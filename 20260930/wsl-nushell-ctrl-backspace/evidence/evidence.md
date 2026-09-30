# 原始证据记录（2026-09-30 本机实测）

## 0. 环境

```
Windows Terminal : Microsoft.WindowsTerminalPreview 1.25.1912.0     (Get-AppxPackage)
WSL              : 2.7.14.0, kernel 6.18.33.2-microsoft-standard-WSL2
Distro           : Arch Linux (wsl -d archlinux)
nushell (WSL)    : 0.116.0      nushell (Windows): 0.116.0
crossterm (WSL)  : 0.29.0  (~/.cargo/registry/src/index.crates.io-*/crossterm-0.29.0)
TERM             : xterm-256color
edit_mode        : emacs
config           : /home/lumirelle/.config/shared/nushell/config.nu
$env.config.keybindings : 8 条内置项，无自定义覆盖（无 ctrl+h / ctrl+backspace 覆盖）
```

`nu -c 'keybindings default | to text'` 在 Windows 与 WSL 上逐行相同（`diff` 只报 CRLF/LF 差异）。

---

## 1. nushell 启动时写的转义序列（`nu --no-config-file`）

由 `evidence/pty_key_probe_ctrl_backspace.py` §0 采集（去重后）：

```
'\x1b]2;/mnt/c/Users/lumirelle/my/demo/demo-misc\x07'   # OSC 2 标题
'\x1b[32m' '\x1b[1m' '\x1b[0m'                          # SGR
'\x1b[?2004h'                                           # bracketed paste
'\x1b[6n'                                               # 光标位置查询
'\x1b[?25l' '\x1b[1;2H' '\x1b[J' '\x1b[1;1H'           # 清屏/定位
'\x1b[92m' '\x1b[1;32m' '\x1b[1;36m' '\x1b[1;35m' '\x1b[1;31m' '\x1b[1;90m' '\x1b[96m' '\x1b[35m'
'\x1b[3;121H' '\x1b[?25h'
```

**没有** `ESC[>…u`（Kitty 键盘协议 push）序列 ⇒ nushell/reedline 不请求 KKP。

---

## 2. `input listen --types [key]`（probe A）

方法：`nu --no-config-file -c 'input listen --types [key] | to nuon'`，在 Linux pty 里注入下面的字节。

| 注入的字节（hex） | nushell 输出 |
| --- | --- |
| `7f` | `{type: key, key_type: other, code: backspace, modifiers: []}` |
| `08` | `{type: key, key_type: char, code: h, modifiers: ["keymodifiers(control)"]}` |
| `1b 7f` | `{type: key, key_type: other, code: backspace, modifiers: ["keymodifiers(alt)"]}` |
| `1b 08` | `{type: key, key_type: char, code: h, modifiers: ["keymodifiers(control)", "keymodifiers(alt)"]}` |
| `1b 5b 31 32 37 3b 35 75` (`ESC[127;5u`) | `{type: key, key_type: other, code: backspace, modifiers: ["keymodifiers(control)"]}` |
| `1b 5b 31 32 37 3b 35 3b 31 75` (`ESC[127;5;1u`) | `{type: key, key_type: other, code: backspace, modifiers: ["keymodifiers(control)"]}` |
| `1b 5b 38 3b 35 75` (`ESC[8;5u`) | `{type: key, key_type: char, code: , modifiers: ["keymodifiers(control)"]}`（C0 码点） |
| `1b 5b 32 37 3b 35 3b 31 32 37 7e` (`ESC[27;5;127~`) | 空（crossterm 不解析这种 fixterms 形式） |
| `1b 5b 38 3b 31 34 3b 31 32 37 3b 31 3b 38 3b 31 5f`（W32IM 记录） | **空**（完全被忽略） |
| `17` | `{type: key, key_type: char, code: w, modifiers: ["keymodifiers(control)"]}` |
| `1b 5b 31 3b 35 44` (`ESC[1;5D`) | `{type: key, key_type: other, code: left, modifiers: ["keymodifiers(control)"]}` |

---

## 3. 交互实测（probe B）：`echo AA BB CC` + 按键 + `Z` + 回车

用**用户自己的 config**（`nu`），看实际执行的 `echo` 收到了什么参数。

```
DEL      0x7f             -> AA BB CZ          # 删 1 字符
BS       0x08             -> AA BB CZ          # 删 1 字符（= Ctrl+H）
ESC DEL  1b 7f            -> AA BB Z           # 按词删 ✅
ESC BS   1b 08            -> AA BB CChZ        # ctrl+alt+h 无绑定 ⇒ 插入字面量 'h'
CSI 127;5u (kitty)        -> AA BB Z           # 按词删 ✅
CTRL+W   0x17             -> AA BB Z           # 按词删（CutWordLeft）✅
CTRL+U   0x15             -> Z                 # 整行清到行首（CutFromStart）
CTRL+LEFT ESC[1;5D        -> AA BB ZCC         # 光标按词跳 ✅
LEFT     ESC[D            -> AA BB CZC         # 只移 1 个字符
(baseline, 不按键)         -> AA BB CCZ
```

（另一轮用 `echo AAA BBB CCC` 的旧记录：`0x7f` → `CCZ`，`0x08` → `CCZ`，`ESC DEL` → `Z`，结论一致。）

---

## 4. nushell 默认键位表中与退格相关的行（0.116.0，两平台相同）

```
mode: emacs, modifier: KeyModifiers(0x0),     code: Backspace, event: Edit([Backspace])
mode: emacs, modifier: KeyModifiers(ALT),     code: Backspace, event: Edit([BackspaceWord])
mode: emacs, modifier: KeyModifiers(ALT),     code: Char('m'), event: Edit([BackspaceWord])
mode: emacs, modifier: KeyModifiers(CONTROL), code: Backspace, event: Edit([BackspaceWord])   <- WSL 里收不到
mode: emacs, modifier: KeyModifiers(CONTROL), code: Char('h'),  event: Edit([Backspace])      <- WSL 里实际命中
mode: emacs, modifier: KeyModifiers(CONTROL), code: Char('w'),  event: Edit([CutWordLeft])
mode: vi_insert,   modifier: KeyModifiers(CONTROL), code: Backspace, event: Edit([BackspaceWord])
mode: vi_insert,   modifier: KeyModifiers(CONTROL), code: Char('h'), event: Edit([Backspace])
mode: vi_insert,   modifier: KeyModifiers(CONTROL), code: Char('w'), event: Edit([BackspaceWord])
（helix_insert / helix_normal 与 vi 系列同构）
```

## 5. 用户 config 现状

```
edit_mode : emacs
keybindings (8) : completion_menu(tab) / ide_completion_menu(ctrl+space) / completion_previous(shift+backtab) /
                  history_menu(ctrl+r) / next_page_menu(ctrl+x) / undo_or_previous_page_menu(ctrl+z) /
                  help_menu(f1) / search_history(ctrl+q)
                  —— 没有任何 ctrl+h / ctrl+backspace / ctrl+w 的自定义项
```

---

## 6. 修复实测（`evidence/verify_ctrl_h_rebind.py`）

```
BEFORE (用户 config):
    0x08 -> AA BB CZ     # 删 1 字符
    0x7f -> AA BB CZ
    1b 7f -> AA BB Z

AFTER (config 里加 { modifier: control, keycode: char_h, mode: [emacs vi_insert], event: {edit: BackspaceWord} }):
    0x08 -> AA BB Z      # 按词删 ✅
    0x7f -> AA BB CZ     # 普通退格不受影响 ✅
    1b 7f -> AA BB Z
```

配置语法校验：`nu --config /tmp/…/fixed.nu -c 'print ok'` → `ok`；
合并后 `$env.config.keybindings | where keycode == char_h` → `[ctrl_h_word_delete, control, char_h, {edit: BackspaceWord}, [emacs, vi_insert]]`（用户项覆盖内置项）。

---

## 7. 源码摘录

### 7.1 conhost：VT 输入模式下把 INPUT_RECORD 编回 VT（`src/host/inputBuffer.cpp`）

```cpp
const auto vtInputMode = IsInVirtualTerminalInputMode();
...
// If we're in vt mode, try and handle it with the vt input module.
// If it was handled, do nothing else for it.
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

### 7.2 `TerminalInput::_encodeRegular` 的 VK_BACK 规则（`src/terminal/input/terminalInput.cpp:912`）

```cpp
case VK_BACK:
{
    // BACKSPACE maps to either DEL or BS, depending on the Backarrow Key mode.
    // The Ctrl modifier inverts the active mode, swapping BS and DEL (this is
    // not standard, but a modern terminal convention). The Alt modifier adds
    // an ESC prefix (also not standard).
    enc.altPrefix = true;
    const auto ctrl = key.ctrlPressed;
    const auto back = _inputMode.test(Mode::BackarrowKey);
    enc.plain = ctrl == back ? L"\x7f"sv : L"\b"sv;   // 默认 back=false ⇒ Ctrl+Backspace = 0x08
    break;
}
```

（同文件 :233：`if (_inputMode.test(Mode::Win32) && !_forceDisableWin32InputMode && !_kittyFlags) return _makeWin32Output(...)` —— ConPTY 请求了 W32IM，所以 WT→ConPTY 这一段送的是 `CSI 8;14;127;1;8;1_`。）

### 7.3 WSL 自己把控制台设成 VT 输入模式（`microsoft/WSL@master`, `src/windows/common/ConsoleState.cpp:99`）

```cpp
// Configure for raw input with VT support.
THROW_LAST_ERROR_IF(!GetConsoleMode(m_InputHandle.get(), &mode));
DWORD NewMode = mode;
WI_SetAllFlags(NewMode, ENABLE_WINDOW_INPUT | ENABLE_VIRTUAL_TERMINAL_INPUT);
WI_ClearAllFlags(NewMode, ENABLE_ECHO_INPUT | ENABLE_INSERT_MODE | ENABLE_LINE_INPUT | ENABLE_PROCESSED_INPUT);
ChangeConsoleMode(m_InputHandle.get(), NewMode);
```

⇒ 送进 Linux pty 的字节由 **conhost** 用 7.2 的规则生成。WSL 仓库（master，1725 个文件）里没有按键→VT 的翻译实现，只有 VT 输出辅助（`VTSupport.*`）。

### 7.4 crossterm 0.29.0（Unix）字节表（`src/event/sys/unix/parse.rs:103`）

```rust
b'\x7F' => Ok(Some(InternalEvent::Event(Event::Key(KeyCode::Backspace.into())))),
c @ b'\x01'..=b'\x1A' => Ok(Some(InternalEvent::Event(Event::Key(KeyEvent::new(
    KeyCode::Char((c - 0x1 + b'a') as char),     // 0x08 -> 'h'
    KeyModifiers::CONTROL,
))))),
```

### 7.5 crossterm 0.29.0（Windows）用的是结构化字段（`src/event/sys/windows/parse.rs`）

```rust
let modifiers = KeyModifiers::from(&key_event.control_key_state);
...
VK_BACK => Some(KeyCode::Backspace),
...
let key_event = KeyEvent::new_with_kind(key_code, modifiers, kind);
```

⇒ Windows 上 Ctrl+Backspace = `KeyCode::Backspace + CONTROL`（不经过任何字节编码）。

---

## 8. ConPTY 的 `^H = Ctrl+Backspace` 约定（microsoft/terminal#3935，2020-01 合入）

同 PR 里 reviewer（zadjii-msft）用 `showkey -a` / `conechokey` 实测的表格（节选）：

| Key Chord | gnome-terminal | conhost (前) | conhost (修复后) | conpty (前) | conpty (修复后) |
| --- | --- | --- | --- | --- | --- |
| Bksp | `DEL` (0x7f) | `DEL` (0x7f) | `DEL` (0x7f) | `DEL` (0x7f) | `DEL` (0x7f) |
| **Ctrl+Bksp** | **`^H` (0x08)** | **`^H` (0x08)** | `^[^H` (0x1b08) | **`^H` (0x08)** | `^[^H` (0x1b08) |
| Ctrl+h | `^H` (0x08) | `^H` (0x08) | `^H` (0x08) | `^H` (0x08) | `^[^H` (0x1b08) |
| Ctrl+Del | `^[[3;5~` | `^[[3;5~` | `^[[3;5~` | `^[[3;5~` | `^[[3;5~` |
| Alt+Bksp | `^[DEL` (0x1b7f) | `^[DEL` | `^[DEL` | — | — |

关键评论：

> Fundamentally, there's a problem where clients reading VT input can't differentiate between Ctrl+Bksp and Ctrl+h because they have the same encoding (`^H`) … Win32 client apps _can_ differentiate, but not VT (read:WSL) ones.

> With some new changes making `InputStateMachine` process `^H` as Ctrl+Bksp, CMD and PS will delete whole words. **In WSL, `^H` does not follow the same path through `InputStateMachine` as in CMD or PS** (apparently). （PR 作者 mkitzan）

PR 时间线上还有一条 2020-04 的用户回报：*"I'm on 0.10.781.0 but ctrl-backspace simply seems to send ctrl-h in WSL2 :("* —— 与本次分析一致。

---

## 9. 本机尚未直接采样的一项（需要人工按键）

上面所有"WSL 送的是 0x08"的结论来自：① 7.2/7.3 的源码链路；② #3935 的实测表；③ 上一份调研（2026-09-24）里对同一条链路 Ctrl+← 的字节采样（`ESC[1;5D`，说明 conhost 的编码被原样保留）。

**尚未在本机用真实按键抓过 Ctrl+Backspace 的字节**（无法在 agent 环境里注入键盘事件）。验证方式：在 WT 的 WSL 标签页里跑 `evidence/wt_wsl_keylog.py`。
