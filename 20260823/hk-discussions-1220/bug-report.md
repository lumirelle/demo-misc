# Windows: structured argv builtins cannot resolve `node_modules/.bin` shims (oxlint, eslint, ...)

## Summary

Since #1194 ("fix(builtins): preserve file argument boundaries"), builtins migrated to structured argv — e.g. `pkl/builtins/ox_lint.pkl`:

```pkl
check = new Config.CommandSpec {
  command = new Config.Command { argv = List("oxlint", "--deny-warnings", "{{files}}") }
  effect = "read"
}
```

On Windows, these steps fail with "oxlint" (or "eslint", etc.) not found **only when the tool is installed via `node_modules`**. The same steps work on Linux, and work on Windows when the tool is installed globally (e.g. via mise/cargo/scoop, which ship a real `.exe`).

## Environment

- OS: Windows
- hk: since commit a810c3b (#1194, merged)
- Affected builtins: any migrated to argv that resolve to a `node_modules/.bin` shim (oxlint, eslint, ...)
- Not affected: Linux; Windows with a globally-installed `.exe`

## Reproduction

1. On Windows, in a repo with `oxlint` (or `eslint`) installed as an npm dev dependency (so `node_modules/.bin/oxlint.cmd` exists).
2. Run `hk run check` (or trigger the `ox_lint` / `eslint` step).
3. The step fails reporting the executable cannot be found.

## Root cause

#1194 switched ~100 builtins from shell-string commands to structured `Config.Command { argv = [...] }`. The two command forms take different execution paths in `src/step/runner.rs`:

- **Shell form** (before #1194) renders to a single string and, on Windows with the default `Cmd` shell, runs via `cmd.exe /c <rendered>` (`runner.rs:296`). `cmd.exe` resolves the executable using `PATHEXT` (`.COM;.EXE;.BAT;.CMD;...`), so the bare name `oxlint` matches `node_modules/.bin/oxlint.cmd`.

- **Argv form** (after #1194) runs via `CmdLineRunner::new_direct(&argv[0])` (`runner.rs:276`), which calls Rust's `std::process::Command::new("oxlint")` directly, bypassing `cmd.exe` entirely (see `ensembler/src/cmd.rs`, `new_direct`).

Per the Rust std docs for [`Command` on Windows](https://doc.rust-lang.org/std/process/struct.Command.html#searching):

> For executable files, the `.exe` extension may be omitted. Files with other extensions must include the extension, otherwise they will not be found.

`CreateProcessW` (the Win32 API Rust uses) only appends `.exe`; it does **not** consult `PATHEXT`. npm shims under `node_modules/.bin/` are `oxlint` (extensionless shell script) and `oxlint.cmd` — neither is a `.exe`, so `Command::new("oxlint")` cannot find them.

On Linux, `new_direct` falls back to `execvp`, which searches `PATH` and happily executes the extensionless shim (it has the executable bit), so the same argv form works.

## Why only `node_modules` installs are affected

Global installs (mise, cargo, scoop, ...) provide a real `oxlint.exe`, which `CreateProcessW` resolves via the implicit `.exe` append. `node_modules/.bin/` only provides `.cmd`/extensionless shims, which `CreateProcessW` cannot resolve without `PATHEXT`.

## Relevant code

- `pkl/builtins/ox_lint.pkl` — argv form introduced by #1194
- `src/step/runner.rs:276` — `RenderedCommand::Argv(argv) => CmdLineRunner::new_direct(&argv[0]).args(&argv[1..])`
- `src/step/runner.rs:296` — shell form on Windows: `CmdLineRunner::new_direct("cmd.exe").arg("/c").raw_arg(run)`
- `ensembler/src/cmd.rs` — `new()` wraps `cmd.exe /c` on Windows; `new_direct()` does not
