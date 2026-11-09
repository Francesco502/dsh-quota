# @francescoli/dsh-quota: DSH AI 额度与用量监控插件

[![version](https://img.shields.io/badge/version-v0.4.4-blue.svg)](./package.json)
[![npm](https://img.shields.io/badge/npm-@francescoli/dsh--quota-CB3837.svg)](https://www.npmjs.com/package/@francescoli/dsh-quota)
[![license](https://img.shields.io/badge/license-Apache--2.0-green.svg)](./LICENSE)

> 当前版本：**v0.4.4**

专门为 **DeepSeek Harness (DSH)** 打造的全功能 AI 服务额度、余额与用量监控插件。集中监控并展示 **DeepSeek 官方平台**、**Cursor**、**Codex (ChatGPT)**、**Google Antigravity**、**GitHub Copilot**、**OpenAI Platform**、**Anthropic Claude**、**Kimi**、**智谱 GLM**、**MiniMax**、**阿里通义千问**、**火山方舟**、**OpenCode-Go** 及 **OneAPI / NewAPI** 兼容中转的实时剩余额度、用量、充值余额、消耗速率及重置周期。

---

## ✨ 核心特性

1. **16+ 家服务全聚合**：
   - **国内大模型**：DeepSeek（充值/赠金实时查询）、硅基流动 SiliconFlow（实时余额与充值金）、Kimi（代金券/余额）、智谱 GLM、MiniMax（海螺）、通义千问（百炼）、火山方舟（豆包）；
   - **IDE 编程助手**：Cursor（免密读取 SQLite `state.vscdb`）、Google Antigravity（CloudCode 配额）、GitHub Copilot（本地凭据探测）；
   - **海外官方与聚合**：OpenRouter（全局配额/用量）、Codex (ChatGPT Wham)、OpenAI Platform Billing、Anthropic Claude、OpenCode-Go、OneAPI / NewAPI 中转。
2. **直观数据看板与 HUD 悬浮环**：
   - **概览看板**：顶部 4 宫格总览、分类筛选 Tab、多模型分组折叠 (Accordion) 与宋代青绿雅致配色；
   - **HUD 悬浮环**：与监控面板同一套语义配色（品牌色圆环 + 中性轨道），状态色只用于小圆点与文字强调；字号随球径（46px / 贴边 38px 微缩）自适应，长金额自动缩写，悬停可展开明细与暂停轮播；
   - **设置与测活**：为所有 Provider 提供一键「测试连接」与毫秒级延迟反馈。
3. **时序统计与智能预警**：
   - 本地 30 天时序历史采样记录（append-only JSONL，写入不阻塞请求）；
   - 自动计算近 24 小时平均消耗速率 (%/h) 与预估可用剩余时长；
   - 多级阈值告警与侧边栏「额度监控」动态小红点 Badge 联动。
4. **DSH Agent 深度协同**：
   - 注册 `get_quota_status` Agent Tool，支持在对话中直接让 AI 查额度与获取模型可用状态。
5. **安全与性能加固**：
   - 插件 API 统一守卫（`X-DSH-Quota` 头 + 回环 Host + 同源 Origin + 写入仅 JSON），阻断跨站改写配置；
   - 用户自填的 `baseUrl` 经安全校验（拒绝非 http(s)、云元数据与链路本地地址，允许本机/内网中转）；
   - 独立 Provider TTL 缓存池 + 整轮/实例双层 single-flight，单服务网络超时不阻塞全局；
   - 配置文件保存在本地 `~/.dsh/quota-config.json`，密钥拆分到 `quota-secrets.json`（均 `0600`）；
   - 历史数据写入 append-only `~/.dsh/quota-history.jsonl`，30 天/单 key 2000 点自动裁剪与每日 compaction。
6. **原生 UI 与国际化**：
   - 通过宿主官方 slots 注册一级导航「额度监控」（`sidebar.panellist` + `main` 面板），与搜索/插件/自动化任务同级；`ctx.layout.selectPanel` 负责选中，dsh-claude-style 的「编辑侧栏…」可直接勾选显隐；旧宿主自动回退 DOM 入口与覆盖层；
   - 响应式布局（1024/720/480 断点）、深浅色主题令牌、32px 圆心百分比、7 天用量柱、数据来源徽标与窄屏卡片化设置表；
   - 壳层文案支持中英切换（`dsh-quota` locale 命名空间）。

---

## 🆕 v0.4.4 更新要点

- **一级导航「额度监控」**：新增根作用域 `sidebar.panellist` 入口与同名 `main` 主面板，和搜索/插件/自动化任务同级；`ctx.layout.selectPanel('quota')` 负责选中，底部快捷入口与 HUD 的「打开面板」也走同一条路径。旧宿主没有 slots/layout 时仍回退到覆盖层与 DOM 入口。
- **侧栏显隐联动**：dsh-claude-style 的「更多 → 编辑侧栏…」会自动枚举该入口，可勾选显示/隐藏，并沿用其 `sidebarHidden` 设置。
- **面板版本号修正**：标题版本标签不再硬编码，改为读取 `PLUGIN_VERSION`，本次界面显示 `v0.4.4`。
- **HUD 配色回归面板语义色**：圆环改为品牌色（`--q-brand`）+ 中性轨道（`--q-track`），不再整环绿/黄/红；状态色只保留在 5px 告警点与卡片内文字，深浅色分别校准。
- **HUD 文字自适应**：字号按球径 `clamp()` 缩放（46px / 贴边 38px 微缩），长金额缩写成 `K/M/B` 或省略号；`0%`、`100%`、`123%`、`9.99GB`、中英混排与深色主题下均不溢出。
- **面板滚动与高度**：新增 `data-dsh-quota-mode="panel|overlay"` 区分渲染模式，主面板使用 `height:100%; overflow-y:auto`，不再依赖 `panelOpen` 状态。

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

### 桌面版（Desktop）安装

桌面版使用**独立的 Desktop profile**，且 npm 版 CLI 会拒绝管理它（`profile "desktop" is managed exclusively by the Electron application`）。正确步骤：

1. 安装并**启动一次** DeepSeek Harness Desktop，让它初始化 `$DSH_HOME/profiles/desktop`，然后**完全退出**应用；
2. 用 **Desktop 自带的命令运行时**（不是 Homebrew / npm 安装的 `dsh`）执行：
   ```bash
   dsh plugin --profile desktop add @francescoli/dsh-quota@0.4.4
   ```
3. 重新打开 Desktop。

> 桌面版与 Web 版共享 `$DSH_HOME` 下的数据文件（配置、历史），但不共享插件安装目录；两端升级需要各自执行一次。

---

## 🛠️ 构建与发布验证

```bash
npm ci
npm run typecheck    # tsc --noEmit（host 类型走 types/dsh-shims.d.ts）
npm run build        # esbuild 产出 lib/index.js + lib/client.js（含 source map）
npm test             # 类型检查 + legacy 套件 + node:test 全量用例
npm run validate:release -- --tag v0.4.4
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
