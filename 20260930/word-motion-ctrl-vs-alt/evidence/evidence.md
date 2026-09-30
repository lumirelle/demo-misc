# 原始证据记录（2026-09-30 本机实测 + 一手文档）

## 0. 环境

```
Windows          : Windows 11 (10.0.26300)
Windows Terminal : Microsoft.WindowsTerminalPreview 1.25.1912.0
WSL              : 2.7.14.0, kernel 6.18.33.2-microsoft-standard-WSL2, Arch Linux
nushell          : 0.116.0（Windows 与 WSL 同版本，config: ~/.config/shared/nushell/config.nu, edit_mode=emacs）
bash             : GNU bash 5.3.20(1) (x86_64-pc-linux-gnu)
PowerShell       : Windows PowerShell + PSReadLine（Get-PSReadLineKeyHandler 实取）
crossterm        : 0.29.0（WSL 侧 registry 源码）
```

---

## 1. pty 实测：按键到底删掉了什么

脚本 `word_chord_probe.py`；输入 `echo foo/bar/baz` → 按一次键 → 输入 `Z` → 回车，看实际执行的 `echo` 收到什么。

```
typed: echo foo/bar/baz   then: <chord> <Enter>

bash  Ctrl+W              (unix-word-rubout)         17
      | $                                     <- 只剩 'echo'，整段 foo/bar/baz 被删（空白符词）
bash  Alt+Backspace       (backward-kill-word)       1b 7f
      | foo/bar/                              <- 只删掉 baz
bash  Ctrl+Backspace      (^H)                       08
      | foo/bar/ba                            <- 只删 1 个字符（它就是 Ctrl+H）
bash  Alt+D               (kill-word forward)        1b 64
      | foo/bar/baz                           <- 光标在行尾，向右删词无事可删
bash  Ctrl+Left           (backward-word)            1b 5b 31 3b 35 44
      | foo/bar/baz                           <- 只移动，不删

nu    Ctrl+W              (CutWordLeft)               17
      | foo/bar/                              <- 删掉 baz
nu    Alt+Backspace       (BackspaceWord)            1b 7f
      | foo/bar/                              <- 删掉 baz
nu    Alt+D               (CutWordRight)             1b 64
      | foo/bar/baz
nu    Ctrl+Delete         (DeleteWord)               1b 5b 33 3b 35 7e
      | foo/bar/baz
```

**cut buffer 对照**（nushell：Ctrl+W 会写入 cut buffer，Alt+Backspace 不会）：

```
输入 'echo foo/bar/baz' → 按键序列 → 回车
  Ctrl+W  then Ctrl+Y  -> ['foo/bar/baz']   # 删掉的词被 Ctrl+Y 粘回来了（cut）
  Alt+Backspace then Ctrl+Y -> ['foo/bar/'] # 什么都没粘回来（kill，不进 buffer）
  Ctrl+W  then Alt+Y   -> ['foo/bar/']      # nushell 的 Alt+Y 不是 yank
  Ctrl+W  x2           -> ['foo/bar']       # 第二次只删掉了分隔符 '/'
  Alt+Backspace x2     -> ['foo/bar']       # 同上
```

nushell 的两次删除结果一致 ⇒ 两者词边界相同；区别只在 cut buffer（与 readline 里 `C-w` vs `M-DEL` 的差别**不同**，见 §7.1 手册原文）。

---

## 2. bash / readline

`bind -P`（Arch，bash 5.3，节选）：

```
backward-kill-word can be found on "\e\C-h", "\e\C-?".
backward-word can be found on "\e\e[D", "\e[1;3D", "\e[1;5D", "\e[5D", "\eb".
forward-word can be found on "\e\e[C", "\e[1;3C", "\e[1;5C", "\e[5C", "\ef".
kill-word can be found on "\e[3;5~", "\ed".
unix-line-discard can be found on "\C-u".
unix-word-rubout can be found on "\C-w".
```

`/etc/inputrc`（非注释行，说明 `Ctrl+←/→` 是发行版补的）：

```
set meta-flag on
set input-meta on
set convert-meta off
set output-meta on
$if mode=emacs
"\e[1~": beginning-of-line
"\e[4~": end-of-line
...
"\e[5C": forward-word
"\e[5D": backward-word
"\e\e[C": forward-word
"\e\e[D": backward-word
"\e[1;5C": forward-word
"\e[1;5D": backward-word
...
$endif
```

（`~/.inputrc` 不存在。）

---

## 3. PowerShell / PSReadLine

`Get-PSReadLineKeyHandler -Bound`（筛选 Backspace/Left/Right/Delete/Word）：

```
Key                   Function
---                   --------
Backspace             BackwardDeleteChar
Ctrl+Backspace        BackwardKillWord
Ctrl+w                BackwardKillWord
Delete                DeleteChar
Alt+d                 KillWord
Ctrl+Delete           KillWord
LeftArrow             BackwardChar
Ctrl+LeftArrow        BackwardWord
RightArrow            ForwardChar
Ctrl+RightArrow       NextWord
Shift+LeftArrow       SelectBackwardChar
Shift+Ctrl+LeftArrow  SelectBackwardWord
Shift+RightArrow      SelectForwardChar
Shift+Ctrl+RightArrow SelectNextWord
```

⇒ PSReadLine 走的是 Windows 习惯（Ctrl 管词），而且**没有 `Alt+Backspace` 绑定**。

---

## 4. nushell 0.116 默认键位（`keybindings default`，Windows 与 WSL 逐行相同）

```
mode: emacs, modifier: KeyModifiers(0x0),     code: Backspace, event: Edit([Backspace])
mode: emacs, modifier: KeyModifiers(ALT),     code: Backspace, event: Edit([BackspaceWord])
mode: emacs, modifier: KeyModifiers(ALT),     code: Char('m'), event: Edit([BackspaceWord])
mode: emacs, modifier: KeyModifiers(CONTROL), code: Backspace, event: Edit([BackspaceWord])
mode: emacs, modifier: KeyModifiers(CONTROL), code: Char('h'),  event: Edit([Backspace])
mode: emacs, modifier: KeyModifiers(CONTROL), code: Char('w'),  event: Edit([CutWordLeft])
mode: emacs, modifier: KeyModifiers(ALT),     code: Char('d'),  event: Edit([CutWordRight])
mode: emacs, modifier: KeyModifiers(CONTROL), code: Delete,     event: Edit([DeleteWord])
mode: emacs, modifier: KeyModifiers(ALT),     code: Left/Right, event: Edit([MoveWordLeft/Right ...])
mode: emacs, modifier: KeyModifiers(CONTROL), code: Left/Right, event: Edit([MoveWordLeft/Right ...])
mode: vi_insert modifier: KeyModifiers(CONTROL), code: Backspace / Char('w'), event: Edit([BackspaceWord])
（helix_insert 与 vi_insert 同构）
```

---

## 5. Windows Terminal 官方默认键位里与 `alt+` / `backspace` 有关的条目

（`defaults.json`，共 68 条默认键位；本机解析后完整列表见 `wt_default_alt_keys.txt`）

```
alt+f4               Terminal.CloseWindow
alt+enter            Terminal.ToggleFullscreen
alt+space            Terminal.OpenSystemMenu
alt+left             Terminal.MoveFocusLeft
alt+right            Terminal.MoveFocusRight
alt+up               Terminal.MoveFocusUp
alt+down             Terminal.MoveFocusDown
alt+shift+left/right/up/down  Terminal.ResizePane*
alt+shift+- / alt+shift+plus  Terminal.DuplicatePane*
ctrl+alt+,           Terminal.OpenDefaultSettingsFile
ctrl+alt+1..9        Terminal.SwitchToTab*/LastTab
ctrl+alt+left        Terminal.MoveFocusPrevious
```

**结论：`alt+backspace` 没有任何默认绑定** ⇒ 它会原样送给应用（nushell/bash 拿到 `ESC DEL`）。

---

## 6. VS Code 默认键位（源码摘录）

`src/vs/editor/contrib/wordOperations/browser/wordOperations.ts`：

```ts
// cursorWordLeft / cursorWordEndRight / …Select 系列
primary: KeyMod.CtrlCmd | KeyCode.LeftArrow,
mac:     { primary: KeyMod.Alt | KeyCode.LeftArrow },
primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.LeftArrow,
mac:     { primary: KeyMod.Alt | KeyMod.Shift | KeyCode.LeftArrow },
// deleteWordLeft / deleteWordRight
primary: KeyMod.CtrlCmd | KeyCode.Backspace,
mac:     { primary: KeyMod.Alt | KeyCode.Backspace },
primary: KeyMod.CtrlCmd | KeyCode.Delete,
mac:     { primary: KeyMod.Alt | KeyCode.Delete },
```

（`KeyMod.CtrlCmd` = Windows/Linux 的 Ctrl、macOS 的 Cmd；`mac:` 覆盖把它换成 Option(Alt)。）

---

## 7. 一手文档引文

### 7.1 GNU Bash 参考手册 · Readline Killing Commands

> `M-d` — Kill from the cursor to the end of the current word… Word boundaries are the same as those used by `M-f`.
> `M-DEL` — Kill from the cursor to the start of the current word, or, if between words, to the start of the previous word. Word boundaries are the same as those used by `M-b`.
> `C-w` — Kill from the cursor to the previous whitespace. **This is different than `M-DEL` because the word boundaries differ.**
> `C-y` — Yank the most recently killed text back into the buffer at the cursor.

### 7.2 GNU Bash 参考手册 · Readline Movement Commands

> `M-f` — Move forward a word, where a word is composed of letters and digits.
> `M-b` — Move backward a word.
> … **It is a loose convention that control keystrokes operate on characters while meta keystrokes operate on words.**

### 7.3 GNU Emacs 手册 · Kinds of User Input

> Two commonly-used modifier keys are Control (usually labeled Ctrl), and Meta (usually labeled Alt).
> You can also type Meta characters using two-character sequences starting with `ESC`. Thus, you can enter `M-a` by typing `ESC a`. … This feature is useful on certain text terminals where the Meta key does not function reliably.

### 7.4 Apple 支持 · Mac keyboard shortcuts（Text-editing shortcuts 节选）

```
Option-Delete: Delete the word to the left of the insertion point.
Option–Left Arrow: Move the insertion point to the beginning of the previous word.
Option–Right Arrow: Move the insertion point to the end of the next word.
Option–Shift–Left/Right Arrow: Extend text selection … word …
Command–Left/Right Arrow: Move the insertion point to the beginning/end of the current line.
Shift–Command–Left/Right Arrow: Select … to the beginning/end of the current line.
Control-H: Delete the character to the left of the insertion point.
Control-D: Delete the character to the right of the insertion point.
Control-K: Delete the text between the insertion point and the end of the line or paragraph.
Control-A/E/F/B/P/N/T: (line start / line end / char forward / char backward / line up / line down / transpose)
```

### 7.5 Microsoft 支持 · Keyboard shortcuts in Windows（Text editing）

```
Ctrl + Backspace : Delete words to the left of the cursor.
Ctrl + Del       : Delete words to the right of the cursor.
Ctrl + Left arrow  : Move the cursor backward to the beginning of the previous word.
Ctrl + Right arrow : Move the cursor forward to the beginning of the next word.
Ctrl + Up/Down arrow : Move the cursor to the beginning of the previous/next paragraph.
Shift + Ctrl + Left/Right : Select words backward/forward from the current cursor position.
Alt + Left arrow  : Go back.
Alt + Right arrow : Go forward.
```

### 7.6 Microsoft 支持 · Keyboard shortcuts in Excel

```
Move to the edge of the current data region in a worksheet. | Ctrl+Arrow key
Extend the selection of cells to the last nonblank cell … | Ctrl+Shift+Arrow key
Backspace: Deletes one character to the left in the formula bar / In cell editing mode, …
Delete: Removes the cell contents (data and formulas) from selected cells …
```

### 7.7 Mozilla Bug 1041377

> Disable Backspace as a shortcut for navigating back in history（Firefox 86 起生效）

⇒ 浏览器"后退"的正式快捷键是 `Alt+←`（macOS `⌘←`），不是 `Backspace`。
