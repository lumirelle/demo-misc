# pi-lens 调研：对工作流程的意义，能否替代 mise check/fix 类 CLI 入口

调研日期：2026-09-01
对象：https://pi.dev/packages/pi-lens （npm: pi-lens@4.1.3，repo: github.com/apmantza/pi-lens）

## 结论先行

**pi-lens 有显著价值，但定位是「agent 会话内的实时反馈层」，不能、也不应该替代 `mise check & mise fix` 这类项目级 CLI 入口。** 两者是互补关系：

- `mise check/fix`：人、pre-commit、CI 共用的**确定性全仓合同**（版本锁定、全项目范围、退出码可门禁）。
- pi-lens：**只活在 pi 会话里**的进程内扩展，每次 agent write/edit 时给增量反馈，把 lint/类型错误的发现时机从「事后」提前到「落笔即报」，缩短 agent 迭代循环。

## 包基本信息（来源：pi.dev 包页 + npm registry）

| 项 | 值 |
|---|---|
| 版本 | 4.1.3（2026-08-28 发布，迭代极快） |
| 下载量 | 60.1K/月 · 19.1K/周 |
| 作者 | apmantza（Apostolos Mantzaris），MIT |
| 体积 | 23.3 MB（打包了 tree-sitter WASM 语法等） |
| 类型 | extension + skill |
| 运行时依赖 | @ast-grep/cli、@ast-grep/napi、js-yaml、minimatch、pidusage、vscode-jsonrpc（6 个） |
| peer 依赖 | @earendil-works/pi-coding-agent、pi-tui、typebox |
| bin | `pi-lens`（MCP CLI）、`pi-lens-mcp`（实验性 MCP server）、`pi-lens-analyze`（日志分析） |

注意：pi.dev 官方提示「Pi packages can execute code and influence agent behavior. Review the source before installing」——它在 pi 进程内执行代码并注入上下文，属高信任级依赖。

## 实际运行机制（来源：README、docs/usage.md、docs/agent-guide.md@4.1.3、docs/features.md）

生命周期钩子：`session_start`（水合缓存、**预装工具**、预热 LSP、后台项目扫描）→ `tool_call`（读覆盖记录）→ `tool_result`（format/autofix/LSP/runners）→ `turn_end`（合并 blocker/advisory、刷新项目缓存、注入下一轮发现）。

每次 write/edit 的 on-write pipeline：

1. 格式化队列（默认 deferred 到 `agent_end`；`immediate` 需 opt-in；nearest-config-wins）
2. 安全 autofix（`biome/ruff/eslint/stylelint/rubocop/clippy … --fix`）：**write 即时执行并在工具结果里回传修复后全文（2 MiB 上限）；edit 则延迟到 `agent_end`**，edit 期诊断基于未修复的磁盘状态，可能出现「先报后消」的发现
3. LSP 文件同步 + 诊断等待（45 个语言服务器定义；从 PATH → 项目 node_modules → 自管安装自动发现，缺失时交互式安装提示）
4. 并行 dispatch：LSP、ast-grep、tree-sitter 规则、语言 linter/安全扫描器
5. **impact cascade**：对反向依赖邻居文件补拉 LSP 诊断
6. 去重并路由为 blocker / advisory / code-quality 历史

子系统一览：

- LSP 诊断与导航（默认开，`--no-lsp` 可关）
- Opengrep（Semgrep 的开源 fork）作为 auxiliary LSP：每 edit ~1–2s（vs 冷 CLI ~8s），高置信安全发现升级为 blocker
- 可选扫描器（config/presence 门控）：gitleaks、trivy、govulncheck、knip/jscpd/madge、vulture、zizmor、typos
- test-runner-on-write：相关/受影响测试异步跑，下一轮给结果（**edit 范围，不是全量测试**）
- read-guard：未读先改会被阻止/警告
- git/commit-guard（`--lens-guard`）：**EXPERIMENTAL、严格 opt-in、默认关**；开启后 `git commit/push` 在有未清 blocker 时被硬阻断；状态是 sequence/session-bound，stale 状态保守性 block
- 诊断 triage（`lens_diagnostic_mark`）：false-positive / source suppress / defer / flagged-to-fix，跨表面生效
- MCP server（实验性）：让 Claude Code 等外部 MCP 客户端驱动同一套诊断/读替代工具

### 诚实标签（honesty labels）—— 作者自己承认它不是全仓保证

`lens_diagnostics` 默认 `mode=delta`（仅本轮）；`mode=all`（缓存范围）；`mode=full`（全新全项目扫描，含缓存的 opengrep 项目级扫描）。标签体系：`unconfirmed`（LSP 返回空但无法证明干净）、`cold`（重型扫描器本轮没跑）、`partial/truncated`（文件数上限）、`stale`（缓存过期）、`degraded`、`unsafe root`。agent guide 原文：

> "Absence of findings under a degraded label is **not** a clean verdict. Re-run the complete path (usually `lens_diagnostics mode=full`) before concluding."

### 工具自动安装策略（来源：docs/dependencies.md）

四种门控：config-gated / flow-language-gated / operational prewarm / **GitHub release 二进制直接下到 `~/.pi-lens/bin/`**。自动安装清单包括：biome、prettier、ruff、typescript + typescript-language-server、pyright、mypy、knip、jscpd、madge、stylelint、markdownlint-cli2、shellcheck、shfmt、rust-analyzer、golangci-lint、hadolint、ktlint、tflint、taplo、terraform-ls、actionlint、sqlfluff、yamllint、htmlhint、@ast-grep/cli、opengrep、gitleaks、trivy（显式 opt-in）、govulncheck（go install）等。gopls/ruby-lsp/solargraph 从 PATH 或原生包管理器探测。

## 为什么不能替代 mise check & mise fix

1. **运行域不同，没有 CLI 检查入口。** 它是 pi 会话内的扩展，只由 write/edit 事件触发；三个 bin 是 MCP CLI/MCP server/日志分析器，没有任何「人/CI 直接跑全项目检查」的命令。实验性 MCP server 只是让别的 agent 客户端复用诊断工具，不是 CI 门禁。
2. **覆盖模型是增量+诚实标签，不是全仓合同。** 默认 delta；全项目扫描带文件上限、缓存和 `cold/partial/stale` 标签，作者明确说降级标签下「没有发现 ≠ 干净」。CI 需要的恰恰是无标签的确定性全量结果。
3. **工具链解析会与 mise 漂移。** LSP 等会优先用 PATH（mise shim 在 PATH 上时能对齐），但 auto-install 的二进制直接落到 `~/.pi-lens/bin/`（GitHub release 下载，绕过 mise），版本与 mise 锁定版本不一致 → 规则集、fix 行为可能与 `mise check` 结果不同。mise 入口的价值正是「唯一权威版本 + 唯一权威结果」。
4. **受众不同。** pi-lens 只对用 pi 的人生效；mise check 对所有人和 CI 生效。团队/CI 一致性必须靠 CLI 入口。
5. **稳定性与成本。** 4.x 迭代快且行为有变（如 autofix 即时/延迟策略刚在 4.x 内调整）；23MB；进程内跑大量子进程；turn_end 注入发现占上下文 token。作为质量门太活，作为反馈层正合适。

## 它的真实价值（作为补充值得装的理由）

- **错误发现前移**：agent 落笔即报 lint/类型/安全问题，替代「写完 → mise check 爆一堆 → 再修」的昂贵循环，也省掉 agent 手动 bash 跑 lint 的来回 token。
- **impact cascade**：改一处立刻看到反向依赖邻居文件是否被改坏——这是全量 check 做不到的「局部快速反馈」。
- read-guard（未读先改拦截）、write 即时 autofix 回传全文、edit-scoped 测试异步跑，都在降低坏编辑率。
- commit-guard 可以当「agent 侧最后防线」体验优化（但别当唯一质量门：experimental、session-bound）。
- 实验性 MCP server：团队里 Claude Code 用户可复用同一套诊断。

## 建议的配置姿势（针对 mise 工作流）

1. **保留** `mise check & mise fix` 作为唯一权威入口（人、pre-commit、CI 三方共用）。
2. 若装 pi-lens：定位为 agent 会话内的增量反馈层；`.pi-lens.json` 做项目级最小配置；优先让工具命中 PATH（mise shim）以减少版本漂移；对不希望被自动安装的重型扫描器显式关闭。
3. 不把 commit-guard 当质量门；在 AGENTS.md 里保留「done 前跑 mise check」的指令作为最终把关（这条不装 pi-lens 也该有）。
4. 供应链：装前 review 源码、锁版本（`pi install npm:pi-lens@4.1.3`），升级读 changelog。

## 参考来源（均访问于 2026-09-01）

- https://pi.dev/packages/pi-lens （包页：版本/下载量/体积/依赖统计）
- https://github.com/apmantza/pi-lens README（功能列表、架构、安装）
- https://cdn.jsdelivr.net/npm/pi-lens@4.1.3/docs/agent-guide.md（诚实标签、autofix 时序、commit-guard）
- https://cdn.jsdelivr.net/npm/pi-lens@4.1.3/docs/usage.md（生命周期、on-write pipeline）
- https://cdn.jsdelivr.net/npm/pi-lens@4.1.3/docs/features.md（45 LSP 定义、trivy/helm 细节、事件总线）
- https://cdn.jsdelivr.net/npm/pi-lens@4.1.3/docs/dependencies.md（自动安装策略与工具表）
- https://cdn.jsdelivr.net/npm/pi-lens@4.1.3/docs/settings.md（--lens-guard experimental/opt-in）
- https://cdn.jsdelivr.net/npm/pi-lens@4.1.3/package.json（deps/peerDeps/bin）