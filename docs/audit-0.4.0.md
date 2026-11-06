# dsh-quota 0.4.0 审计、修复与版本规划

> 日期：2026-11-06 ｜ 对象：`@francescoli/dsh-quota` v0.4.0（npm 已发布）+ 仓库 HEAD `c7723f0`
> 环境：DSH CLI 0.2.2-rc.1（`/opt/homebrew/lib/node_modules/@deepseek-ai/dsh`）、macOS arm64、Web profile `~/.dsh/profiles/web`
> 方法：源码审计（3 条并行线）+ 线上只读取证 + `node:vm` 行为复现。完整分报告见 `docs/audit/{core,client,providers}.md`。

---

## 0. 一句话结论

**0.4.0 的「升级即报错」根因已修复在 `c7723f0`，但修复还停在本地、npm 上仍是坏产物**；同时审计发现三类更值得先处理的真问题——**数据真实性**（部分 provider 恒 100%、部分假 0%）、**持久化写放大**（1.9 GB/天起，30 天后约 18.7 GB/天）、**插件 API 零鉴权**（本机 CSRF → 改代理 → 密钥经攻击者代理外泄）。

建议节奏：**今天发 0.4.1（只含客户端修复 + 回归测试 + CI 门禁）→ 0.5.0 集中修安全与数据真实性 → 0.6.0 换构建栈并迁移官方 slots**。不要把 provider 行为改动塞进 0.4.1。

---

## 1. 现状核对（先对齐事实）

| 对象 | 实测状态 | 证据 |
|---|---|---|
| 仓库 HEAD `c7723f0` | IIFE 修复已提交，工作树干净，`node tests/run.mjs` 全绿，`node bundle-client.mjs` 可复现（无 diff） | `git show --stat c7723f0`、本地构建 |
| npm `0.4.0` | **仍是坏产物**：`lib/client.js` 首行 `const factory = ...`，尾部注册 2 个 id；sha256 `42cc51a4…88d3` | `npm pack` 产物 + pnpm store 副本，与仓库内 `francescoli-dsh-quota-0.4.0.tgz` 一致 |
| 行为复现 | 旧产物二次执行 → `SyntaxError: Identifier 'factory' has already been declared`；新版二次执行 OK 且只注册 1 个 id `@francescoli/dsh-quota` | `node:vm` 模拟 classic script（持久全局词法环境） |
| 本机 Web 安装 | 已是打好补丁的 IIFE 产物（176,427 B），运行正常 | `~/.dsh/profiles/web/node_modules/@francescoli/dsh-quota/lib/client.js` |
| 运行时 API | `status` 命中缓存 0.6–1.1 ms / 11.1 KB；`?force=true` 0.9–2.2 s；`history` 7 天 112 KB | curl 实测 |
| 数据文件 | `quota-history.json` 2,621,512 B / 10,780 点 / 15 key / 4 天 | 只读解析 `~/.dsh` |
| desktop profile | **未安装**（无 `/Applications` 应用、无 `profiles/desktop`）；npm CLI 会拒绝管理该 profile | `bin.js`：`rejectElectronProfile`；`plugin-*.js`：`if (!manageDesktopProfile) rejectElectronProfile(...)` |

**关键机制（决定 0.4.1 的优先级）**：宿主把一批插件拼成**一个 classic script**（`dsh-client-modules/lib/index.js:397`），所以单个插件语法错误会**整批不注册**，再逐包回退重取——表现为启动变慢 + 一排 `loaded without registering`。这就是 0.4.0 事故的真实爆炸半径，也是"必须尽快发 0.4.1"的原因。

---

## 2. 问题清单（合并三份审计，按优先级）

### P0：不修会持续造成用户可见错误或安全事故

| # | 问题 | 位置 | 后果 | 归属版本 |
|---|---|---|---|---|
| P0-1 | npm 0.4.0 客户端 bundle 缺陷未发布修复 | `lib/client.js`（发布产物） | 任何二次执行场景（HMR/重复 script/升级）整批插件失败；desktop 装 0.4.0 后升级同样中招 | **0.4.1** |
| P0-2 | 修复无回归测试；CI 不跑测试，`validate-release.ps1` 只检查 `client.js` 非空 | `tests/run.mjs`、`.github/workflows/release.yml:33/37/42`、`.github/scripts/validate-release.ps1:48-56` | 同类事故可原样再发一次；21 条 `clientBundle.includes(...)` 字符串断言对坏产物同样通过 | **0.4.1** |
| P0-3 | `openai_billing` 恒 100%：`totalUsage` 声明后从未赋值 | `src/providers/openai-billing.ts:92,101,116` | 无论用多少都显示"剩余 100%"，余额上报也是假的 | 0.5.0 |
| P0-4 | `custom_api` 恒 100%：OneAPI 分支把分母设成剩余额；0 余额被 `remainingBal \|\| …` 回退成全额 | `src/providers/custom-api.ts:121-126,139,156` | 中转站额度显示完全失真，0 余额显示 100% | 0.5.0 |
| P0-5 | 插件 API **零鉴权**，且 `text/plain` + JSON body 可绕过 preflight | `src/routes.ts:9-233`；实测 `POST /test-connection` 接受 text/plain | 任意网页可 CSRF：触发全量刷新；改写配置（含 `httpProxy`）→ 后续 provider 请求携带真实 Key 经过攻击者代理 | 0.5.0 |
| P0-6 | `POST /test-connection` 的 `custom_api` 用请求体里的 `baseUrl` 直接发请求 | `src/routes.ts:36-70`、`src/providers/custom-api.ts:12,31,83-92` | 盲 SSRF：内网扫描、云元数据读取，错误/延迟回显可做 oracle | 0.5.0 |

> 说明：P0-5/6 的实际可利用性取决于浏览器 Private Network Access 策略与用户是否访问恶意页面，但"零鉴权 + 可改写代理"这条链不需要读取任何响应即可完成，属于必须修的面。

### P1：0.5.0 必须处理（挑重点，全量见分报告）

**数据真实性**
- 6 家只做连通性检查却硬编码 100%（GLM/MiniMax/Qwen/Volcengine/Copilot/Claude），前端还改写成「已用 0% · 额度充足」（`glm.ts:104-111` 等；`view.ts:197-201`）。
- antigravity `remainingFraction:null → Number(null)=0` 且置 `exhausted`（`antigravity.ts:355-364`），前端 unknown 也按 0% 红环渲染（`view.ts:1758`）。
- codex/cursor/opencode-go 缺字段一律 `?? 0` → 「未知」显示成满额（`codex.ts:270`、`cursor.ts:157-159`、`opencode-go.ts:114`）。
- 余额类 provider 用金额阈值编造百分比（`kimi.ts:99`、`siliconflow.ts:115`、`deepseek.ts:138`），污染 HUD、Agent 摘要（`manager.ts:884-889`）与 burn rate（`manager.ts:626`）——违反 `types.ts:24` 契约。
- **11/16 provider 未透传 `config.proxyMode`**：用户选 `proxy-required` 仍被静默直连（`cursor.ts:96`、`glm.ts:32,83`、`kimi.ts:32,87` 等）。

**持久化与性能**
- `2000 点/key` 上限是死代码：裁剪只按 30 天 cutoff，近期点过滤后仍 >2000（`history.ts:76-79`）。30 天 15 key ≈ 10.9 万点 ≈ 26 MB。
- 每 2 分钟**全量同步重写**（不论有无新点），`JSON.stringify(..., null, 2)` 二空格缩进（`history.ts:146-148`、`paths.ts:75`）：当前 ≈ 1.87 GB/天，稳态 ≈ 18.7 GB/天，且发生在请求路径上。
- history 解析失败 `catch {}` 吞掉 → 下次 save 用空数据覆盖 2.6 MB 历史（`history.ts:29-44`）。
- 无 single-flight：并发 `?force=true` = N 轮全量扇出（`manager.ts:601-653`）；无 AbortSignal 下传；`void manager.getQuotaCards(true)` 无 catch（`routes.ts:146,173,199`）→ unhandled rejection 可终止宿主。
- 客户端 10 处 `fetch` 无超时（`api.ts:218…292`）；静默轮询失败被吞、`state.error/lastUpdated/stale` 是死字段（`controller.ts:293-299`，`view.ts` 0 处渲染）。

**客户端正确性/安全**
- **单卡刷新绕过转义边界**：全量刷新走 `escapeCardText`，`refreshSingle` 不走（`controller.ts:312-317`），远端 `name/account/error/group.title` 直达 `innerHTML`（`view.ts:1745/1780/1803/1838`、`hud.ts:491`）。
- `api.ts:232 return data` 兜底：服务端 provider 找不到时返回 `{ok:true}`，整个对象被当卡片塞进数组 → `card.groups.map` TypeError → `emit()` 无 try/catch → 面板卡死且每次复现。
- 每次 emit `container.innerHTML = ...` 全量重建（`view.ts:2205`），容器自身是滚动容器（`view.ts:617`）→ 60s 轮询把用户正在输入的表单打回服务端值、把列表滚回顶部。
- 两个 body 级 `subtree:true` MutationObserver（`mount.ts:35-36`、`sidebar-entry-core.ts:101-110`），随聊天流式输出每批触发。

**发布/版本工程**
- 版本号 6 处硬编码（`package.json`、`src/index.ts:13`、`src/core/types.ts:6`、`src/client/index.ts:12`、`view.ts:2210`、README badge），违背 VERSIONING.md「唯一版本来源」。
- `cordis.patch.yml` 头注释仍写 `v0.3.1`。
- release 门禁依赖 `pwsh`（本机无）；npm 发布手工 2FA、无 provenance、CI 不发布。

### P2：随版本清理（全量见分报告）
- 构建管线是正则拼接（`bundle-client.mjs:22/24`、`bundle-host.mjs`），`export default`/`export {a,b}`/副作用 import 全部漏网且构建期零校验。
- 无 sourcemap（宿主**支持**并会合成 combo map，`dsh-client-modules/lib/index.js:329-441`，而 `stripTypeScriptTypes` 实测保留行列 → 现有管线即可零依赖出精确 map）。
- UI 靠 `[class*="centerCol"]`/`[class*="sessionRow"]` 等 CSS Module 类名注入 + 全局 `!important` 隐藏对话区，跨插件用 `data-dsh-taskboard-active` 属性耦合。
- 文档系统性脱节：`docs/PROVIDERS.md` 描述的 `fetchQuota/ProviderQuotaResult/status:'warning'` 在代码中不存在；FAQ 的 Codex `baseUrl` 不存在；README 把 6 家连通性检查写成「实时剩余额度」。
- 16/16 provider 解析分支零测试；`test-run.ts` 是死文件；无 tsconfig、无 lint。
- Codex OAuth 无备份重写 `~/.codex/auth.json`（`manager.ts:518-536`）；OAuth token 刷新只改内存不落盘；Codex 回调固定 1455 但可能绑 1456/随机端口（`oauth.ts:119` vs `:214`）。

---

## 3. 修复方案（三批，带验收标准）

### Batch A → `0.4.1`（hotfix，今天，约 2–3 小时）

1. **版本统一**：`package.json` → `0.4.1`；`src/index.ts:13`、`src/core/types.ts:6`、`src/client/index.ts:12`、`view.ts:2210`、README badge 同步；`cordis.patch.yml` 注释改为 v0.4.1。
2. **回归测试**（新增 `tests/client-bundle.test.mjs`，约 40 行，零依赖）：
   - `node:vm` 建持久上下文 + `window.__ModuleLoader__` 桩（重复 id 抛 `duplicate factory registration`）；
   - 断言：执行不抛、`load()` 恰好 1 次、`id === '@francescoli/dsh-quota'`、**二次执行不抛且不重复注册**、`factory` 物化后 `exports.apply/inject/VERSION` 齐全。
3. **构建闸门**（`bundle-client.mjs` 末尾，3 条断言）：`new vm.Script(bundle)` 语法校验；IIFE 外无 `const/let/var/function` 裸声明；`__ModuleLoader__.load(` 恰好 1 次且 id 等于包名。
4. **CI 门禁**（`.github/workflows/release.yml`）：`Build bundles` 后加 `npm test`；加 `npm run build && git diff --exit-code lib/`（防源码/产物漂移）。
5. **CHANGELOG**：`## [0.4.1] - 2026-11-06`（Fixed：客户端 bundle IIFE + 单 id；Added：回归测试与 CI 门禁）。
6. **发布**：`npm run build` → commit → `git tag -a v0.4.1` → push → CI 出 Release → `npm publish --access public`（2FA）。

**验收**：
- `npm view @francescoli/dsh-quota version` = 0.4.1；
- 下载 tarball，`lib/client.js` 首行为 `(function () {`，尾部只有 1 处 `__ModuleLoader__.load`；
- vm 双执行测试通过；
- 本机重装后强刷页面，设置页无同步失败。

### Batch B → `0.5.0`（1–2 周）：安全 + 数据可信 + 性能

**安全（先做，独立可验证）**
- `makeQuotaRoutes` 前置统一守卫：校验 `Origin`/`Host`，强制 `Content-Type: application/json`（触发 preflight）+ 自定义头（如 `X-DSH-Quota: 1`）；DSH 若提供会话 token 优先复用。无凭证一律 401。
- `custom_api` URL 白名单：仅 http/https；拒绝回环/私网/link-local/169.254/metadata；DNS 解析后按 IP 再校验（防 rebinding）；`balancePath` 禁 `..`。
- `restoreMaskedSecrets` 收口：`baseUrl`/`httpProxy` 变更时清空并要求重填；`getSafeConfig.keyProps` 与 `SECRET_STRING_KEYS` 合并（修 `sessionKey` 明文）；掩码不再回显真实字符。

**数据真实性**
- `types.ts` 增加 `quotaKind: 'usage' | 'balance' | 'liveness' | 'unknown'`；`unknown` 不产出百分比，前端渲染「—」。
- 修 P0-3/P0-4；6 家 liveness 改为 liveness 卡片，不显示「额度充足」；余额类不再编造百分比，HUD/Agent 改读 `amountText`/`balance`。
- 统一状态判定表：error 只留给 401/403/网络；零余额 → warn/exhausted。

**性能与持久化**
- history：先修真裁剪（`splice`）+ dirty 标记 + debounce ≥10 min + 紧凑 JSON（体积 ×0.5、写量 ÷5）；0.5.x 换 append-only JSONL（按天分片 + 每日 compaction）；损坏文件先 `rename` 隔离 + 保留 `.bak`。
- single-flight：同实例刷新合并；`force` 限流（≥10 s 一次）；`AbortSignal` 透传 + `req.on('close')` 取消；失败指数退避。
- `void getQuotaCards()` 全部加 catch；`/status` 改 stale-while-revalidate；`/history` clamp `days` + 降采样 + gzip。
- 多进程一致性：写前比对 mtime/size，或直接走 JSONL 追加。

**工程**
- provider fixture 测试（16 家 × 正常/字段缺失/401/429/零余额），用可注入 fetch；`npm test` 跑 `node --test`；删 `test-run.ts`。
- `tsconfig.json` + `tsc --noEmit` 进 CI（至少覆盖 `src/core`、`src/providers`）。
- 客户端：`refreshSingle` 补 `escapeCardText`；`emit()` 逐 listener try/catch；fetch 加 `AbortSignal.timeout(8000)`；渲染前保存/恢复 `scrollTop` + 输入焦点保护；头部渲染「最后更新 + 失败横幅」；`document.hidden` 暂停轮询与 HUD 轮播。

**验收**：`/status` force 并发 5 次只触发 1 轮上游请求；30 天模拟数据下写盘 <100 ms/次且 ≤1 次/10 min；`/config` 无任何明文/半明文密钥；provider fixture 全覆盖；CSRF 探测（无 Origin 的 text/plain POST）返回 401/415。

### Batch C → `0.6.0`（2–4 周）：构建与 UI 现代化

1. **esbuild 替换正则拼接**：`--bundle --format=cjs --platform=browser --target=es2020 --sourcemap=external`，保留 classic script + IIFE + 单 id；产物形状照抄官方插件；**不要 minify**（宿主 combo map 依赖行偏移，且 gzip 后仅 37.9 KB）。
2. **官方 slots 迁移**（必须**先**有打包器）：`sidebar.footer.action`（list，收 `{wide}`）、`sidebar.panellist`（list，收 `{size,active}`）、`sidebar.toggle.badge`（single）。槽位组件是 React 组件，需要 `react` / `react/jsx-runtime`（module table 的 seed word），并通过 `dsh.client.external` 声明。
3. 拆 `view.ts`（3008 行、`update()` 单函数 1320 行）：`style/cards/settings/drawer/update`，事件委托替代 45 处 `addEventListener`。
4. i18n：Cordis 侧 `inject: ['locale']` + `ctx.locale.register/bind`（注意：`dsh.client.inject` 是**信息性包依赖**，与 Cordis 服务注入无关）。
5. `resolveApiBase()`：`globalThis.__DSH_TRANSPORT__?.streamBaseUrl ?? document.baseURI`，为 desktop 预留；`platform` 与宿主协商后再扩。
6. 智能路由改按真实剩余额度打分（当前写死 deepseek 优先，`manager.ts:800-840`）。

---

## 4. `0.4.1` 执行清单（可直接照做）

```bash
cd /tmp/dsh-quota          # HEAD=c7723f0，工作树干净
# 1) 版本号 + CHANGELOG + README badge + cordis.patch.yml 注释
# 2) 新增 tests/client-bundle.test.mjs，并串进 package.json 的 test
# 3) bundle-client.mjs 加 3 条产物断言
# 4) .github/workflows/release.yml 加 npm test + build 一致性检查
npm run build && node tests/run.mjs
git add -A && git commit -m "release: v0.4.1 (client bundle IIFE fix + regression gate)"
git tag -a v0.4.1 -m "Release v0.4.1: fix client bundle re-execution registration failure"
git push origin main && git push origin v0.4.1   # CI 自动出 GitHub Release
npm publish --access public                      # 需 npm 2FA
# 5) 验证
npm view @francescoli/dsh-quota version          # → 0.4.1
```

发布后：`dsh plugin --profile web add @francescoli/dsh-quota@0.4.1` → 强刷页面。

> 注意：0.4.0 的 tag/版本不可变（`VERSIONING.md` §2.3），不要尝试覆盖；`prepack` 已会在发布时重建 bundle，所以只要源码是 HEAD，产物就是修好的。

---

## 5. desktop profile 的正确装法（更正上次说法）

上次说的 `dsh plugin --profile desktop add …` **会被 npm CLI 直接拒绝**：

```js
// bin.js
if (!manageDesktopProfile) rejectElectronProfile(plugin, options.profile)
// → error: profile "desktop" is managed exclusively by the Electron application
```

正确路径：

1. 安装并**启动一次** Desktop 应用（让它初始化 `$DSH_HOME/profiles/desktop`），然后**完全退出**；
2. 用 **Desktop 自带的命令运行时**（不是 Homebrew 的 `dsh`）执行插件安装；
3. 装 **0.4.1**，不要装 0.4.0；
4. 装完先验证两件事：
   - `package.json` 的 `dsh.client.platform: "web"` 是否被 Desktop 载体接受（非 `web` 会被宿主直接跳过，插件**静默消失**）；
   - 客户端硬编码的 `/api/dsh-quota/*` 绝对路径是否与 Desktop 页面 origin / `streamBaseUrl` 一致（不一致会全部 404）。

这两点在 0.6.0 的 `resolveApiBase()` 与 platform 协商之前都属于**未验证风险**，建议先装一次做冒烟，再决定是否向用户推荐 desktop。

---

## 6. 版本路线图

| 版本 | 主题 | 关键交付 | 验收 | 预计 |
|---|---|---|---|---|
| **0.4.1** | 止血 | IIFE 修复 + 回归测试 + CI 门禁 + 版本文本统一 | npm 0.4.1 产物可二次执行、单 id、CI 红灯能拦住同类问题 | 今天 |
| **0.5.0** | 可信 | 路由鉴权/SSRF、provider 数据真实性、history 存储重构、single-flight | 无假 100%/假 0%；写放大 ≤1 GB/天；CSRF 探测被拒 | 1–2 周 |
| **0.6.0** | 现代 | esbuild + sourcemap、官方 slots、i18n、desktop 适配 | DevTools 落到 .ts；侧边栏/面板不依赖 CSS 类名；desktop 冒烟通过 | 2–4 周 |
| **1.0.0** | 稳定 | 契约冻结、`engines.dsh`、文档重写 | PROVIDERS.md 与代码一致；semver 稳定 | 视 0.6 反馈 |

---

## 7. 明确不建议做的事

- **不要把 provider 行为改动塞进 0.4.1**：hotfix 的价值是可预测，行为变更需要 fixture 测试兜底，放 0.5.0。
- **不要 minify 客户端 bundle**：宿主 combo sourcemap 依赖行数偏移，且 gzip 后仅 37.9 KB，收益不抵调试成本。
- **不要先迁 slots 再换打包器**：槽位是 React 组件，需要真实 `require('react')`，当前正则删 import 的构建物理上做不到。
- **不要覆盖 0.4.0**：tag/版本不可变，只能 0.4.1。
- **不要在没有回归测试的情况下再改打包脚本**：这次事故的根因就是"构建产物没有契约测试"。

---

## 8. 证据附录

- 分报告：`docs/audit/core.md`（19 条 A + 9 条 B）、`docs/audit/client.md`（25 条 A + 8 条 B）、`docs/audit/providers.md`（32 条 A + 15 条 B + 16 行覆盖矩阵）。
- 产物 sha256：npm 0.4.0 `lib/client.js` = `42cc51a42ee8886487bbcffe31636a6fa1190bf0837e252646951f71f30a88d3`（含 `const factory`）；本机补丁版 = `1b92142e…`（IIFE）。
- 复现脚本：`node:vm` 持久上下文 + 重复 id 抛错的 `__ModuleLoader__` 桩，两次 `runInContext`；旧产物第二次抛 `SyntaxError`，新产物两次均通过且 `loads total: 1`。
- 线上数据：`quota-history.json` 2,621,512 B / 10,780 点 / 15 key；最热 key `codex` 4 天 970 点；243 B/点（含二空格缩进）。
- 路由探测：`GET /status` 无凭证 200；`POST /test-connection` 使用 `Content-Type: text/plain` + JSON body 返回 200 并执行请求（证明无 preflight 也可达）。
