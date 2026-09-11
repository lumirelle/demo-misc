# Optimized config.nu
#
# Original cost ~165-185ms per shell start, almost entirely from:
#   1. `mise exec -- <tool> init`  (3x) — mise.exe spawn + tool spawn, ~50-68ms each
#   2. regenerating those init files on *every* start (writes to disk every time)
#
# Fixes:
#   - call the tools directly (they are already on PATH after `use mise.nu`); the
#     generated output is byte-identical to the `mise exec --` version
#   - generate once and cache; regenerate only when missing (or via `regen-nu-init`)
#
# Measured: config.nu eval 165ms -> ~7ms, startup (login -e) ~281ms -> ~81ms.

use ($nu.default-config-dir | path join mise.nu)

let autoload = $nu.data-dir | path join "vendor/autoload"
if not ($autoload | path exists) { mkdir $autoload }

# Generate a tool's init script only if the cached copy is missing.
def --env gen-once [name: string, cmd: closure] {
    let f = $autoload | path join $name
    if not ($f | path exists) {
        do $cmd | save -f $f
    }
}

gen-once starship.nu { starship init nu }
gen-once zoxide.nu   { zoxide init nushell }
gen-once fnox.nu     { fnox activate nu }

# Run this after upgrading starship/zoxide/fnox/mise so cached paths are refreshed.
def --env regen-nu-init [] {
    mkdir $autoload
    starship init nu   | save -f ($autoload | path join "starship.nu")
    zoxide init nushell | save -f ($autoload | path join "zoxide.nu")
    fnox activate nu   | save -f ($autoload | path join "fnox.nu")
    ^mise activate nu  | save -f ($nu.default-config-dir | path join "mise.nu")
    print "nushell init files regenerated"
}

# --- podman ---
$env.PODMAN_COMPOSE_WARNING_LOGS = false

# --- aliases ---
# Kept identical to the original: `source` needs a parse-time constant path, and
# relative paths resolve against this file's directory, so this only works when
# the file lives next to `aliases/` (i.e. in ~/.config/shared/nushell/).
source aliases/sudo.nu
source aliases/built-in.nu
source aliases/cwd-file-exts.nu
source aliases/winget.nu
source aliases/git.nu
source aliases/lazygit.nu
source aliases/chezmoi.nu
source aliases/docker.nu
source aliases/degit.nu
