#!/usr/bin/env python3
"""Log the raw bytes Windows Terminal actually delivers to a WSL tty.

RUN THIS **INSIDE A WINDOWS TERMINAL WSL TAB** (not through ssh/tmux):

    python3 wt_wsl_keylog.py

For every listed key it puts the tty in raw mode, waits for you to press the key,
prints the exact bytes, and restores the tty.  Nothing is sent anywhere.

Expected (per 2026-09-30 analysis, conhost encodes VK_BACK+Ctrl as 0x08):

    Backspace       ->  7f
    Ctrl+Backspace  ->  08          <-- identical to Ctrl+H: that is the whole problem
    Ctrl+H          ->  08
    Alt+Backspace   ->  1b 7f

If Ctrl+Backspace instead shows 1b 5b 38 3b ... 5f  (CSI 8;14;127;1;8;1_) the session
is stuck in win32-input-mode; fix with:  printf '\\e[?9001l'
"""
import os
import select
import sys
import termios
import time
import tty

STEPS = [
    ("Backspace", "press Backspace"),
    ("Ctrl+Backspace", "press Ctrl+Backspace"),
    ("Ctrl+H", "press Ctrl+H"),
    ("Alt+Backspace", "press Alt+Backspace (Alt+Backspace, not Esc then Backspace)"),
    ("Ctrl+W", "press Ctrl+W"),
    ("Ctrl+Left", "press Ctrl+Left"),
    ("Backspace (again)", "press Backspace once more, to confirm nothing was left over"),
]

INTERPRETATIONS = {
    b"\x7f": "DEL  -> plain Backspace",
    b"\x08": "^H   -> identical to Ctrl+H (no way to tell them apart in a Linux terminal)",
    b"\x1b\x7f": "ESC DEL -> Alt+Backspace (nushell: BackspaceWord, deletes a word)",
    b"\x1b\x08": "^[^H -> Ctrl+Alt+Backspace",
    b"\x1b[127;5u": "CSI 127;5u -> Kitty-encoded Ctrl+Backspace (nushell understands this)",
    b"\x1b[8;14;127;1;8;1_": "win32-input-mode record (crossterm ignores it => key looks dead)",
}


def grab(label, timeout=6.0, quiet=0.25):
    print("  -> %s ... " % label, end="", flush=True)
    fd = sys.stdin.fileno()
    old = termios.tcgetattr(fd)
    buf = b""
    try:
        tty.setraw(fd)
        deadline = time.time() + timeout
        last = time.time()
        while time.time() < deadline:
            r, _, _ = select.select([fd], [], [], 0.05)
            if r:
                chunk = os.read(fd, 64)
                if not chunk:
                    break
                buf += chunk
                last = time.time()
            elif buf and (time.time() - last) > quiet:
                break
    finally:
        termios.tcsetattr(fd, termios.TCSADRAIN, old)
    return buf


def main():
    if not sys.stdin.isatty():
        print("!! stdin is not a tty. Run this from an interactive Windows Terminal WSL tab.")
        print("   (tty:", os.ttyname(0) if sys.stdin.isatty() else "none", ")")
        return 1
    print("TERM=%s   tty=%s" % (os.environ.get("TERM", "?"), os.ttyname(0)))
    print("Follow the prompts. Each key is captured for up to 6 s; 0.25 s of silence ends it.\n")
    results = {}
    for name, prompt in STEPS:
        results[name] = grab(prompt)
    print("\n================ RESULT ================")
    for name, _ in STEPS:
        b = results[name]
        print("%-20s %-24s %s" % (name, " ".join("%02x" % x for x in b) or "(nothing)", INTERPRETATIONS.get(b, "")))
    print("========================================")
    return 0


if __name__ == "__main__":
    sys.exit(main())
