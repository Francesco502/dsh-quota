# providers 审计

> 对象：`@francescoli/dsh-quota` v0.4.0，`/tmp/dsh-quota` @ `c7723f0`（工作树干净，审计未做任何修改）。
> 方法：只读源码 + 本地运行 `node tests/run.mjs`（全绿，但见 C 节覆盖结论）；未访问任何真实 provider API，涉及上游响应结构的判断均标注「推断」。
> 范围：`src/providers/*.ts`（16 个）、`tests/run.mjs`、`test-run.ts`、`docs/*.md`、`README.md`、`src/core/types.ts`（附带必要的 `core/fetch|manager|history|alarm`、`client/view|hud` 作为「结论落地位置」证据）。

---

## 0. 契约基线（types.ts）

- 实际契约：`IQuotaProvider { name; category; fetchCard(config, accountConfig?) => Promise<ProviderResult> }`，`ProviderResult = { card: AuthCardItem }`（`src/core/types.ts:205-214`）。**16/16 provider 均实现了该契约**（`manager.ts:345-367` 注册 16 个）。
- 卡片级 `status` 只有 `'ok' | 'warn' | 'error' | 'disabled'`（`types.ts:65`）——**没有 `degraded`/`unknown`**；窗口级有 `'active' | 'disabled' | 'unknown' | 'exhausted'`（`types.ts:19`）。因此「降级」只能靠窗口 `status` + `sourceProvenance.partial` 表达。
- `MetricWindow.usedPercent/remainingPercent` 是**必填 number**（`types.ts:15-16`），这是所有「缺字段→伪造 0/100」问题的类型学根源。
- 契约里明确写了「余额类窗口只提供金额，**绝不**从金额推导百分比」：`types.ts:24`（`amountText` 注释）。但实现有 3 处直接违反，见 A8。
- `formatQuotaResetText` 是统一重置文案（`types.ts:234-270`），但前端另写了一份 `formatWindowSubtitle`（`src/client/view.ts:197-243`）并且**优先于 provider 的 `subtitle`**，见 A28。

---

## A. 缺陷与风险

> 严重度：P0 = 结果长期错误/核心功能失真；P1 = 在常见条件下产生误导性额度或安全/隐私影响；P2 = 边界/健壮性/一致性问题。S/M/L = 修复工作量。

| ID | 级别 | 位置 | 触发条件 | 影响 | 修复方案 | 工作量 |
|---|---|---|---|---|---|---|
| A1 | **P0** | `src/providers/openai-billing.ts:92,95-101,116` | 计费接口返回 `hard_limit_usd > 0`（或任何 200） | `totalUsage` 声明为 0 后**从未赋值**，`remPercent` 恒为 `((hardLimit-0)/hardLimit)=100`；`balance.remaining` 也恒等于 `hardLimit`。即无论实际用了多少，永远「剩余 100%」，且上报给 HUD/Agent 的余额是假的 | 必须再查 usage（`/v1/dashboard/billing/usage` 已废弃，改用 `/v1/organization/costs`+`/v1/organization/usage`，需要 admin key）；拿不到就返回 `status:'unknown'` + `remainingPercent` 不展示，不得回填 100% | M |
| A2 | **P0** | `src/providers/custom-api.ts:121-126,138-140,156` | 中转返回 OneAPI `data.quota`（`quota/500000` 分支）或余额为 0 | 该分支把 `hardLimit = remainingBal`，于是 `remPercent = remainingBal/hardLimit = 100%` 恒成立；且 `remainingBal || (hardLimit-totalUsage)` 对**余额为 0** 走了 falsy 回退，把 0 余额又算回 100% | 保留原始 quota 总额作为分母（`total_granted`/`quota`），only 用 used 计算；`remainingBal` 用 `??` 不用 `||`；0 余额必须显示 0% | S |
| A3 | **P1** | `glm.ts:104-111`、`minimax.ts:100-107`、`qwen.ts:114-120`、`volcengine.ts:109-116`、`copilot.ts:134-140`、`claude.ts:100-113`；前端覆盖 `view.ts:197-201,1758-1808` | 接口 HTTP 200（GLM/MiniMax/Qwen/Volcengine 的 `/models` ping、Copilot 的 `/user`、Claude 的 `/v1/models` 无速率头） | 这 6 家只做了**连通性/鉴权检查**，却硬编码 `usedPercent:0 / remainingPercent:100`，前端 `formatWindowSubtitle` 还会把 `rem>=100` 强写成「已用 0% · 额度充足」。用户看到的是根本不存在的「额度充足」，与 README/PROVIDERS 宣称的「实时剩余额度」矛盾 | 新增能力元数据 `quotaKind:'usage'|'balance'|'liveness'`；liveness 窗口 `status:'unknown'`、不输出百分比，UI 显示「仅连通性检查」；禁止用 0/100 占位 | M |
| A4 | **P1** | `antigravity.ts:355-364`；渲染侧 `view.ts:1758,1799-1808`；历史侧 `history.ts:113-119` | `buckets[].remainingFraction` 缺失或为 `null`（API 变更/部分池子无数据） | `remainingFraction:null` 走 `Number(null)=0` → `hasFrac=true` → `rem=0` 且 `status='exhausted'`（**虚假耗尽**）；即使已经是 `status:'unknown'`，前端也算 `rem=0` 并渲染红色 `0%`（`view.ts:1758`），历史卡片级代表点还取 `groups[0].windows[0]` 的 0%（`history.ts:113-119`），污染 burn rate | `null`/缺字段一律 `status:'unknown'` 且不写百分比；前端对 `status==='unknown'` 渲染「—」；历史/告警跳过 unknown（窗口级已跳过：`history.ts:92`、`alarm.ts:36`，卡片级未跳过） | M |
| A5 | **P1** | `codex.ts:268-287`（关键 `:270`） | 上游响应无 `used_percent`（字段改名/窗口尚未启用） | `win.used_percent ?? 0` → 已用 0% → 剩余 100%，把「未知」显示成「满额」 | 先判 `typeof used_percent==='number'`，否则 `status:'unknown'` 且不产出百分比；同样校验 `reset_at` 单位 | S |
| A6 | **P1** | `cursor.ts:157-159,155,186,163-169` | `individualUsage.plan.autoPercentUsed/apiPercentUsed` 为 null/改名；无订阅（`plan.enabled` 假值）；`stripe` 失败 | 百分比 `?? 0` → 剩余 100%；无 plan 时抛错 → `status:'error'`（凭据其实是好的）；卡片 `warn` 只看 auto，不看 api；`$20 API 用量` 硬编码文案（`:177`）；`currentPeriodEnd*1000` 未校验单位（推断：若已是 ms 会得到 5 万年后重置） | 字段 null → unknown；无 plan → disabled/不展示而非 error；warn 取两窗口最小值；重置时间做秒/毫秒判别；删除硬编码 $20 | S |
| A7 | **P1** | `cursor.ts:96,147-148`；`openai-billing.ts:31,82-83`；`kimi.ts:32,87`；`glm.ts:32,83`；`minimax.ts:30-32,82`；`qwen.ts:31,86`；`volcengine.ts:31,86`；`siliconflow.ts:35,101`；`openrouter.ts:35,103`；`opencode-go.ts:30,102`；`custom-api.ts:33,83-92` | 用户在设置里选择 `proxyMode:'proxy-required'` 或 `'direct'` | 这 11 家调用 `fetchWithProxy` 时**没有传第 5 个参数 `config.proxyMode`**，永远走默认 `proxy-preferred`：`proxy-required` 会被静默降级为直连（隐私/合规风险），`direct` 也会被环境变量代理劫持。只有 deepseek/antigravity/codex/claude 传了（对照 `deepseek.ts:45,118`、`antigravity.ts:175,226,291,327,417`、`codex.ts:125,181,186,247,252`、`claude.ts:36,94`） | 统一 `providerFetch(config, ...)` 包装，强制透传 `proxyMode`；或在 `fetchWithProxy` 内从全局配置读取（当前无此通道） | S |
| A8 | **P1** | `kimi.ts:99`、`siliconflow.ts:115`、`deepseek.ts:138`；消费侧 `hud.ts:385-393`、`manager.ts:884-889`、`manager.ts:626`、`history.ts:113-119,234` | 余额类 provider 正常返回金额 | 用金额阈值**编造**剩余百分比（`<5→15%`、`<20→40%`、`else→100%`），直接违反 `types.ts:24` 的契约注释。主面板因 `isBalance` 规则显示金额，但 HUD 只认 `provider==='deepseek' || barType==='balance'`（`hud.ts:385`），Kimi/SiliconFlow 的窗口 `barType:'circle'` → HUD 显示编造的 15%/40%/100%；Agent 摘要 `manager.ts:884-889` 把每个窗口都输出为 `${remainingPercent}%`；burn rate 用窗口百分比（`manager.ts:626`、`history.ts:234`）→ 余额 provider 的「消耗速率」是 100→40→15→0 的阶梯噪声，`estimatedHoursLeft` 不可信 | 余额窗口不产出百分比（或固定 `status:'unknown'`）；HUD/Agent 改读 `amountText`/`balance`；burn rate 对余额 provider 用 `remainingBalance` 差值（history 的 `getUsageTrendPoints` 已有余额分支：`history.ts:173-177`） | M |
| A9 | **P1** | `kimi.ts:99-110`；告警 `alarm.ts:13-25`；历史 `history.ts:87` | Kimi 余额为 0 | `status:'error'` 被当作「连接异常」，告警文案变成「连接异常 (余额耗尽)」，且 `recordSnapshots` 直接 `continue` 不再记录历史。与 deepseek 的约定相反（`deepseek.ts:135-137` 注释明确 error 只用于不可用账号） | 0 余额应 `warn`/`exhausted`，error 仅留给 401/403/网络；统一各 provider 的状态判定表 | S |
| A10 | **P1** | `claude.ts:100-113,121` | 正常 200 响应（`/v1/models`） | Anthropic 的 `anthropic-ratelimit-*` 头出现在 **messages** 响应上，`/v1/models` 基本不会带（推断，依据 Anthropic 速率头语义）；因此 `remPercent` 几乎恒为 100、副标题「API 凭据有效 · 额度正常」。即使有头，它也是**每分钟请求速率余量**，不是账户额度/用量——与卡片「Claude 账户配额」的标题语义不符 | 无头时 `unknown`；把窗口明确命名为「速率余量」并标注非账户额度；真正的用量需要 Admin API（`/v1/organizations/usage_report`，admin key），或干脆降为 liveness | S |
| A11 | **P1** | `copilot.ts:110-139` | 任意有效 GitHub PAT | `hasAccess = copilotTokenRes.ok || userRes.ok`：没有 Copilot 订阅的 GitHub 账号（`/user` 200）也会显示「订阅正常 · 额度充足 / 0% used」；`copilotTokenRes` 返回的 token/`sku` 只用来拼 plan（`:119`），真正的 premium requests 用量完全没查。请求还缺 `Editor-Version` 等头（推断：`copilot_internal/v2/token` 常因此 404/401），此时只会落入 `|| userRes.ok` 的假阳性 | 校验 `copilotTokenRes` 必需成功且 `sku` 属于 Copilot；调用 Copilot 内部 usage 端点获取 premium 配额；失败时退回 liveness 且不显示 100% | S |
| A12 | **P1** | `docs/PROVIDERS.md:9-33` vs `types.ts:205-214` | 任何按文档接入新 provider 的贡献者 | 文档描述的接口 `QuotaProvider.fetchQuota()`、返回 `ProviderQuotaResult{id,status:'warning',metrics,updatedAt}` **在代码中一个都不存在**；真实是 `IQuotaProvider.fetchCard()` → `{card}`，状态是 `warn` 不是 `warning`。按文档实现必然编译失败/不被 manager 识别 | 用真实契约重写 PROVIDERS.md（含 `AuthCardItem/MetricGroup/MetricWindow` 语义、余额 vs 百分比、unknown 约定）；加示例 provider 的 fixture 测试 | S |
| A13 | **P1** | `docs/FAQ.md:6-7` vs `codex.ts:181,247`、`types.ts:156-168` | 用户按 FAQ 把 Codex 接到 OneAPI/NewAPI | Codex provider **硬编码** `https://chatgpt.com/backend-api/wham/usage`，`QuotaConfig.codex` 类型里也没有 `baseUrl` 字段；FAQ 的「改 Base URL 即可」是错的（能改 baseUrl 的是 `openai_billing`/`custom_api`） | 要么给 codex 增加 baseUrl+协议适配，要么把 FAQ 改成「用 OpenAI Platform 或自定义中转」 | S |
| A14 | **P1** | `tests/run.mjs:69-85,371-403,406-408`；`tests/quota.test.ts`（25 行 2 例）；`package.json` `"test": "node tests/run.mjs"` | 运行 `npm test` | 16 个 provider **只被实例化**，没有任何 `fetchCard` 解析断言：`run.mjs:406-408` 的 “Codex dual window” 块只有 `assert.ok(codexProv)`；`run.mjs:371-403` 的 Antigravity 块是手写假卡片；测试导入的是构建产物 `../lib/index.js` 而非 `src`（`:35`）。因此 A1/A2 这种「恒 100%」的 P0 缺陷可以 100% 通过测试。`tests/quota.test.ts` 根本没被 `npm test` 执行 | 引入可注入 fetch 的 fixture 测试（每个 provider 至少：正常/字段缺失/401/429/零余额）；`npm test` 增加 `node --test tests/`；对 `src` 而非 `lib` 做类型/单测 | M |
| A15 | **P1（安全/合规，推断）** | `antigravity.ts:164-169`；`oauth.ts:251-253,367-373`；UA 伪造 `antigravity.ts:32-34` | 任意用户使用 Antigravity 登录/刷新 | Google OAuth `client_secret` 以 `String.fromCharCode` 混淆后硬编码进源码（可一条命令还原），并申请 `auth/cclog`、`auth/experimentsandconfigs` 等**非公开/内部 scope**；请求还伪造 `antigravity/hub/2.26.0` UA 访问 `v1internal:*` 内部端点。若上游判定滥用，可能封禁插件用户账号/客户端（推断） | 改用公开 OAuth 客户端 + PKCE/Device Code，去除内部 scope 与 UA 伪造；或明确只支持读本地 IDE 登录态；在 README 披露风险 | M |
| A16 | **P1（安全）** | `codex.ts:145-153`；`manager.ts:518-536` | 用户在插件里完成 OpenAI OAuth 登录；或开启 `syncLocalAuth` | 插件会**无备份地重写** `~/.codex/auth.json`（`saveCodexLogin` 在 OAuth 成功回调里无条件调用 `manager.ts:518-536`），可能覆盖用户 CLI 里另一个账号的 token；`syncLocalAuth` 路径虽已 opt-in（`codex.ts:110`），但写入不保留 `last_refresh` 等 CLI 字段（推断），可能让 Codex CLI 状态错乱 | 写前备份 `.bak`；仅在文件不存在或用户确认时写；合并而非重建字段；优先只存插件自己的 secrets 文件 | M |
| A17 | **P1** | `oauth.ts:119` vs `oauth.ts:214` | 本机 1455 端口被占用 | `redirect_uri` 写死 `http://localhost:1455/auth/callback`，但监听端口是 `findAvailablePort([1455,1456,0])`，可能实际绑 1456/随机端口 → 浏览器回调不到，登录挂起 5 分钟。属于 Codex 凭据获取路径的直接失败点 | 用实际绑定端口动态拼 `redirect_uri`；或 1455 占用时直接报错并提示关闭占用进程 | S |
| A18 | P2 | `antigravity.ts:189-198`；`codex.ts:136-143` | access token 过期后刷新成功 | 只改内存里的 `config.*.oauth.accessToken/expiresAt`，**未调用 `saveConfig`/`persistSplit`**：重启后回到旧 token 再刷一次；若上游轮换 refresh_token（Google 一般不转、但 OpenAI 会）则新 refresh token 丢失，用户被强制重新登录 | 刷新成功后通过回调持久化（含 secrets 文件）；加单飞锁避免并发刷新 | S |
| A19 | P2 | `codex.ts:36`（类型声明），全文无读取 | Codex 有付费 credits | `credits` 定义了但从未解析，付费余额/无限额度信息完全丢失，只显示 rate-limit 窗口 | 把 `credits.balance` 映射为 `balance` 或独立窗口 | S |
| A20 | P2 | `cursor.ts:155,163-169,177,186` | 非个人 Pro 套餐/账单接口异常/月界 | `plan` 缺失即 error；`stripe` 失败时用「下月 1 日」估算重置（与真实账单周期可能差数天）；`$20 API 用量` 是硬编码；warn 只看 auto 窗口 | 以 `startOfMonth`+周期推算；文案改成不承诺具体金额；warn 取 `min(auto, api)` | S |
| A21 | P2 | `opencode-go.ts:62,102,114-116,129-131,144-146,164` | 上游 `usage` 字段为 null/改名；滚动窗口重置时间是 epoch 秒 | `percent ?? 0` → 剩余 100%；`resetsAt` 原样传给 `formatQuotaResetText`（`types.ts:240` 用 `new Date(input)`，若上游给秒级数字会变成 1970 → 显示「即将重置」）；窗口没有 `status/windowKind`，卡片永远 `ok`，即使 0% 也不 warn；`fetchCard` 的 fetch 没传 timeout（`:102`，默认 20s） | 单位归一化 + 字段校验；窗口补 `status/windowKind`；状态按阈值 warn；显式 timeout | S |
| A22 | P2 | `openrouter.ts:114-123,136-141` | `data.limit` 为 null（无限额）或 0 | 两者都显示 100% 剩余；`data.limit_remaining`/`limit_reset` 等官方字段未用，重置周期完全缺失；`limit===0` 可能是被限额为 0，却被当作「无硬限额」 | 用 `limit_remaining` 优先；null→「无硬限额」且不显示百分比；0→unknown/warn；补 `limit_reset` 窗口 | S |
| A23 | P2 | `deepseek.ts:71-79,128-139` | 账户有 CNY+USD 两个 `balance_infos`；`total_balance` 是异常字符串 | 只取 `balance_infos[0]`，另一币种丢失；`testConnection` 里 `¥${total} ${currency}` 对 USD 也打 ¥；`parseFloat` 失败得到 NaN → `Math.max(0,NaN)=NaN`，`toFixed` 输出「NaN」，`remPercent` 变 0（虚假 0%） | 按 currency 选条目或分组展示；NaN 守卫；币种符号跟随 currency | S |
| A24 | P2 | `siliconflow.ts:111,113-116` | 余额 2~5 元 / 20 元附近 | `isLow = available <= 2`，但百分比分档是 `<5→20%`、`<20→50%`、`else 100%`，两套阈值不一致；`total` 用 `max(total, available)` 兜底，`chargeBalance/totalBalance` 缺失时语义漂移 | 统一一次阈值策略；total 缺失时不展示 total | S |
| A25 | P2 | 10 个 provider 完全不发 UA（`kimi/glm/minimax/qwen/volcengine/siliconflow/openrouter/claude/openai-billing/custom-api` 全文无 `User-Agent`）；所有 provider 均无 429/Retry-After 处理（`grep` 无命中） | 上游 Cloudflare/限流 | 缺 UA 容易被 Cloudflare 判 bot；429/403 只会得到「HTTP 429」或「登录态失效」这类错误文案，无退避重试，也不区分「限流」与「凭据失效」 | 统一 HTTP 包装补默认 UA、429 识别与指数退避（配合 A7 的包装） | S |
| A26 | P2 | `antigravity.ts:400-498,521,342,352,471`；`testConnection` `:229-243` | `retrieveUserQuotaSummary` 返回 200 但 `groups:[]`，fallback 也无数据 | 卡片 `status:'ok'` + `groups:[]`（空白卡片），`testConnection` 也报成功（「已连接 (0 个额度分组)」）；错误卡却带 `plan:'已连接'`；`hasArgonPool` 赋值 3 次从未读取 | 空 groups → `error`/degraded 且 `partial:true`；testConnection 要求 groups>0；删除死变量 | S |
| A27 | P2 | `cursor.ts:224`、`codex.ts:345`、`antigravity.ts:521` | 捕获异常分支 | 错误卡把 `plan` 字段写成 `'已连接'`（plan 语义被当作状态文本），UI/Agent 摘要（`manager.ts:876`）会展示「已连接」+ `error`，自相矛盾 | 删除该赋值，用 `account`/`sourceProvenance` 表达已连凭据 | S |
| A28 | P2 | `view.ts:197-243` vs `types.ts:234-270`；`src/client/api.ts` 重复定义 `MetricWindow` 等；`view.ts:1758-1808` 不看 `win.status` | 任意窗口 | 前端 `formatWindowSubtitle` 会覆盖 provider 的 `subtitle`（`view.ts:1759`），并用 `remainingPercent` 自行生成「额度充足」；与 `formatQuotaResetText` 两套逻辑已出现文案/边界差异；client 类型副本与 core 类型可能漂移。渲染层完全不尊重 `status:'unknown'`/`'disabled'` | 前端改用 `formatQuotaResetText` 或直接展示 provider subtitle；unknown 显示「—」；`src/client/api.ts` 改为从 core 类型生成/复用 | S |
| A29 | P2 | `minimax.ts:8,14-15`；`types.ts:187` | 用户填了 `groupId` | `resolveKey` 返回 `groupId` 但从未使用（死字段）；且 MiniMax 开放平台是否有 `/v1/models` 存疑（推断），若无则有效 Key 也会被判 error | 删除死字段或真正用于查询；对 `/models` 404 回退到轻量 chat 探测 | S |
| A30 | P2 | `types.ts:184`；全仓 `grep sessionKey` 仅 manager 的 secret 名单 | 用户配置 Claude `sessionKey` | 配置项是死字段：Claude provider 只读 `apiKey`（`claude.ts:9-12`），也没有 claude.ai 会话额度解析路径 | 删除字段或在 UI/文档明确不支持 ;若支持需实现 web 会话额度接口 | S |
| A31 | P2 | `README.md:9,16-18,25,30-31`；`docs/ARCHITECTURE.md:50-52` | 阅读文档的用户 | README 把 Claude/GLM/MiniMax/Qwen/Volcengine/Copilot 归入「实时剩余额度/用量」——实际是 liveness（A3/A10/A11）；「单服务网络超时不阻塞全局」实际 `getQuotaCards` 要等所有任务 settle，慢 provider 会拖慢整批（`manager.ts:612-653`）；「配置保存在 `~/.dsh/quota-config.json` 0600」已拆分为 `quota-config.json` + `quota-secrets.json`（`manager.ts:314-315,339-343`），README 未提；ARCHITECTURE 说 codex 支持 OneAPI/NewAPI，实际在 custom-api（`ARCHITECTURE.md:50`） | 增加「能力矩阵」（额度/余额/仅连通性）并在 README 标注；修正缓存/文件路径描述；架构文档按 16 provider 重写 | S |
| A32 | P2（关联，越界提示） | `manager.ts:670-677,401,555-572` | 默认配置下新增 `custom_compatible` 端点 | `visibleCards` 过滤要求 `enabledProviders` 含 `c.id` 或 `c.provider`；默认 `enabledProviders` 不含 `'custom_api'`，且账号 id 不在列表时只能靠 provider 名兜底。若客户端保存端点时未把 id 加进 `enabledProviders`，卡片会「测活了但看板不显示」 | 可见性判定对 `accounts`/`custom_compatible` 直接以 `enabled !== false` 为准，不依赖 `enabledProviders` 白名单 | S |

---

## B. 优化与升级点

| ID | 级别 | 位置/主题 | 现状与机会 | 建议 | 工作量 |
|---|---|---|---|---|---|
| B1 | P1 | `types.ts:15-19,24` | 百分比必填 + 注释「余额不推百分比」，但实现无类型约束 | 引入 discriminated union 或 `usedPercent?: number` + `status:'unknown'`，让「未知」在编译期无法被当成 0/100；前端集中处理 unknown | M |
| B2 | P1 | provider 元数据 / UI | 6 家 liveness provider 与 3 家余额 provider 混在「额度」语义里 | 给每个 provider 声明 `capability: 'quota'|'balance'|'liveness'`，看板/HUD/Agent 摘要按能力渲染；liveness 不参与「额度充足」推荐（`manager.ts:809-835` 目前会把 GLM 等当成 healthy 首选/备选） | M |
| B3 | P1 | `core/fetch.ts:81-87` + 16 provider | 每次调用手写 proxyMode/timeout/UA，已出现 11 处漏传（A7） | 增加 `providerFetch(config, url, init)`：默认 UA、超时、`proxyMode`、429 语义、错误脱敏；provider 内禁止直接调 `fetchWithProxy` | S |
| B4 | P2 | `docs/FAQ.md:10` vs `manager.ts:607-616` | FAQ 宣称「请求合并与缓冲」，实际只有实例级 TTL 缓存，无 in-flight 去重；并发 `getQuotaCards` 会重复打上游 | 按 instance id 做单飞（相同 in-flight promise 复用）；429/5xx 指数退避；把真实行为写进 FAQ | M |
| B5 | P1 | `tests/` | 16 provider 0 解析测试（A14） | 建 `tests/fixtures/<provider>/*.json` + mock fetch，覆盖：正常、字段缺失/null、单位变体、401/403/429、零余额、字段改名；断言不出现虚假 100%/0% | M |
| B6 | P2 | 各 provider 的 reset 处理 | 时间单位/格式各写各的（codex 秒*1000、cursor 秒*1000、antigravity 原样、opencode 原样） | 统一 `normalizeResetAt(input)`：支持 ISO / epoch 秒 / epoch 毫秒 / 相对秒，统一输出 ISO；非法→undefined（不显示倒计时） | S |
| B7 | P2 | `antigravity.ts:189-198`、`codex.ts:136-143` | 刷新后的 token 不落盘（A18） | 注入 `onTokenRefreshed` 回调 → `manager.saveConfig`；刷新加互斥锁；记录 `expiresAt` 并提前 60s 刷新（antigravity 已有 60s 余量：`:155`） | S |
| B8 | P1 | `openai-billing.ts` | 只有 models+billing subscription，没有 usage（A1） | 支持 Admin key 的 `/v1/organization/usage/completions` + `/v1/organization/costs`；普通 project key 直接标「无权限查询」，不要显示 100% | L |
| B9 | P2 | `codex.ts:290-298`、`customer` 历史 | window id 固定为 `codex-5h/codex-weekly`，但 `windowKind` 由 `limit_window_seconds` 推断，套餐切换时同一 id 会拼接不同窗口的历史；`secondary_window || primary_window` 回退可能重复同一窗口 | 窗口 id 含 kind/周期，或在 `windowKind` 变化时重置历史序列；回退时去重 | S |
| B10 | P2 | `antigravity.ts:36-99` | 手写 protobuf 解析依赖猜测的 field number（1/2/3/4），格式一变就 `null` → 「未连接」而非「Token 格式变更」 | vendored 稳定解码器 + schema 版本探测；解析失败与「未登录」区分错误文案；`node:sqlite` 不可用时提示 Node 版本（`:128-134`） | M |
| B11 | P1 | `docs/PROVIDERS.md`、`README.md`、`docs/FAQ.md` | 文档与实现系统性脱节（A12/A13/A31） | 重写 PROVIDERS.md 为真实契约 + 贡献流程；README 增加 16 家能力矩阵（额度/余额/仅连通/需要代理）；FAQ 修正 Codex/缓存描述 | S |
| B12 | P2 | `SourceProvenance`（`types.ts:52-58`） | 只有 deepseek/codex/antigravity/openai-billing 填了 provenance；其余 12 家为空，`partial` 只有 antigravity 用 | 每个 provider 填 endpoint/method/partial；降级分支（fallback models、无 billing 数据、无 header）标 `partial:true` 供 UI 显示「数据不完整」 | S |
| B13 | P2 | `package.json` scripts | `npm test` 只跑 run.mjs，`tests/quota.test.ts` 是死测试；无 lint/typecheck 脚本 | `"test": "node --test tests/ && node tests/run.mjs"`（或统一 vitest）；增加 `tsc --noEmit`；CI 对 `lib` 与 `src` 一致性做检查 | S |
| B14 | P2 | `fetch.ts:92,110-125` | 代理只认 `HTTPS_PROXY/HTTP_PROXY`，不认 `NO_PROXY`；`proxyAgentCache` 无上限 | 支持 NO_PROXY/ALL_PROXY；缓存按 proxy+时间清理；代理失败的错误里保留脱敏后的 host | S |
| B15 | P2 | HUD/Agent/Alarm | HUD 与 Agent 摘要把所有窗口当百分比（`hud.ts:385-393`、`manager.ts:884-889`），余额与 liveness 语义丢失 | 输出结构区分 `percent`/`amount`/`unknown`；告警对余额窗口用金额阈值（`alarm.ts:61-77` 已有 `amountText` 分支，但 kimi/SF 未填 `amountText`） | M |

---

## C. 测试覆盖矩阵

`tests/run.mjs` 共 27 个带编号的断言块（1–27）。与 provider 相关的只有：块 4「实例化 16 个类」（`:69-85`）、块 7「getAgentQuotaSummary」（`:145-150`，全部 provider 因无凭据走 disabled 早退）、块 8「单个/批量测活」（`:153-161`，空 Key 早退）、块 19/20（`:371-408`，手写假卡片 + 空断言）。**没有任何一块对 provider 的响应解析分支做断言**；也无 fetch mock/fixture。

| Provider (LOC) | 代码中的主要解析分支 | 测试覆盖 | 缺口与风险（对应 ID） |
|---|---|---|---|
| deepseek (205) | `/user/balance` → `balance_infos[0]` → total/granted/toppedUp；金额→百分比分档；`is_available` 状态 | 仅空 Key 早退（`run.mjs:153` 间接） | 多币种、NaN、0 余额、401/403 全部未测；金额分档（A8/A23） |
| antigravity (530) | protobuf token 解码（JSON/二进制两路）→ refresh → summary `groups[].buckets[]` → fallback `fetchAvailableModels` → 窗口分类/去重/provenance | 0（块 19 是手写假卡） | 全仓最复杂、零覆盖：null fraction、空 groups、fallback、双端点、token 刷新、`node:sqlite` 缺失（A4/A15/A18/A26） |
| cursor (233) | SQLite `state.vscdb` → cookie 组装；`usage-summary` + `stripe` 双请求；plan 缺省/百分比/重置 | 0 | 字段 null、无 plan、stripe 失败、401、cookie 格式未测（A6/A20） |
| codex (354) | `~/.codex/auth.json` + `CODEX_HOME` 发现；401→refresh→回写；`rate_limit.primary/secondary` + `code_review`；403 Cloudflare 识别 | 0（块 20 只有 `assert.ok`） | 双窗口、缺 `used_percent`、refresh 失败、写文件、credits 未测（A5/A16/A17/A19） |
| siliconflow (168) | `/v1/user/info` → balance/charge/total → 金额分档 | 0 | 阈值/NaN/缺字段未测（A8/A24） |
| openrouter (175) | `/v1/auth/key` → usage/limit → 百分比；null limit 分支 | 0 | **P0 邻近**：limit null/0、缺 usage 未测（A22） |
| copilot (163) | `hosts.json` → `/user` + `/copilot_internal/v2/token` → 假 100% | 0 | 无订阅账号、token 端点失败未测（A11） |
| openai_billing (160) | `/v1/models` + `/v1/dashboard/billing/subscription` → hardLimit→百分比 | 0 | **A1 恒 100% 缺陷完全无测试可发现** |
| claude (156) | `/v1/models` → 速率头 → 百分比 | 0 | 无头场景（默认）未测（A10） |
| kimi (153) | `/v1/users/me/balance` → available/cash/voucher → 金额分档；0 余额→error | 0 | 0 余额、字符串/NaN、币种未测（A8/A9） |
| glm (134) | `/api/paas/v4/models` 仅鉴权 → 硬编码 100% | 0 | 仅 liveness（A3） |
| minimax (130) | `/v1/models` 仅鉴权 → 硬编码 100%；groupId 死字段 | 0 | 端点存在性、liveness（A3/A29） |
| qwen (143) | `/compatible-mode/v1/models` → 模型列表 → 硬编码 100% | 0 | liveness（A3） |
| volcengine (139) | `/api/v3/models` 仅鉴权 → 硬编码 100% | 0 | liveness（A3） |
| opencode_go (191) | `/zen/go/v1/usage` → rolling/weekly/monthly 百分比 + resetsAt | 0 | percent null、reset 单位、空 usage、状态恒 ok（A21） |
| custom_api (190) | `/v1/models` + 2~3 个余额端点启发式（hard_limit/total_granted/quota/balance） | 0 | **A2 恒 100% 缺陷无覆盖**；多分支优先级/字符串金额未测 |

**结论**：16/16 provider 的解析分支覆盖率为 0；`tests/quota.test.ts` 的 2 个测试未接入 `npm test`；`test-run.ts`（7 行）只是手工脚本。零覆盖 + 高风险的组合是 **antigravity / codex / cursor / openai-billing / custom-api / opencode-go**（前四个正是任务点名的重点）。

---

## D. 建议优先级 Top 5

1. **先修「恒 100%」的 P0 计算错误**：`openai-billing.ts:92-116`（`totalUsage` 永不赋值）与 `custom-api.ts:121-140,156`（分母=剩余、0 余额被 `||` 回退）。这两个 bug 让「额度监控」在核心场景下给出完全错误的正向信号，且无测试可拦截；同时给二者补 fixture 测试（A1/A2/A14）。
2. **消灭虚假 0%/100% 的展示链**：先改 provider 对缺字段/null 的处理（`antigravity.ts:355-364`、`codex.ts:270`、`cursor.ts:157-159`、`opencode-go.ts:114-146`），再改渲染层尊重 `status:'unknown'`（`view.ts:1758-1808`），最后改 HUD/Agent 摘要（`hud.ts:385-393`、`manager.ts:884-889`）。这是用户信任的核心（A3/A4/A5/A6/A8/B1/B15）。
3. **把「仅连通性」从「额度」里拆出来**：GLM/MiniMax/Qwen/Volcengine/Copilot/Claude 目前硬编码 100% 并被前端改写为「额度充足」，还会进入模型路由推荐（`manager.ts:809-835`）。加 capability 元数据 + UI 标注，Claude 明确速率余量≠账户额度（A3/A10/A11/B2）。
4. **修凭据与网络路径**：11 个 provider 漏传 `proxyMode`（A7）导致隐私设置失效；Codex OAuth 固定 1455 回调（A17）；刷新 token 不落盘（A18）；`~/.codex/auth.json` 无备份覆盖（A16）。这些直接决定「能不能连上、会不会连错」。
5. **文档与测试止血**：`docs/PROVIDERS.md` 的接口与代码完全不符（A12），FAQ 的 Codex baseUrl/请求合并描述失真（A13/A31）；`npm test` 接入真实 provider 解析测试与 typecheck（A14/B5/B13）。否则上述缺陷会持续回归。

---

### 附：本次审计未做/无法验证的事项

- 未访问任何真实 provider API，上游响应结构（Cursor `individualUsage.plan.*`、Antigravity `buckets[]`、Codex `wham/usage`、OpenCode `usage.rolling.*`、MiniMax/Volcengine `/models` 是否存在）均按公开资料/代码推断，已在对应行标注「推断」。
- 未运行 `npm install`/构建/发布；未修改 `/tmp/dsh-quota`（`git status` 干净）。唯一写入是本文件。
