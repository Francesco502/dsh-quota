# Changelog

All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

## [Unreleased]

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
- **Scoped npm 包标准**：采用 `@francesco502/dsh-quota` 规范化命名空间，支持公开发布至 npm 官方源与 CDN 加速。
- **版本规范与自动化发布**：建立完整的 SemVer 规范、发布前门禁校验脚本与 GitHub Actions 自动 Release 流水线。
