# 原始证据记录（2026-09-24 本机实测）

## 0. 环境

```
Windows Terminal : 1.25.1912.0 (Microsoft.WindowsTerminalPreview)  [wt.exe]
WSL              : 2.7.13.0, kernel 6.18.33.2-2
Distro           : Arch Linux  (shell: /usr/bin/bash, interactive nushell = /usr/sbin/nu)
nushell (WSL)    : 0.115.1
nushell (Windows): 0.115.1
TERM             : xterm-256color
edit_mode        : emacs (Windows 与 WSL 相同)
$env.config.keybindings : 8 条内置项（两侧完全一致），无 ctrl+left 覆盖
```

## 1. 键位表（Windows / WSL 完全一致）

```
$ nu -c 'keybindings default | to text' | grep -i "code: Left"
mode: emacs, modifier: KeyModifiers(0x0),     code: Left, event: UntilFound([MenuLeft, Left])
mode: emacs, modifier: KeyModifiers(ALT),     code: Left, event: Edit([MoveWordLeft { select: false }])
mode: emacs, modifier: KeyModifiers(CONTROL), code: Left, event: Edit([MoveWordLeft { select: false }])
mode: emacs, modifier: KeyModifiers(SHIFT),   code: Left, event: Edit([MoveLeft { select: true }])
mode: emacs, modifier: KeyModifiers(SHIFT | CONTROL), code: Left, event: Edit([MoveWordLeft { select: true }])
```

## 2. `input listen` —— nushell 实际解析到的按键

在 Windows Terminal 驱动的真实 WSL 会话里（加载用户自己的 `config.nu`）：

```
$ nu -c "input listen --types [key] | to nuon"      # 然后按 Ctrl+←
{type: key, key_type: other, code: left, modifiers: ["keymodifiers(control)"]}
[EXIT=0]
```

在纯 Linux pty 里逐条注入序列（`nu --no-config-file`）：

| 注入的字节 | `input listen --types [key]` 输出 |
| --- | --- |
| `ESC[1;5D` | `{type: key, key_type: other, code: left, modifiers: ["keymodifiers(control)"]}` |
| `ESC[1;5C` | `{type: key, key_type: other, code: right, modifiers: ["keymodifiers(control)"]}` |
| `ESC[1;2D` | `{type: key, key_type: other, code: left, modifiers: ["keymodifiers(shift)"]}` |
| `ESC[37;75;0;1;8;1_`（win32-input-mode 的 Ctrl+← 记录） | **空**（没有任何事件） |
| `ESC[37;5u`（kitty CSI u） | `{type: key, key_type: char, code: %, modifiers: ["keymodifiers(control)"]}` |

## 3. Windows Terminal → WSL 的实际字节流（raw tty dump）

在 WT 的 WSL 标签页里把 tty 置 raw，`dd` 记录；依次按下 `a b c`、`Ctrl+←`、`Ctrl+→`、`x y z`：

```
$ cat /tmp/klog3.bin | xxd
00000000: 6162 631b 5b31 3b35 441b 5b31 3b35 4378  abc.[1;5D.[1;5Cx
00000010: 797a                                     yz
```

解码：`a b c` + `ESC[1;5D`(Ctrl+←) + `ESC[1;5C`(Ctrl+→) + `x y z` —— **标准 xterm 序列，修饰符完好**。

## 4. 交互效果（Linux pty，nushell 0.115.1）

步骤：输入 `echo AAA BBB CCC` → 按一次方向键 → 输入 `Z` → 回车，观察实际执行的参数（表格第 3 行）：

```
plain LEFT             -> ['│ 2 │ CCZC │']      # 只移动 1 个字符
CTRL+LEFT (ESC[1;5D)   -> ['│ 2 │ ZCCC │']      # 按词移动 ✅
CTRL+LEFT x2           -> ['│ 2 │ CCC  │']      # 第 2 行为 'ZBBB'，即连续按词移动
ALT+LEFT (ESC[1;3D)    -> ['│ 2 │ ZCCC │']      # 按词移动（备用键）
CTRL+RIGHT (ESC[1;5C)  -> ['│ 2 │ CCCZZZ │']    # 行尾行为差异，见 README §4(d)
```

## 5. Windows Terminal 源码摘录（clone: microsoft/terminal@0b94a7e）

`src/host/VtIo.cpp:196-204`（ConPTY 启动时请求 win32-input-mode）：

```cpp
// GH#4999 - Send a sequence to the connected terminal to request
// win32-input-mode from them. ...
writer.WriteUTF8(
    "\x1b[c"      // DA1 Report (Primary Device Attributes)
    "\x1b[?1004h" // Focus Event Mode
    "\x1b[?9001h" // Win32 Input Mode
);
```

`src/host/VtIo.cpp:253-260`（关闭时反向操作）：`"\x1b[?1004l" "\x1b[?9001l"`

`src/terminal/adapter/adaptDispatch.cpp:1893-1903`：

```cpp
case DispatchTypes::ModeParams::W32IM_Win32InputMode:
    _terminalInput.SetInputMode(TerminalInput::Mode::Win32, enable);
    // ConPTY requests the Win32InputMode on startup and disables it on shutdown.
```

`src/terminal/input/terminalInput.cpp:233`：

```cpp
if (_inputMode.test(Mode::Win32) && !_forceDisableWin32InputMode && !_kittyFlags)
{
    return _makeWin32Output(event.Event.KeyEvent);   // 所有按键都变成 CSI ..;_ 记录
}
```

设计文档 `doc/specs/#4999 - Improved keyboard handling in Conpty.md`（WSL 场景）：

> When WSL reads the input, it'll read (using `ReadConsoleInput`) a stream of `INPUT_RECORD`s
> that contain only character information, which it will then pass to the linux application.

## 6. crossterm（Unix 后端）无 win32-input-mode 解析

`src/event/sys/unix/parse.rs` 中 `parse_csi_modifier_key_code()` 只处理 `A/B/C/D/F/H/P/Q/R/S`（方向键/Home/End/F1-F4），
`_` 结尾的 win32-input-mode 记录没有对应分支；实测（§2）也确实收不到任何事件。
