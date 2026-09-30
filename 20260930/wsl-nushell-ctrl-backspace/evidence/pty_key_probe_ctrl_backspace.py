#!/usr/bin/env python3
"""Ctrl+Backspace probe for WSL/Linux nushell (no Windows Terminal needed).

Runs `nu` in a plain Linux pty, injects each candidate byte stream, and reports:

  0) which escape sequences nushell emits at startup   (does it request the Kitty protocol?)
  A) what `input listen --types [key]` parses it into  (what nushell "sees")
  B) what actually happens while editing               (delete one char / one word / nothing)

Usage (inside WSL):  python3 pty_key_probe_ctrl_backspace.py
"""
import os, pty, fcntl, termios, struct, time, select, re, signal

CASES = [
    ("DEL         0x7f          ", b"\x7f"),
    ("BS          0x08          ", b"\x08"),          # <- what Windows Terminal/ConPTY send for Ctrl+Backspace
    ("ESC DEL     (alt+backspc) ", b"\x1b\x7f"),
    ("ESC BS      0x1b 0x08     ", b"\x1b\x08"),
    ("CSI 127;5u  (kitty ctrl+bs)", b"\x1b[127;5u"),
    ("CSI 127;5;1u(report all)  ", b"\x1b[127;5;1u"),
    ("CSI 8;5u    (kitty ctrl+h)", b"\x1b[8;5u"),
    ("CSI 27;5;127~ (fixterms)  ", b"\x1b[27;5;127~"),
    ("W32IM CSI 8;14;127;1;8;1_ ", b"\x1b[8;14;127;1;8;1_"),
    ("CTRL+W      0x17          ", b"\x17"),
    ("CTRL+U      0x15          ", b"\x15"),
    ("CTRL+LEFT   ESC[1;5D      ", b"\x1b[1;5D"),
    ("LEFT        ESC[D         ", b"\x1b[D"),
]

TEXT = b"echo AA BB CC"


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
    """Wait until the line editor is up (answer the cursor-position request like a real terminal)."""
    out, end = b"", time.time() + budget
    while time.time() < end:
        out += drain(fd, 0.1)
        if out.count(b"\x1b[6n") > out.count(b"\x1b[1;1R"):
            os.write(fd, b"\x1b[1;1R")
        if b"\x1b[?2004h" in out and out.count(b"\x1b[6n") <= out.count(b"\x1b[1;1R"):
            return out
    return out


def kill(pid):
    try:
        os.kill(pid, signal.SIGKILL)
    except OSError:
        pass


def clean(txt):
    txt = re.sub(r"\x1b\][^\x07]*\x07", "", txt)
    txt = re.sub(r"\x1b\[[0-9;?]*[a-zA-Z]", "", txt)
    return txt


def startup_bytes():
    pid, fd = spawn(["--no-config-file"])
    out = wait_ready(fd)
    kill(pid)
    seen = []
    for s in re.findall(rb"\x1b(?:\[[0-9;?<>=]*[a-zA-Z~]|\][^\x07]*\x07)", out):
        if s not in seen:
            seen.append(s)
    return [s.decode(errors="replace") for s in seen]


def test_listen(payload):
    """A) what KeyEvent does nushell report for these bytes?"""
    pid, fd = spawn(["--no-config-file", "-c", "input listen --types [key] | to nuon"])
    drain(fd, 1.2)
    os.write(fd, payload)
    out = drain(fd, 1.2)
    kill(pid)
    return clean(out.decode(errors="replace")).strip()


def test_edit(payload):
    """B) type TEXT, press key, type Z, Enter -> show the executed command's output."""
    pid, fd = spawn(["nu"])
    wait_ready(fd)
    os.write(fd, TEXT)
    drain(fd, 0.5)
    os.write(fd, payload)
    drain(fd, 0.4)
    os.write(fd, b"Z\r")
    out = drain(fd, 1.5)
    kill(pid)
    lines = [l.strip() for l in clean(out.decode(errors="replace")).splitlines() if "\u2502" in l]
    return lines if lines else []


if __name__ == "__main__":
    print("== 0. escape sequences nushell writes at startup (nu --no-config-file) ==")
    for s in startup_bytes():
        print("   ", repr(s))
    print("    (no '\\x1b[>' push sequence  =>  nushell never asks for the Kitty keyboard protocol)")

    print("\n== A. `input listen --types [key]` ==")
    for name, payload in CASES:
        print("  %s -> %s" % (name, test_listen(payload)))

    print("\n== B. editing: '%s' + key + 'Z' + Enter ==" % TEXT.decode())
    print("      AA BB CZ = one char deleted | AA BB Z = one word deleted | unchanged = key ignored")
    for name, payload in CASES:
        print("  %s -> %s" % (name, test_edit(payload)))
