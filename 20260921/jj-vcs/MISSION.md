# Mission: Jujutsu (jj) version control

## Why
Replace Git as the day-to-day version control tool on real projects. The goal is to stop reaching for raw Git and instead do everyday version control — committing, inspecting, rewriting history, and sharing with GitHub — entirely in jj.

## Success looks like
- Init or clone a repo with jj and make commits without a staging area
- Read `jj log` / `jj status` fluently, understanding change IDs, the working-copy commit, and bookmarks
- Rewrite history (amend, squash, reorder, rebase) in jj with the ease that motivated switching
- Push to and pull from a Git remote (e.g. GitHub) using jj
- Complete a real chunk of real work in jj and not miss Git

## Constraints
- Already a comfortable daily Git user — map jj concepts onto Git concepts; don't re-explain version control from scratch
- Hands-on: lessons include running jj commands in a terminal (jj 0.45.1 installed, git 2.55.0 installed)
- Short, single-topic lessons, one tangible win each

## Out of scope
- jj internals (operation-log internals, custom backends, the revset engine internals) until the core workflow is mastered
- Gerrit and non-Git backends for now
