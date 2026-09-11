# Firefox 扩展：自动给 URL 加 `?t=` 时间戳来破缓存？

**问题**：有没有 Firefox 扩展能在每次刷新/进入页面时自动给 URL 加上 `?t=xxx`，以此绕过 服务器 / CDN / 浏览器 多层缓存？

**结论**：没有主流扩展自动做这件事。AMO 上现成的都是**手动点按钮**版本；想要"每次导航自动加"，最可靠的办法是写一个 ~40 行的 WebExtension（本目录已给出可直接加载的 `manifest.json` + `background.js`），或者用 **WebRequest Rules** 扩展粘贴一段 JS 规则。
调查时间：2026-09-11（数据取自 AMO 官方 API + 各扩展安装包源码）。

---

## 1. AMO 现状（均已核对，`u`=日均用户数）

| 扩展 | slug | u | 最后更新 | 机制 | 自动？ |
|---|---|---|---|---|---|
| **Request Interceptor** | `request-interceptor` | 562 | 2023-10-20 | 规则可增/改/删 query 参数、改 header、重定向 | ❌ 参数值是**静态**的 |
| **Request Control** | `requestcontrol` | 711 | 2020-07-07 | 重定向规则模板只支持 URL 组件（host/path/query）替换 | ❌ 无动态时间戳（读源码确认） |
| **Redirector** | `redirector` | 18,262 | 2020-03-26 | 正则重定向 + `$1` 反向引用 | ❌ 目标串静态 |
| **WebRequest Rules** | `webrequest-rules` | 388 | 2025-12-28 | 自己写 JS，`onBeforeRequest` 返回 `{redirectUrl}` | ✅ **可以算 `Date.now()`** |
| Cachebuster for Varnish | `cachebuster-for-varnish` | 2 | 2025-03-05 | 工具栏点击 → `searchParams.set('cachebuster', random)` | ❌ 手动点击 |
| HubSpot Cache Buster | `hubspot-cache-buster` | 39 | 2025-07-28 | 工具栏点击 → 加 `hsCacheBuster=<random>` | ❌ 手动点击 |
| Site Cache Buster | `site-cache-buster` | 2 | 2026-07-15 | 点图标清站点缓存 + 硬刷新（自带文案："No more `?nocache=1234` hacks"） | ❌ 手动 |
| **Cache Killer** | `cache-killer` | 40 | 2025-09-09 | 改**请求头**：`Cache-Control: no-cache, no-store, must-revalidate` + `Pragma` | ✅ 自动（按域名白名单开关） |
| No-Cache No-Store for Selected Hosts | `no-cache-no-store-for-css` | 69 | 2020-10-17 | 同上，改请求头（针对 Firefox 79+ 不再重新验证 CSS） | ✅ 自动 |
| Clear Cache | `clearcache` | 74,934 | 2026-08-19 | 清 Firefox 缓存（不是改 URL） | ❌ 手动 |

> Requestly 目前在 AMO **没有公开上架**（`addon/requestly/` 返回 401；不存在的 slug 返回 404）。

已经有三个扩展做"手动加随机参数"这件事，说明这个需求存在但都止步于手动 —— 因为**自动加时间戳最大的坑是无限重定向循环**：加完参数的新请求如果继续匹配规则，就会一直跳下去。本目录的实现用"记住自己生成的 URL"来解决。

## 2. `?t=` 到底能破哪一层缓存

| 缓存层 | `?t=` 有效？ |
|---|---|
| 浏览器 HTTP 缓存 | ✅ 不同 URL = 不同 key（但 Firefox 的内存缓存可能让 webRequest 监听器根本不触发，见下） |
| CDN / 反向代理（Varnish、Cloudflare 默认） | ✅ 通常有效 —— cache key 含 query string。Varnish 默认 VCL 对带参数的 URL 直接 miss，这正是 `Cachebuster for Varnish` 存在的理由 |
| CDN 配了忽略 query（Cloudflare "Cache Level: Ignore Query String"、`ignore_querystring`） | ❌ 无效 |
| 应用层缓存（Redis/Memcached 按 path 做 key） | ⚠️ 取决于应用 —— 很多只按 path 做 key，加参数没用 |
| Service Worker / Cache Storage | ⚠️ 看 SW 写法：Workbox 默认只忽略 `utm_*`/`fbclid`，`t=` 会让它 miss；但用 `ignoreSearch` 或自建 key 的 SW 仍会命中 |
| 带哈希文件名的静态资源 | ❌ 无意义 |

**副作用**（所以建议只对你自己的 staging/开发域名开）：签名 URL、OAuth `redirect_uri`、支付/邀请链接会失效；分享出去的链接变脏；分析统计去重失效；你自己的 CDN 命中率归零。代码里已默认跳过 `oauth/login/callback/auth/payment/checkout` 路径，并且只处理 `main_frame` + `GET`（重定向 POST 会被降级成 GET，这是个容易踩的坑）。

## 3. 不需要扩展的办法（先试这些）

1. `Ctrl+Shift+R`（硬刷新）：绕过浏览器缓存，并发送 `Cache-Control: no-cache` + `Pragma: no-cache`。大多数 CDN 会因此回源 —— 很多情况下你根本不需要扩展。
2. DevTools → Network → **Disable cache**（DevTools 打开期间生效）。
3. 书签小工具（bookmarklet），配合关键字书签（名称 `cb`，地址填下面这行，地址栏输入 `cb` 回车）：
   ```js
   javascript:(()=>{const u=new URL(location.href);u.searchParams.set('t',Date.now());location.replace(u)})()
   ```
4. 给页面发请求头的扩展（`Cache Killer`）：不污染 URL，效果等同硬刷新的"自动版"。

## 4. 本目录给出的最小扩展

```
20260911/firefox-cache-bust-ext/
  manifest.json    MV2，权限 webRequest / webRequestBlocking / <all_urls>
  background.js    onBeforeRequest 里给 main_frame + GET 加 ?t=Date.now()
```

- 加载：`about:debugging#/runtime/this-firefox` → **Load Temporary Add-on** → 选 `manifest.json`。要持久安装就得签名，或用 Developer/Nightly 版把 `xpinstall.signatures.required` 设为 `false` 后走 `web-ext build`。
- 想只对某些站点生效：改 `background.js` 顶部的 `SITES`（`[]` = 所有站点）。
- **无限循环防护**：每次生成的 URL 存进 `produced` 集合，该 URL 再次到达时直接放行；同时用户手动刷新时它已被移除，所以会拿到**新的**时间戳 —— 正好是"每次刷新都取新的"这个语义。
- **已知坑**：MDN 明确写了，若页面从**内存缓存**重载，webRequest 事件可能**根本不触发**，此时监听器不会被调用。应急手段是调用 `browser.webRequest.handlerBehaviorChanged()`（会清空内存缓存，但有 10 分钟调用次数上限，代码里已注释留出）。
- 为什么这类扩展基本只在 Firefox 有：Chrome MV3 的 `declarativeNetRequest` 只能用**静态**规则值，无法生成动态时间戳，所以 Chrome 上的同类扩展只能靠"内容脚本跳转重载"这种 hack。

### WebRequest Rules 替代方案（不想自己装扩展时）

装 `webrequest-rules`，新建规则，两段 JS：

Match Request：
```js
if (details.type !== 'main_frame') return false;
if (details.method && details.method !== 'GET') return false;
let u = new URL(details.url);
self.gen = self.gen || new Map();          // href -> 生成时刻
let t = self.gen.get(u.href);
if (t && Date.now() - t < 5000) return false;  // 是我们自己刚生成的，放行
return true;
```
BeforeRequest → Redirect：
```js
let u = new URL(details.url);
u.searchParams.set('t', Date.now());
self.gen.set(u.href, Date.now());
return { redirectUrl: u.href };
```

## 5. 参考

- AMO API v5（用户数/版本/更新日期/安装包）：`https://addons.mozilla.org/api/v5/addons/addon/<slug>/`
- `Cachebuster for Varnish` 源码（v1.0，即核心 10 行）：`browser.tabs.update(tab.id, {url})`，`searchParams.set('cachebuster', random)`
- MDN `webRequest.handlerBehaviorChanged()`：内存缓存重载时事件可能不触发的官方说明
- `WebRequest Rules` 文档与示例：https://github.com/ichaoX/ext-webRequest（`docs/Guide.md`、`docs/Examples.md`）
