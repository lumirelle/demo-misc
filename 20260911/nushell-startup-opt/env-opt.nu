# Optimized env.nu — regenerate mise activation only when the cache is missing.
# Original spent ~30ms spawning `mise activate nu` on every single shell start.
# Regenerate with: nu -c '^mise activate nu | save -f ($nu.default-config-dir | path join mise.nu)'

$env.config.show_banner = 'short'
$env.config.buffer_editor = 'nvim'

let mise_nu = $nu.default-config-dir | path join mise.nu
if not ($mise_nu | path exists) {
    ^mise activate nu | save -f $mise_nu
}
