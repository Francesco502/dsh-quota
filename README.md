# @francescoli/dsh-quota: DSH AI 额度与用量监控插件

[![version](https://img.shields.io/badge/version-v0.4.6-blue.svg)](./package.json)
[![npm](https://img.shields.io/badge/npm-@francescoli/dsh--quota-CB3837.svg)](https://www.npmjs.com/package/@francescoli/dsh-quota)
[![license](https://img.shields.io/badge/license-Apache--2.0-green.svg)](./LICENSE)

> 当前版本：**v0.4.6**

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

## 🆕 v0.4.6 更新要点

- **修复中文界面侧栏入口显示英文 `Quota Monitor`**：插件重载时宿主已存在同名 locale 命名空间，重复注册被当成失败后直接回落英文；同时宿主逐键回落的英文结果覆盖了插件自己的中文词典。现在重复注册只记录警告并继续绑定，且宿主活动语言为中文时直接使用插件自带中文词典。以下为 0.4.5 的界面调整。
- **取消侧栏底部「…」浮层里的二级入口**：不再注册 `sidebar.footer.action`。一级导航「额度监控」本身已能直达面板；而在 dsh-claude-style 等把底部动作收进左下角「…」浮层的主题里，旧入口会在浮层里再出现一行「额度监控」，读起来像同一面板的二级菜单。本次移除该入口，只保留一级导航与折叠轨 Badge。
- **悬停明细区分「服务 · 模型」**：明细行仍是单行，改为「服务缩写（`AGY`）· 模型/分组（加粗主色）| 额度类型 | 剩余值」。模型名占据主要宽度，`Gemini Models` 与 `Claude and GPT models` 不再被服务全名挤成省略号；分组标题里重复的服务名会被压掉（`Cursor Plan Usage` → `Plan Usage`）。完整名称仍保留在行 `title` 与读屏文案里。
- **悬浮球标签按「模型 · 窗口」命名**：球内小标签不再固定为服务商缩写；Antigravity 显示 `GEM·周`、`GEM·5h`、`CLD·周`、`CLD·5h`，OpenCode Go 显示 `OPN·5h`、`OPN·周`、`OPN·月`；四位缩写（`FAST`/`AGNT`）本身已能区分窗口，不再追加后缀。标签超宽时缩小字号并以省略号收尾，悬停可看完整名称；读屏文案同步带出模型/分组名。
- **窗口标签说人话**：`5-Hour Rolling Limit` 不再显示为「滚动」，按长度显示 `5h`；请求类/模型类窗口分别显示「请求」「模型」，不再出现含义不明的「量」。
- **明细行的命名规则**：通用分组（`Plan Usage` / `Plan Limits`）改用窗口名 `5h Limits` / `Weekly Limits` / `Monthly Limits`；`Claude and GPT models` 显示为 `Claude/GPT Models`；行内文字已经写明窗口时不再重复显示药丸标签。
- **连通性窗口不再进入轮播**：只有 liveness 的窗口（如 Claude 的「速率余量」）没有额度数字，已从 HUD 明细与轮播中移除；若某个服务只有连通性，悬浮球显示「暂无可展示额度」而不是误报未连接。

<details>
<summary>v0.4.4（历史）</summary>

- 一级导航「额度监控」：`sidebar.panellist` 入口 + 同名 `main` 主面板，`ctx.layout.selectPanel('quota')` 负责选中。
- 侧栏显隐联动：dsh-claude-style 的「更多 → 编辑侧栏…」自动枚举该入口。
- 面板版本号改为读取 `PLUGIN_VERSION`。
- HUD 配色回归面板语义色（品牌色圆环 + 中性轨道），状态色只用于告警点与卡片文字。
- HUD 字号随球径 `clamp()` 缩放，长金额缩写成 `K/M/B`。
- 面板模式改为 `height:100%; overflow-y:auto`，不再依赖 `panelOpen`。

</details>

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
   dsh plugin --profile desktop add @francescoli/dsh-quota@0.4.6
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
npm run validate:release -- --tag v0.4.6
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
