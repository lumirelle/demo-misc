# 免费密码管理器排行榜（2025–2026）

要求：免费 + OTP 支持 + 多设备同步（桌面 + 移动）。
数据源：NVD CVE API（2026-09-08 拉取，见 data/nvd_raw.json）、各厂商官方定价/文档页。

## 候选与资格

| 产品 | 免费 OTP | 免费多设备同步 | 资格 |
|---|---|---|---|
| KeePassXC 生态 (桌面 KeePassXC + Android KeePassDX / iOS KeePassium) | ✅ 内置 | ✅ 自选云盘/WebDAV/SFTP | ✅ |
| KeePass 2.x (+KeePassOTP 插件) | ✅ 插件 | ✅ DIY | ✅ |
| Bitwarden 免费版 | ⚠️ 库内 TOTP 为 Premium；独立 Authenticator App 免费但仅手机端、靠 OS 备份 | ✅ 官方云同步无限设备 | ⚠️ 部分 |
| Proton Pass 免费版 | ❌ 内置 2FA 验证器为 Pass Plus 付费功能 | ✅ 官方云同步 | ❌ OTP 不达标 |
| pass (+pass-otp) | ✅ pass-otp | ✅ git 同步；Android 官方客户端已归档 | ⚠️ 移动端存疑 |
| Strongbox (Apple) | ✅ 免费版含 TOTP | ✅ iCloud 等 | ⚠️ 仅 iOS/macOS |

## 榜 1：安全榜（2025–2026 CVE）

公式：安全分 = 10 − min(4, 次均响应天数/30) − min(4, 年均CVSS之和/10)；0 CVE 记 10 分。
响应天数 = NVD lastModified − published（代理指标，有局限）。

| 排名 | 产品 | CVE 数 | 次均响应 | 年均 CVSS 和 | 安全分 |
|---|---|---|---|---|---|
| 1 | KeePass 2.x | 0 | — | 0 | 10.0 |
| 1 | pass | 0 | — | 0 | 10.0 |
| 1 | Proton Pass | 0 | — | 0 | 10.0 |
| 4 | Strongbox | 2 | 50d | 10.4 | 7.3 |
| 5 | KeePassXC 生态 | 2 | 124d | 8.5 | 5.2 |
| 6 | Bitwarden | 10 | 78d | 38.0 | 3.6 |

注：
- Bitwarden 仅计官方产品（Server/CLI/Web），Vaultwarden（第三方自建服务器实现）另有 12 条 CVE 未计入。
- CVE-2025-5138（Bitwarden，388d）为 VulDB 提交、厂商未回应、真实性存疑的条目；剔除后 Bitwarden 次均响应 44d。
- KeePass 2.x 的 CVE-2020-37178 为 2020 年旧洞（2.44 已修）的记录 2026 年重新发布，不计入。
- 0 CVE ≠ 绝对安全：可能反映审计/CNA 活跃度差异。Proton 曾有内存安全问题的公开报道但无 CVE 编号。
- 若按字面公式 次均响应天数 ÷ 年均CVSS之和：Bitwarden 2.1 < Strongbox 4.8 < KeePassXC 14.6——该除法会"奖励"严重度总量，故榜单按两个分量分别计分。

## 榜 2：跨平台支持（桌面 + 移动）

| 排名 | 产品 | 桌面 | 移动 | 同步 | 分 |
|---|---|---|---|---|---|
| 1 | Bitwarden | Win/mac/Linux + Web + CLI + 扩展 | iOS/Android | 官方云，免费无限设备 | 10 |
| 1 | Proton Pass | Win/mac/Linux + Web + 扩展 | iOS/Android | 官方云 | 10 |
| 3 | KeePassXC 生态 | KeePassXC (Win/mac/Linux) | KeePassDX / KeePassium | 自选云盘/WebDAV/SFTP | 8.5 |
| 4 | KeePass 2.x | Windows 原生，mac/Linux 靠 Mono | 第三方 App | DIY | 6 |
| 5 | pass | CLI (Linux/mac/Win-WSL) | Android 官方端已归档；iOS 社区端 | git | 5 |
| 6 | Strongbox | 仅 macOS | 仅 iOS | iCloud（WebDAV/SFTP 为 Pro） | 4.5 |

## 榜 3：上手门槛（分高 = 越好上手）

| 排名 | 产品 | 分 | 说明 |
|---|---|---|---|
| 1 | Proton Pass | 9 | 注册即用 |
| 1 | Bitwarden | 9 | 注册即用；免费版 OTP 需另装独立 App |
| 3 | Strongbox | 7 | Apple 生态内顺手 |
| 4 | KeePassXC 生态 | 6 | 需理解数据库文件 + 自配同步 + 各端选 App |
| 5 | KeePass 2.x | 4 | 界面老派，TOTP 靠插件 |
| 6 | pass | 2 | git + GPG，极客玩具 |

## 榜 4：综合榜（安全 0.4 + 跨平台 0.4 + 上手 0.2）

| 排名 | 产品 | 安全 | 跨平台 | 上手 | 综合 |
|---|---|---|---|---|---|
| 1 | Proton Pass | 10.0 | 10 | 9 | 9.8 ⚠️免费版无 TOTP |
| 2 | Bitwarden | 3.6 | 10 | 9 | 7.2 |
| 2 | KeePass 2.x | 10.0 | 6 | 4 | 7.2 |
| 4 | KeePassXC 生态 | 5.2 | 8.5 | 6 | 6.7 |
| 5 | pass | 10.0 | 5 | 2 | 6.4 |
| 6 | Strongbox | 7.3 | 4.5 | 7 | 6.1 |

## 结论

严格满足"免费 + OTP + 桌面/移动同步"的只有 KeePass 家族：
- 全家桶最均衡：KeePassXC + KeePassDX/KeePassium
- Windows 单机党：KeePass 2.x + KeePassOTP
- 愿意付 $10/年：Bitwarden Premium（TOTP 入库 + 生态最全）
- 愿意付 ~$24/年：Proton Pass（综合分最高）
