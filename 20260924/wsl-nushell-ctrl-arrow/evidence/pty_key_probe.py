import os, pty, fcntl, termios, struct, time, select, re, signal

def trial(keys, cfg=True, text=b"echo AAA BBB CCC"):
    args = ["nu"] if cfg else ["nu", "--no-config-file"]
    pid, fd = pty.fork()
    if pid == 0:
        os.environ["TERM"] = "xterm-256color"
        os.execvp("nu", args)
    fcntl.ioctl(fd, termios.TIOCSWINSZ, struct.pack("HHHH", 40, 120, 0, 0))

    def drain(t):
        out = b""
        end = time.time() + t
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

    out = b""
    for _ in range(60):
        out += drain(0.1)
        if out.count(b"\x1b[6n") > out.count(b"\x1b[1;1R"):
            os.write(fd, b"\x1b[1;1R")   # answer CPR like a real terminal
        if b"\x1b[?2004h" in out and out.count(b"\x1b[6n") <= out.count(b"\x1b[1;1R"):
            break
    os.write(fd, text)
    out += drain(0.5)
    for k in keys:
        os.write(fd, k)
        out += drain(0.4)
    os.write(fd, b"Z\r")
    out += drain(1.5)
    try:
        os.kill(pid, signal.SIGKILL)
    except OSError:
        pass
    txt = out.decode(errors="replace")
    txt = re.sub(r"\x1b\][^\x07]*\x07", "", txt)
    txt = re.sub(r"\x1b\[[0-9;?]*[a-zA-Z]", "", txt)
    return txt

cases = [
    ("plain LEFT            ", [b"\x1b[D"]),
    ("CTRL+LEFT (ESC[1;5D)  ", [b"\x1b[1;5D"]),
    ("CTRL+LEFT x2          ", [b"\x1b[1;5D", b"\x1b[1;5D"]),
    ("ALT+LEFT (ESC[1;3D)   ", [b"\x1b[1;3D"]),
    ("CTRL+RIGHT (ESC[1;5C) ", [b"\x1b[1;5C"]),
]
print("=== WSL/Linux nushell 0.115.1: type 'echo AAA BBB CCC', press key, type 'Z', Enter ===")
print("=== (what actually ran is printed by the shell) ===")
for name, keys in cases:
    t = trial(keys)
    lines = [l.strip() for l in t.splitlines() if "│" in l]
    print("%s -> %r" % (name, lines[-1:] if lines else lines))
