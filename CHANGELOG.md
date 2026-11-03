# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.4.0] - 2026-11-03

### Added
- **Antigravity Gemini 4 Argon 独立周配额池支持**：
  - 适配 Google Cloud Code `retrieveUserQuotaSummary` 新版服务端识别机制，采用标准 Hub Client 身份（`antigravity/hub/2.26.0`）发送查询；
  - 自动识别并独立归类 **Gemini 4 Argon** 专属额度池（`Weekly Limit (Argon)`），不再与普通 Gemini Flash/Pro 混桶去重；
  - 细分 poolType（`gemini` / `argon` / `claude_gpt` / `general`），单池额度耗尽不影响其余池的模型可用性判断。
- **Codex 双窗口限额完整展示**：
  - 同时解析并独立展示 `primary_window` (5-Hour Limit) 与 `secondary_window` (Weekly Limit) 以及 Code Review 额度；
  - 优化持续时间与重置倒计时判断。
- **网络请求安全模式 (ProxyMode)**：
  - 增加 `direct` / `proxy-required` / `proxy-preferred` 模式，在 `proxy-required` 下严格实行 fail-closed（不回退直连、不暴露直连源 IP）；
  - 代理 URL 凭据自动脱敏，防止密码进入错误日志或 UI。
- **配置与数据流安全强化**：
  - `GET /api/dsh-quota/config` 自动脱敏并掩码 API Key、Token，防止敏感凭据回传；
  - 增加保存时的未脱敏凭据还原，防止 `***` 意外覆盖有效密钥；
  - 请求载荷增加 256KB 硬上限防护。
- **逐窗口时序历史记录与重置识别**：
  - 时序历史升级为窗口级别记录（`instanceId::poolId::windowId`），防止跨组混淆；
  - 消耗速度计算（Burn Rate）增加重置与充值识别，重置周期跨越时不产生错误消耗激增。

### Added
- **只读额度探针 `scripts/probe-antigravity.mjs`**：直接打印上游返回的额度分组、bucketId、窗口类型与 plan 字段，用于在真机上确认协议变化（不回显任何密钥，账号邮箱打码）。

### Changed
- **本地凭据探测改为显式授权**：首次安装不再默认 `autoDetectLocal: true`，Cursor / Antigravity / Codex / Copilot 的本机登录态只有用户在设置中勾选后才读取。
- **DeepSeek 余额不再伪装百分比**：看板与告警均以真实金额呈现，颜色按金额分档；告警文案从"剩余 15%"改为"余额 ¥x.xx"。
- **密钥与可读配置分离**：新增 `~/.dsh/quota-secrets.json`（0600），`quota-config.json` 不再包含任何密钥；旧版本内联密钥在首次启动时自动迁移。
- **额度耗尽不再等同于连接失败**：Antigravity / Codex / DeepSeek 的耗尽状态统一为 `warn`，`error` 只表示请求失败，告警文案不再误报"凭据失效"。
- **单 Provider 查询先过滤再联网**：`get_quota_status(provider)` 只采集目标服务，不再先打全部上游。
- **不再猜测订阅档位**：Antigravity 未返回 `plan` 时留空，不再硬编码 "Antigravity Pro / Ultra"。

### Fixed
- **修复代理凭据泄漏进浏览器 DTO**：`/config` 的 `httpProxy` 同样掩码为 `***:***`。
- **修复掩码回填按数组下标匹配**：账号重排后不再把 A 的密钥回填给 B，改为按 `id` 匹配。
- **修复一键测活探测已禁用服务**：被关闭的 provider 不再进入连通性批量测试。
- **修复余额/额度耗尽被判为 `error`**：见上文状态语义修正。
- **修复损坏配置被静默覆盖**：解析失败时旧文件重命名为 `quota-config.json.corrupt-<时间戳>` 保留待查。
- **修复远端文本未转义**：账号邮箱、上游错误体、分组名在进入看板前统一转义；设置表单属性值同样转义。
- **修复 Codex 被动改写用户登录态**：监控不再刷新/回写 `~/.codex/auth.json`；如需插件代管该文件，显式设置 `codex.syncLocalAuth: true`。
- **修复趋势采样绑定服务端顺序**：消耗速率改用"稳定活跃窗口"而非 `groups[0].windows[0]`。
- **修复 Ultra 账号被误标 partial**：只有走 `fetchAvailableModels` 降级分支才标记部分数据。
- **修复 Antigravity 多账号 Token 刷新污染默认账号配置缺陷**：更新特定账号令牌时严格按 `accountConfig` 作用域写回，不再污染默认全局配置。
- **修复 Codex 配置 OAuth 刷新后未持久化轮换 Token 缺陷**：显式账号与全局配置均能正确持久化新令牌。
- **解决客户端全局超时重挂与生命周期泄漏**：移除无宿主防护的 `setTimeout apply({})`，增加 `isDestroyed` 与 `AbortController` 守卫，确保插件销毁后定时器与监听器完全回收。
- **修复 Claude 自定义 BaseURL 跨源重定向泄漏敏感头隐患**：对 API 验证请求添加 `redirect: 'error'` 严格防御。
- **修复 DeepSeek 余额金额伪造为固定百分比问题**：准确区分真实币种与金额，不虚拟映射为 15%/40%/100%。

## [0.3.1] - 2026-10-26

### Fixed
- **修复 Undici 跨版本冲突导致的 fetch failed**：在 Node 内置 Undici (v7) 与外部 DSH 运行环境 Undici (v8) 存在版本差异时，统一采用同一 Undici 实例派发请求，彻底解决 `UND_ERR_INVALID_ARG` 异常。
- **增强代理自动回退与智能重试机制**：为代理请求增加异常捕获与超时控制；当配置的 HTTP 代理端口未开启或不可达时，自动安全回退至直连重试，并提供精准的双重错误诊断信息。
- **修复桌面悬浮球内容空白（未选择额度）问题**：
  - 重构指标跨模型族自适应对齐：优化 Google Antigravity 配额匹配机制，无论上游接口动态下发 Gemini 还是 Claude & GPT 模型分组，周额度与 5 小时额度均能精准命中；
  - 增加指标匹配兜底保护：当已启用悬浮球的服务因上游分组或 ID 漂移导致无指标匹配时，自动回退展示卡片可用窗口，杜绝悬浮球空白；
  - 修复设置抽屉回显：同步修正详细设置中的指标复选框勾选判断逻辑。

## [0.3.0] - 2026-09-14

### Added
- **Provider 矩阵扩充 (16+ 家)**：
  - 新增 **硅基流动 (SiliconFlow)** 官方 Provider：直读账户可用余额、充值金，低额度自动预警，支持独立测活；
  - 新增 **OpenRouter** 官方 Provider：读取 API Key 限额 (limit)、实际用量 (usage) 与速率限制，无硬限额场景自适应展示；
  - 前端抽屉与 HUD 指标选择全面接入 SiliconFlow 与 OpenRouter。
- **高并发请求池调度 (Concurrency Pool)**：
  - 实现通用 `runWithConcurrency` 异步任务并发限制器，在看板全量刷新与「一键全部测活」时将最大瞬发并发数限制在 5，防止网络突发导致第三方 API 触发 HTTP 429 或本地 Socket 耗尽。
- **配置无感备份与跨机迁移 (Backup & Restore)**：
  - 偏好设置中增加「导出脱敏备份」按钮，自动对所有 Provider 的 API Key、Session Token 与 OAuth 凭据进行脱敏遮盖（`***`），安全分享；
  - 增加「完整配置导出」按钮，方便多台开发设备间快速克隆迁移；
  - 增加「导入配置文件」按钮，支持本地 JSON 文件解析、格式校验与二次确认覆盖生效。
- **DSH Agent 智能路由器强化**：
  - 工具 `get_quota_status` 响应中新增具体的机器调用模型标识符 `primaryModelId`、`availableModels` 及候选路由中的 `modelId`（如 `deepseek-chat`、`deepseek-ai/DeepSeek-V3`、`gemini-2.0-flash`），AI Agent 可直接用作子代理派发参数。
- **Sparkline 趋势图原生悬停 Tooltip**：
  - 在每个数据点上增加 `<circle><title>M/D 相对用量: X%</title></circle>`，悬停可直接查看具体日期的用量强度。

### Fixed
- **修复 Cursor 忽略 HTTP 代理与无超时保护问题**：全面改用 `fetchWithProxy`，继承用户设置的 `httpProxy` 并增加 12s 超时防挂起。
- **实现 Codex (ChatGPT) Token 401 静默自动续期**：检测到 HTTP 401 鉴权失效时，自动使用本地 `refresh_token` 换取新令牌并原子更新 `auth.json` 与配置，避免频繁提示重新登录。
- **根治 Claude / GLM / MiniMax 的虚假正常状态 (False Positive)**：接入轻量模型列表或状态探测，杜绝未填有效 Key 时显示虚假绿灯。
- **落地 Custom API balancePath 自定义路径与多级降级探测**：打通 `balancePath`，并按顺序自动降级支持 OneAPI `/v1/dashboard/billing/subscription`、NewAPI `/api/user/self` 及 `/v1/models`。
- **解决后台定时轮询冲掉用户输入与光标丢失缺陷**：在 `update()` 中加入打开状态的模态保护，正在配置抽屉或弹窗时跳过全量 DOM 覆写。
- **存储原子写盘防 0 字节损坏**：实现 `atomicWriteJsonSync`（经 `.tmp` 文件写入后通过操作系统的 `renameSync` 原子重命名替换），彻底规避断电或崩溃时配置文件损坏的隐患；并在 Node.js 进程退出前自动刷新落盘用量历史。

## [0.2.4] - 2026-09-08

### Changed
- **界面优化**：去除「一键全部测活」按钮中的“⚡”表情符号，保持视觉素雅克制。
- **平台凭据选择重构**：平台凭据配置改为下拉平台选择器，选中对应平台后按需加载表单，避免长列表滚动负担。
- **独立保存与删除确认**：各个平台支持独立的保存配置按钮，点击后提供即时 Toast 反馈；删除凭据时提供二次确认模态对话框 (Modal)，防止误删。
- **看板、悬浮球与服务凭据深度联动**：
  - 仅已配置有效凭据/API Key 的平台及自定义中转站才会加入「服务展示与排序」列表；
  - 列表为每个服务配备「看板」与「悬浮球」两个独立勾选框，分别控制在概览面板与桌面 HUD 轮播中的展示；
  - 移除了冗余的列表表头行（“已配置凭据服务 / 展示位置 / 排序”），并去除旧式的显式 `↑` / `↓` 排序按钮，支持直接点击卡片按住拖动（Drag & Drop）进行直观平滑排序。
- **配置持久化安全增强**：优化配置写入机制，局部保存与全局设置保存互不干扰，确保未在 DOM 中的平台 Key 不被意外覆盖清空。

## [0.2.3] - 2026-09-04

### Fixed
- **适配 DSH 最新版本 (0.1.2-rc.1+) 客户端模块加载机制**：
  - 修复 `cordis.patch.yml` 中包声明名称与 `package.json` 中的 `@francescoli/dsh-quota` 匹配，解决 `dsh-client-modules` 的 `nearestPackage` / `resolveMeta` 校验失败导致客户端 Bundle 未注入 `window.__DSH_BOOT__` 的关键缺陷；
  - 移除 `package.json` 及 `src/client/index.ts` 中多余的客户端服务注入声明（`sessions`, `workspaces` 等未导出服务），防止 `assertEntriesActive` 启动门禁阻塞；
  - 客户端 Bundle (`bundle-client.mjs`) 双向注册 `@francescoli/dsh-quota` 与 `dsh-quota` 模块工厂，确保模块系统在不同引入路径下均能即时实例化；
  - 规范化 Agent Tool `get_quota_status` 注册契约，无缝兼容 `@deepseek-ai/dsh-tools` 的 `ctx.tools.register`（支持 `output { schema, render }` 标准结构），同时向下兼容旧版 `ctx.agent.registerTool`。

### Added
- **Sparkline 7 天自适应趋势折线图**：重构并增强纯 SVG 趋势图渲染，支持初次启动无历史时的自适应平滑基准线与真实 7 天时序采样混合渲染，确保任意时刻即时呈现高清晰折线图。
- **全平台多账号与中转站动态管理**：前端设置页提供完整的多账号与 OneAPI / NewAPI 自定义中转站端点增删与可视化配置。
- **一键全部测活与并发延迟探测**：支持并发对 14+ 家大模型平台与自定义中转站一键测活并输出毫秒级响应耗时。
- **低额度告警滑块与 HTML5 桌面通知**：支持 5% ~ 50% 动态调节阈值，并在额度危急或服务异常时触发系统级桌面通知。
- **DSH Agent 智能模型路由决策**：`get_quota_status` 工具增强实时健康度评估与长长程任务前置模型路由推荐。

## [0.2.1] - 2026-08-26

### Added
- **纯 SVG 7 天消耗趋势折线图 (Sparkline)**：在每个配额卡片右侧集成轻量纯原生 SVG 趋势图，实时呈现 7 天波动曲线。
- **一键全部测活 (Test All)**：在设置页提供「⚡ 一键全部测活」按钮，并发对所有配置的服务发起连通性检测与毫秒级延迟测速。
- **低额度告警阈值调节滑块**：支持在设置页自由拖动 5% ~ 50% 告警阈值，并支持开启/关闭系统级 HTML5 桌面通知。
- **多账号与自定义中转站面板**：
  - 前端提供可视化「+ 添加中转站端点」面板，支持管理多个 OneAPI / NewAPI 端点；
  - 架构全面支持多账号增删与独立卡片调度。
- **HTML5 桌面通知 (Web Notification)**：在服务额度跌破阈值或请求异常时触发系统级桌面通知。
- **模型深度探测与 Agent 智能路由建议**：
  - 增强阿里通义千问 (DashScope) 与火山方舟 (Ark) 推理接入点与全系模型连通性探测；
  - Agent Tool `get_quota_status` 升级支持智能模型路由推荐 (`recommendation`)，在长任务前自动预检主力模型健康度并给出降级路线。
- **配额标签规范化**：去除 Weekly Limit 和 5-Hour Limit 中的中文后缀，统一使用标准英文命名。

## [0.2.0] - 2026-08-26

### Added
- **Provider 矩阵全面扩充**：
  - 新增 **DeepSeek 官方 API**（账户充值余额、赠送金与可用状态实时查询）；
  - 新增 **GitHub Copilot**（免密自动探测本地 VS Code Copilot 登录态与订阅状态）；
  - 新增 **OpenAI Platform (API)** 官方账单与总限额监控；
  - 新增 **Anthropic Claude** 控制台与 API 连通性监控；
  - 新增国内主流大模型：**Moonshot Kimi**（余额与代金券）、**智谱清言 (GLM)**、**MiniMax (海螺)**、**阿里通义千问 (百炼)**、**字节火山方舟 (豆包)**；
  - 新增通用 **OneAPI / NewAPI / OpenAI 兼容接口** 自定义中转监控。
- **时序采样与消耗速率 (Burn Rate) 统计**：
  - 本地持久化 30 天时序历史记录 (`~/.dsh/quota-history.json`)；
  - 自动计算近 24 小时平均消耗速率 (%/h) 并估算剩余可用时长。
- **告警系统与侧边栏 Badge 联动**：
  - 多级阈值检测（≤15% 预警、≤5% 严重报警、凭据失效检测）；
  - 侧边栏「额度监控」入口增加动态呼吸微光小红点 Badge。
- **DSH Agent 深度协同 Tool**：
  - 注册 `get_quota_status` Agent Tool，支持在对话中直接让 AI 查额度与获取模型可用状态。
- **UI / UX 视觉与交互重塑**：
  - 看板头部增加 4 宫格全局概览卡片（总服务、正常数、告警数、刷新周期）；
  - 增加服务分类快速筛选 Tab（全部 / IDE助手 / 国内大模型 / 海外官方 / 自定义中转）；
  - 多模型窗口支持分组折叠 (Accordion)；
  - 设置页面为所有 Provider 提供「测试连接」即时测活与毫秒级延迟反馈；
  - HUD 悬浮环支持悬停暂停轮播、数字平滑过渡、视口碰撞防溢出自动翻转与贴边微缩模式。
- **架构加固与跨平台兼容**：
  - 彻底清除个人调试绝对路径，增加通用跨平台路径解析器 (`src/core/paths.ts`)；
  - 增加 Node.js SQLite 动态加载降级保护，避免老版本环境启动报错；
  - 重构独立 Provider TTL 缓存池，避免单个慢接口阻塞全局刷新。

## [0.1.0] - 2026-08-26

### Added
- **Cursor 额度自动探测**：自动定位并免密读取本地 Cursor SQLite 数据库凭据 (`state.vscdb`)，实时监控 Fast Requests 剩余次数与重置周期。
- **Codex / OpenAI 消费与限额统计**：支持官方 OpenAI API 及主流第三方聚合分发服务（NewAPI / OneAPI），统计当月消费额度与总上限。
- **Google Antigravity 额度监控**：实时获取 Antigravity Pro 配额剩余及已用 Tokens 用量。
- **OpenCode-Go 算力监控**：支持 OpenCode 订阅算力额度监控与周期重置倒计时。
- **DSH 侧边栏看板**：深度融入 DeepSeek Harness Web GUI 侧边栏「额度监控」入口，提供直观卡片式看板。
- **HUD 状态栏监控浮窗**：支持自定义 HUD 指标选择、常驻/轮播展示与悬停详细指标展开。
- **宋代青绿雅致配色**：状态配色采用宋代传统矿物色彩体系（天青、松石绿、柳黄、黛蓝、朱砂），提升视觉体验。
- **环形进度圈与统一倒计时**：全平台额度统一使用环形进度百分比展示与跨端标准化重置倒计时。
- **安全配置与防风控缓存**：配置保存于本地 `~/.dsh/quota-config.json`（权限 `0600`），内置内存级智能缓存防止高频触发上游风控。
- **Scoped npm 包标准**：采用 `@francescoli/dsh-quota` 规范化命名空间，支持公开发布至 npm 官方源与 CDN 加速。
- **版本规范与自动化发布**：建立完整的 SemVer 规范、发布前门禁校验脚本与 GitHub Actions 自动 Release 流水线。
