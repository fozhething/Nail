import {
    BufferSlotRuntime,
    CatSlotRuntime,
    DEFAULT_RULES,
    GameEventName,
    GameEvents,
    GameState,
    PinRuntime,
    PinState,
    RulesConfig,
    SlotState,
} from './data/GameTypes';
import { LevelState } from './data/LevelState';

/**
 * 关卡规则执行者（裁判）。
 *
 * 职责：
 * - 接收玩家操作；
 * - 用 id 在 LevelState 中查数据；
 * - 按规则和当前状态判断；
 * - 合法时修改账本；
 * - 发出事件通知界面。
 *
 * 约定：
 * - 只有本类可以修改 LevelState；
 * - 不直接操作 Node / Sprite / 动画 / UI；
 * - 未确定的规则用 TODO 标出，不写假实现。
 */
export class LevelController {
    // #region 依赖与构造

    constructor(
        private readonly state: LevelState,
        private readonly emit: (event: GameEventName, payload?: unknown) => void = () => {},
        private readonly rules: RulesConfig = DEFAULT_RULES,
    ) {}

    // #endregion

    // #region 对外接口

    /**
     * 点击一颗钉子。
     * @returns true 表示操作被接受并已修改账本；false 表示被拒绝。
     */
    public pickPin(pinId: number): boolean {
        // 流程守卫
        if (!this.canOperate()) {
            return false;
        }

        // 查账本：钉子必须存在，且还在板上
        const pin = this.findPin(pinId);
        if (!pin || pin.state !== PinState.OnBoard) {
            return false;
        }

        // TODO（遮挡）：判断是否被上层板材盖住。
        // 依赖 BoardView 提供的多边形数据，暂不在数据层实现。

        // 优先放入猫盒
        const cat = this.findCatFor(pin);
        if (cat) {
            const willFull = this.movePinToCat(pin, cat);
            this.emit(GameEvents.PinPicked, pin);

            if (willFull) {
                this.completeCat(cat);
            }
            return true;
        }

        // 猫盒不收，再尝试缓冲位
        const buffer = this.findFreeBuffer();
        if (!buffer) {
            // 猫盒不收、缓冲位也没有空位：失败
            this.state.progress.state = GameState.Lose;
            this.emit(GameEvents.LevelLose);
            return false;
        }

        this.movePinToBuffer(pin, buffer);
        this.emit(GameEvents.PinPicked, pin);

        // 放进去之后，缓冲位全满：失败
        if (!this.findFreeBuffer()) {
            this.state.progress.state = GameState.Lose;
            this.emit(GameEvents.LevelLose);
        }
        return true;
    }

    /**
     * 使用道具（待实现）。
     * TODO：道具契约确定后，把 type 改成 PropType，
     * 再补金币/广告次数判断和具体道具效果。
     */
    public useProp(_type: string): boolean {
        return false;
    }

    // #endregion

    // #region 查询

    /** 按编号找钉子 */
    private findPin(pinId: number): PinRuntime | undefined {
        return this.state.pins.find((pin) => pin.id === pinId);
    }

    /**
     * 找到可以接收这颗钉子的猫盒。
     * 条件：未锁定、空闲、颜色相同、还有空位。
     * 多个可选时选已装最多的，等价于剩余空位最少。
     */
    private findCatFor(pin: PinRuntime): CatSlotRuntime | undefined {
        let best: CatSlotRuntime | undefined;

        for (const cat of this.state.cats) {
            if (!this.canPutInCat(cat, pin)) {
                continue;
            }
            if (!best || cat.pinIds.length > best.pinIds.length) {
                best = cat;
            }
        }
        return best;
    }

    /** 找到第一个未锁定且为空的缓冲位 */
    private findFreeBuffer(): BufferSlotRuntime | undefined {
        return this.state.buffers.find((buffer) => !buffer.locked && buffer.pinId === null);
    }

    // #endregion

    // #region 判断

    /** 只有 Playing 状态允许操作 */
    private canOperate(): boolean {
        return this.state.progress.state === GameState.Playing;
    }

    /** 猫盒能否接收这颗钉子 */
    private canPutInCat(cat: CatSlotRuntime, pin: PinRuntime): boolean {
        return (
            !cat.locked &&
            cat.state === SlotState.Idle &&
            cat.colorId === pin.colorId &&
            cat.pinIds.length < this.rules.catCapacity
        );
    }

    /** 已装数量达到总数即过关 */
    private isWin(): boolean {
        return (
            this.state.progress.totalPins > 0 &&
            this.state.progress.placedPins >= this.state.progress.totalPins
        );
    }

    // #endregion

    // #region 修改

    /**
     * 把钉子放进猫盒。
     * @returns true 表示这颗钉子让猫盒装满了。
     */
    private movePinToCat(pin: PinRuntime, cat: CatSlotRuntime): boolean {
        pin.state = PinState.InCat;
        cat.pinIds.push(pin.id);
        return cat.pinIds.length >= this.rules.catCapacity;
    }

    /** 把钉子放进缓冲位 */
    private movePinToBuffer(pin: PinRuntime, buffer: BufferSlotRuntime): void {
        pin.state = PinState.InBuffer;
        buffer.pinId = pin.id;
    }

    /** 猫盒装满后的结算：加进度、加金币、判断过关 */
    private completeCat(cat: CatSlotRuntime): void {
        const count = cat.pinIds.length;

        // 清空猫盒，等待换色
        cat.state = SlotState.Done;
        cat.pinIds = [];

        this.state.progress.placedPins += count;
        this.state.progress.coinsEarned += count;

        this.emit(GameEvents.CatFilled, count);
        this.emit(GameEvents.ProgressChanged);
        this.emit(GameEvents.CoinsChanged);

        if (this.isWin()) {
            this.state.progress.state = GameState.Win;
            this.emit(GameEvents.LevelWin);
            return;
        }

        this.state.progress.state = GameState.Resolving;
        this.refillCat(cat);
    }

    // #endregion

    // #region 待实现

    /**
     * TODO（关卡规则）：猫盒完成后换新颜色并重新入场。
     * 需要 LevelRules 提供：
     * - 猫盒颜色队列；
     * - 按关卡选择取色策略（原项目 r_0 ~ r_4）；
     * - 换色后把 cat.state 置回 Idle、progress.state 置回 Playing；
     * - 发出 GameEvents.CatRefilled。
     */
    private refillCat(_cat: CatSlotRuntime): void {
        // 等 LevelRules 完成后接这里
    }

    // #endregion
}
