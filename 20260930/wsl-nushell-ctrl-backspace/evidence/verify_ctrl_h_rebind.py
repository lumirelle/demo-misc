#!/usr/bin/env python3
"""Verify the recommended fix: does re-binding ctrl+h to BackspaceWord make the
byte Windows Terminal/WSL actually delivers for Ctrl+Backspace (0x08) delete a word?

Self-contained: writes a temporary nushell config and drives `nu` in a pty twice
(before/after), so you can diff the behaviour.

Usage (inside WSL):  python3 verify_ctrl_h_rebind.py
"""
import os, pty, fcntl, termios, struct, time, select, re, signal, tempfile

TMP = tempfile.mkdtemp(prefix="nu_ctrl_h_")
FIXED = os.path.join(TMP, "ctrl_h_word_delete.nu")
with open(FIXED, "w") as f:
    f.write(
        "$env.config = ($env.config | default {})\n"
        "$env.config.edit_mode = 'emacs'\n"
        "$env.config.keybindings ++= [\n"
        "  { name: ctrl_h_word_delete, modifier: control, keycode: char_h,\n"
        "    mode: [emacs vi_insert], event: { edit: BackspaceWord } }\n"
        "]\n"
    )

CASES = [
    ("0x08       (what WSL delivers for ctrl+backspace)", b"\x08"),
    ("0x7f       (plain backspace)                     ", b"\x7f"),
    ("0x1b 0x7f  (alt+backspace)                       ", b"\x1b\x7f"),
]


def spawn(args, cols=120, rows=40):
    pid, fd = pty.fork()
    if pid == 0:
        os.environ["TERM"] = "xterm-256color"
        os.execvp("nu", args)
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", rows, cols, 0, 0))
    return pid, fd


def drain(fd, t):
    out, end = b"", time.time() + t
    while time.time() < end:
        r, _, _ = select.select([fd], [], [], 0.05)
        if r:
            try:
                d = os.read(fd, 65536)
            except OSError:
                break
            if not d:
                break
            out += d
    return out


def wait_ready(fd, budget=12.0):
    out, end = b"", time.time() + budget
    while time.time() < end:
        out += drain(fd, 0.1)
        if out.count(b"\x1b[6n") > out.count(b"\x1b[1;1R"):
            os.write(fd, b"\x1b[1;1R")
        if b"\x1b[?2004h" in out and out.count(b"\x1b[6n") <= out.count(b"\x1b[1;1R"):
            return out
    return out


def clean(t):
    t = re.sub(r"\x1b\][^\x07]*\x07", "", t)
    t = re.sub(r"\x1b\[[0-9;?]*[a-zA-Z]", "", t)
    return t


def run(payload, cfg=None):
    args = ["nu"] + (["--config", cfg] if cfg else [])
    pid, fd = spawn(args)
    wait_ready(fd)
    os.write(fd, b"echo AA BB CC")
    drain(fd, 0.5)
    os.write(fd, payload)
    drain(fd, 0.4)
    os.write(fd, b"Z\r")
    out = drain(fd, 1.5)
    try:
        os.kill(pid, signal.SIGKILL)
    except OSError:
        pass
    return [l.strip() for l in clean(out.decode(errors="replace")).splitlines() if "\u2502" in l][:3]


if __name__ == "__main__":
    print("temporary config:", FIXED)
    print("'echo AA BB CC' + key + 'Z' + Enter  ->  the args the executed echo received")
    print("  AA BB CZ = deleted one char | AA BB Z = deleted one word\n")
    for label, cfg in (("BEFORE (your current config)", None), ("AFTER  (ctrl+h -> BackspaceWord)", FIXED)):
        print(" %s" % label)
        for name, payload in CASES:
            print("    %s -> %s" % (name, run(payload, cfg)))
        print()
