# 按词操作到底是 Ctrl 还是 Alt？—— 由来、平台差异、日常选择

调研日期：2026-09-30　本机环境：Windows 11 + Windows Terminal 1.25.1912.0 (Preview) + WSL2 (Arch) + nushell 0.116.0 + bash 5.3 + PowerShell/PSReadLine；crossterm 0.29.0。
姊妹篇：`20260924/wsl-nushell-ctrl-arrow/`（Ctrl+← 在 WSL）、`20260930/wsl-nushell-ctrl-backspace/`（Ctrl+Backspace ≡ Ctrl+H）。

---

## 0. 一分钟速查

| 场景 | 按词左移 | 按词左删 | 按词右删 | 按词选择 |
| --- | --- | --- | --- | --- |
| **Windows / Linux GUI**（记事本、Office、浏览器、VS Code…） | `Ctrl+←/→` | `Ctrl+Backspace` | `Ctrl+Del` | `Ctrl+Shift+←/→` |
| **macOS GUI**（Cocoa 文本框、Safari、VS Code-mac…） | `⌥←/→` | `⌥⌫` | `⌥⌦` | `⌥⇧←/→` |
| **UNIX 终端 + readline**（bash/zsh） | `M-b`/`M-f`（= `Alt+B`/`Alt+F`） | **`M-DEL`（= `Alt+Backspace`）** | `M-d` / `Ctrl+Del` | 终端里没有"选择" |
| **nushell**（本机实测） | `Alt+B`/`Alt+F`、`Ctrl+←/→` | `Alt+Backspace`、`Ctrl+W` | `Alt+D`、`Ctrl+Del` | `Shift+Ctrl+←/→` ✅ |
| **PowerShell (PSReadLine)** | `Ctrl+←/→` | `Ctrl+Backspace`、`Ctrl+W` | `Ctrl+Del`、`Alt+D` | `Shift+Ctrl+←/→` |
| **Vim/Neovim** | `b` | `db` / `dW`，插入模式 `Ctrl+W` | `dw` / `dW` | `v` 然后 `b`/`w` |

> 一行记忆：**GUI 跟系统走（Win/Linux = Ctrl，mac = Option）；终端跟 emacs 走（Alt/Meta）。**
> 原因见 §1 —— "按词"这一层，永远落在**当时还没被占用的那个修饰键**上。

---

## 1. 为什么会有 Ctrl/Alt 之分

### 1.1 起点：终端只有两个修饰键，Ctrl 管字符、Meta 管词

1960–70 年代的终端世界里，"多出来"的修饰键只有两个：**Ctrl**（产生控制码 0x00–0x1F）和 **Meta**（Lisp 机 / Symbolics 键盘上的第二个修饰键）。readline 手册把结论直接写成了规范：

> It is a loose convention that **control keystrokes operate on characters while meta keystrokes operate on words.**
> — [Bash 参考手册 · Readline Movement Commands](https://www.gnu.org/software/bash/manual/html_node/Readline-Movement-Commands.html)

于是就有了这套分工：

| 层级 | 键 | 作用 |
| --- | --- | --- |
| 字符层 | `C-f` / `C-b`（→/←）、`C-d`（删右 1 字符）、`DEL` | 一个字符 |
| 词层 | `M-f` / `M-b`、`M-d`（删到词尾）、**`M-DEL`（删到词首）** | 一个词 |
| 行层 | `C-a` / `C-e`、`C-k`、`C-u`、`C-w` | 行 |

而"Meta"在真实终端上往往**没有独立按键**，所以 Emacs 允许用 `ESC` 前缀代替：

> Two commonly-used modifier keys are Control (usually labeled Ctrl), and Meta (usually labeled Alt)… You can also type Meta characters using two-character sequences starting with **ESC**… This feature is useful on certain text terminals where the Meta key does not function reliably.
> — [GNU Emacs 手册 · Kinds of User Input](https://www.gnu.org/software/emacs/manual/html_node/emacs/User-Input.html)

**这解释了两件日常看的怪事**：

1. 为什么 `Alt+Backspace` 在字节层面是 `ESC DEL`（`1b 7f`）—— **Alt 就是 Meta，Meta 就是 ESC 前缀**（本机 WSL 实测：`1b 7f` → nushell 解析为 `backspace + alt`）。
2. 为什么"按词删"在终端里天然是 Alt 层：**Ctrl 层已经被"控制/字符"占满了**，`Ctrl+Backspace` 只能退化成 `^H`（0x08），与 `Ctrl+H` 撞车——这就是姊妹篇里 WSL 那个坑的根源。

> 补一句：`Ctrl+←/→` 在终端里其实是**后来追加**的"PC 风味"键，用 CSI 修饰符编码（`ESC[1;5D`），并不是所有发行版默认都有——它常常是靠 `/etc/inputrc` 补上的。本机 Arch 的 `/etc/inputrc` 里就有 `"\e[1;5D": backward-word` 这几行（原文见 `evidence/evidence.md` §2）。

### 1.2 PC 世界：没有 Meta，于是 Ctrl 接管了"词"

Windows/DOS 键盘没有 Meta 键，`Alt` 从第一天起就是"菜单/系统键"（`Alt+F4`、`Alt+Tab`、`Alt+←` 后退）。文本编辑的"词层"就只能给 Ctrl。微软官方的文本编辑快捷键表把它定死了：

| 按键 | 动作（微软官方 "Keyboard shortcuts in Windows" → Text editing） |
| --- | --- |
| `Ctrl+Backspace` | Delete words to the left of the cursor |
| `Ctrl+Del` | Delete words to the right of the cursor |
| `Ctrl+←` / `Ctrl+→` | Move the cursor backward/forward to the beginning of the previous/next word |
| `Ctrl+↑` / `Ctrl+↓` | 按段落移动 |
| `Shift+Ctrl+←/→` | Select words backward/forward |
| **`Alt+←` / `Alt+→`** | **Go back / Go forward（系统级！）** |

⇒ **同一个"词"概念：UNIX 血统给 Alt/Meta，Windows 血统给 Ctrl。**

### 1.3 macOS：第三条路（Ctrl 留给 emacs 遗产，Option 管词，Command 管行/文档）

Apple 官方的文本编辑快捷键表把三层分得很清楚：

| 层级 | macOS | 例子 |
| --- | --- | --- |
| 字符 / emacs 遗产 | **Ctrl** | `⌃H` 删左 1 字符、`⌃D` 删右 1 字符、`⌃A`/`⌃E` 行首/行尾、`⌃F`/`⌃B` 前后 1 字符、`⌃K` 删到行尾、`⌃T` 交换字符、`⌃P`/`⌃N` 上下行 |
| **词** | **Option (Alt)** | `⌥←/→` 按词移动、**`⌥⌫` 删左词**、`⌥⌦` 删右词、`⌥⇧←/→` 按词选择 |
| 行 / 文档 / 应用命令 | **Command** | `⌘←/→` 行首/行尾、`⇧⌘←/→` 选到行边界、`⌘↑/↓` 文档首尾 |

> 出处：Apple 支持页 [Mac keyboard shortcuts](https://support.apple.com/en-us/102650) 的 "Text-editing shortcuts" 一节。

注意最后一行还有个历史包袱：**macOS 把 `⌃←/→` 留给了 Mission Control / 切换空间**（System Settings → Keyboard Shortcuts 里可看到），所以 macOS 上"Ctrl+箭头 = 按词"这条 Windows 习惯在那里根本不成立。

### 1.4 规律

| 平台 | 谁的 Ctrl 被占用 | 于是"词"给了谁 |
| --- | --- | --- |
| UNIX 终端 | 被控制码（`C-c`/`C-d`/`C-z`…）占用 | **Meta / Alt** |
| Windows | 空着（系统命令主要用 `Alt`/`Win`） | **Ctrl** |
| macOS | 留给了 emacs 遗产 + Mission Control | **Option (Alt)**；行层给 Command |

一句话：**"按词"是"第二修饰键"的活，而"第二修饰键"是谁，取决于谁被腾出来了。** 这也是为什么你在 Windows 上用惯了 Ctrl+Backspace，到终端里最省心的却是 Alt+Backspace。

### 1.5 那条流行概括（"GUI 用 Ctrl、终端用 Alt"）的例外清单

这条概括**方向是对的**（Windows/Linux GUI + Unix 终端），但要记住四条例外，否则会在某些场景里纳闷：

| 概括 | 例外 | 为什么 |
| --- | --- | --- |
| GUI 用 `Ctrl` | **macOS GUI 用 `⌥`（Option）** | Ctrl 留给了 emacs 遗产（`⌃A/⌃E/⌃H/⌃D/⌃K`），Cmd 留给应用命令（§1.3）；VS Code 源码里的 `mac:` 覆盖就是证据 |
| GUI 用 `Ctrl` | **表格类软件里 `Ctrl+箭头` 不是"按词"** | Excel：`Ctrl+箭头` = 跳到数据区边缘；`Ctrl+Shift+箭头` = 选到边界（§4.2） |
| 终端用 `Alt` | **Windows 的 shell（PowerShell/PSReadLine）是 Ctrl 派** | `Ctrl+Backspace = BackwardKillWord`、`Ctrl+W` 同样；**`Alt+Backspace` 根本没有绑定**（§4.3） |
| 终端用 `Alt` | **macOS 终端里 Option 默认不是 Meta** | Terminal.app 要手动勾选 “Use Option as Meta key” 才会把 Option 作为 Meta/ESC 发送（[Apple 帮助](https://support.apple.com/guide/terminal/change-profiles-keyboard-settings-trmlkbrd/mac)）；iTerm2/WezTerm 等各有自己的设置 |

再精确一点：**"终端用 Alt"对"删词"最成立**。终端里的"按词**移动**"往往是 `Ctrl+←/→`（靠发行版的 `/etc/inputrc` 补上），而"整段/整行"又回到 Ctrl（`Ctrl+W`、`Ctrl+U`、`Ctrl+K`）。所以终端的实际情况是：**Ctrl 管字符与行，Alt 管词**。

---

## 2. 本机实测：同一个动作，不同键删掉的东西真的不一样

方法：在 pty 里驱动真实交互式 shell，输入 `echo foo/bar/baz` → 按一次键 → 输入 `Z` → 回车，看实际执行了什么（脚本 `evidence/word_chord_probe.py`；bash 5.3 + nushell 0.116）。

| 按键 | bash（readline） | nushell |
| --- | --- | --- |
| `Ctrl+W` | 删掉**整段** `foo/bar/baz`（回到上一个空白符）→ 只剩 `echo` | 删掉 `baz` → `echo foo/bar/Z`，**且写入 cut buffer**（`Ctrl+Y` 能粘回，实测） |
| `Alt+Backspace` | 删掉 `baz` → `echo foo/bar/Z` | 删掉 `baz` → 同左（不进 cut buffer） |
| `Ctrl+Backspace` = `^H` (0x08) | 只删 1 个字符（终端里它就是 `Ctrl+H`） | 只删 1 个字符（同左，详见姊妹篇） |
| `Alt+D` / `Ctrl+Del` | 光标在行尾时无事可删（它们是"向右删词"） | 同左 |

readline 手册明确写了这两种"删词"**不是一回事**（这也是日常最容易踩的坑）：

> `M-DEL` — Kill from the cursor to the start of the current word… Word boundaries are the same as those used by `M-b`.
> `C-w` — Kill from the cursor to the previous **whitespace**. **This is different than `M-DEL` because the word boundaries differ.**
> — [Bash 参考手册 · Readline Killing Commands](https://www.gnu.org/software/bash/manual/html_node/Readline-Killing-Commands.html)

**⇒ 想删掉一整个路径/一串参数，用 `Ctrl+W`；想只删一层（`baz`），用 `Alt+Backspace`。** 反过来，在 nushell 里两者删的范围一样，差别只在"进不进剪贴缓冲"。

---

## 3. "词"的定义：为什么有时删多了、有时删少了

| "词"的定义 | 谁在用 | `foo/bar/baz` 光标在末尾时 |
| --- | --- | --- |
| **空白符词**（unix word） | bash 的 `Ctrl+W`（`unix-word-rubout`）；Vim 的 `W`；多数 shell 的"删整段参数" | 一次删掉整段 |
| **字母数字词**（word boundary，`[A-Za-z0-9_]`） | readline 的 `M-b`/`M-f`/`M-d`/`M-DEL`（手册："a word is composed of letters and digits"）；Vim 的 `w`/`b` | 只删 `baz` |
| **应用自定义分隔符** | VS Code（`editor.wordSeparators` 默认含 `/ . - _` 等）；JetBrains（"words" vs "camelHumps" 两种模式） | 视设置，通常只删 `baz` |
| **CJK 整串** | Windows/macOS 输入法体系、多数 GUI 控件把连续汉字当一个词 | — |

> 顺带：`Ctrl+←/→` 在终端里由 `TERM`/`inputrc` 决定，而在 **Excel 里语义完全不同**——微软官方是 "Move to the edge of the current data region"（`Ctrl+Shift+箭头` = 选到数据区边界）。所以在表格里用 `Ctrl+←/→` 会"跳很远"，那不是 bug。

---

## 4. 平台 / 软件对照（含"谁抢了你的键"）

### 4.1 宿主层（终端模拟器 / 系统）的抢占 —— 这是最容易翻车的地方

| 组合 | 被谁占用 | 影响 |
| --- | --- | --- |
| `Alt+←/→` | **Windows 系统**："Go back / Go forward"；**Windows Terminal 默认**：`alt+left`/`alt+right` = `MoveFocus`（切分屏）；浏览器同理（后退/前进） | 想在终端/编辑器里用 `Alt+←/→` 做"按词移动"经常不可靠 |
| `Alt+↑/↓` | WT = `MoveFocus`；VS Code = 上下移动行 | 与 emacs 的按行移动冲突 |
| **`Alt+Backspace`** | **WT 默认 68 条键位里没有它**（本机核对了官方 `defaults.json`：`alt+` 的只有 `alt+f4 / alt+enter / alt+space / alt+shift+导航与分割 / alt+方向键 MoveFocus / ctrl+alt+←`）；Windows 系统也没占用 | **可以安全地送到应用 ✅ 这就是我们推荐它的硬理由** |
| `Ctrl+Backspace` | 系统没占用，但终端协议把它编码成 `^H`（ConPTY 的约定） | WSL 里与 `Ctrl+H` 撞车 ❌（姊妹篇） |
| `Alt+F4` / `Alt+Space` / `Alt+Enter` | 系统 / 窗口 | 所以别指望 readline 的 `M-f`、`M-SPC` 在 Windows 上可用 |
| `Ctrl+W` | 浏览器/GUI 是"关闭标签"; 终端里是 readline 的 `unix-word-rubout` | 在终端里放心用；在浏览器里会关标签 |

### 4.2 GUI 文本控件

| 工具 | 按词移动 | 按词左删 | 备注 |
| --- | --- | --- | --- |
| Windows 记事本 / Office / 通用编辑框 | `Ctrl+←/→` | `Ctrl+Backspace` | 微软官方快捷键表（§1.2） |
| 浏览器文本框（Chrome/Edge/Firefox, Windows） | `Ctrl+←/→` | `Ctrl+Backspace` | 跟随 Windows 习惯；`Alt+←` 是后退 |
| 浏览器文本框（macOS） | `⌥←/→` | `⌥⌫` | 跟随 macOS 习惯 |
| VS Code (Windows/Linux) | `Ctrl+←/→` | `Ctrl+Backspace` | 见下方源码摘录 |
| VS Code (macOS) | `⌥←/→` | `⌥⌫` | 同源同逻辑，只换修饰键 |
| Firefox（历史遗留） | — | — | `Backspace` 曾经是"后退"，已于 Firefox 86 移除（[Bug 1041377](https://bugzilla.mozilla.org/show_bug.cgi?id=1041377)）；现在是 `Alt+←` |
| Excel 单元格 | `Ctrl+箭头` = **跳到数据区边缘** | `Backspace` 只删 1 字符（公式栏里） | [Excel 快捷键官方表](https://support.microsoft.com/en-us/office/keyboard-shortcuts-in-excel-1798d9d5-842a-42b8-9c99-9b7213f0040f) |

VS Code 是"同一套逻辑、按平台换修饰键"的最好例子（源码 `src/vs/editor/contrib/wordOperations/browser/wordOperations.ts`）：

```ts
// cursorWordLeft / cursorWordEndRight
primary: KeyMod.CtrlCmd | KeyCode.LeftArrow,
mac:     { primary: KeyMod.Alt | KeyCode.LeftArrow },
// deleteWordLeft / deleteWordRight
primary: KeyMod.CtrlCmd | KeyCode.Backspace,
mac:     { primary: KeyMod.Alt | KeyCode.Backspace },
```

> `KeyMod.CtrlCmd` 在 Windows/Linux 上是 Ctrl、在 macOS 上是 Cmd；而 `mac:` 覆盖又把它换成 **Alt(Option)**。
> 也就是说：**VS Code 认为"按词"在 Win/Linux 属于 Ctrl、在 macOS 属于 Option（物理上就是 Alt）** —— 和你选的键完全一致。

### 4.3 shell / 编辑器的出厂设置（本机实取）

**bash / readline**（`bind -P`，Arch + bash 5.3）：

```
backward-kill-word  ->  "\e\C-h", "\e\C-?"      # "\e\C-?" = ESC DEL = Alt+Backspace ✅
forward-word        ->  "\e[1;3C", "\e[1;5C", "\e\e[C", "\e[5C", "\ef"
backward-word       ->  "\e[1;3D", "\e[1;5D", "\e\e[D", "\e[5D", "\eb"
kill-word           ->  "\e[3;5~", "\ed"        # Ctrl+Del / Alt+D
unix-word-rubout    ->  "\C-w"                  # Ctrl+W（按空白符）
unix-line-discard   ->  "\C-u"
```

注意 `\e\C-h` 也是 `backward-kill-word`（即 `Alt+Ctrl+H`）——readline 用这个别名来绕开 `^H` 的歧义，而 `Alt+Backspace`（`\e\C-?`）是同一命令的"正统"键。

**PowerShell / PSReadLine**（`Get-PSReadLineKeyHandler -Bound`）：

```
Backspace            -> BackwardDeleteChar
Ctrl+Backspace       -> BackwardKillWord      Ctrl+w -> BackwardKillWord
Ctrl+Delete          -> KillWord              Alt+d  -> KillWord
Ctrl+LeftArrow       -> BackwardWord          Ctrl+RightArrow -> NextWord
Shift+Ctrl+LeftArrow -> SelectBackwardWord    Shift+Ctrl+RightArrow -> SelectNextWord
（没有 Alt+Backspace 的绑定 —— 它在 PowerShell 里是"空键"）
```

**nushell 0.116**（`keybindings default`，Windows 与 WSL 完全相同）：

```
emacs        : Backspace -> Backspace            CONTROL+Backspace -> BackspaceWord
emacs        : ALT+Backspace -> BackspaceWord    ALT+Char('m') -> BackspaceWord
emacs        : CONTROL+Char('h') -> Backspace    CONTROL+Char('w') -> CutWordLeft
emacs        : ALT+Char('d') -> CutWordRight     CONTROL+Delete -> DeleteWord
emacs        : ALT+Left/Right -> MoveWordLeft/Right   CONTROL+Left/Right -> MoveWordLeft/Right
vi_insert    : CONTROL+Backspace / CONTROL+Char('w') -> BackspaceWord
helix_insert : 同上
```

**Vim/Neovim**：普通模式 `w/b/e`（小词）、`W/B/E`（空白符词）、`dw`/`db`/`dW`/`diw`；插入模式 `Ctrl+W` = 删前一个词。终端里的 `Ctrl+←/→`、`Alt+Backspace` 需要终端发得出对应序列并在 vim 里映射（`<C-Left>`、`<M-BS>` 依赖 terminfo/kitty 协议），这也是"vim 里按词键更别扭"的原因。

---

## 5. 日常推荐

### 5.1 三条原则

1. **GUI 随大流**：Windows/Linux 用 `Ctrl+Backspace`/`Ctrl+Del`/`Ctrl+←/→`；macOS 用 `⌥⌫`/`⌥⌦`/`⌥←/→`（别在 macOS 上指望 Ctrl）。
2. **终端里用 `Alt+Backspace` 做"按词左删"**，因为：
   - 它是 emacs/readline 的**原始定义**（`M-DEL`），bash/zsh/korn/以及绝大多数 readline 系程序默认就有；
   - 它在字节层面是 `ESC DEL`（带 ESC 前缀的序列），**能安全穿过 终端→ConPTY→WSL→pty 多层翻译**；而 `Ctrl+Backspace` 只能退化成 `^H`，与 `Ctrl+H` 不可区分（姊妹篇的结论）；
   - **宿主层没人抢**（Windows Terminal 默认键位、Windows 系统都没占用它，§4.1）。
3. **区分"删一层"和"删整段"**：`Alt+Backspace` 删到词边界（`foo/bar/` 留下），`Ctrl+W` 删到空白符（整段没）——而且 `Ctrl+W` 的内容进 cut buffer，可用 `Ctrl+Y` 粘回。**这是终端里最实用的两个键，别只用其中一个。**

### 5.2 给"Windows Terminal + WSL + nushell"这套的具体建议（也就是你现在这套）

| 想做什么 | 用这个键 | 备注 |
| --- | --- | --- |
| 删一个词 | **`Alt+Backspace`** | 唯一"零配置 + 穿透多层翻译 + 宿主无占用"的选择 |
| 删一整个参数/路径 | `Ctrl+W` | 删完还能 `Ctrl+Y` 粘回 |
| 向右删一个词 | `Alt+D`（nushell）/ `Ctrl+Del` | 在 bash 里 `Alt+D` 也是 `kill-word` |
| 按词移动光标 | `Ctrl+←/→` 或 `Alt+B`/`Alt+F` | 别用 `Alt+←/→`（WT 抢去做分屏焦点、浏览器抢去做后退） |
| 按词选择 | `Shift+Ctrl+←/→` | nushell 支持；终端里的 bash 没有"选择"概念 |
| `Ctrl+Backspace` | **不要依赖** | WSL 里它等于 `Ctrl+H`＝删 1 个字符 |

### 5.3 肌肉记忆表（跨场景最省脑容量的一套）

```
Windows/Linux GUI : Ctrl+←/→ 移动 · Ctrl+Backspace 删词 · Ctrl+Shift+←/→ 选词
macOS GUI         : ⌥←/→      移动 · ⌥⌫            删词 · ⌥⇧←/→       选词
终端 / shell      : Alt+B/F   移动 · Alt+Backspace 删词 · Ctrl+W 删整段
Vim               : b/w       移动 · db/dw         删词
```

---

## 6. 复现脚本与证据（本目录）

| 文件 | 用途 |
| --- | --- |
| `evidence/word_chord_probe.py` | 在 pty 里驱动 **bash** 与 **nushell**，逐个按键实测"到底删掉了什么"（本文 §2 的表） |
| `evidence/evidence.md` | 全部原始数据：环境、`bind -P`、PSReadLine、nushell 键位、WT 默认键位、VS Code 源码摘录、官方文档引文 |
| `evidence/reference_extracts.txt` | 从 GNU bash 手册 / Emacs 手册抓下来的原文（§1 的引文出处） |
| `evidence/wt_default_alt_keys.txt` | Windows Terminal 官方 `defaults.json` 里所有含 `alt+` / `backspace` 的默认绑定（§4.1 的依据） |
| `evidence/wt_defaults.json`、`evidence/vscode_wordOperations.ts` | 上面两个文件的原始副本 |

---

## 7. 参考来源

**一手文档 / 源码**

- GNU Bash 参考手册 · Readline Movement Commands（"control keystrokes operate on characters while meta keystrokes operate on words"）：<https://www.gnu.org/software/bash/manual/html_node/Readline-Movement-Commands.html>
- GNU Bash 参考手册 · Readline Killing Commands（`M-DEL` vs `C-w` 的词边界差别）：<https://www.gnu.org/software/bash/manual/html_node/Readline-Killing-Commands.html>
- GNU Emacs 手册 · Kinds of User Input（Meta 一般标为 Alt；Meta 可用 ESC 前缀输入）：<https://www.gnu.org/software/emacs/manual/html_node/emacs/User-Input.html>
- Apple 支持 · Mac keyboard shortcuts（`⌥←/→`、`⌥⌫`、`⌘←/→`、`⌃A/E/F/B/H/D/K`）：<https://support.apple.com/en-us/102650>
- Microsoft 支持 · Keyboard shortcuts in Windows → Text editing（`Ctrl+Backspace`、`Ctrl+Del`、`Ctrl+←/→`、`Alt+←` = Go back）：<https://support.microsoft.com/en-us/windows/keyboard-shortcuts-in-windows-dcc61a57-8ff0-cffe-9796-cb9706c75eec>
- Microsoft 支持 · Keyboard shortcuts in Excel（`Ctrl+箭头` = Move to the edge of the current data region）：<https://support.microsoft.com/en-us/office/keyboard-shortcuts-in-excel-1798d9d5-842a-42b8-9c99-9b7213f0040f>
- VS Code 源码 `wordOperations.ts`（`Ctrl/Cmd` vs `mac: Alt` 的按词键位）：<https://github.com/microsoft/vscode/blob/main/src/vs/editor/contrib/wordOperations/browser/wordOperations.ts>
- Windows Terminal 默认键位 `defaults.json`（`alt+方向键` = `MoveFocus`；无 `alt+backspace`）：<https://github.com/microsoft/terminal/blob/main/src/cascadia/TerminalSettingsModel/defaults.json>
- 本机实测脚本与原始输出：`evidence/`（bash 5.3 `bind -P`、PSReadLine `Get-PSReadLineKeyHandler`、nushell 0.116 `keybindings default`）

**历史 / 背景**

- Firefox 移除 `Backspace` = 后退：<https://bugzilla.mozilla.org/show_bug.cgi?id=1041377>
- `^H` 与 `Ctrl+Backspace` 在 ConPTY/WSL 里的歧义（姊妹篇的证据链）：`20260930/wsl-nushell-ctrl-backspace/README.md`、<https://github.com/microsoft/terminal/pull/3935>
