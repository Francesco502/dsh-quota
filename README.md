# @francescoli/dsh-quota: DSH AI 额度与用量监控插件

[![version](https://img.shields.io/badge/version-v0.3.0-blue.svg)](./package.json)
[![npm](https://img.shields.io/badge/npm-@francescoli/dsh--quota-CB3837.svg)](https://www.npmjs.com/package/@francescoli/dsh-quota)
[![license](https://img.shields.io/badge/license-Apache--2.0-green.svg)](./LICENSE)

> 当前版本：**v0.3.0**

专门为 **DeepSeek Harness (DSH)** 打造的全功能 AI 服务额度、余额与用量监控插件。集中监控并展示 **DeepSeek 官方平台**、**Cursor**、**Codex (ChatGPT)**、**Google Antigravity**、**GitHub Copilot**、**OpenAI Platform**、**Anthropic Claude**、**Kimi**、**智谱 GLM**、**MiniMax**、**阿里通义千问**、**火山方舟**、**OpenCode-Go** 及 **OneAPI / NewAPI** 兼容中转的实时剩余额度、用量、充值余额、消耗速率及重置周期。

---

## ✨ 核心特性

1. **16+ 家服务全聚合**：
   - **国内大模型**：DeepSeek（充值/赠金实时查询）、硅基流动 SiliconFlow（实时余额与充值金）、Kimi（代金券/余额）、智谱 GLM、MiniMax（海螺）、通义千问（百炼）、火山方舟（豆包）；
   - **IDE 编程助手**：Cursor（免密读取 SQLite `state.vscdb`）、Google Antigravity（CloudCode 配额）、GitHub Copilot（本地凭据探测）；
   - **海外官方与聚合**：OpenRouter（全局配额/用量）、Codex (ChatGPT Wham)、OpenAI Platform Billing、Anthropic Claude、OpenCode-Go、OneAPI / NewAPI 中转。
2. **直观数据看板与 HUD 悬浮环**：
   - **概览看板**：顶部 4 宫格总览、分类筛选 Tab、多模型分组折叠 (Accordion) 与宋代青绿雅致配色；
   - **HUD 悬浮环**：支持鼠标悬停暂停轮播、数字平滑过渡、视口边界防溢出自动翻转、贴边微缩模式；
   - **设置与测活**：为所有 Provider 提供一键「测试连接」与毫秒级延迟反馈。
3. **时序统计与智能预警**：
   - 本地 30 天时序历史采样记录；
   - 自动计算近 24 小时平均消耗速率 (%/h) 与预估可用剩余时长；
   - 多级阈值告警与侧边栏「额度监控」动态小红点 Badge 联动。
4. **DSH Agent 深度协同**：
   - 注册 `get_quota_status` Agent Tool，支持在对话中直接让 AI 查额度与获取模型可用状态。
5. **安全与性能加固**：
   - 独立 Provider TTL 缓存池，单服务网络超时不阻塞全局；
   - 配置文件严格保存在本地 `~/.dsh/quota-config.json`（权限 `0600`）；
   - 彻底支持跨平台路径解析与 Node.js SQLite 优雅降级。

---

## 📦 安装方法

### 方式一：通过 DSH 插件市场 (dsh-market) 一键安装（推荐）

1. 打开 DSH Web 界面 (`http://127.0.0.1:3080`)；
2. 进入 **设置 (Settings)** → **插件市场 (Plugin Market)**；
3. 搜索 `dsh-quota` 并点击 **安装 (Install)**；
4. 刷新网页即可在侧边栏看到「额度监控」入口。

### 方式二：通过 DSH CLI (npm Scoped 模式) 安装

```bash
dsh plugin --profile web add @francescoli/dsh-quota
```

### 方式三：通过 GitHub 源码链接安装

```bash
dsh plugin --profile web add github:Francesco502/dsh-quota
```

---

## 🛠️ 构建与发布验证

```bash
npm run build
npm test
pwsh -File .github/scripts/validate-release.ps1 -Tag v0.2.0
```

---

## 📚 详细文档

- [系统架构与实现原理](./docs/ARCHITECTURE.md)
- [新 Provider 扩展接入指南](./docs/PROVIDERS.md)
- [常见问题与解答 (FAQ)](./docs/FAQ.md)
- [版本管理与发布标准规范](./VERSIONING.md)
- [版本更新日志](./CHANGELOG.md)

---

## 📄 开源协议

[Apache-2.0](./LICENSE)
