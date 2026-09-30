#!/usr/bin/env python3
"""What does each 'delete word' chord actually delete?

Drives an interactive shell in a pty: type TEXT, press the chord, press Enter,
and show the arguments the executed `echo` received.  This exposes the
difference between "kill back to whitespace" and "kill back to word boundary".

Usage (inside WSL):  python3 word_chord_probe.py
"""
import os, pty, fcntl, termios, struct, time, select, re, signal

TEXT = b"echo foo/bar/baz"      # no space inside one token: rubout vs word-boundary differ here

# (label, argv, bytes for the chord)
CASES = [
    ("bash  Ctrl+W              (unix-word-rubout)", ["bash", "--norc", "--noprofile", "-i"], b"\x17"),
    ("bash  Alt+Backspace       (backward-kill-word)", ["bash", "--norc", "--noprofile", "-i"], b"\x1b\x7f"),
    ("bash  Ctrl+Backspace      (^H -> backward-kill-word per /etc/inputrc? no: ^H alone)", ["bash", "--norc", "--noprofile", "-i"], b"\x08"),
    ("bash  Alt+D               (kill-word forward)", ["bash", "--norc", "--noprofile", "-i"], b"\x1bd"),
    ("bash  Ctrl+Left           (backward-word)", ["bash", "--norc", "--noprofile", "-i"], b"\x1b[1;5D"),
    ("nu    Ctrl+W              (CutWordLeft)", ["nu"], b"\x17"),
    ("nu    Alt+Backspace       (BackspaceWord)", ["nu"], b"\x1b\x7f"),
    ("nu    Alt+D               (CutWordRight)", ["nu"], b"\x1bd"),
    ("nu    Ctrl+Delete         (DeleteWord)", ["nu"], b"\x1b[3;5~"),
]


def spawn(argv, cols=120, rows=40):
    pid, fd = pty.fork()
    if pid == 0:
        os.environ["TERM"] = "xterm-256color"
        os.environ["PS1"] = "$ "
        os.execvp(argv[0], argv)
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


def kill(pid):
    try:
        os.kill(pid, signal.SIGKILL)
    except OSError:
        pass


def clean(t):
    t = re.sub(r"\x1b\][^\x07]*\x07", "", t)
    t = re.sub(r"\x1b\[[0-9;?]*[a-zA-Z]", "", t)
    t = re.sub(r"\x1b.", "", t)
    return t


def wait_ready(fd, budget=12.0):
    """bash: wait for the prompt.  nu: also answer its cursor-position request, or it hangs."""
    out, end = b"", time.time() + budget
    while time.time() < end:
        out += drain(fd, 0.1)
        if out.count(b"\x1b[6n") > out.count(b"\x1b[1;1R"):
            os.write(fd, b"\x1b[1;1R")
        if b"$ " in out or (b"\x1b[?2004h" in out and out.count(b"\x1b[6n") <= out.count(b"\x1b[1;1R")):
            return out
    return out


def run(argv, chord, text=TEXT):
    pid, fd = spawn(argv)
    wait_ready(fd)
    os.write(fd, text)
    drain(fd, 0.4)
    os.write(fd, chord)
    drain(fd, 0.4)
    os.write(fd, b"\r")
    out = drain(fd, 1.2)
    kill(pid)
    txt = clean(out.decode(errors="replace"))
    lines = [l.strip() for l in txt.splitlines() if l.strip()]
    noise = ("click_events", "file://", "\u276f", "@dev:", "\x1b")
    lines = [l for l in lines if not any(k in l for k in noise)]
    return lines[-4:] if lines else []


if __name__ == "__main__":
    print("typed: %s   then: <chord> <Enter>" % TEXT.decode())
    for label, argv, chord in CASES:
        print("\n%-52s %s" % (label, chord.hex(" ")))
        for l in run(argv, chord):
            print("      | %s" % l)
