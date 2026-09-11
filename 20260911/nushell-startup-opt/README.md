# Nushell startup profiling & optimization (nu 0.114.1, Windows)

## How to measure

```nu
nu --log-level perf                       # interactive: full startup incl. prompts/hooks
nu -l --log-level perf -c 'exit'          # config + env only (no autoload, no prompt)
nu -l -e 'exit' --log-level perf          # config + env + vendor autoload (best harness)
```

`nu -c` (non-login) does **not** load `env.nu` / `config.nu`, so use `-l` (or a real
interactive shell) when benchmarking config cost.

Wall-clock check:

```bash
for i in 1 2 3 4 5; do
  s=$(date +%s%N); nu -l -e 'exit' >/dev/null 2>&1; e=$(date +%s%N)
  echo "$(( (e-s)/1000000 )) ms"
done
```

## Findings on this machine

Original startup (`nu --log-level perf`, interactive): **~249ms**

| Phase | Time | Cause |
|---|---:|---|
| `eval_source env.nu` | 34-37ms | `^mise activate nu` (external spawn) every start |
| `eval_source config.nu` | 165-185ms | 3x `mise exec -- <tool> init` (~50-68ms each) + writes |
| `autoload/fnox.nu` | 15ms | runs `fnox hook-env` at load |
| `autoload/starship.nu` | 13ms | runs `starship prompt --continuation` at load |
| `autoload/zoxide.nu` | 2-3ms | cheap |
| `env-change hook` | 51ms | `mise hook-env` on PWD change (54ms measured) + `zoxide add` (18ms) |
| `pre-prompt hook` | 32ms | `mise hook-env` + `fnox hook-env` every prompt |
| `update_prompt` | 107ms | `starship prompt` left (48ms) + right (15ms) every prompt |

Per-prompt measured costs: `mise hook-env` 54ms, `fnox hook-env` 17ms,
`zoxide add` 18ms, `starship prompt` 48ms, `starship prompt --right` 15ms.

## Startup fixes (biggest wins)

1. **Drop the `mise exec --` wrapper.** The tools are already on PATH via mise shims
   after `use mise.nu`, and `mise exec -- starship init nu` produces byte-identical
   output to `starship init nu`.

   | command | via `mise exec --` | direct |
   |---|---:|---:|
   | `starship init nu` | 68ms | 16ms |
   | `zoxide init nushell` | 60ms | 9ms |
   | `fnox activate nu` | 66ms | 12ms |
   | `mise activate nu` | 29ms | 29ms |

2. **Generate init scripts once, don't rewrite them every start.** Guard each
   `save -f` with an existence check (see `config-opt.nu`).

3. **Cache `mise activate nu` output** in `env.nu` and regenerate only if missing
   (see `env-opt.nu`).

### Result

| | original | optimized |
|---|---:|---:|
| `env.nu` eval | 34ms | 0.8ms |
| `config.nu` eval (incl. 9 alias files) | 165ms | 6.8ms |
| `setup_config` | 230ms | 40-43ms |
| wall time `nu -l -e exit` | 271-288ms | **77-87ms** |
| wall time, no config (`-l -n`) | — | 38ms (floor) |

## Per-prompt fixes (interactive feel)

These don't affect startup but dominate latency on every Enter:

`mise.nu` registers `mise_hook` in **both** `hooks.pre_prompt` and
`hooks.env_change.PWD`; `fnox.nu` appends `_fnox_hook` to `hooks.pre_prompt`.

- Move env-refresh hooks off `pre_prompt` and keep them only on
  `hooks.env_change.PWD` — saves ~54ms (mise) + ~17ms (fnox) per prompt:
  ```nu
  # after all `use`/autoload in config.nu
  $env.config = ($env.config | upsert hooks.pre_prompt [])
  ```
  (Only do this if the shell env only needs refreshing when the directory changes.)
- Drop `PROMPT_COMMAND_RIGHT` from the generated `starship.nu` — saves ~15ms/prompt.
- `zoxide add` on `env_change.PWD` (18ms/cd) can be backgrounded with `job spawn`.

Combined: prompt latency ~135ms -> ~48ms.

## Applying

Copy/symlink `env-opt.nu` and `config-opt.nu` over the live files (the live ones are
symlinks into `~/.config/shared/nushell/`), then run `regen-nu-init` once if the
autoload cache needs rebuilding.

`config-opt.nu` keeps the original relative `source aliases/*.nu` lines, so it must
sit next to the `aliases/` directory (i.e. in `~/.config/shared/nushell/`).
