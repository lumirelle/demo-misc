# ASD-STE100 skill 实验记录（2026-09-01）

## 问题

已安装 `asd-ste100` skill（v0.4.0，位于 `~/.pi/agent/skills/asd-ste100/`）。验证两点：
1. 对任意英文/中文回答，skill 是否自动生效？
2. 强制应用时，英文和中文分别是什么效果？

## 方法

三组对照子代理，同一模型，任务并行：

| 组 | skill 加载 | 任务 | session |
|---|---|---|---|
| A 自然触发 | 是（skills=asd-ste100） | 普通问答（EN 索引原理 / ZH 索引原理 / EN 状态报告），不提 STE，禁止读文件 | `2026-09-01T06-13-21-618Z_37c437f0…jsonl` |
| B 强制应用 | 是 | 读 SKILL.md 后改写 EN/ZH 样本 + 用规则新生成 EN/ZH 报告 | `2026-09-01T06-13-21-663Z_f9b3c90a…jsonl` |
| C 对照 | 否（skills=""） | 相同四项任务，只说"改清楚点"，不提 STE，禁止读文件 | `2026-09-01T06-13-21-710Z_06da72ac…jsonl` |

测试样本（B、C 相同）：

> EN: "We have received your report regarding the deployment failure that may potentially have been caused by a configuration issue. Our team is currently performing an analysis of the logs in order to identify the root cause; it is important to note that the new robust caching layer will seamlessly spin up additional worker nodes and help to improve performance. Files not backed up will be lost."
>
> ZH: "本次重构采用了先进的架构设计，赋能研发团队提升交付效率。这不是单纯的性能优化，而是底层逻辑的全面升级：新链路不仅不挡主流程，每行都活，还能沉淀可复用能力，为业务闭环打下坚实基础。目前团队的体感是稳定性有了较大提升。"

## 结果

### A 组：自然触发 → 完全不生效

三个回答均无 STE 痕迹。英文回答单句约 60 词、分号连接复合句；状态报告（skill 声明的适用文本类型）仍是 "actively investigating / as soon as we have more information" 式企业腔。**触发的决定因素是任务框架（是否暗示"机器解析、误读有代价"），不是文本类型。**

### B 组 vs C 组：英文改写

| 维度 | B（STE 强制） | C（通用润色） |
|---|---|---|
| hedge 处理 | "A configuration issue may have caused the failure." 原样保留 hedge | "We think a configuration error caused it, but we have not confirmed this yet." issue→error，措辞被强化 |
| "Files not backed up will be lost" | 保留 "will be lost"，Kept as-is 标注（源文本无施动者） | 改为 "will be deleted"——补入源文本没有的具体性 |
| Kept as-is 输出契约 | 严格遵守 | 无此概念 |
| 副作用 | "Our team now analyzes the logs"（禁进行时导致轻微生硬） | 更自然，但解释性更强 |

B 的差异化价值：**忠实性纪律**（保 hedge 强度、不添加事实、偏离处标注）。这正是 skill 设计场景（机器解析的字符串）需要的。

### B 组 vs C 组：中文改写

B 明确承认 "ASD-STE100 has no Chinese edition"，类比迁移了 5 条：删营销形容词（先进/坚实）、名词化→动词、拆多主题句、术语一致、保 hedge 不加事实。判定无中文等价物的规则：时态限制、主语省略禁令（中文意合语法的正常现象）、短语动词、词性锁定、词长上限（无计数单位）。

B 的中文改写（忠实但保留病灶）：

> 本次重构使用了新的架构，研发团队可以用它更快地交付代码。本次重构不只优化性能，也更改了底层的逻辑。新链路不会阻挡主流程，每一行都保持活跃。新链路还提供了可重复使用的功能。目前团队的体感是稳定性有了较大的提升。

C 的中文改写（更好读但靠猜）：

> 我们重构了服务架构，目标是提高交付效率，这不只是性能优化。新链路异步执行，不阻塞主流程；所有代码都在实际运行，没有闲置代码。重构还产出了几个可复用模块，后续业务可以直接使用。团队目前的反馈是稳定性明显提升。

- B 把 "每行都活" 按 Kept-as-is 原样保留、"底层的逻辑" 保留、"不只…也" 结构保留——用户最在意的三个病灶，B 治了两个半之外的全部（只治了黑话和名词化）。
- C 全部治了，但 "异步执行""闲置代码" 是源文本没有的机制，**靠编造换可读性**；且残留 "这不只是性能优化"（"不是X而是Y" 弱化变体）。
- 结论：**中文上 STE 类比迁移 ≈ "删营销形容词 + 不编造"，可读性收益低于通用润色；通用润色的可读性收益以编造为代价。** 两者各自的优点恰好互补。

### 生成任务（B、C 的 c/d 项）：都编造细节

B 和 C 在新生成状态报告时均虚构了具体值（4021、14:30 UTC、30 秒超时、17:00 截止）。STE 的 "add no facts" 纪律只约束改写（有源文本可对照），**对无源生成任务不起作用**——它管形式，不管真实性。

## 结论

1. **作为全局输出风格：无效**（A 组）。skill 的 description 把适用范围限定在"机器要解析的英文文本"，普通问答不触发。想要全局生效需要 AGENTS.md 规则块或强制 skills 加载，skill 本身做不到。
2. **英文改写：有效且优于通用润色**，差异点在忠实性纪律（hedge 保真、不添加事实、Kept as-is 标注），适合工具描述、错误消息、prompt 等机器消费文本。
3. **中文：结构性不覆盖**。类比迁移后只剩弱化版（营销形容词 + 忠实性），治不了"不是X而是Y"、模糊转义（"每行都活"）和信息密度问题；且无词表可依，一词一义无法执行。
4. **反编造纪律值得移植**："add no facts / keep hedges" 是全实验中对中文最有迁移价值的两条，应写入 AGENTS.md 规则块（改写时不得补全机制如"异步执行"、不得把"体感/较大"升级为断言）。
5. **无源生成任务，任何文风规则都不防编造**——需要单独的"结论必须含可核对内容（数字/名称/命令）"规则。

## 建议

- skill 保留，用于其设计场景：给 agent 消费的英文字符串（工具描述、错误消息、系统提示）。
- 全局回答文风（EN+ZH）用 AGENTS.md 规则块（见同日讨论），并把本实验验证的两条 STE 纪律移植进去。
- 局限性：每组 n=1，单样本；B 组读了参考文件、C 组没有，条件不完全对称。结论是方向性的。
