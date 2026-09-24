#!/bin/bash
# Run this INSIDE a Windows Terminal WSL tab (so that /dev/tty is the real terminal).
# It puts the tty in raw mode and dumps whatever bytes arrive, in hex.
# Then press keys (e.g. Left, Ctrl+Left, Ctrl+Right) and wait for the timeout.
rm -f /tmp/wslkey.hex
stty -F /dev/tty raw -echo
timeout -k 2 30 dd bs=1 count=64 if=/dev/tty 2>/dev/null | xxd -p -c 64 > /tmp/wslkey.hex
stty -F /dev/tty sane
cat /tmp/wslkey.hex
