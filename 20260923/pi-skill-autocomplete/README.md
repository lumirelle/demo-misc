# pi 的 skill 补全问题：社区讨论整理

整理日期：2026-09-23
本地版本：`pi --version` = **0.87.1**（`/opt/pi-coding-agent`）

## 症状

输入区为空时 `/` 能补全 skill，一旦继续输入（`/skill` 或「行首已有文字 / 中途输入」）补全就丢失。

对应**两条彼此独立的线索**，其中第一条是版本级 bug，第二条是长期设计限制。

---

## 1. 版本级 bug：#9944（正好命中 0.87.1）

- [#9944 [tui] Skill autocomplete is empty while typing "/skill"](https://github.com/earendil-works/pi/issues/9944)
  - 2026-09-23 开，**当天修复**，label `bug`
  - 症状：`/` 正常列出，继续输入 `/skill` 后面板**变空**（不是变短）
  - 复现：装一个不含字母 `s` `k` `i` `l` 的技能，输入 `/skill`
  - 根因：PR [#9120](https://github.com/earendil-works/pi/pull/9120)（fix(tui): rank skill autocomplete by bare name，09-19 合入，随 v0.86.0 发布）改为按**裸名**匹配，于是 prefix `"skill"` 被拿去模糊匹配技能名本身 → 名字不含 s/k/i/l 的全部被过滤掉。issue 评论里 tmueller 定位到 `pi-tui/dist/autocomplete.js:228`
  - 起因链：issue [#8813](https://github.com/earendil-works/pi/issues/8813)（skill slash autocomplete 用 `skill:` 前缀参与打分，导致 `/idea` 匹配不到 `skill:research-idea`）→ PR [#8786](https://github.com/earendil-works/pi/pull/8786) → PR #9120 → 引入 #9944 回归
  - 修复：commit `36af9dc4` "fix(tui): restore skill prefix autocomplete, closes #9944"（2026-09-23 12:32 UTC，作者 mitsuhiko）
    - `packages/tui/src/autocomplete.ts`：裸名匹配为主序 + 完整 `skill:` 命令作为 fallback
    - 新增回归测试 `packages/tui/test/autocomplete-skill-slash.test.ts`（`lists skills while typing the skill prefix` 等）
- **未发版**：最新 release 仍是 v0.87.1（2026-09-22 19:43）。所以本机 0.87.1 必然带此回归
- 临时绕过：不要打 `/skill`，直接打 `/` + 技能名（#9120 的本意用法），或打完整的 `/skill:name`

## 2. 结构性限制：行首才补全，中途丢失

TUI 里 slash 补全**只在第一行行首**触发，而 skill 复用了 slash command 通道 → 「只有输入区（行首）为空/开头时才有 complete」。

按时间顺序的重复报告（**全部被 bot auto-close 或打 `no-action`**）：

| # | 标题 | 日期 | 状态 |
|---|---|---|---|
| [Discussion #2939](https://github.com/earendil-works/pi/discussions/2939) | 最初的反馈帖（@file 提及 + multi-skill autocomplete） | — | — |
| [#2945](https://github.com/earendil-works/pi/issues/2945) | `/skill:` autocomplete only works for the first skill in the prompt | 2026-04-08（v0.65.2） | closed（auto） |
| [#3700](https://github.com/badlogic/pi-mono/issues/3700) | Inline autocomplete skills | 2026-04-25 | closed-because-weekend |
| [#4986](https://github.com/earendil-works/pi/issues/4986) | Consecutive leading `/skill:name` expansion and injection | 2026-05-25 | closed（作者 ping 维护者无回应） |
| [#4998](https://github.com/earendil-works/pi/pull/4998) / #5000 / #5001 | feat: inline skill mentions in editor | 2026-05-26 | closed |
| [#8144](https://github.com/earendil-works/pi/issues/8144) | Prompt input should autocomplete skills in the middle of the prompt | 2026-08-14 | closed `no-action` |
| [#9452](https://github.com/earendil-works/pi/issues/9452) | [TUI] Autocomplete skill mentions anywhere in the user prompt | 2026-09-10 | closed `no-action` |
| [#9823](https://github.com/earendil-works/pi/issues/9823) | Invoke skills mid-session via @mention anywhere in the input | 2026-09-21 | closed `no-action` |

要点摘录：

- **#2945**：期望「按光标位置补全，而不是只看第一个 token」；行首 `/skill:` 可以，行首之后的第二个 `/skill:` 就不行
- **#3700**：给了补丁位置 `packages/tui/src/autocomplete.ts:357`（映射到 `/skill` 的正则）+ `packages/tui/src/components/editor.ts:2051`；并讨论两种方案——任意 `/` 都触发（作者认为会误导 `foo /new`），还是 `/skill` 打全才触发。评论里 tfreiberg-fastly 说想用扩展解决但必须改核心代码
- **#8144**：带 fork 对比（`alleneubank/pi`）和实施方案——复用 `CombinedAutocompleteProvider` 的 trigger 字符机制，mid-prompt 分支只 fuzzy-match `skill:` 命令，无匹配时 fallback 到路径补全
- **#9452**：设计最完整
  - 行首 `/` 只补内置命令/模板；非行首 `/` 只补 skill
  - 接受 mid-prompt 补全只插入文本，行首接受才提交
  - 一个 prompt 里多个 skill 需去重、统一在开头展开，正文里的 skill 名保持原样
  - 对比 Codex / Claude Code 已支持
- **#4986**：连续 `/skill:a /skill:b` 只注入第一个，第二个留在正文里，浪费 token。作者 05-26/05-27 两次 ping badlogic、mitsuhiko，无实质回应

**上游当前没有 open 的追踪 issue**：搜索 `repo:earendil-works/pi skill autocomplete state:open` 结果为 0。所有相关 issue 都被「新人自动关闭 + 维护者审核」机制收掉了。

社区讨论的实际场所是 **Discord**（issue 模板提供：`https://discord.com/invite/3cU7Bz4UPx`），GitHub 侧更像归档。

## 3. 社区/第三方解法

- [pi-inline-skill-autocomplete](https://pi.dev/packages/pi-inline-skill-autocomplete)（2026-05-20）
  — "skills complete anywhere in the editor instead of only at command start"（Claude 风格 inline 补全）
- [@tifan/pi-inline-skills](https://pi.dev/packages/@tifan/pi-inline-skills)（2026-06-20）
  — `/` 选技能后继续写；提交时 prompt 保持原样
- fork **`can1357/oh-my-pi`** 把 mid-prompt 补全做进了核心（`packages/tui/src/components/editor.ts` 中 `#isInMidPromptSkillSlashContext()`，见 `#insertCharacter` 附近），但仍有相关 bug：
  - [#4809](https://github.com/can1357/oh-my-pi/issues/4809) — **最接近「complete 丢失」**：100ms debounce 竞态，快速输入后立刻按 Tab，`#autocompletePrefixMatchesCursorText` 的 staleness 检查会取消弹窗且什么都不插入（`packages/tui/src/components/editor.ts`、`autocomplete.ts:425`）
  - [#3121](https://github.com/can1357/oh-my-pi/issues/3121) — 提交路径仍 `text.startsWith("/skill:")`（column 0）+ 只处理一个 skill（`packages/coding-agent/src/modes/controllers/input-controller.ts:919/959`）；附 Codex vs Claude Code 对比表：Codex 支持 `$skill1 $skill2 task`，Claude Code 只解析第一个 token（[anthropics/claude-code#17349](https://github.com/anthropics/claude-code/issues/17349)）
  - [#8895](https://github.com/can1357/oh-my-pi/issues/8895) — `/skill` 提交后 composer 立即清空，但消息要等 preflight（memory hook / extension hook / compact）结束才出现在 transcript

## 4. 结论与待办

1. **先升级**：升级到包含 `36af9dc4` 的构建（当前 release v0.87.1 不含该修复），验证方式 = 打 `/skill` 是否列出全部技能
2. 若升级后仍「行首可用、有文字/中途不可用」→ 那是第 2 节的结构性限制，此时装上面任一社区包最省事
3. 想推动上游：Discord 比 GitHub issue 有效（新人 issue 会被 auto-close；有用回复需要维护者 `lgtm`/`lgtmi` 才能保持 open）

## 参考链接

- https://github.com/earendil-works/pi/issues/9944
- https://github.com/earendil-works/pi/issues/9452
- https://github.com/earendil-works/pi/issues/8144
- https://github.com/earendil-works/pi/issues/9823
- https://github.com/earendil-works/pi/issues/2945
- https://github.com/earendil-works/pi/issues/4986
- https://github.com/badlogic/pi-mono/issues/3700
- https://github.com/earendil-works/pi/discussions/2939
- https://github.com/earendil-works/pi/pull/9120
- https://github.com/can1357/oh-my-pi/issues/4809
- https://github.com/can1357/oh-my-pi/issues/3121
- https://github.com/can1357/oh-my-pi/issues/8895
- https://pi.dev/packages/pi-inline-skill-autocomplete
- https://pi.dev/packages/@tifan/pi-inline-skills
