import {
    BucketRuntime,
    BufferSlotRuntime,
    CatSlotRuntime,
    GameState,
    LevelProgress,
    PinRuntime,
} from './GameTypes';

/**
 * 一局关卡的运行时数据账本。
 *
 * 约定：
 * 1. 只保存状态，不做规则判断；规则统一放在 GameSession。
 * 2. 只允许 GameSession 修改；界面（View）只读。
 * 3. 每次开新关时重新创建一份，上一局的数据直接丢弃。
 */
export class LevelState {
    /** 本关所有钉子，装配时按孔位 1:1 生成 */
    pins: PinRuntime[] = [];

    /** 本关所有猫盒，长度等于场景里的猫盒数量 */
    cats: CatSlotRuntime[] = [];

    /** 本关所有缓冲位，长度等于场景里的缓冲位数量 */
    buffers: BufferSlotRuntime[] = [];

    /** 暂存区，全局只有一个，用于存放暂时匹配不到猫盒的钉子 */
    bucket: BucketRuntime = { pinIds: [] };

    /** 本关的进度、金币和流程状态 */
    progress: LevelProgress = {
        levelId: 0,               // 0 表示还没开始
        totalPins: 0,             // 装配时填入总孔数
        placedPins: 0,            // 每完成一个猫盒增加 catCapacity
        coinsEarned: 0,           // 本局获得的金币
        state: GameState.Loading, // 初始为加载中
    };
}
