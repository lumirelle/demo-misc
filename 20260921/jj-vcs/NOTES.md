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

## Lesson 3 findings (verified on jj 0.45.1)
- `jj rebase` flags: `-r/--revision` (no descendants), `-s/--source` (+descendants), `-b/--branch`; destination is `-o/--onto`, `-A/--insert-after`, `-B/--insert-before`. **There is no `-d/--destination` flag** — easy mistake to make.
- Reorder idiom: `jj rebase -r <rev> -A/-B <dest>` (prints "Rebased 1 commits to destination. / Rebased N descendant commits.").
- `jj abandon <rev>` drops a commit and rebases descendants onto its parent (prints "Abandoned 1 commits … Rebased N descendant commits …").
- Revset gotcha: descriptions with spaces must be quoted or use a function — bare `add a.txt` is a syntax error; use `description("add a.txt")` or relative `@-`/`@--`/`@---`.

## Lesson 4 findings (verified on jj 0.45.1)
- `jj squash --from <src> --into <dst>` moves changes between commits. With a `<path>`, only that file's changes move (source keeps the rest, no prompt). Without a path, everything moves; emptied source is **abandoned** and jj prompts to combine the two descriptions.
- Off-by-one trap: stack `@ → B → A → root` means `@-`=B, `@--`=A, `@---`=root (immutable). Easy to aim at root by accident.
- `jj split <path>`: the selected path STAYS in the current commit, the remaining changes go to a **new child commit** (working copy becomes the "remaining" commit). Always opens the editor to describe; `-i` = interactive (git add -p equivalent); no `-m` flag exists for split.
- Editor for split/squash prompts: `$JJ_EDITOR` > `ui.editor` > `$VISUAL` > `$EDITOR`. Sandbox has no `nano`; used `JJ_EDITOR=true` to script tests.
