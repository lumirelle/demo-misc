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

## Lesson 2 findings (verified on jj 0.45.1)
- There is **no `jj amend`** — jj hints "you probably want `jj squash`".
- `jj squash` (no args) folds @ into its parent = `git commit --amend`. `jj squash <path>` / `jj squash -i` for partial.
- `jj describe -r <rev>` rewrites any commit's message and **auto-rebases descendants** (prints "Rebased N descendant commits.").
- `jj undo` / `jj redo` / `jj op log` (operation log replaces reflog). `jj restore <path>`.
- `jj edit <rev>` exists but docs now recommend `jj new` + `jj squash` for resuming work on an existing change.
- Identity: user has since configured jj identity via `jj config set --user` (commits now authored `lumirelle@outlook.com`), so Lesson 1's setup was followed. Author is baked at commit creation; `jj describe` preserves it, `jj new` picks up current config.
