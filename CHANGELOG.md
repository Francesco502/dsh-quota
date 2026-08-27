# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

## [0.2.2] - 2026-08-26

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
