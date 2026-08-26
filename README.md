# @francesco502/dsh-quota: DSH AI 额度与用量监控插件

[![version](https://img.shields.io/badge/version-v0.1.0-blue.svg)](./package.json)
[![npm](https://img.shields.io/badge/npm-@francesco502/dsh--quota-CB3837.svg)](https://www.npmjs.com/package/@francesco502/dsh-quota)
[![license](https://img.shields.io/badge/license-Apache--2.0-green.svg)](./LICENSE)

> 当前版本：**v0.1.0**

专门为 **DeepSeek Harness (DSH)** 开发的 AI 服务额度与用量监控插件。集中展示 **Codex (OpenAI)**、**Cursor**、**Google Antigravity**、**OpenCode-Go** 等 AI 编程工具的实时剩余额度、已用量及重置周期。

---

## ✨ 核心特性

1. **多平台全聚合**：
   - **Cursor**：自动探测本地客户端 SQLite 凭据 (`state.vscdb`)，免密读取 Fast Requests 剩余次数及重置日；
   - **Codex / OpenAI**：支持官方 OpenAI API 或第三方聚合分发格式（NewAPI / OneAPI），统计当月消费与总限额；
   - **Google Antigravity**：实时跟踪 Antigravity Pro 配额与已用 Tokens；
   - **OpenCode-Go**：监控 OpenCode 订阅算力与重置倒计时。
2. **直观前端看板与 HUD 浮窗**：
   - 深度融入 DSH Web GUI 侧边栏与 HUD 状态栏，支持一键呼出/收起；
   - 卡片式进度条与宋代青绿雅致状态指示；
   - 内置前端配置表单，支持随时修改或添加平台凭据与自定义 Base URL。
3. **安全与性能**：
   - 配置文件严格保存在本地 `~/.dsh/quota-config.json`（权限 `0600`）；
   - 内存级智能缓存，防止高频轮询触发各服务提供商的风控。

---

## 📦 安装方法

### 方式一：通过 DSH 插件市场 (dsh-market) 一键安装（推荐）

1. 打开 DSH Web 界面 (`http://127.0.0.1:3080`)；
2. 进入 **设置 (Settings)** → **插件市场 (Plugin Market)**；
3. 搜索 `dsh-quota` 并点击 **安装 (Install)**；
4. 刷新网页即可在侧边栏看到「额度监控」入口。

### 方式二：通过 DSH CLI (npm Scoped 模式) 安装

```bash
dsh plugin --profile web add @francesco502/dsh-quota
```

### 方式三：通过 GitHub 源码链接安装

```bash
dsh plugin --profile web add github:Francesco502/dsh-quota
```

---

## 🛠️ 版本管理与发布标准

本项目遵循严格的语义化版本规范与自动化发布流水线：
- 完整规范标准文档请参见：[VERSIONING.md](./VERSIONING.md)
- 详细版本更新记录请参见：[CHANGELOG.md](./CHANGELOG.md)

### 1. 本地构建与验证

```bash
npm run build
pwsh -File .github/scripts/validate-release.ps1 -Tag v0.1.0
```

### 2. 标准发布步骤简述

1. 更新 `package.json` 中的版本号并在 `CHANGELOG.md` 中归档变更；
2. 运行构建与校验：`npm run build` & `npm run validate:release -- -Tag vX.Y.Z`；
3. 提交代码并创建附注标签：`git commit` & `git tag -a vX.Y.Z -m "Release vX.Y.Z"`；
4. 推送至 GitHub：`git push origin main --tags`；
5. GitHub Actions 将自动构建、打包并发布 GitHub Release 资产。

---

## 📄 开源协议

[Apache-2.0](./LICENSE)
