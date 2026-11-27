import { _decorator, Component, instantiate, Node, Prefab } from 'cc';
import { DEFAULT_RULES } from './data/GameTypes';

const { ccclass, property } = _decorator;

interface LevelNodes {
    units: Node[];
    layers: Node[];
    elements: Node[];
    holes: Node[];
}

interface CheckReport {
    source: Node;
    info: LevelNodes;
    holeCount: number;
    needCatCount: number;
    colorCount: number;
}

/**
 * 关卡数据检查器。
 *
 * 对应原项目的关卡生成逻辑：
 * - 模板结构：lvl_N → Unit → Layer → Element → Hole
 * - 运行时拍平：lvl_x → Layer → Element → Hole
 * - 孔数 ÷ 3 = 需要装满猫的次数
 * - 颜色数量按关卡规则计算，超过基础色时循环使用
 *
 * 只做检查，不生成钉子、不修改关卡。
 */
@ccclass('LevelDataChecker')
export class LevelDataChecker extends Component {
    @property({ type: Prefab, tooltip: '关卡配方预制体 lvl_N；与 levelNode 二选一，优先使用 levelNode' })
    levelTemplate: Prefab = null!;

    @property({ type: Node, tooltip: '场景里已存在的关卡节点 lvl_x；绑定后不再实例化预制体' })
    levelNode: Node = null!;

    @property({ type: Node, tooltip: '猫盒根节点 layerRootSlot' })
    slotRoot: Node = null!;

    @property({ type: Node, tooltip: '缓冲位根节点 layerRootEmpty' })
    emptyRoot: Node = null!;

    @property({ tooltip: '关卡号，用于计算本关应有的颜色数量' })
    levelNumber = 1;

    @property({ tooltip: '孔位节点名' })
    holeNodeName = 'hole';

    private errors: string[] = [];
    private warnings: string[] = [];

    start() {
        this.runCheck();
    }

    /** 可手动调用，重新执行一次检查 */
    public runCheck() {
        this.errors = [];
        this.warnings = [];

        const source = this.getSource();
        if (!source) {
            this.printReport(null);
            return;
        }

        const info = this.collect(source.node);
        const holeCount = info.holes.length;
        const needCatCount = holeCount / 3;
        const colorCount = this.getExpectedColorCount(this.levelNumber);

        this.checkLevelStructure(source.node, info, holeCount);
        this.checkColors(colorCount, needCatCount, holeCount);
        this.checkCatSlots();
        this.checkBuffers();
        this.checkLayers(info.layers.length);

        if (info.units.length > 0) {
            console.log(`[LevelDataChecker] 模板含 ${info.units.length} 个 Unit，运行时会被拍平成 ${info.layers.length} 层`);
        }

        this.printReport({
            source: source.node,
            info,
            holeCount,
            needCatCount,
            colorCount,
        });

        // 临时实例化的预制体用完即销毁，不留在场景里
        if (source.temp) {
            source.node.destroy();
        }
    }

    /** 优先用场景里的关卡节点；否则临时实例化配方预制体 */
    private getSource(): { node: Node; temp: boolean } | null {
        if (this.levelNode) {
            return { node: this.levelNode, temp: false };
        }
        if (this.levelTemplate) {
            if (this.levelNumber <= 10 && this.levelTemplate.name !== `lvl_${this.levelNumber}`) {
                this.warnings.push(
                    `配方 ${this.levelTemplate.name} 与关卡号 ${this.levelNumber} 不一致（预期 lvl_${this.levelNumber}）`,
                );
            }
            return { node: instantiate(this.levelTemplate), temp: true };
        }
        this.errors.push('未绑定 levelNode 或 levelTemplate');
        return null;
    }

    /** 收集 Unit / Layer / Element / Hole 节点 */
    private collect(root: Node): LevelNodes {
        const info: LevelNodes = { units: [], layers: [], elements: [], holes: [] };
        const targetHoleName = this.holeNodeName.toLowerCase();

        const walk = (node: Node) => {
            const name = node.name.toLowerCase();
            if (name.startsWith('unit')) {
                info.units.push(node);
            } else if (name.startsWith('layer')) {
                info.layers.push(node);
            }
            if (name.startsWith('element')) {
                info.elements.push(node);
            }
            if (name === targetHoleName) {
                info.holes.push(node);
            }
            node.children.forEach(walk);
        };

        walk(root);
        return info;
    }

    private checkLevelStructure(root: Node, info: LevelNodes, holeCount: number) {
        if (holeCount === 0) {
            this.errors.push('没有找到任何孔位，检查孔位节点名或关卡预制体');
        }
        if (holeCount > 0 && holeCount % 3 !== 0) {
            this.errors.push(`孔数 ${holeCount} 不是 3 的倍数，need_slot_num 会变成小数，关卡会死局`);
        }
        if (info.layers.length === 0) {
            this.errors.push('没有找到层节点（layer*）');
        }
        if (info.elements.length === 0) {
            this.errors.push('没有找到板材节点（element*）');
        }

        for (const element of info.elements) {
            if (this.countByName(element, this.holeNodeName) === 0) {
                this.warnings.push(`板材 ${element.name} 没有孔位`);
            }
        }

        for (const layer of info.layers) {
            const elementNum = layer.children.filter((child) =>
                child.name.toLowerCase().startsWith('element'),
            ).length;
            if (elementNum === 0) {
                this.warnings.push(`层 ${layer.name} 没有板材`);
            }
        }

        for (const hole of info.holes) {
            if (!this.hasAncestor(hole, 'element', root)) {
                this.warnings.push(`孔位 ${hole.name} 不在板材节点下，可能不是 element → hole 结构`);
            }
        }

        for (const unit of info.units) {
            if (this.countDescendantsByPrefix(unit, 'layer') === 0) {
                this.warnings.push(`Unit ${unit.name} 没有层`);
            }
        }
    }

    private checkColors(colorCount: number, needCatCount: number, holeCount: number) {
        if (colorCount <= 0) {
            this.errors.push('颜色数量必须大于 0');
            return;
        }
        if (colorCount > 11) {
            this.warnings.push(`关卡需要 ${colorCount} 种颜色，超过 11 个基础色，运行时会循环使用`);
        }
        if (holeCount > 0) {
            console.log(
                `[LevelDataChecker] 需装满 ${needCatCount} 次猫（${holeCount} / 3），本关颜色 ${colorCount} 种，同色会循环使用`,
            );
        }
    }

    private checkCatSlots() {
        if (!this.slotRoot) {
            this.errors.push('未绑定 slotRoot（layerRootSlot）');
            return;
        }
        const slots = this.slotRoot.children;
        if (slots.length === 0) {
            this.errors.push('猫盒数量为 0');
            return;
        }

        let unlocked = 0;
        for (const slot of slots) {
            const holeNum = this.countByName(slot, this.holeNodeName);
            if (holeNum !== DEFAULT_RULES.catCapacity) {
                this.errors.push(
                    `猫盒 ${slot.name} 有 ${holeNum} 个孔，应为 ${DEFAULT_RULES.catCapacity}`,
                );
            }
            if (!this.isLocked(slot)) {
                unlocked++;
            }
        }

        if (unlocked === 0) {
            this.errors.push('所有猫盒都是锁定状态，开局无法装钉');
        }
    }

    private checkBuffers() {
        if (!this.emptyRoot) {
            this.warnings.push('未绑定 emptyRoot（layerRootEmpty），跳过缓冲位检查');
            return;
        }
        if (this.emptyRoot.children.length === 0) {
            this.warnings.push('缓冲位数量为 0，错色钉子无处暂存，会直接失败');
        }
    }

    private checkLayers(layerCount: number) {
        if (layerCount === 0) {
            return;
        }
        if (layerCount < DEFAULT_RULES.visibleLayerCount) {
            console.log(
                `[LevelDataChecker] 层数 ${layerCount} < ${DEFAULT_RULES.visibleLayerCount}，不会出现第 5 层黑影预告`,
            );
        }
    }

    /** 颜色数量规则：1关3色；2~5关5色；6~7关6色；8~9关8色；10关以后 = 关卡号 */
    private getExpectedColorCount(level: number): number {
        if (level <= 1) {
            return 3;
        }
        if (level <= 5) {
            return 5;
        }
        if (level <= 7) {
            return 6;
        }
        if (level <= 9) {
            return 8;
        }
        return level;
    }

    private countByName(root: Node, name: string): number {
        const target = name.toLowerCase();
        let count = 0;
        const walk = (node: Node) => {
            if (node.name.toLowerCase() === target) {
                count++;
            }
            node.children.forEach(walk);
        };
        root.children.forEach(walk);
        return count;
    }

    private countDescendantsByPrefix(root: Node, prefix: string): number {
        let count = 0;
        const walk = (node: Node) => {
            if (node.name.toLowerCase().startsWith(prefix)) {
                count++;
            }
            node.children.forEach(walk);
        };
        root.children.forEach(walk);
        return count;
    }

    private hasAncestor(node: Node, prefix: string, root: Node): boolean {
        let current = node.parent;
        while (current && current !== root) {
            if (current.name.toLowerCase().startsWith(prefix)) {
                return true;
            }
            current = current.parent;
        }
        return false;
    }

    /** 约定：槽位下的 lock 子节点处于激活状态 = 锁定 */
    private isLocked(slot: Node): boolean {
        const lock = slot.getChildByName('lock');
        return !!lock && lock.active;
    }

    private printReport(report: CheckReport | null) {
        console.log('========== 关卡数据检查 ==========');
        if (report) {
            const bufferCount = this.emptyRoot ? this.emptyRoot.children.length : 0;
            const catCount = this.slotRoot ? this.slotRoot.children.length : 0;
            console.log(`关卡: ${this.levelNumber}，来源: ${report.source.name}`);
            console.log(
                `层: ${report.info.layers.length}，板材: ${report.info.elements.length}，孔: ${report.holeCount}`,
            );
            console.log(`钉子: ${report.holeCount}（1 孔 1 钉）`);
            console.log(`需装满猫: ${report.needCatCount} 次（${report.holeCount} / 3）`);
            console.log(`颜色: 规则需要 ${report.colorCount} 种`);
            console.log(`猫盒: ${catCount} 个，每盒 ${DEFAULT_RULES.catCapacity} 孔`);
            console.log(`缓冲位: ${bufferCount} 个`);
        }

        this.warnings.forEach((message) => console.warn(`[检查警告] ${message}`));
        this.errors.forEach((message) => console.error(`[检查错误] ${message}`));

        if (this.errors.length > 0) {
            console.error(`检查失败：${this.errors.length} 个错误，${this.warnings.length} 个警告`);
        } else {
            console.log(`检查通过（${this.warnings.length} 个警告）`);
        }
    }
}
