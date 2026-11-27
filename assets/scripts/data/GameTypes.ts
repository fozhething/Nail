/**
 * 游戏核心数据契约。
 *
 * 规则：
 * 1. 只描述"数据形状"，不依赖 Cocos，也不放具体关卡数据。
 * 2. 所有 id 都是"同类型内唯一"的编号（pinId 和 catId 可以同为 3）。
 * 3. 颜色通道使用 0~255 的整数。
 * 4. 金额/进度单位见各字段注释。
 *
 * 对应参考项目里散落在 ColorDate / Global / DjManger / Enums 中的字段。
 */

/** 一种颜色，钉子和猫盒共用；只有 colorId 相同才能装进猫盒 */
export interface ColorDef {
    /** 颜色编号，同一关内唯一，用于钉子和猫盒匹配 */
    id: number;
    /** 红色通道，0~255 */
    r: number;
    /** 绿色通道，0~255 */
    g: number;
    /** 蓝色通道，0~255 */
    b: number;
}

/** 钉子的生命周期状态 */
export enum PinState {
    /** 插在板材孔位上，可以被玩家点击 */
    OnBoard = 'OnBoard',
    /** 已离开孔位，正在飞向猫盒或缓冲位，期间不可再次点击 */
    Flying = 'Flying',
    /** 已装进猫盒，计入过关进度 */
    InCat = 'InCat',
    /** 已放进缓冲位，等待同色猫盒把它吸走 */
    InBuffer = 'InBuffer',
    /** 已进入暂存区，等待同色猫盒把它吸走 */
    InBucket = 'InBucket',
    /** 已销毁或回收，不再参与任何判断 */
    Removed = 'Removed',
}

/** 猫盒的状态 */
export enum SlotState {
    /** 上锁，不能装钉；开盒道具可以解锁 */
    Locked = 'Locked',
    /** 空闲，可以接收同色钉子 */
    Idle = 'Idle',
    /** 正在飞入或飞出（换色入场动画），期间不接收钉子 */
    Flying = 'Flying',
    /** 正在装填或结算（动画进行中） */
    Filling = 'Filling',
    /** 已装满并完成结算，等待换成新颜色 */
    Done = 'Done',
}

/** 整局游戏的流程状态；只有 Playing 状态允许玩家操作 */
export enum GameState {
    /** 加载或装配关卡中，不能操作 */
    Loading = 'Loading',
    /** 正常游玩，可以点击钉子 */
    Playing = 'Playing',
    /** 结算中（猫盒完成或失败判定延迟），暂时禁止操作 */
    Resolving = 'Resolving',
    /** 过关 */
    Win = 'Win',
    /** 失败 */
    Lose = 'Lose',
}

/** 一颗钉子的运行时数据 */
export interface PinRuntime {
    /** 钉子编号，同类型内唯一（1、2、3…）；界面用它找到对应节点 */
    id: number;
    /** 颜色编号，对应 ColorDef.id；必须与猫盒的 colorId 相同才能装入 */
    colorId: number;
    /** 所在层的编号，来自关卡预制体里的层节点 */
    layerId: number;
    /** 所在板材的编号，来自关卡预制体里的 Element 节点 */
    elementId: number;
    /** 所在孔位的编号；钉子离板后仍保留，方便回查它原来在哪 */
    holeId: number;
    /** 当前生命周期状态 */
    state: PinState;
}

/** 一个猫盒的运行时数据，最多装 rules.catCapacity 颗钉子 */
export interface CatSlotRuntime {
    /** 猫盒编号，同类型内唯一（1、2、3、4） */
    id: number;
    /** 当前要求的颜色编号；与钉子 colorId 相同才允许装入 */
    colorId: number;
    /** 是否上锁；true 时不能装钉，开盒道具可以解锁 */
    locked: boolean;
    /** 猫盒当前状态 */
    state: SlotState;
    /** 已装入的钉子编号列表，长度范围 0 ~ catCapacity；装满后触发结算 */
    pinIds: number[];
}

/** 一个缓冲位的运行时数据 */
export interface BufferSlotRuntime {
    /** 缓冲位编号，同类型内唯一（1 ~ 7） */
    id: number;
    /** 是否上锁；true 时不能放钉子，开孔道具可以解锁 */
    locked: boolean;
    /** 当前放着的钉子编号；null 表示空位 */
    pinId: number | null;
}

/** 暂存区：放不下的钉子先存这里，等对应颜色的猫盒来吸走 */
export interface BucketRuntime {
    /** 暂存区里的钉子编号列表，顺序不重要 */
    pinIds: number[];
}

/** 一关的进度汇总，对应参考项目的 Global 计数器 */
export interface LevelProgress {
    /** 当前关卡号，从 1 开始；0 表示还没开始 */
    levelId: number;
    /** 本关钉子总数（等于总孔数）；过关条件是 placedPins >= totalPins */
    totalPins: number;
    /** 已装进猫盒并完成结算的钉子数；每完成一个猫盒增加 catCapacity */
    placedPins: number;
    /** 本局获得的金币，用于道具购买 */
    coinsEarned: number;
    /** 本局流程状态 */
    state: GameState;
}

/** 玩法事件名，供 EventBus 使用 */
export const GameEvents = {
    /** 玩家成功拔起一颗钉子并决定去向；界面据此播放飞行动画 */
    PinPicked: 'game:pin-picked',
    /** 猫盒装满并完成结算；用于加金币、加进度、换色 */
    CatFilled: 'game:cat-filled',
    /** 猫盒换上新颜色重新入场；界面刷新颜色和位置 */
    CatRefilled: 'game:cat-refilled',
    /** 过关进度变化；HUD 更新进度条 */
    ProgressChanged: 'game:progress-changed',
    /** 金币变化；HUD 更新金币数字 */
    CoinsChanged: 'game:coins-changed',
    /** 过关 */
    LevelWin: 'game:level-win',
    /** 失败 */
    LevelLose: 'game:level-lose',
} as const;

/** 所有合法事件名的联合类型，EventBus 用它做类型检查 */
export type GameEventName = (typeof GameEvents)[keyof typeof GameEvents];

/**
 * 全局规则，对应参考项目的：
 * 每种颜色 3 颗钉子、猫盒 3 孔、道具 30×关卡、金币 2 次 / 广告 5 次。
 */
export interface RulesConfig {
    /** 每种颜色生成几颗钉子；通常是 catCapacity 的倍数，保证能整除进猫盒 */
    pinsPerColor: number;
    /** 每个猫盒的孔数，决定装满一盒需要几颗同色钉子 */
    catCapacity: number;
    /** 道具基础价格；实际价格 = basePropCost × 当前关卡号 */
    basePropCost: number;
    /** 每关每个道具允许用金币购买的次数 */
    coinUseLimit: number;
    /** 每关每个道具允许看广告使用的次数 */
    videoUseLimit: number;
    /** 正常显示的层数；再往下一层显示为黑影预告 */
    visibleLayerCount: number;
}

/** 默认规则：与原项目的数值保持一致 */
export const DEFAULT_RULES: RulesConfig = {
    pinsPerColor: 3,      // 每种颜色 3 颗钉子
    catCapacity: 3,       // 猫盒 3 个孔
    basePropCost: 30,     // 道具 30 × 关卡 金币
    coinUseLimit: 2,      // 每关每个道具金币 2 次
    videoUseLimit: 5,     // 每关每个道具广告 5 次
    visibleLayerCount: 4, // 显示前 4 层
};
