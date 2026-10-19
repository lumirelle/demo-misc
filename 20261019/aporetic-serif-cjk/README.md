# Aporetic Serif 的中文搭配

样本页：`compare.html`（比例版）、`mono.html`（等宽版）

## 粗体（朱雀只有 Regular）

`./build-bold.py fonts/ZhuqueFangsong-Regular.ttf fonts/ZhuqueFangsong-Bold.ttf 30`（需 `pip install skia-pathops`，约 14 s）

- 做法：轮廓 ∪ 自身描边(30) 求并，即沿法线向外扩，**不是横向拉伸的伪粗体**；miter join 上限 2，直角仍是直角
- 实测竖画 **54 → 84/1000**（思源宋体 400 是 68、Bold 是 100），advance **不变**，等宽/对齐不受影响
- family 名与原版保持一致，subfamily = Bold、`usWeightClass = 700`、`fsSelection` BOLD 位、`macStyle` bold 位 —— 装两个字重后系统与编辑器会自动选中
- 代价：密字（警/鼻/疆）比手绘 Bold 更易糊；强度甜区 **26–34**，再往上开始闭口；2 个字形（如 `uni9802`）外扩失败、保底为原样
- 想给等宽版用：`build-bold.py` 后再跑一次 `build-1050.py` 即可得到 A1050 Bold

页面：`bold.html`。



## Mono 版（`spacing = "fixed"`）

字形与比例版完全相同，只有宽度约束变了，于是中英对齐先出问题：

- 西文单字 **525/1000 em**，汉字 **1000/1000 em** → **1.905 : 1**，不是 2 : 1
- 2 格 = 1.05 em，每 20 个汉字累积漂出约 1 个字宽；40 格能装 21 个汉字而不是 20 个
- 终端多半把中文强按 2 格绘制并横向压缩约 5%（字变瘦），IDE 则按 advance 排，光标逐行偏移
- **市面上没有为 525 对齐的中文字体**：汉字只有 1 em 一种宽度，5% 只能改字体

四条路子：

| 方案 | 2:1 | 气质 | 代价 |
| --- | --- | --- | --- |
| 朱雀仿宋 + 现有 525 | ✗ | 最接近 | 只适合中文不参与对齐的场合（注释、正文） |
| **自建 1050 宽朱雀仿宋**（本目录已生成） | ✓ | 最接近 | 只跟 525 绑定；部分终端按 wcwidth 重算仍会压回 |
| 自建 500 宽 Iosevka（`widths.normal.shape = 500`） | ✓ | 保住 slab | 要跑构建工具链，code 略变窄 |
| 更纱黑体 Mono SC（Sarasa = Iosevka + 思源黑体） | ✓ | 黑体，属 Sans | 丢掉衬线，但开箱即用、小字号最稳 |

### 1050 宽版怎么做的

`./build-1050.py fonts/ZhuqueFangsong-Regular.ttf fonts/ZhuqueFangsong-Aporetic1050.ttf`

逐个全角字形（11,584 个：汉字、全角标点、U+3000）advance 1000 → 1050、轮廓右移 25 单位保持居中，拉丁与半角标点原样不动；family 改名为 `Zhuque Fangsong A1050`，安装时不会覆盖原版。字形不缩放，所以视觉密度不变、只是字距松 5%。浏览器实测：40 个西文格与 20 个汉字右端误差 0 px。

小字号实测（12/13/14 px 深色底）：朱雀与思源宋体 300 的竖画都是 54–55/1000，12 px 时约 0.65 px，靠抗锯齿才连成线；SimSun 横画 23/1000 会断成虚线。长时间盯终端仍建议黑体，想要衬线味就把字号拉到 14 px 以上。

反过来说：**比例版（quasi-proportional）本来就没有格子，1 em 汉字不会系统性漂移**——在意对齐时，比例版反而更省心。

## 结论

| 优先级 | 字体 | 理由 |
| --- | --- | --- |
| 主力 | **朱雀仿宋** Zhuque Fangsong | 仿宋是中文里唯一「等线 + 方笔」的骨架，与 Aporetic 的板状单侧衬线同源；竖画 54/1000、横竖对比 1.2，字面 775–929，混排不抢戏。OFL 1.1。 |
| 稳妥 | **思源宋体 Light**（Noto Serif SC 300） | 需要正式宋体时的选择，必须用 300；400 竖画 68/1000、西文 89/1000，配 Aporetic 会整体偏重。 |
| 备选 | 聚珍新仿（商用需确认授权）、华文仿宋、Fandol 仿宋（TeX, GPL） | 同属仿宋气质，覆盖与授权各有限制。 |
| 不要用 | 更纱黑体 Sarasa | 它是 Iosevka + 思源黑体，属于 **Aporetic Sans** 的搭档，不是 Serif 的。 |
| 不要用 | SimSun | 横竖对比 2.6，屏幕长文吃力，字面也偏小。 |

## Aporetic Serif 的关键参数（来自 `private-build-plans.toml`）

- `serifs = "slab"`，`spacing = "quasi-proportional"`（Serif Mono 版为 `fixed`）
- 宽度 525/1000；x-height 520；cap 735；竖画 78/1000（近单线）
- 只有 400 / 700，正体 + 9.4° 斜体

## 实测（fontTools 扫描线，单位 1/1000 em）

竖画：「十」在 y=300 处的横向墨宽；横竖对比 = 竖画 / 横画。

| 字体 | 竖画 | 横竖对比 | 汉字字面高 | 字面宽「国」 | x-height |
| --- | --- | --- | --- | --- | --- |
| Aporetic Serif | 78 | 1.0 | — | — | 520 |
| 朱雀仿宋 0.212 | 54 | 1.2 | 877–929 | 775 | 462 |
| 思源宋体 300 | 55 | 1.8 | 891–913 | 838 | 512 |
| 思源宋体 400 | 68 | 2.3 | 899–917 | 845 | 516 |
| SimSun | 59 | 2.6 | 906 | 762 | 437 |

## 落地

- **字号**：汉字字面 ≈900 对 Aporetic cap 735，同字号下中文大 22%，中文压到 **0.82–0.88 em**（正文 0.85）最齐。
- **字重**：配 Aporetic 400，中文字重取「竖画 50–60」那一档；宋体 400 起会往中文那边沉。
- **等宽数学**：Aporetic 单字 0.525 em，汉字 1 em，比例 1.905:1，不是整数 2:1；终端强制 2 格会在左右各多出 0.05 em 的缝。要严格 2:1 就用 Aporetic Serif Mono 或宽度 500 的 Iosevka 构建。

## 文件

- `compare.html` — 比例版对比页（含中文倍率 / 混排字号滑杆）
- `mono.html` — 等宽版：525 vs 500 的对齐演示 + 12/13/14 px 小字号实测
- `bold.html` — 粗体合成：Regular vs Bold 对照、三条路线对比
- `build-1050.py` / `build-bold.py` — 两个构建脚本（后者依赖 `skia-pathops`）
- `fonts/AporeticSerif-Regular-subset.woff2` — 拉丁子集，仅为页面展示用；原文件见 [protesilaos/aporetic](https://github.com/protesilaos/aporetic)
- `fonts/ZhuqueFangsong-Regular.ttf` — v0.212，[TrionesType/zhuque](https://github.com/TrionesType/zhuque)，OFL 1.1，技术预览版
- `fonts/ZhuqueFangsong-Aporetic1050.ttf` — 由 `build-1050.py` 生成的全角 1050 宽版（family: `Zhuque Fangsong A1050`）
- `fonts/ZhuqueFangsong-Bold.ttf` — 由 `build-bold.py` 合成的 Bold（family 同原版，subfamily Bold / 700）

思源宋体通过 Google Fonts CDN 加载，SimSun 走系统字体。
