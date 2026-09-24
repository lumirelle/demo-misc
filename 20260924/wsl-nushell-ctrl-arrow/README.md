# 为什么 Windows Terminal 里 nushell 的 Ctrl+←/→ 能按词跳，WSL 里的 nushell 不行？

调研日期：2026-09-24
被测环境（本机实测）：Windows Terminal **1.25.1912.0 (Preview)**、WSL **2.7.13.0**、Arch Linux 发行版、nushell **0.115.1**（Windows 与 WSL 同一版本，`/usr/sbin/nu`）、`TERM=xterm-256color`、`edit_mode=emacs`、双方 `$env.config.keybindings` 相同（8 条内置项，无自定义）。

---

## 0. 结论速览

1. **两台机器的“输入路径”根本不是同一条路。**
   - Windows 上的 nushell 是 **原生控制台程序**：它用 `ReadConsoleInput` 直接从控制台输入缓冲区拿 `KEY_EVENT_RECORD`（`VK_LEFT` + `LEFT_CTRL_PRESSED`）。终端**不需要**把按键编码成任何字节流，Ctrl 修饰信息不可能丢。
   - WSL 里的 nushell 是 **ConPTY 客户端后面的 Linux 程序**：键盘要先被 Windows Terminal 编码成 VT / win32-input-mode 序列 → ConPTY(conhost) → `wsl.exe` → **WSL 自己再把 Windows 控制台事件合成为 VT 序列**写进 Linux 的 pty。Linux 程序看到的只是“WSL 合成出来的字节”。这条链上任何一层丢了 Ctrl 状态，Ctrl+← 就废掉。
2. **nushell 侧的键位表没问题**：Windows 和 WSL 的 nushell 二进制里，默认 emacs 模式都有
   `modifier: KeyModifiers(CONTROL), code: Left → Edit([MoveWordLeft { select: false }])`（见 §2）。
3. **我在你这台机器上实测：Windows Terminal → WSL 这一段送进 Linux 的字节是对的**：
   Ctrl+← 到达 Linux tty 时是 `ESC [ 1 ; 5 D`（xterm 标准 ctrl+left），nushell 把它解析成 `code: left, modifiers: [control]`，交互式测试里光标**确实按词跳**。也就是说：在你当前这套版本组合下，Ctrl+← 应该是能用的（见 §3、§4）。
4. 因此如果你现在按 Ctrl+← 仍然没反应，最可能是遇到下面几种“序列被改写 / 被吞掉”的场景之一，其中 **(a) win32-input-mode 泄漏**是最典型的，症状完全吻合（见 §5）：
   - 终端实际发的是 `CSI Vk;Sc;Uc;Kd;Cs;Rc _`（win32-input-mode 记录），而 **crossterm 完全不解析这种序列 → nushell 收到的事件是“空”**（实测确认，见 §2.3）；
   - 会话里跑过 Windows 程序（interop，例如 `code`、`explorer.exe`）之后终端被留在 W32IM 状态；
   - 两边 nushell/reedline 版本不同（旧版没有 Ctrl+← 绑定）；
   - 中间还有 tmux/zellij/ssh，或程序没有 tty（管道）。

---

## 1. 两条输入路径

### 1.1 Windows：nushell 是“原生控制台程序”

```
键盘 → Windows Terminal(只负责把按键塞进控制台输入缓冲区)
     → nushell 进程 ReadConsoleInput() 拿到 KEY_EVENT_RECORD
        { VK_LEFT, dwControlKeyState = LEFT_CTRL_PRESSED }
     → crossterm(Windows 后端) → KeyCode::Left + KeyModifiers::CONTROL
     → reedline: control+left → MoveWordLeft ✅
```

关键点：**没有任何“按键→字节流”的编码/解码往返**，所以 Windows 上一定对。

### 1.2 WSL：nushell 在 4 层翻译之后

```
键盘
 → Windows Terminal：把按键编码成序列，写进 ConPTY 的输入流
 → conhost.exe(ConPTY 服务端，即 WT 为 wsl.exe 创建的那个“伪控制台”)
 → wsl.exe（ReadConsoleInput，或 VT 输入模式）
 → WSL 把 Windows 控制台事件再合成为 VT 序列，写进 Linux pty
 → Linux 里的 nushell 从 /dev/pts/N 读到字节，用 crossterm(Unix 后端) 解析
 → reedline: control+left → MoveWordLeft
```

这条链上，**ctrl+方向键的“Ctrl”只存在于两个地方**：Windows 的 `dwControlKeyState`，以及终端/ WSL 合成出来的 VT 序列里的修饰符数字（`ESC[1;5D` 里的 `5`）。任何一层用“只转发字符”的逻辑处理（方向键没有 Unicode 字符），修饰信息就会蒸发。

### 1.3 一个容易忽略的事实：ConPTY **总是**请求 win32-input-mode

Windows Terminal 源码（main，本次实测版本对应行为一致）：

- `src/host/VtIo.cpp:203`：ConPTY 服务端启动时向终端写
  `"\x1b[c" + "\x1b[?1004h" + "\x1b[?9001h"`，注释明确写着
  *“GH#4999 - Send a sequence to the connected terminal to request win32-input-mode from them.”*
  关闭时（`VtIo::Shutdown`，同文件 259 行）再发 `?9001l`。
- `src/terminal/adapter/adaptDispatch.cpp:1893`：终端侧处理 `DECSET 9001` →
  `_terminalInput.SetInputMode(TerminalInput::Mode::Win32, enable)`。
- `src/terminal/input/terminalInput.cpp:233`：一旦处于 Win32 模式，**所有**按键都走 `_makeWin32Output()`
  编码成 `CSI Vk;Sc;Uc;Kd;Cs;Rc _` 记录，不再发普通 VT 序列。

设计文档：`doc/specs/#4999 - Improved keyboard handling in Conpty.md`，其中专门有一节
“User is typing into WSL from the Windows Terminal”：

> * Conpty[1] will ask for `win32-input-mode` from the Windows Terminal when conpty[1] first boots up.
> * When the user types keys in Windows Terminal, WT will translate them into win32 sequences and send them to conpty[1]
> * Conpty[1] will translate those win32 sequences into `INPUT_RECORD`s … **When WSL reads the input, it'll read (using `ReadConsoleInput`) a stream of `INPUT_RECORD`s that contain only character information, which it will then pass to the linux application.**

也就是说：**Linux 侧看到的字节完全由 WSL 合成**，这是整件事的根因所在（也是历史 bug 的来源，见 §5）。

---

## 2. nushell 这一侧的事实（已逐条验证）

### 2.1 默认键位表里 Ctrl+← / Ctrl+→ 是存在的

在你这台机器的 WSL 里跑（Windows 侧结果完全相同）：

```nu
keybindings default | to text | lines | where $it =~ "code: Left"
# mode: emacs, modifier: KeyModifiers(CONTROL), code: Left, event: Edit([MoveWordLeft { select: false }])
```

另外还有：`KeyModifiers(ALT), code: Left → MoveWordLeft`、`KeyModifiers(SHIFT|CONTROL), code: Left → MoveWordLeft { select: true }`（选择用）。
`edit_mode` 两侧都是 `emacs`，`$env.config.keybindings` 只有 8 条内置项、没有覆盖 Ctrl+←。

### 2.2 nushell 在 WSL 里能把 `ESC[1;5D` 解析成 Ctrl+←

在**真实 Windows Terminal 会话**里（跑你本人的 `config.nu`）：

```nu
input listen --types [key]        # 然后按 Ctrl+←
# {type: key, key_type: other, code: left, modifiers: ["keymodifiers(control)"]}
```

同一条序列在 Linux pty 里也是同样结果（我用 Python pty 复现）：

| 送进去的字节 | nushell `input listen` 解析结果 |
| --- | --- |
| `1b 5b 31 3b 35 44` = `ESC[1;5D` | `code: left, modifiers: [control]` ✅ |
| `1b 5b 31 3b 35 43` = `ESC[1;5C` | `code: right, modifiers: [control]` ✅ |
| `1b 5b 31 3b 32 44` = `ESC[1;2D` | `code: left, modifiers: [shift]` |
| `1b 5b 33 37 3b 35 3b 30 3b 31 3b 38 3b 31 5f`（win32-input-mode 的 Ctrl+← 记录） | **没有任何事件（被完全忽略）** ❗ |

（crossterm 的 Unix 解析器源码 `src/event/sys/unix/parse.rs` 里没有 `_` 结尾的 win32-input-mode 分支，这与实测一致。）

### 2.3 交互效果（Linux pty 内实际打字验证）

输入 `echo AAA BBB CCC`，按一次方向键，再输入 `Z` + 回车，看实际执行的参数：

| 按的键 | 实际执行结果 | 含义 |
| --- | --- | --- |
| `ESC[D`（←） | `… BBB CCZC` | 只移动 1 个字符 |
| `ESC[1;5D`（Ctrl+←） | `… BBB ZCCC` | **按词移动 ✅** |
| `ESC[1;3D`（Alt+←） | `… BBB ZCCC` | 按词移动（备用键） |
| `ESC[1;5D` ×2 | `… ZBBB CCC` | 连续按词移动 |

---

## 3. 你这台机器上的实测：WT → WSL 的字节流是对的

方法：在 Windows Terminal 里开一个 WSL 会话，把 tty 置成 raw 模式，用 `dd` 记录原始字节（脚本见 `evidence/wsl_tty_keylog.sh`），然后用 Windows 侧真实按键（等价输入）触发。

记录到的字节：

```
61 62 63 | 1b 5b 31 3b 35 44 | 1b 5b 31 3b 35 43 | 78 79 7a
 a  b  c | E  S  C  [ 1 ; 5 D | E  S  C  [ 1 ; 5 C |  x  y  z
             ← Ctrl+Left        ← Ctrl+Right
```

即：**Ctrl+← 到达 Linux tty 时是标准的 `ESC[1;5D`**，不是 win32-input-mode 记录、也不是丢失修饰的 `ESC[D`。
配合 §2，链路两端都对 ⇒ 在你当前版本上，WSL 里的 nushell 收到 Ctrl+← 就会按词跳。

> 附带结论：Windows Terminal 1.25 + WSL 2.7 这条链里，**W32IM 要么没启用，要么 WSL 把它正确翻译回了 `ESC[1;5D`**。两种情况下 crossterm 都能正常识别。

---

## 4. 那“以前/有时不行”是怎么来的？（按可能性排序）

### (a) win32-input-mode 泄漏进 Linux 会话 —— 症状最吻合的一种

机制（有明确源码与 issue 佐证）：

- ConPTY 启动就请求 W32IM（§1.3），终端随即改为发 `CSI …_` 记录。
- 如果这条序列**穿到 Linux 侧**而不是被正确翻译，crossterm 完全不认识它 ⇒ **按键像“没反应”**（§2.2 最后一行实测）。
- 微软 terminal 仓库 issue [#16343 “Win32 input mode breaks WSL .exe interop”](https://github.com/microsoft/terminal/issues/16343) 里 j4james 的分析正是这个：
  > *I suspect WSL is actually passing them up to the parent terminal. This would result in the parent terminal enabling win32 input mode, and from then on any keystrokes would be sent to WSL in a format that it doesn't understand.*
  并且提到“从 WSL 里跑完 exe 再回到 shell，终端还停在 win32-input-mode”，手工修法是 `printf "\e[?9001l"`（同 issue 里 mintty 的复现：在 WSL 内 `echo -e "\e[?9001h"` 会彻底搞坏交互）。
- 触发场景：在 WSL 里执行 Windows 程序（interop，如 `code .`、`explorer.exe`、任何 `.exe`），嵌套 ConPTY；旧版 WT（1.19–1.22 有过多次修复/回归）更容易踩到。
- 你的环境里确实经常跑 Windows 侧命令（例如 nushell 配置里那些会调用 `code`/mise 的 shim），所以这条值得优先排查。

### (b) WSL 自己的控制台翻译历史 bug

[microsoft/WSL#2153](https://github.com/microsoft/WSL/issues/2153)（Ctrl+方向键在 WSL 里输出成字面量 `;5A` / `;5C` / `;5D`）说明这层翻译历来最容易出问题：序列被截断/拆分后，修饰部分变成了普通文本。这类问题在旧 WSL/ConPTY 组合里会表现为“Ctrl+← 没反应或屏幕上多出 `;5D`”。

### (c) 两边 nushell / reedline 版本不同

Ctrl+← **不是 readline 的“默认”约定**，而是应用自己要绑定的键位（见 [nushell#441](https://github.com/nushell/nushell/issues/441)：2019 年时 nushell 还没有这个绑定，PR [#1141](https://github.com/nushell/nushell/pull/1141) 才加上；选择/Shift 导航是 [#11535](https://github.com/nushell/nushell/pull/11535)）。如果 Windows 的 nushell 比 WSL 里的新（或反之），就会出现“同样的终端、同样的按键，一个行一个不行”。你现在两边都是 0.115.1，所以这一条暂时不成立——但如果你是在升级前观察到的现象，这很可能就是原因。

### (d) 中间层/环境

- `tmux` / `zellij` / `ssh` 会话：多一层键盘映射（旧 tmux 的 `escape-time` 也会打断序列）。
- 程序没有 tty（`nu -c ... | cat`、被重定向、`wsl.exe -e nu ... | ...`）：没有 tty 就没有行编辑，Ctrl+← 自然不会“按词移动”。
- `$env.config.edit_mode` 被改成 `vi*` 且自定义了键位表。
- `$env.config.keybindings` 里覆盖/删除了 Ctrl+←（你的配置没有）。

---

## 5. 现在怎么诊断（3 条命令，按顺序）

**① 看终端到底送了什么字节**（在 Windows Terminal 的 WSL 里执行，然后按 Ctrl+←）：

```sh
stty raw -echo; timeout 5 head -c 8 /dev/tty | xxd -p; stty sane
```

- 期望 `1b5b313b3544`（= `ESC[1;5D`）→ 终端侧正常，问题在 nushell 配置/版本。
- 出现 `1b5b33373b…5f`（`ESC[…_`）→ 命中 §4(a)，终端在 win32-input-mode，见下面的修法。
- 出现 `1b5b44`（`ESC[D`）→ 修饰符在 WSL 合成时丢了（§4(b)），只能换键或用自定义绑定绕。
- 什么都不出现 → 按键根本没送达（焦点/窗口问题，或 §4(d)）。

**② 看 nushell 解析成什么**（同一个会话里）：

```nu
input listen --types [key]      # 按 Ctrl+←
```

- `code: left, modifiers: [control]` → nushell 侧完全正常；
- 什么都不打印 → nushell 不认识送进来的序列（典型就是 win32-input-mode 记录）。

**③ 确认绑定存在**：

```nu
keybindings default | to text | lines | where $it =~ "code: Left"
```

应能看到 `modifier: KeyModifiers(CONTROL), code: Left, event: Edit([MoveWordLeft …])`。

---

## 6. 修复 / 绕行

**(1) 命中 §4(a)（序列是 `ESC[…_`）——把 win32-input-mode 关掉**

在该 WSL 会话里执行一次（或在 `config.nu` / `env.nu` 里放一行，让每个新会话都关）：

```nu
^printf '\e[?9001l'    # 或者: print -n "\e[?9001l"
```

WT 源码里 `adaptDispatch.cpp:2036` 实现了对 9001 的 `DECRQM` 查询，所以也可以用
`printf '\e[?9001$p'` 让终端回报当前状态（`ESC[?9001;1$y` = 已启用，`;2$y` = 已关闭）。
注意：这是一条 workaround；微软侧的正解是修 ConPTY/WSL 的翻译（issue #16343 已被标记修复，但历史上反复出现）。

**(2) 显式把 Ctrl+← / Ctrl+→ 绑到词移动上**（不管终端送来什么键位，都保证有绑定；语法已在 0.115.1 上验证通过）

```nu
# config.nu
$env.config.keybindings ++= [
  { name: move_word_left,  modifier: control, keycode: left,  mode: [emacs vi_insert], event: { edit: MoveWordLeft } }
  { name: move_word_right, modifier: control, keycode: right, mode: [emacs vi_insert], event: { edit: MoveWordRight } }
]
```

**(3) 换用验证过可用的等价键**

`Alt+←` / `Alt+→`（实测按词跳）以及 emacs 传统的 `Alt+B` / `Alt+F`（reedline 默认绑定）。

**(4) 排查版本/环境**

```sh
nu --version                 # WSL 侧
```
```powershell
nu --version                 # Windows 侧
```
两边保持一致；确认不在 tmux/ssh 里、且 nushell 有真正的 tty（`tty` 能打印 `/dev/pts/N`）。

**(5) 如果 ① 显示 `ESC[1;5D`、② 显示 `left+control`、③ 有绑定，但光标仍不动**
那问题在别处（例如配置里别的东西吃掉了按键、或菜单/补全层拦截）。带上 ①②③ 的原始输出去 nushell/reedline 提 issue 是最有效的方式。

---

## 7. 复现脚本（附录）

见同目录 `evidence/`：

| 文件 | 用途 |
| --- | --- |
| `wsl_tty_keylog.sh` | 在 Windows Terminal 的 WSL 会话里记录 tty 原始字节（`stty raw` + `dd` + `xxd`），用来验证 §1.2 的字节流 |
| `pty_key_probe.py` | 纯 Linux pty 里驱动交互式 nushell，自动注入 `ESC[1;5D` 等序列并回车，输出“实际执行了什么”，用来验证 §2.3（不依赖 Windows Terminal） |
| `evidence.md` | 本次实测的原始输出记录（版本、键位表、`input listen` 结果、字节 dump） |

---

## 8. 补充（2026-09-24 追加）：这是 Windows Terminal **Preview** 比稳定版多修了什么吗？

短答：**对 Ctrl+← 这件事来说，基本不是。** 但 Preview 通道里确实有一条相关的、且目前不在 1.24.x 稳定版发布说明里的修复。

### 8.1 反证：WSL 这条路的 Ctrl+方向早就送对了

[microsoft/terminal#18921](https://github.com/microsoft/terminal/issues/18921)（2025-05，报告者用的是 **WT 1.22 稳定版 + 1.23 预览**、Ubuntu 24.04 WSL）里：

- 他贴的 `showkey -a` 显示 WSL 侧收到的是正确序列（shift+方向 = `\e[1;2C` 等）；
- 并明确写着：**“Ctrl+Arrow for word-wise navigation does work correctly in WSL/Bash (this is handled by /etc/inputrc within WSL)”**，
  且 `/etc/inputrc` 里对应的绑定就是 `"\e[1;5C": forward-word`。

也就是说：**在 2025 年 5 月的稳定版 WT 下，WSL 里的 Ctrl+方向就已经把 `ESC[1;5D/C` 送对了**，不需要等到 1.25 Preview。

### 8.2 你现在这版 1.25.1912.0 的更新里没有输入相关修复

v1.25.1912.0（2026-07-16，preview）与 v1.24.11911.0（2026-07-16，stable）是同一批改动的“孪生”维护版本，发布说明逐条相同，只包含：拖拽小标签到大窗口崩溃、屏幕阅读器播报、Export Text 对话框的 Enter、URL 检测、DRCS 字体内存损坏、NVIDIA 驱动死锁、缩放后字号被重置等——**没有一条涉及 win32-input-mode / WSL / 键盘输入**。

### 8.3 Preview 通道里唯一直接相关的那条修复：`#19229 Disable WIN32IM on shutdown`

- PR：<https://github.com/microsoft/terminal/pull/19229>，标题 *Disable WIN32IM on shutdown*，2025-08-08 合入 `main`；
- 首次见诸发布说明：**v1.24.2372.0 preview（2025-08-26）**，原文是
  *“conhost: when Win32 Input Mode is enabled, we will request that it be disabled as part of PTY teardown (#19229)”*；
- 在最近 60 个发布说明里，**没有任何 1.24.x 稳定版条目提到它** → 说明它目前只在 preview/main 线（稳定版还在 1.24 的维护分支上，1.25 尚未转正）。

这条修的正是本文 §4(a) 那种状态：W32IM 被留在打开状态（跑过 Windows 程序/嵌套 pty 之后），于是按键变成 `CSI …_` 记录、被 crossterm 全部忽略。
**如果你的“WSL 里不行”当时是这种状态，那这条 preview 修复确实帮到了你**；但它是“会话状态被卡住”的 bug，并不是“稳定版天生不支持 Ctrl+←”。

同类 preview 先行、与输入有关但不影响普通 Ctrl+方向键的改动：

| PR | 标题 | 合入 | 首次发布 |
| --- | --- | --- | --- |
| [#19229](https://github.com/microsoft/terminal/pull/19229) | Disable WIN32IM on shutdown | 2025-08-08 | 1.24.2372.0 preview |
| [#19817](https://github.com/microsoft/terminal/pull/19817) | Implement the Kitty Keyboard Protocol | 2026-02-17 | 1.25.622.0 preview |
| [#19940](https://github.com/microsoft/terminal/pull/19940) | Only honor Ctrl+Z during ReadFile if the console is in PROCESSED mode | 2026-03-11 | 1.25.923.0 preview |

### 8.4 为什么“版本”解释不了“Windows 行 / WSL 不行”

本机只安装了 `Microsoft.WindowsTerminalPreview 1.25.1912.0`——你“Windows 上的 nushell 能用”和“WSL 里的 nushell 不能用”是**同一个 WT 二进制**在服务。
同一版本里出现这种差异，只能是**输入路径**的差别（原生控制台 vs ConPTY+WSL 多层翻译，见 §1），不可能是 WT 通道。
WT 版本只能解释**时间上的变化**（“以前 WSL 不行、现在行了”），这更可能来自：WSL 版本（控制台→VT 合成层，你现在 2.7.13）／nushell 版本（现在两侧都是 0.115.1）／当时会话是否踩到 W32IM 卡住状态。

### 8.5 想一锤定音的话

在同一台机器上再装一个 **稳定版** WT（`Microsoft.WindowsTerminal 1.24.11911.0`），用 `evidence/wsl_tty_keylog.sh` 在两个通道各抓一次字节，并各做一轮对照：直接抓 vs 先执行 `cmd.exe /c exit` 再抓。

- 若稳定版在 interop 之后字节变成 `ESC[…_`、preview 不变 → 就是 §8.3 的 `#19229` 在起作用；
- 若两个通道的字节完全一样（都是 `ESC[1;5D`）→ 与 WT 通道无关，回到 §4 的其他解释。

---

## 9. 参考来源

- Windows Terminal 设计文档（win32-input-mode、WSL 场景）：<https://github.com/microsoft/terminal/blob/main/doc/specs/%234999%20-%20Improved%20keyboard%20handling%20in%20Conpty.md>
- Windows Terminal 源码（本机 clone，commit `0b94a7e`）：
  - `src/host/VtIo.cpp:203`（ConPTY 启动时请求 `?9001h`）、`:259`（关闭时 `?9001l`）
  - `src/host/_stream.cpp:423`（RIS 后重新请求 9001/1004）
  - `src/terminal/adapter/adaptDispatch.cpp:1893`（处理 `DECSET 9001`）、`:2036`（`DECRQM 9001` 查询）
  - `src/terminal/input/terminalInput.cpp:233`（W32IM 下所有按键都走 `_makeWin32Output`）
- win32-input-mode 支持 PR：<https://github.com/microsoft/terminal/pull/6309>
- W32IM 与 WSL interop 的冲突（含“WSL 把它透传给宿主终端”的分析）：<https://github.com/microsoft/terminal/issues/16343>
- 历史：WSL 里 Ctrl+方向键变成 `;5A`/`;5D` 字面量：<https://github.com/microsoft/WSL/issues/2153>
- nushell：Ctrl+← 支持的历史与来源：<https://github.com/nushell/nushell/issues/441>，<https://github.com/nushell/nushell/pull/1141>
- nushell：Shift+导航/选择：<https://github.com/nushell/nushell/pull/11535>
- crossterm Unix 事件解析（无 win32-input-mode 分支）：<https://github.com/crossterm-rs/crossterm/blob/master/src/event/sys/unix/parse.rs>
