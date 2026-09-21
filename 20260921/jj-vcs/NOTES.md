# Notes

## User & mission
- Mission: replace Git day-to-day. Started 2026-09-21.
- Git level: comfortable daily user (branches, commits, merge/PRs, occasional rebase; avoids reflog/deep surgery). Map jj→Git, don't re-explain VCS.
- Hands-on CLI preferred. jj 0.45.1 and git 2.55.0 installed.

## Environment quirks (verified on this machine)
- `jj init` does **not** exist in 0.45.1 — the command is `jj git init` (colocated by default, creates `.git`).
- jj 0.45.1 uses its **own** `[user] name` / `email` config and warns "Name and email not configured" even though git's `user.name`/`user.email` are set. Teach: `jj config set --user user.name "..."` and `user.email "..."`.
- Current jj terminology: **change**, **revision**, **working copy**, **bookmark** (not "branch"). The README glosses it as "bookmarks (branches)".
- Two IDs per commit: **change ID** (stable, like `zuryntwn`) and **commit ID** (content hash, changes on rewrite, like `4fa33b2b`). `jj describe` rewrites the commit ID but keeps the change ID — visible in real output.

## Teaching decisions
- Lesson 0001 scoped to the core model ("the working copy is a commit") + first commits. Rewriting/rebasing saved for later lessons.
- Glossary (GLOSSARY.md) deliberately not created yet — add terms only after the user demonstrates understanding.
