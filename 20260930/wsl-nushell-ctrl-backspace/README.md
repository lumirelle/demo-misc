# 为什么 Windows 的 nushell 里 Ctrl+Backspace 能按词删，WSL 里不行？

调研日期：2026-09-30　（承接 `20260924/wsl-nushell-ctrl-arrow/`：那份查的是 Ctrl+←，这份查的是 Ctrl+Backspace）
被测环境（本机实测）：

```
Windows Terminal : Microsoft.WindowsTerminalPreview 1.25.1912.0
WSL             : 2.7.14.0 , kernel 6.18.33.2-microsoft-standard-WSL2
Distro          : Arch Linux
nushell         : 0.116.0（Windows 与 WSL 同一版本）
crossterm       : 0.29.0（WSL 侧 ~/.cargo/registry 里的源码）
TERM            : xterm-256color      edit_mode: emacs
config          : /home/lumirelle/.config/shared/nushell/config.nu
                   $env.config.keybindings = 8 条内置项（无自定义覆盖），Windows 侧键位表与 WSL 完全一致（仅换行符不同）
```

---

## 0. 结论速览

1. **Ctrl+Backspace 在 VT/字节世界里只能用 `^H`（0x08）表示；而 `^H` 同时又是 Ctrl+H。两者在字节层面不可区分。** 这是整件事的根因，微软自己在 2019 年就写明了：

   > Fundamentally, there's a problem where clients reading VT input can't differentiate between Ctrl+Bksp and Ctrl+h because they have the same encoding (`^H`) … **Win32 client apps _can_ differentiate, but not VT (read: WSL) ones.**
   > —— [microsoft/terminal#3935](https://github.com/microsoft/terminal/pull/3935) 的 review 评论（zadjii-msft）

2. **Windows 上能按词删，是因为那条路根本没有"编码成字节"这一步**：nushell 是原生控制台程序，crossterm 的 Windows 后端直接读 `KEY_EVENT_RECORD`，拿到 `VK_BACK + LEFT_CTRL_PRESSED`，于是 `KeyCode::Backspace + KeyModifiers::CONTROL` 命中了 nushell 的 `ctrl+backspace → BackspaceWord`。

3. **WSL 上不行，是因为链路末端是字节流，而且送进来的那个字节是 `0x08`**：

   ```
   WT（win32-input-mode 记录 CSI 8;14;127;1;8;1_）
     → ConPTY(conhost) 解析成 KEY_EVENT{VK_BACK, Uc=0x7F, LEFT_CTRL_PRESSED}
     → wsl.exe 把控制台设成 ENABLE_VIRTUAL_TERMINAL_INPUT（WSL 源码确证）
     → conhost 再用 TerminalInput::_encodeRegular 把它"编回 VT"：VK_BACK + Ctrl ⇒ 0x08
     → wsl.exe 把这串字节写进 Linux pty
     → Linux 里的 crossterm 解析：0x08 ∈ 0x01..=0x1A ⇒ Char('h') + CONTROL
   ```

4. **Linux 侧 crossterm 的字节表里没有"Ctrl+Backspace"这个概念**：`0x7F → Backspace`（无修饰），`0x01..=0x1A → Ctrl+字母`。所以 0x08 到了 nushell 就是 **Ctrl+H**，而 nushell 默认 emacs 表里 `ctrl+h → Backspace`（删 1 个字符），`ctrl+backspace → BackspaceWord` 这条绑定**永远收不到事件**。

   ⇒ 表现：在 WSL 的 nushell 里按 Ctrl+Backspace，**效果和普通退格一样，只删一个字符**（不是"完全没反应"）。

5. **这不是 WSL 的 bug、也不是终端版本问题**：原生 Linux 上也是如此（gnome-terminal 的 Ctrl+Backspace 同样是 `^H`，见 §2.1 的实测表）。想在 Linux 侧拿到"可区分的 Ctrl+Backspace"，只能靠带修饰符的编码（Kitty `CSI 127;5u` 等）或自己改键位。**Windows 侧的 nushell 之所以"更聪明"，只是因为它不走字节协议。**

6. 直接可用的修法（已在本机实测，见 §6/§7）：在 `config.nu` 里把 `ctrl+h` 改绑到 `BackspaceWord`；不改配置的话，`Alt+Backspace`、`Ctrl+W`、`Alt+M` 在 WSL 里本来就能按词删。

---

## 1. 两条输入路径的差别（和 Ctrl+← 那份是同一套框架）

| | Windows 上的 nushell | WSL 里的 nushell |
| --- | --- | --- |
| 程序类型 | 原生控制台程序 | ConPTY 客户端后面的 Linux 程序 |
| 输入获取方式 | `ReadConsoleInput` → `KEY_EVENT_RECORD` | `/dev/pts/N` 上的**字节流** |
| "Ctrl"靠什么表达 | `dwControlKeyState` 里的 `LEFT_CTRL_PRESSED`（结构化字段） | VT 序列里的修饰符数字，或**某个控制字节** |
| Ctrl+Backspace | `VK_BACK` + `LEFT_CTRL_PRESSED` → 可区分 ✅ | `^H` = 0x08 → 与 Ctrl+H 同码 ❌ |
| Ctrl+← | `VK_LEFT` + `LEFT_CTRL_PRESSED` → 可区分 ✅ | `ESC[1;5D` → 修饰符信息完整 ✅ |

一句话：**方向键有"带修饰符的 CSI 序列"可以用，退格键在 VT 协议里只有"裸控制字节"**（0x08/0x7F 二选一），修饰信息只能靠"两个码点互换"这种土办法表达，于是和 Ctrl+H 撞车。

---

## 2. 证据链：0x08 是怎么一路产生的

### 2.1 ConPTY 的输入协议就规定 `^H` = Ctrl+Backspace

[microsoft/terminal#3935](https://github.com/microsoft/terminal/pull/3935)（2020-01 合入，正是"让 Ctrl+Backspace 按词删"的那个 PR）里，reviewer 用 `showkey -a` / `conechokey` 实测出了一张表，其中与我们相关的四行：

| 按键 | gnome-terminal | conhost | **conpty（即 WSL 看到的）** |
| --- | --- | --- | --- |
| Backspace | `DEL` (0x7f) | `DEL` (0x7f) | `DEL` (0x7f) |
| **Ctrl+Backspace** | **`^H` (0x08)** | **`^H` (0x08)** | **`^H` (0x08)** |
| Ctrl+h | `^H` (0x08) | `^H` (0x08) | `^H` (0x08) |
| Alt+Backspace | `ESC DEL` (0x1b 0x7f) | `ESC DEL` | `ESC DEL` |

注意两点：**（a）原生 Linux 终端（gnome-terminal）的 Ctrl+Backspace 也是 `^H`；（b）conpty 这条路给客户端的也是 `^H`。** 同 PR 的评论里也有人报告 "I'm on 0.10.781.0 but ctrl-backspace simply seems to send ctrl-h in WSL2 :("。

### 2.2 conhost 这一层：WSL 开了 VT 输入模式，所以由 conhost 负责"编回 VT"

WSL 源码（`microsoft/WSL@master`，`src/windows/common/ConsoleState.cpp:99-107`）明确把自己切到 VT 输入模式：

```cpp
// Configure for raw input with VT support.
THROW_LAST_ERROR_IF(!GetConsoleMode(m_InputHandle.get(), &mode));
DWORD NewMode = mode;
WI_SetAllFlags(NewMode, ENABLE_WINDOW_INPUT | ENABLE_VIRTUAL_TERMINAL_INPUT);
WI_ClearAllFlags(NewMode, ENABLE_ECHO_INPUT | ENABLE_INSERT_MODE | ENABLE_LINE_INPUT | ENABLE_PROCESSED_INPUT);
ChangeConsoleMode(m_InputHandle.get(), NewMode);
```

于是 conhost 在写输入缓冲区时会走 VT 编码分支（`src/host/inputBuffer.cpp`，`InputBuffer::_WriteBuffer`）：

```cpp
const auto vtInputMode = IsInVirtualTerminalInputMode();
...
// If we're in vt mode, try and handle it with the vt input module.
if (vtInputMode)
{
    // GH#11682: TerminalInput::HandleKey can handle both KeyEvents and Focus events seamlessly
    if (const auto out = _termInput.HandleKey(inEvent))
    {
        _writeString(*out);
        eventsWritten++;
        continue;
    }
}
```

而 `TerminalInput::_encodeRegular` 里 VK_BACK 的规则是"**Ctrl 把 BS/DEL 互换**"（`src/terminal/input/terminalInput.cpp:912-919`）：

```cpp
case VK_BACK:
{
    // BACKSPACE maps to either DEL or BS, depending on the Backarrow Key mode.
    // The Ctrl modifier inverts the active mode, swapping BS and DEL (this is
    // not standard, but a modern terminal convention). ...
    enc.altPrefix = true;
    const auto ctrl = key.ctrlPressed;
    const auto back = _inputMode.test(Mode::BackarrowKey);   // 默认 false（Backspace 发 DEL）
    enc.plain = ctrl == back ? L"\x7f"sv : L"\b"sv;          // ctrl 且默认模式 ⇒ L"\b" = 0x08
    break;
}
```

即：**普通 Backspace → `0x7F`，Ctrl+Backspace → `0x08`**，与 §2.1 的表完全一致。（这也是"Ctrl 修饰信息"在 WSL 这条路上的最后形态。）

> 反向同理：conhost 的输入状态机把收到的 `0x08` 解释成 Ctrl+Backspace（就是 #3935 改的），所以协议两侧是自洽的 —— 只是**这个约定到了 Linux 侧 crossterm 那里就不成立了**（crossterm 认为 0x08 是 Ctrl+H）。

### 2.3 Linux 这一层：crossterm 的字节表

`crossterm-0.29.0/src/event/sys/unix/parse.rs`：

```rust
b'\x7F' => Ok(Some(InternalEvent::Event(Event::Key(KeyCode::Backspace.into())))),   // 无修饰
c @ b'\x01'..=b'\x1A' => Ok(Some(InternalEvent::Event(Event::Key(KeyEvent::new(
    KeyCode::Char((c - 0x1 + b'a') as char),      // 0x08 → 'h'
    KeyModifiers::CONTROL,
))))),
```

− 没有 0x08 → Ctrl+Backspace 的分支，也不可能凭空恢复（信息在字节里就不存在）。

### 2.4 对照组：Windows 侧 crossterm 完全不经过字节

`crossterm-0.29.0/src/event/sys/windows/parse.rs`：

```rust
let modifiers = KeyModifiers::from(&key_event.control_key_state);   // ← 从结构化字段取 Ctrl
...
VK_BACK => Some(KeyCode::Backspace),
...
let key_event = KeyEvent::new_with_kind(key_code, modifiers, kind);
```

⇒ Windows 上 Ctrl+Backspace 就是 `KeyCode::Backspace + KeyModifiers::CONTROL`，命中 nushell 的 `ctrl+backspace → BackspaceWord`。

---

## 3. WSL 实测：各种候选字节序列，nushell 分别怎么反应

（在 Linux pty 里直接注入字节，脚本见 `evidence/pty_key_probe_ctrl_backspace.py`；`nu` 为用户配置）

### 3.1 `input listen --types [key]` —— nushell 解析成什么

| 注入的字节 | nushell 看到的 KeyEvent | 判定 |
| --- | --- | --- |
| `7f` | `code: backspace, modifiers: []` | 普通退格 |
| `08` | `code: h, modifiers: [control]` | **Ctrl+H**（← WSL 实际送的就是这个） |
| `1b 7f` | `code: backspace, modifiers: [alt]` | Alt+Backspace |
| `1b 08` | `code: h, modifiers: [control, alt]` | Ctrl+Alt+H（无绑定 ⇒ 会插入字面量 `h`） |
| `1b 5b 31 32 37 3b 35 75`（`ESC[127;5u`，Kitty） | `code: backspace, modifiers: [control]` | **真正的 Ctrl+Backspace** ✅ |
| `1b 5b 31 3b 35 44`（`ESC[1;5D`） | `code: left, modifiers: [control]` | Ctrl+← ✅（对照） |
| `1b 5b 38 3b 31 34 3b 31 32 37 3b 31 3b 38 3b 31 5f`（W32IM 记录） | **空**（被忽略） | win32-input-mode 泄漏的信号 |

### 3.2 交互实测 —— 实际执行了什么

输入 `echo AA BB CC` → 按键 → `Z` → 回车：

| 按键/字节 | 执行结果 | 含义 |
| --- | --- | --- |
| （不按） | `AA BB CCZ` | 基线 |
| `0x7f` | `AA BB CZ` | 删 1 字符 |
| **`0x08`（WSL 送来的）** | **`AA BB CZ`** | **删 1 字符 = 就是你在 WSL 里看到的现象** ❌ |
| `0x1b 0x7f`（Alt+Backspace） | `AA BB Z` | 按词删 ✅ |
| `0x1b 0x08` | `AA BB CChZ` | 没绑定 ⇒ 字面插入 `h` |
| `ESC[127;5u`（Kitty） | `AA BB Z` | 按词删 ✅ |
| `0x17`（Ctrl+W） | `AA BB Z` | 按词删（`CutWordLeft`）✅ |
| `0x15`（Ctrl+U） | `Z`（整行被清到行首） | `CutFromStart` ✅ |
| `ESC[1;5D`（Ctrl+←） | `AA BB ZCC` | 光标按词跳 ✅（对照：`ESC[D` → `AA BB CZC`） |

### 3.3 为什么 nushell 的绑定表"看起来没问题"

`nu --no-config-file -c 'keybindings default | to text'`（Windows 与 WSL **完全相同**）：

```
mode: emacs, modifier: KeyModifiers(0x0),     code: Backspace, event: Edit([Backspace])
mode: emacs, modifier: KeyModifiers(ALT),     code: Backspace, event: Edit([BackspaceWord])
mode: emacs, modifier: KeyModifiers(CONTROL), code: Backspace, event: Edit([BackspaceWord])    ← 收不到
mode: emacs, modifier: KeyModifiers(CONTROL), code: Char('h'),  event: Edit([Backspace])       ← 实际命中这个
mode: emacs, modifier: KeyModifiers(CONTROL), code: Char('w'),  event: Edit([CutWordLeft])
```

也就是说：**两边键位表一字不差，差别 100% 在"按键怎样变成事件"这一层** —— 和上次 Ctrl+← 的结论同构。

---

## 4. 顺便回答：为什么 Ctrl+← 就没问题？

因为 Ctrl+← 用的是 **CSI 修饰符编码**：`ESC[1;5D`，其中 `5 = 1 + Ctrl(4)`。修饰信息是一个**独立参数**，即便要穿过 ConPTY→WSL→pty 四层，也只需要每一层"别丢字段"。

而退格只有"两个码点互换"（`0x7f` ↔ `0x08`），Ctrl 与否**没有独立的表达位**，到了 Linux 侧就只剩"0x08 还是 0x7f"两种可能，于是必然与 Ctrl+H 撞车。这也是为什么 TTY 时代的老终端要把 Ctrl+Backspace 归到 `stty erase`/`intr` 那一类去讨论。

---

## 5. 自己确认（你机器上的真实字节）

**① 记录 Windows Terminal → WSL 的实际字节**（在 WT 的 WSL 标签页里跑，脚本：`evidence/wt_wsl_keylog.py`）

```sh
python3 wt_wsl_keylog.py
```

脚本会依次提示按键（Backspace / Ctrl+Backspace / Ctrl+H / Alt+Backspace / Ctrl+W / Ctrl+←），把 tty 置 raw 后抓原始字节并打印 hex。判读：

| 记录的字节 | 含义 | 下一步 |
| --- | --- | --- |
| **`08`** | 本推论的预期结果：Ctrl+Backspace 被编码成 `^H` | §6(1) 改键位即可 |
| `7f` | 修饰位在最后一层丢了（连 Ctrl+H 都不是） | 只能改键位/换键，或查 W32IM 状态 |
| `1b 7f` | 居然是 Alt+Backspace 编码 | 直接用，无需改配置 |
| `1b 5b 31 32 37 3b 35 75` | 已经是 Kitty `CSI 127;5u` | 本该直接可用，若仍不行则为 nushell 侧问题 |
| `1b 5b 38 3b … 5f`（`CSI …_`） | 命中 win32-input-mode 泄漏（上一份调研的 §4a） | `printf '\e[?9001l'` 关闭 W32IM |
| **什么都不打印** | 按键根本没送达（或 W32IM 记录被 crossterm 忽略） | 见上表 W32IM 行 |

**② 看 nushell 解析成什么**（同一个会话，按 Ctrl+Backspace）

```nu
input listen --types [key]
# 期望（也是现状）：{type: key, key_type: char, code: h, modifiers: ["keymodifiers(control)"]}
# 如果出现 code: backspace + control，才说明终端真的送了 CSI 127;5u
```

---

## 6. 修复 / 绕行

### (1) 推荐：把 `ctrl+h` 改绑成 `BackspaceWord`（0 成本、已实测）

因为送到 nushell 的永远是 **Ctrl+H**，所以"让 Ctrl+H 做按词删"就等于让 Ctrl+Backspace 按词删。

你的配置在 `/home/lumirelle/.config/shared/nushell/config.nu`（**Windows 与 WSL 共用**），而 Windows 侧真正的 Ctrl+H 目前是"删 1 字符"。所以建议**只在 Linux 侧生效**（`$nu.os-info.name` 在 Windows 上是 `windows`、WSL 上是 `linux`，已实测）：

```nu
# 只在 WSL/Linux 侧：这些终端把 Ctrl+Backspace 编码成 ^H，除了 Ctrl+H 没别的落点
if $nu.os-info.name == 'linux' {
  $env.config.keybindings ++= [
    { name: ctrl_h_word_delete
      modifier: control
      keycode: char_h
      mode: [emacs vi_insert]
      event: { edit: BackspaceWord }
    }
  ]
}
```

想两边都改就把 `if` 去掉（Windows 上会失去"Ctrl+H = 删 1 字符"，但 Ctrl+H 本来就等价于 Backspace，损失很小）。

- 本机实测（见 `evidence/verify_ctrl_h_rebind.py`）：
  - 改之前：注入 `0x08` → `AA BB CZ`（删 1 字符）
  - 改之后：注入 `0x08` → `AA BB Z`（**按词删** ✅），而普通 Backspace（`0x7f`）仍然只删 1 字符 ✅
- 代价：真正的 Ctrl+H 也会变成"按词删"。原本 Ctrl+H 的行为就是"删 1 字符"（和 Backspace 同义），所以几乎没有损失；如果你希望保留"Ctrl+H = 删 1 字符"，那就别用这条，改用 (2)。
- 注意 `mode`：用 emacs 就写 `[emacs]`；vi/helix 用户写 `[vi_insert helix_insert]`（内置表里这几个模式的 ctrl+h 都是 `Backspace`）。

### (2) 不改任何配置就能按词删的等价键（本机实测可用）

| 按键 | nushell 默认绑定 | 实测 |
| --- | --- | --- |
| `Alt+Backspace` | `BackspaceWord` | ✅ 按词删（`ESC DEL`，是 Unix 传统做法） |
| `Ctrl+W` | `CutWordLeft` | ✅ 按词删（会把词放进 cut buffer，Ctrl+Y 可粘回） |
| `Alt+M` | `BackspaceWord` | ✅（nushell 特有的是 Alt+M） |
| `Alt+D` / `Ctrl+U` / `Ctrl+K` | `CutWordRight` / `CutFromStart` / `KillLine` | ✅ |

> 在原生 Linux 上我一般推荐 `Alt+Backspace`；它在 Windows Terminal 里也是**唯一一条"本身就带修饰符、能穿过多层翻译"的按词删键**。

### (3) 终端侧重映射（可用但有坑，未在本机验证）

Windows Terminal 的 `sendInput` 可以把 `ctrl+backspace` 固定发成 `ESC DEL`（= Alt+Backspace）：

```jsonc
// settings.json
{ "keys": "ctrl+backspace", "command": { "action": "sendInput", "input": "\u001b\u007f" } }
```

坑：microsoft/terminal#16889 报告过 `sendInput` 发 `\u001b\u007f` 无效；而且这条对所有 WSL 会话（含 bash/zsh）生效，会改变它们的行为。优先级放在 (1)(2) 之后。

### (4) Kitty 键盘协议（CSI u）路线——理论最优，但目前用不上

- crossterm 0.29 **能**正确处理 `CSI 127;5u` ⇒ `Backspace + CONTROL`（§3.1 实测）；WT 1.25 preview 也实现了 KKP（[#19817](https://github.com/microsoft/terminal/pull/19817)）。
- 但 **nushell/reedline 目前不请求 KKP**：抓 nushell 启动时写的转义序列，只有 `?2004h`（bracketed paste）等，**没有任何 `ESC[>…u` 的 push 序列**（见 `evidence/evidence.md` §0）。所以 WT 永远走 W32IM/legacy 分支。
- 想试的话（未验证）：在 WT 的 WSL 标签页里手动 `printf '\e[>1u'` 推一次 KKP，再用 `evidence/wt_wsl_keylog.py` 看 Ctrl+Backspace 是否变成 `ESC[127;5u`。中间 ConPTY→WSL 那层的处理方式我没有实测，不敢下结论。

### (5) 不要指望的两件事

- **不要等 WSL/WT 修**：这是 VT 输入的固有歧义（`^H`），不是回归 bug；微软在 #3935 里已经明确"这不在本次修复范围"。
- **不要试图在 nushell 里区分 Ctrl+H 与 Ctrl+Backspace**：信息在到达 Linux 之前就已经丢了，nushell 拿到的只有 0x08。

---

## 7. 复现脚本与证据（本目录）

| 文件 | 用途 |
| --- | --- |
| `evidence/pty_key_probe_ctrl_backspace.py` | 纯 Linux pty 里向 nushell 注入 `0x08`/`0x7f`/`ESC DEL`/`CSI 127;5u`/W32IM 等序列，输出 ① nushell 的 KeyEvent 解析、② 实际执行结果（本 README §3 的表全部由它生成；不依赖 Windows Terminal） |
| `evidence/verify_ctrl_h_rebind.py` | 自动生成 "ctrl+h → BackspaceWord" 的临时 config，对照改前/改后的交互行为（§6(1) 的实测） |
| `evidence/wt_wsl_keylog.py` | **需要在 Windows Terminal 的 WSL 标签页里手动跑**：逐键抓 `/dev/tty` 原始字节，用来确认你机器上 Ctrl+Backspace 到底送的是哪个字节 |
| `evidence/evidence.md` | 本次所有原始输出（版本、启动转义序列、两张实测表、键位表、源码摘录、PR 引用） |

---

## 8. 参考来源

- conhost/conpty 的 `^H = Ctrl+Backspace` 约定与实测表（含 WSL 讨论）：<https://github.com/microsoft/terminal/pull/3935>
- 该问题的最早 issue（"Ctrl-backspace does not delete back to the previous wordbreak"，含 "Ctrl+backspace == ^H which most shells treat as delete one char" 的讨论）：<https://github.com/microsoft/terminal/issues/755>
- `Ctrl + h` 行为差异（conhost 把 `^H` 当成 Ctrl+Backspace 之后，VT 客户端与 Win32 客户端命运不同）：<https://github.com/microsoft/terminal/issues/4397>
- Windows Terminal 源码（main）：
  - `src/terminal/input/terminalInput.cpp:912`（VK_BACK：Ctrl 互换 BS/DEL ⇒ Ctrl+Backspace = `\x08`；:233 W32IM 优先）
  - `src/host/inputBuffer.cpp:~682-706`（VT 输入模式下 `_termInput.HandleKey` 负责把 INPUT_RECORD 编回 VT）
- WSL 源码（master，本次核对 `src/windows/common/ConsoleState.cpp:99-107`）：`ENABLE_VIRTUAL_TERMINAL_INPUT` ⇒ 字节由 conhost 生成；仓库里没有 WSL 自己的按键→VT 翻译实现
- crossterm 0.29.0：
  - Unix `src/event/sys/unix/parse.rs:103-109`（`0x7f→Backspace`，`0x01..0x1a→Ctrl+字母`）
  - Windows `src/event/sys/windows/parse.rs`（`VK_BACK → Backspace` + `control_key_state → modifiers`）
- Windows Terminal 的 Kitty 键盘协议实现（1.25 preview）：<https://github.com/microsoft/terminal/pull/19817>
- `sendInput` 的坑：<https://github.com/microsoft/terminal/issues/16889>
- 姊妹篇（同一链路、Ctrl+← 版本）：`20260924/wsl-nushell-ctrl-arrow/README.md`
