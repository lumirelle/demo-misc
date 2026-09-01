# 改写前后对比（B=STE 强制应用，C=通用润色对照）

A 组（自然触发）无改写产物——它根本没有触发，这正是实验结论之一。

## 英文样本

**原文**（病灶：现在完成时；hedge 堆叠 may potentially；被动语态；名词化 performing an analysis of；分号连接无关话题；it is important to note 填充词；营销形容词 robust/seamlessly；短语动词 spin up；省略引发歧义的警告句）：

> We have received your report regarding the deployment failure that may potentially have been caused by a configuration issue. Our team is currently performing an analysis of the logs in order to identify the root cause; it is important to note that the new robust caching layer will seamlessly spin up additional worker nodes and help to improve performance. Files not backed up will be lost.

### 逐句对比

**S1** — We have received your report regarding the deployment failure that may potentially have been caused by a configuration issue.

- B: "We received your report about the deployment failure. A configuration issue may have caused the failure."
  完成时→过去时；regarding→about；被动→主动；hedge 堆叠压缩为 "may have caused" 但**强度不变**。
- C: "We received your report about the deployment failure. We think a configuration error caused it, but we have not confirmed this yet."
  同样修完前三项；hedge 改写成显式的不确定声明。**issue→error，断言被悄悄加强**。

**S2** — Our team is currently performing an analysis of the logs in order to identify the root cause; it is important to note that the new robust caching layer will seamlessly spin up additional worker nodes and help to improve performance.

- B: "Our team now analyzes the logs to identify the root cause. The new caching layer will start additional worker nodes. This may improve performance."
  名词化→动词（analyzes）；分号拆句；删 robust/seamlessly；spin up→start；"help to improve"→"may improve"。代价：禁进行时产生轻微生硬的 "now analyzes"。
- C: "Our team is now analyzing the logs to find the root cause. Separately: the new caching layer automatically adds worker nodes when load increases, which improves performance."
  同样修名词化和分号。**"automatically…when load increases" 是给 seamlessly 猜的机制；"which improves performance" 把 "help to improve" 升级成了断言**。

**S3** — Files not backed up will be lost.

- B: "Files that have no backup will be lost." — 补全省略消除歧义；"lost" 无施动者，保留被动并 Kept-as-is 标注。
- C: "Action required: back up your files now. Any file that is not backed up will be deleted." — 补全省略；把埋没的警告提升为行动项（超出改写的编辑判断，但是好判断）；**lost→deleted，补入了源文本没有的机制（删除意味着有删除者）**。

## 中文样本

**原文**（病灶：营销形容词 先进的/坚实；名词化 采用了…设计；黑话 赋能/底层逻辑/沉淀/业务闭环；"不是…而是…" 注水句式；自造转义 不挡主流程/每行都活；模糊限定 体感/较大）：

> 本次重构采用了先进的架构设计，赋能研发团队提升交付效率。这不是单纯的性能优化，而是底层逻辑的全面升级：新链路不仅不挡主流程，每行都活，还能沉淀可复用能力，为业务闭环打下坚实基础。目前团队的体感是稳定性有了较大提升。

### 逐句对比

**S1** — 本次重构采用了先进的架构设计，赋能研发团队提升交付效率。

- B: "本次重构使用了新的架构，研发团队可以用它更快地交付代码。" — 名词化→动词；删"先进的"；"赋能"落成"更快地交付"。
- C: "我们重构了服务架构，目标是提高交付效率。" — 同样删干净，更紧凑。

**S2** — 这不是单纯的性能优化，而是底层逻辑的全面升级：新链路不仅不挡主流程，每行都活，还能沉淀可复用能力，为业务闭环打下坚实基础。

- B: "本次重构不只优化性能，也更改了底层的逻辑。新链路不会阻挡主流程，每一行都保持活跃。新链路还提供了可重复使用的功能。"
  拆掉冒号长句；"沉淀可复用能力/业务闭环/坚实基础"→"提供了可重复使用的功能"；术语一致（重构/新链路各指其物）。**但保留了"不只…也"句式、"底层的逻辑"、"每行都活"（Kept-as-is：原文含义不明，按忠实原则拒绝补全）**。
- C: "新链路异步执行，不阻塞主流程；所有代码都在实际运行，没有闲置代码。重构还产出了几个可复用模块，后续业务可以直接使用。"
  **把"每行都活"翻译成了具体含义（猜的）；"异步执行"是编造的机制**。黑话清得最干净。

**S3** — 目前团队的体感是稳定性有了较大提升。

- B: "目前团队的体感是稳定性有了较大的提升。" — 原样保留。体感=主观感受、较大=未量化，hedge 强度分毫未动。
- C: "团队目前的反馈是稳定性明显提升。" — "体感"→"反馈"可以；**"较大"→"明显"，hedge 强度被放大**。

## 汇总

| 维度 | B（STE） | C（通用） |
|---|---|---|
| 结构病灶（长句、名词化、堆叠） | 全修，代价是轻微生硬 | 全修，更自然 |
| hedge 保真 | 分毫不差，偏离处标注 | 两次升级断言（error / 明显） |
| 不编造 | 严格（宁可保留"每行都活"不解释） | 三处编造（error、异步执行、deleted） |
| "不是X而是Y"句式 | 保留（不只…也） | 保留（这不只是） |
| 中文黑话清除 | 部分（保留"底层的逻辑"） | 最彻底 |
| 可读性 | 忠实但"每行都活"照旧难懂 | 最好读，但读者不知道哪些是猜的 |

两组都没治"不是X而是Y"——两个 prompt 里都没有这条规则。这印证了之前的结论：这类病灶要写进显式禁令，靠任何现成文风手册都碰不到。
