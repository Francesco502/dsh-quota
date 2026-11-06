# core/routes 审计

**对象**：`@francescoli/dsh-quota` v0.4.0（git c7723f0，工作区干净）
**范围**：`src/core/{manager,history,fetch,paths,alarm,oauth,types}.ts`、`src/routes.ts`、`src/index.ts`
**方式**：只读源码 + 只读线上样本（`/Users/francesco/.dsh/quota-history.json` 2,621,512B / 10,780 点 / 15 个 key；未修改仓库与 `~/.dsh` 文件，未 install/发布）
**现场测量**（插件在 3080 运行）：

| 端点 | 耗时 | 响应体 |
|---|---|---|
| `GET /api/dsh-quota/status`（缓存命中） | 0.5–1.1 ms | 11,103 B |
| `GET /api/dsh-quota/status?force=true` | 0.91–2.18 s | 11,785 B |
| `GET /api/dsh-quota/history?instanceId=codex&days=7` | 2.6 ms | 112,406 B |
| `GET /api/dsh-quota/config` | 1.4 ms | 1,309 B |

---

## 0. 四个对外问题的结论（先给答案）

### Q1 history 2.6MB / 10,767 点 / 每 2 分钟全量重写

- **保留策略 `2000 点/key` 是死代码**：`history.ts:76-79` 的触发条件是 `list.length > 2000 || list[0] < cutoff`，但裁剪只做 `filter(p => p.timestamp >= cutoff)`。近期数据过滤后长度不变（>2000 依然 >2000），所以单 key 上限永不生效，实际只有「30 天」一个约束。
- **30 天可达点数**：实测最热的 `codex` key 4 天 970 点 ≈ 243 点/天/key。30 天 ≈ 7,275 点/key；当前 15 个 key 同量级 → ≈ 10.9 万点。
- **体积**：实测 2,621,512 B / 10,780 点 = **243 B/点**。原因之一是落盘用 `JSON.stringify(data, null, 2)` 两空格缩进（`paths.ts:75`、`paths.ts:82`），而每个点还冗余重复 `instanceId/poolId/windowId`（`history.ts:94-103`）。紧凑 JSON 约可降到 100–120 B/点。
- **30 天估算**：≈ 10.9 万点 × 243 B ≈ **26 MB**（紧凑化后 ≈ 12–13 MB）。30 天文件大小相对今天的 2.6 MB 约 **×10**。
- **写放大**：`recordSnapshots` 末尾只要距上次写盘 >2 分钟就 `save()`（`history.ts:146-148`），**不论本轮是否有新点**；`save()` 全量序列化整个 Map 并整文件重写（`history.ts:46-55` → `paths.ts:72-83`）。按 2.6 MB 体积、720 次/天计：**≈ 1.87 GB/天**；到 26 MB 稳态后 **≈ 18.7 GB/天**。
- **成本落在请求路径上**：`save()` 是同步 `writeFileSync`（`paths.ts:75`），发生在 `getQuotaCards` 调用链内（`manager.ts:663` → `history.ts:147`）。2.6 MB 时约数十 ms，26 MB 时 `JSON.stringify` + 写盘预计 **0.3–1 s 的 event-loop 阻塞**（推断，按 100–200 MB/s stringify 估算），期间所有 HTTP 请求排队。
- **内存驻留**：`load()` 用 `readFileSync` + `JSON.parse` 全量进 `Map`（`history.ts:29-44`），10,780 个普通对象驻留；按每点 ~250–400 B 堆占用估算当前 3–5 MB，26 MB 文件时 **30–50 MB 常驻**（推断）。

### Q2 status 端点 0.8s 的成本来源

- 缓存命中实测 **0.5–1.1 ms**；`?force=true` 实测 **0.91–2.18 s**。0.8 s 不是 status 的固有成本，而是**强制刷新链路**：客户端轮询/手动刷新会带 `force`（`src/client/api.ts:218`），此时 `getQuotaCards(true)` 跳过所有缓存，对全部已配置实例做一次全量并发拉取（`manager.ts:601-653`，并发上限 5，每个 provider 默认 20 s 超时 `fetch.ts:100`）。
- 成本 = 最慢那个 provider 的网络 RTT（并发 5 的批次数 × 每批最慢 RTT），不是 CPU。实测 9 个启用实例时约 0.9 s，冷启动/代理慢时 2.2 s。
- **没有服务端持久缓存、没有 stale-while-revalidate、没有 single-flight**：force 期间再来一个 force 就再扇出一次。
- 命中缓存时仍会跑 `recordSnapshots` + `detectAlarms` + 排序过滤（`manager.ts:663-686`），这部分是 O(卡数×窗口数)，实测 <1 ms，不是瓶颈。

### Q3 并发 / 竞态

- **无 in-flight 去重**：`getQuotaCards` 里没有任何 `inflight` 变量或互斥（`manager.ts:601-696`）。两个并发 `?force=true` = 两轮全量 provider 请求；客户端 60 s 轮询（`src/client/controller.ts:89-98`）+ 手动刷新 + 配置保存后的刷新（`routes.ts:146`）可叠加。
- **手动刷新 vs 定时刷新**：定时刷新由客户端 `setInterval` 驱动（`controller.ts:89`），服务端无定时器；两者都走同一入口，只靠 `cardCache` 的 TTL 兜底（`manager.ts:614-616`），force 时完全绕过。
- **配置保存 vs 刷新**：`saveConfig` 同步执行并 `cardCache.clear()`（`manager.ts:472-474`），随后 `routes.ts:146` 用 `void` fire-and-forget 触发全量刷新；若刷新进行中，旧结果会在 `saveConfig` 之后回写 `cardCache`（`manager.ts:636`），把旧配置的卡片塞回新缓存（窗口 ≤ 单次刷新耗时）。
- **OAuth 刷新 vs 配置保存**：OAuth 回调里 `onSuccess` → `saveConfig({...current, codex:{...}})`（`routes.ts:161-174`），以「回调触发时读到的 current」为基线整体覆盖；若用户在授权期间改了别的配置，回调会把旧值写回（lost update）。Antigravity 分支同样（`routes.ts:189-199`）。
- **无 AbortSignal 下传**：`provider.fetchCard(this.config, accountConfig)`（`manager.ts:615`）不带 signal；路由也不创建 controller（`routes.ts:14-31`）。客户端断开后 provider 请求继续跑到 20 s 超时。
- **`void manager.getQuotaCards(true)` 无 catch**（`routes.ts:146,173,199`）：一旦内部抛出（history 写入 BigInt/循环引用、OOM、alarm 逻辑异常），Node 默认 unhandledRejection 终止宿主进程。

### Q4 routes 鉴权与输入校验

- **零鉴权**：8 个 handler 全部没有任何 token/cookie/Origin/Referer 检查（`routes.ts:9-233`）。实测 `curl` 无任何凭证即 200。
- **CSRF 可行**：`GET /status?force=true` 属简单请求，任意网页用 `fetch(..., {mode:'no-cors'})` 即可触发全量刷新（副作用发生，响应不可读）；`POST /test-connection`、`POST /config` 若用 `Content-Type: text/plain` 也不触发 preflight，而 handler 无条件 `JSON.parse(body)`（`routes.ts:55`、`routes.ts:144`），CSRF 可写配置。
- **`scope`**：本版本没有 `scope` 参数（`routes.ts` 全文只有 `force`/`provider`/`instanceId`/`days`）；同类风险落在 `instanceId` 与 `days`：`days` 直接 `parseInt`，无 clamp、NaN 未处理（`routes.ts:97`），`instanceId` 无白名单（`routes.ts:96`）。
- **`provider`**：`refreshSingleProvider` 只在已配置任务里按 id/providerName 精确匹配（`manager.ts:710-713`），未知值返回 `undefined` 却仍以 `{ok:true}` 200 返回（`routes.ts:19-23`）。不构成 SSRF。
- **`proxy`**：`httpProxy` 只从配置读取（`fetch.ts:104-110`），路由不接收 proxy 参数；但 `POST /config` 可写 `httpProxy`，且它会被移入 `quota-secrets.json`（`manager.ts:238-242`）。`sanitizeProxyUrl` 只在展示/报错时脱敏（`fetch.ts:66-77`），落盘仍是明文（`quota-secrets.json` 0600，可接受）。
- **`custom-api` = 真 SSRF**：`POST /test-connection` 的 `accountConfig` 完全来自请求体（`routes.ts:55-62`），`custom_api` provider 直接把它拼进 URL 发请求，并回显 `account/latency/错误`（`providers/custom-api.ts:12,31,83-92`，`manager.ts:742-786`）。
- **secrets 泄漏面**：`GET /config` 返回 `getSafeConfig()`，掩码只保留前 4 + 后 4（`manager.ts:167-171`），即真实 key 的 8 个字符会外泄；且 `getSafeConfig` 的 `keyProps` 漏了 `sessionKey`（`manager.ts:481` 只有 `apiKey/sessionToken/token`，而 secrets 拆分用的是四元组 `manager.ts:205`），一旦 `claude.sessionKey` 被使用就会**明文**出现在 `/config` 响应里。`accounts[].oauth.accountId` 与 `antigravity.oauth.email` 也未脱敏（实测 `/config` 返回 `llt810174311@gmail.com`）。
- **响应体积**：`/history` 无分页/无降采样，实测 7 天单 key 112 KB；30 天单 key 预计 ~800 KB（推断：112 KB × 7,275/970）。

---

## A. 缺陷与风险

| ID | 严重度 | 位置 | 触发条件 | 影响 | 修复方案 | 工作量 |
|---|---|---|---|---|---|---|
| A1 | P0 | `src/routes.ts:9-233`（全文件无鉴权） | 本机任意网页/进程访问 3080；恶意页面 `no-cors` GET/POST | 全量刷新 DoS、配置被任意改写、OAuth 流程被触发；当前响应还带半掩码密钥与邮箱 | 在 `makeQuotaRoutes` 前置统一守卫：校验 `Origin`/`Host` 白名单 + 要求自定义 `X-DSH-Quota` 头（强制 preflight）+ 复用 DSH webServer 会话 token；无 token 一律 401 | M |
| A2 | P0 | `src/routes.ts:36-70` + `src/providers/custom-api.ts:12,31,83-92` | `POST /test-connection` 传 `{provider:'custom_api', accountConfig:{baseUrl:'http://169.254.169.254', balancePath:'/latest/meta-data/'}}` | 盲 SSRF：内网端口扫描、云元数据读取；错误/延迟回显提供 oracle | 校验 URL：仅 http/https、拒绝回环/私网/link-local/169.254/元数据域名；解析后按 IP 校验（防 DNS rebinding）；`balancePath` 强制以 `/` 开头且不含 `..`；test-connection 不允许新 baseUrl，或要求二次确认 | M |
| A3 | P0 | `src/core/manager.ts:175-213`（`restoreMaskedSecrets`）+ `src/routes.ts:114-153` + `custom-api.ts:29,81` | 攻击者读 `/config` 取 id 与掩码 → POST 同 id、掩码原样、`baseUrl` 改指自己 → 触发刷新 | **真实 apiKey 被发送到攻击者主机**（掩码回填 → Authorization 头带真 key） | 回填仅限「值 === 当前掩码」且 `baseUrl`/`provider` 未变；baseUrl 变更时清空 key 并要求用户重填；`POST /config` 加 JSON Schema 校验与字段白名单 | M |
| A4 | P1 | `src/core/history.ts:76-79` | 单 key 30 天内点数 >2000（当前 codex 972 点/4 天） | 2000 点上限失效，单 key 可涨到 7,275 点，文件/内存/写盘成本失控 | 改为 `list.splice(0, list.length - cap)`；或按时间分桶（5 min/桶，保留 30 天）+ 双层降采样 | S |
| A5 | P1 | `src/core/history.ts:46-55,146-148` + `src/core/paths.ts:72-83` | 任意一次 `getQuotaCards`/`refreshSingleProvider` 后满 2 分钟 | 同步全量重写 2.6 MB（→26 MB）；1.87→18.7 GB/天写放大；event-loop 阻塞 0.3–1 s | `dirty` 标记（无新点不写）；紧凑 `JSON.stringify`（去 `null,2`）；30 s debounce；异步 `fs.promises.writeFile`；长期改 append-only JSONL | M |
| A6 | P1 | `src/core/manager.ts:601-653` | 两个及以上 `?force=true` 并发（多标签页、手动刷新+定时刷新） | N 倍 provider 请求，触发上游 429/额度浪费；history 重复记录 | 加 `inflight: Map<taskId, Promise<AuthCardItem>>` 合并同一实例请求；整轮刷新再加 `inflightAll`；force 复用进行中的 promise | M |
| A7 | P1 | `src/routes.ts:146,173,199` | `getQuotaCards` 内部抛错（history 序列化、OOM、alarm 异常） | unhandled rejection，Node 15+ 默认终止 DSH 宿主进程 | `void manager.getQuotaCards(true).catch(err => this.logger?.warn(...))`；或封装 `safeRefresh()` 统一 catch | S |
| A8 | P1 | `src/core/history.ts:29-44` + `:46-55` | `quota-history.json` 被写坏（磁盘满、`paths.ts:82` 的 fallback 直接写中断） | `catch {}` 吞掉解析错误 → 内存为空 → 下一次 save 用空数据覆盖 2.6 MB 历史，**永久丢失** | 解析失败先 `rename` 为 `.corrupt-<ts>` 保留现场；save 前保留 `.bak`（或保留最近 N 个版本）；load 校验 `version`/数组形状并计数告警 | S |
| A9 | P1 | `src/core/manager.ts:339-343`（persistSplit）+ `:369-408`（loadConfig） | 同时运行两个 DSH profile/进程 | 配置与 history 双写无锁、无 mtime 校验：last-write-wins；两个进程各自全量重写 history，互相删除对方的点 | 写前 `stat` 比对 mtime/size，不一致则 merge 后重写；history 改 JSONL append（多进程安全）；或加 `proper-lockfile` | L |
| A10 | P1 | `src/core/manager.ts:615,732` + `src/routes.ts:14-31` | 客户端断开/超时 | provider 请求继续跑满 20 s（`fetch.ts:100`），并发叠加；轮询在慢 provider 下堆积 | 路由创建 `AbortController` 并绑定 `req.on('close')`；给 `fetchCard` 增加 `signal` 参数并透传到 `fetchWithProxy`（`fetch.ts` 已支持 `init.signal`） | M |
| A11 | P2 | `src/core/manager.ts:609,636,650` | provider 耗时 2 s | `fetchedAt` 用的是**请求开始**的 `now`，TTL 被实际缩短 2 s，刷新更频繁 | `this.cardCache.set(id, {card, fetchedAt: Date.now()})` | S |
| A12 | P2 | `src/core/manager.ts:632-651` | provider 持续失败 | 失败卡片按 60 s TTL 无退避重试，上游/日志压力恒定；没有「熔断」概念 | error 卡片单独指数退避（60 s→10 min）并保留 `lastError`；连续失败 N 次后跳过本轮 | S |
| A13 | P2 | `src/core/manager.ts:646` + `src/routes.ts:30,67,151` | 上游错误消息含 URL/query/proxy | 错误原文回显到 HTTP 响应（无脱敏）；`fetchWithProxy` 有 `sanitizeProxyUrl` 但仅用于 proxy 字符串 | 统一错误映射：只回 `code` + 通用中文描述，详情写本地日志；对 `err.message` 过 `sanitizeProxyUrl` 与 key 正则脱敏 | S |
| A14 | P2 | `src/routes.ts:19-23` + `src/core/manager.ts:710-714` | `?provider=不存在的值` | 返回 `200 {ok:true, card:undefined}`（字段被 JSON 丢弃），调用方误判成功 | 找不到时 404 `{ok:false,error:'unknown provider'}`；`data.card` 缺失时客户端显式报错（`src/client/api.ts:227-234` 目前回退返回整个 `data`） | S |
| A15 | P2 | `src/routes.ts:96-105` | `days=3650`、`days=abc`、任意 `instanceId` | `days` 无 clamp（NaN 时返回空数组，超大时返回全部点）；响应无分页，30 天后单 key ~800 KB；无鉴权放大 | `days = clamp(1..30)`；响应加 `limit`/降采样（>200 点按桶聚合）；未知 key 返回 404；`Content-Encoding: gzip` | S |
| A16 | P2 | `src/core/types.ts:78-88` + `src/core/history.ts:94-103,125-132` | 持续记录 | 每点重复 `instanceId/poolId/windowId`，243 B/点 的一半来自冗余字段 + 缩进 | 改 `records[key] = { meta, points: [[ts, rem, used, resetAt?]] }`；点只存变化字段 | M |
| A17 | P2 | `src/core/history.ts:54`（`catch {}`）+ `src/core/manager.ts:470-474` | 磁盘满/只读 | 写失败静默，内存与磁盘分叉，重启丢数据；`saveConfig` 的写盘异常经路由变成 **400**（`routes.ts:149-151`），把服务端错误误报为客户端错误 | `save()` 返回 boolean 并记录 `lastSaveError`；`saveConfig` 失败抛错 → 路由映射 500；连续失败在 status 里暴露 `persistenceDegraded:true` | S |
| A18 | P2 | `src/core/oauth.ts:94-140,246-300` + `findAvailablePort`（:31-66） | 用户连点两次「登录」，或端口在探测与 listen 之间被抢占 | 前一个回调服务器被 close，首个授权流程静默失败；TOCTOU 导致 `EADDRINUSE` 未处理（`server.listen` 的 await 无 reject 分支） | 登录流程 single-flight：已有活动 server 时直接返回同一 `authUrl`；`listen` 失败时重试下一个端口 | S |
| A19 | P2 | `src/core/alarm.ts:4,23,75,85` | 实例被删除/重命名 | `activeAlarms` 对已删除实例永不清理，`getActiveAlarms()` 返回幽灵告警 | 每轮以本轮 cards 的 id 集合重建 Map（`for id not in current → delete`） | S |
| A20 | P2 | `src/core/manager.ts:167-171,205,481` | `/config` 被访问 | `sessionKey` 不在 `getSafeConfig.keyProps` 中 → 若用户配置了 `claude.sessionKey`，会以**明文**返回；掩码保留前 4+后 4，泄露 8 个真实字符 | `keyProps` 与 `SECRET_STRING_KEYS` 共用同一常量；掩码改为固定 8 个 `•`（不回显任何真实字符）；`oauth.email/accountId` 一并脱敏 | S |
| A21 | P2 | `src/core/manager.ts:613-616` | 缓存命中时的非 force 请求 | 命中缓存仍会走完整排序/过滤/告警/`recordSnapshots`，且 `recordSnapshots` 会因 2 分钟窗口触发全量写盘 | 写盘移出 `recordSnapshots`，由独立 ticker 按 dirty 触发；命中缓存直接返回并在后台刷新 | S |

> 已验证**不存在**的问题（避免误报）：provider 失败互不污染——每个实例独立 try/catch 并降级为 error 卡片（`manager.ts:612-651`）；`runWithConcurrency` 的并发上限正确（`manager.ts:112-146`，测试也覆盖 `tests/run.mjs:280-290`）；`fetchWithProxy` 的 proxy fail-closed 与超时合并正确（`fetch.ts:95-148`）；history 文件权限 0600 正确（`paths.ts:75`、`history.ts:52`）。

## B. 优化与升级点

| ID | 严重度 | 位置 | 触发条件 | 影响 | 修复方案 | 工作量 |
|---|---|---|---|---|---|---|
| B1 | P1 | `src/core/manager.ts:601-696` | status 端点被高频轮询 | 每次 force 0.9–2.2 s 且全量扇出；卡片不能跨进程复用 | stale-while-revalidate：`cardCache` 落盘（`quota-cache.json`），启动/force 时先返回旧值 200 + `stale:true`，后台刷新完由前端下一次拉取拿到新值；`force` 改为「最多 1 次/10 s」 | M |
| B2 | P1 | `src/core/history.ts:46-55` | 2.6 MB 文件 | 全量重写是写放大与阻塞的根因 | 改 append-only JSONL（每行 `{k,ts,r,u,resetAt}`），启动时流式读 + 只保留 30 天；每日一次 compaction（tmp + rename） | M |
| B3 | P2 | `src/core/paths.ts:75,82` | 所有原子写 | `null, 2` 缩进让文件体积约 ×2 | `JSON.stringify(data)` 紧凑写；如需可读性，另提供导出/格式化命令 | S |
| B4 | P2 | `src/core/history.ts:157-208` | 每次卡片刷新 | `getUsageTrendPoints` 对单 key 全量 `filter + sort`（O(n log n)），7 天后 n≈970，30 天后 n≈7,275 | 存储按 key 天然有序，去掉 `sort`；预聚合 5 min 桶；sparkline 结果按 key 缓存 5 min | S |
| B5 | P2 | `src/core/manager.ts:636-650` + `history.ts:14` | 常驻 | 10,780 个点对象 + 卡片对象常驻；30 天后 30–50 MB | 点用扁平数组（`number[]`）或 typed array；历史按 key 懒加载 | M |
| B6 | P2 | `src/routes.ts:104-105,119-120,26-27` | 每次响应 | 无 gzip、无 `Cache-Control`；11 KB status 无妨，112 KB history 有影响 | 加 `Content-Encoding` 协商（或确认宿主已做）；`/status` 加 `ETag`/`If-None-Match` | S |
| B7 | P2 | `src/core/history.ts:33,49` | 升级/迁移 | `version:2` 只写不校验，未来结构变更无迁移路径 | load 时按 `version` 分支迁移，未知版本先备份再重建 | S |
| B8 | P2 | `src/core/manager.ts:560-600` | 大量实例 | `buildInstanceTasks` 每轮重建 + `tasks.some` O(n²)（小 n 无感，但会随多账号增长） | 用 Set 去重；按配置变更缓存任务列表 | S |
| B9 | P2 | `src/index.ts:96-116` | Agent 工具首次调用 | `getAgentQuotaSummary` 默认 `forceRefresh=false`，但卡片 TTL 60 s；工具调用可能拿到 60 s 旧数据且无 `stale` 提示 | 响应里带 `lastUpdated`（已有）+ `ageMs`，>2×TTL 时自动刷新一次 | S |

## C. 测试/工程化缺口

| ID | 位置 | 问题 | 建议 |
|---|---|---|---|
| C1 | `test-run.ts:1-8` | 死文件：`manager.getQuota()` 不存在（实际方法名 `getQuotaCards`）；`import './core/manager.ts'` 路径错误（源码在 `src/core/`）；不在 `package.json` scripts 中，永远不会执行，但会误导贡献者 | 删除或改写为 `tests/run.mjs` 的入口封装 |
| C2 | `tests/run.mjs:87-108,248-251,280-290,400-401` | 覆盖了 history 基本记录、sparkline、并发上限，但**没有**覆盖：2000 点上限/30 天裁剪、损坏文件恢复、并发 force 去重、`save` 失败、`?force` 路由、SSRF/鉴权、`/history` 参数校验 | 按 A4/A6/A8/A2 各补一条回归用例；用 `DSH_HOME=mkdtemp` 隔离（已有，见 `tests/run.mjs:8-9`） |
| C3 | `tests/run.mjs`（498 行） | 无性能基准：2.6 MB / 10 万点场景下 `save()` 耗时、`/status` p95 都无断言 | 加 `--bench` 模式：生成 10 万点，断言 `recordSnapshots+save < 50 ms`（或改为异步后断言不阻塞） |
| C4 | `src/core/history.ts:33,49` | 无 schema 版本迁移测试 | 补 v1→v2、未知 version、空文件、截断 JSON 四组用例 |
| C5 | 仓库结构 | `lib/`（构建产物）与 `src/` 并存，测试跑 `lib/`（`tests/run.mjs:13-34`），但无校验「lib 是否与 src 同步」 | CI 里 `bundle-host.mjs` 后 `git diff --exit-code lib/`，或测试直接跑 src |
| C6 | `src/index.ts:96-116` | Agent tool 注册三套 fallback（`tools.register`/`registerTool`/`agent`）全靠 `try {} catch {}` 兜底（`:114`），失败静默 | 至少 `console.warn` 一次；用类型化注入（`inject: ['tools']`）替代鸭子类型探测 |

## D. 建议优先级 Top 5

1. **路由鉴权 + SSRF + 密钥外泄链（A1/A2/A3）**：这是唯一「外部输入 → 真实后果」的面。先加统一守卫（Origin + 自定义头 + token），再对 `custom_api.baseUrl` 做私网/协议白名单，最后收口 `restoreMaskedSecrets`（baseUrl 变更必须重填 key）。工作量 M，收益最高。
2. **history 写放大与上限失效（A4/A5/B2/B3）**：`2000` cap 是死代码 → 先把裁剪改成真 splice，再上 dirty+debounce+紧凑 JSON（体积、写量立刻降一个量级），中期换 JSONL。S→M，直接解决 2.6 MB→26 MB 与 18 GB/天写入。
3. **single-flight + AbortSignal（A6/A10）**：force 0.8 s 的本质是全量扇出且可叠加；合并 in-flight 并按 `req.close` 取消，既降延迟也保护上游额度。M。
4. **fire-and-forget 刷新崩宿主（A7）+ 历史损坏覆盖（A8）**：两个都是「一次异常 → 不可恢复」的低成本高收益修复；A7 一行 catch，A8 一个 rename+备份。S。
5. **多进程一致性（A9）**：配置与 history 都是 last-write-wins 全量重写；在 `$DSH_HOME` 被多 profile 共享的前提下，这是数据丢失的定时炸弹。先加 mtime 校验（S），再考虑锁或 JSONL（L）。
