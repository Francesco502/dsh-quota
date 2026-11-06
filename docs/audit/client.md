# client/构建 审计

对象：`@francescoli/dsh-quota` v0.4.0，源码 `/tmp/dsh-quota` @ `c7723f0`（只读，未修改）。
对照宿主：`/opt/homebrew/lib/node_modules/@deepseek-ai/dsh/`（v0.2.2-rc.1）及 `node_modules/@deepseek-ai/*`。
标注约定：**证据** = 代码事实（给出 `文件:行号`）；**〔推断〕** = 基于代码但未实测的结论。

### 0. 已核实的关键前提（本次新增事实）

| # | 事实 | 证据 |
|---|---|---|
| 0.1 | 宿主客户端 bundle 只有 classic script 一条路，**不存在 ESM / `type:module` 分支** | `dsh-client-modules/lib/client.js:581-597` `defaultLoadBundle` 唯一实现：`document.createElement("script")` + `el.src` + load/error；`index.js:1040` 同类 |
| 0.2 | 宿主把**一批插件合成一个 classic script**，批次内任一包语法错误 = 整批不注册 | `dsh-client-modules/lib/index.js:397` `buildComboScript` 用 `;` 拼接 `prepareSource(resource).source`；`client.js:519-536` 逐行 `await this.modules.import(row.id)`，失败按 row 记入 `failures` |
| 0.3 | 未注册时的回退：同 URL 只重试 transport 失败 1 次；"执行过却没注册"的 URL 永不重放，改走单包 URL | `dsh-client-modules/lib/client.js:755-780`（`executedBundleUrls` / `failedBundleUrls` / `arrive()`） |
| 0.4 | 重复注册是硬错误（抛异常） | `dsh-client-modules/lib/client.js:710` `duplicate factory registration for "..." (bundle executed twice without invalidate?)` |
| 0.5 | **`dsh.client.inject` 不是 Cordis 服务注入**，只是包依赖边界的声明 | `dsh-package-manifest/lib/types/types.d.ts:81-84`：`/** Informational package-name dependencies, not Cordis service injection. */` |
| 0.6 | `dsh.client.platform` 是硬闸门：非 `web` 直接不组装 | `dsh-client-modules/lib/index.js:790` `if (decl === void 0 \|\| decl.platform !== "web") return null` |
| 0.7 | 宿主**支持并服务插件 sourcemap**（且会剥掉插件自带 trailer 再重写） | `dsh-client-modules/lib/index.js:329-340`（读 `clientPath.map`）、`:401-441`（合成 indexed map）、`:263`（`comboSearch(...,sourceMap)`）、`:194` `SOURCE_MAP_TRAILER` 被 `prepareSource` 剥离（`:313-321`） |
| 0.8 | 没有 map 时宿主退化为 **identity map**（生成行 1:1 映射到生成的 JS，拿不到 `.ts`） | `dsh-client-modules/lib/index.js:366-380` `identitySectionMap` 注释与实现 |
| 0.9 | 官方 plugin 产物的标准形状 = 顶层直接 `window.__ModuleLoader__.load({id, factory})`，factory 内是 CJS 壳 | `dsh-client-ui-conversation/lib/client.js` 首 3 行 / 尾部 `exports.apply = apply; ... return module.exports; } });` + `//# sourceMappingURL=client.js.map` |
| 0.10 | module table 的 seed word 只有 11 个 | `dsh-web-frontend/dist/assets/index-BgUyXZcc.js:196`：`{react, react/jsx-runtime, react-dom, react-dom/client, @deepseek-ai/cordis, zod, @tanstack/react-virtual, @deepseek-ai/dsh-client-store, @deepseek-ai/dsh-client-ui-slots, @deepseek-ai/dsh-client-ui-primitives, @deepseek-ai/dsh-client-ui-dockkit}` |
| 0.11 | web shell 里**已存在 desktop 启动分支** | 同上文件 `:196`：`globalThis.dshDesktopBoot`、`globalThis.__DSH_TRANSPORT__ = { ownsHost: true, streamBaseUrl }`、`aV()` 注入器 |
| 0.12 | 本机安装产物 = HEAD 构建；npm tgz 是旧产物 | `md5`：HEAD `1b92142ee1605a73fc7b02eea8aea6ec`、`/Users/francesco/.dsh/profiles/web/node_modules/@francescoli/dsh-quota/lib/client.js` `1b92142e…`（176427 B）、仓库内 `francescoli-dsh-quota-0.4.0.tgz` 内 `lib/client.js` `026dd4d4…`（176024 B） |

**重执行行为已实测**（`node:vm` 复现 classic script 语义，脚本全局词法环境持久化）：

```
PUBLISHED(0.4.0 tgz) exec2 FAIL SyntaxError: Identifier 'factory' has already been declared
PUBLISHED(0.4.0 tgz) registered ids: [ '@francescoli/dsh-quota', 'dsh-quota' ]
HEAD(c7723f0) exec2 OK
HEAD(c7723f0) registered ids: [ '@francescoli/dsh-quota' ]
```

旧产物尾巴（`tar -xzf francescoli-dsh-quota-0.4.0.tgz` 后 `lib/client.js` 末尾）额外注册了一个非规范 id `dsh-quota`：

```js
window.__ModuleLoader__.load({ id: "@francescoli/dsh-quota", factory: factory });
window.__ModuleLoader__.load({ id: "dsh-quota",               factory: factory });
```

---

## A. 缺陷与风险

| ID | 级别 | 位置 | 触发条件 | 影响 | 修复方案 | 量级 |
|---|---|---|---|---|---|---|
| **A1** | **P0** | npm 0.4.0 产物（仓库内 `francescoli-dsh-quota-0.4.0.tgz` 的 `lib/client.js`，首行 `const factory = ...`，尾部双 id 注册） | 同一 classic script 在页面执行第二次（HMR 重载、重复 script 标签、宿主 `arrive()` 重取同一 URL）⇒ 全局词法环境里 `factory` 已声明 | `SyntaxError`，脚本整体不执行 ⇒ `__ModuleLoader__` 收不到注册 ⇒ 宿主 `client-modules: could not load "...": ... loaded without registering`（`client.js:760`）。且**整批 combo 一起失效**（0.2），其余插件被迫逐个回退 URL 重取，表现为启动变慢 + 一排失败 | HEAD 已修（IIFE + 单 id）。发布侧只需在 HEAD 打 `v0.4.1`：`prepack` 会重跑 `node bundle-host.mjs && node bundle-client.mjs`（`package.json:40`），产物自动正确；**不要试图覆盖 0.4.0**（npm 不允许）。同时补 A/C 区回归测试 | S |
| **A2** | **P1** | `view.ts:2205` `container.innerHTML = ...`；滚动容器 `view.ts:610-621`（`:617 overflow-y:auto`）；触发源 `controller.ts:304`（静默轮询也 `emit()`） | 面板打开时任意一次 emit：60s 轮询、点分类页签、折叠分组、独立刷新、保存配置 | ①滚动位置被重置到顶部；②设置页输入框（`view.ts:2099` 代理输入、`:2073` 阈值滑杆）在轮询后被打回服务端值，**未保存的编辑丢失**；③正在进行的行内操作（`view.ts:2317` 的 `btn.classList.add('spinning')`、`:2558` 的按钮文案）指向已脱离文档的旧节点，状态错乱 | 渲染前保存/恢复 `container.scrollTop`；输入态保护：焦点在 `input/select/textarea` 或存在 dirty 标记时跳过本次内容区重建（现有 `isDrawerOpen` 守卫只在 `view.ts:1671-1675` 覆盖抽屉）；中期做 keyed diff | M |
| **A3** | **P1** | `controller.ts:89-97`（`setInterval` 内 `if (!this.loading)`）、`controller.ts:278-283`（`loading` 仅在 `!silent` 时置 true）、`controller.ts:112-134`（visibilitychange + focus 双通道）、`controller.ts:275`（`open()` 再触发一次） | 后端响应慢于轮询间隔，或切页签/回窗口与轮询重叠 | 无 in-flight 合并、无请求去重：并发 `getCards` 叠加；后到的响应覆盖先到的更新数据（`controller.ts:286-291` 整体赋值）；后端 fan-out 被放大（服务端每个请求都要跑全部 provider task，`manager.ts:611-637`） | 加 `private inflight?: Promise<void>`，`refresh` 首行复用；`loading` 与 `silent` 解耦为独立 `busy` 计数；visibilitychange/focus 合并到同一 scheduler | S |
| **A4** | **P1** | `controller.ts:293-299`（`if (!silent) this.error = ...` 静默吞掉）；`controller.ts:222/228` 暴露 `error/lastUpdated`；`view.ts` 全文**无** `state.error`/`state.lastUpdated`/`stale`/`sourceProvenance` 渲染（grep 0 命中） | 宿主重启、端口变化、500、离线、上游全挂 | 用户看到永久静止的旧数据，无"最后更新于"、无错误条、无 stale 标记；点"全部刷新"失败时界面无反馈（`state.error` 无人消费）⇒ 用户误以为数据是新的，额度判断失真 | 头部渲染"最后更新 hh:mm" + 失败横幅；把 `card.stale`/`sourceProvenance.partial` 显式标在卡片上（DTO 已提供，纯展示缺口） | S |
| **A5** | **P1** | `api.ts:218,224,236,246,256,263,269,278,285,292`（10 处 `fetch` 全无 `signal`）；`view.ts:2211` loading 文案 | 任一请求悬挂（宿主事件循环卡住、连接半开、代理不回包） | `await` 永不返回 ⇒ 非静默 refresh 的 `loading` 永为 true ⇒ "正在刷新..."常驻；配合 A3 轮询继续叠加；无重试/退避，故障期请求风暴 | `fetch(url, { signal: AbortSignal.timeout(8000) })`；连续 N 次失败指数退避并降轮询频率（示例：60s→60/120/240s 上限 10min） | S |
| **A6** | **P1** | `controller.ts:312-317`（单卡刷新**未**走 `escapeCardText`）对比 `controller.ts:286-287`（全量刷新走了）；消费点 `view.ts:1745`（`card.error`）、`:1780/:1803`（`title="${win.label}"`）、`:1838`（`card.name`）、`:1842`（`card.account`）、`hud.ts:491`（`hudEl.innerHTML`） | 点某卡"↻"（`view.ts:2246-2251` → `refreshSingle`）后，provider 返回的 `name/account/error/group.title/window.label` 含 HTML | 破坏 `api.ts:185-191` 明确声明的"escape once at the boundary"契约：单卡刷新路径的远端字符串（上游 group 名、错误体、账号邮箱）**未转义直达 innerHTML**。安全性：可注入 `<img onerror>` 到 DSH 页面源（该源握着会话/宿主 HTTP 接口） | 一行修复：`this.cards[idx] = escapeCardText(updatedCard)`（两个数组都改） | S |
| **A7** | **P1** | `api.ts:227-232`（`if (data.card) ... if (data.cards) ... return data`）对照 `routes.ts:13-33` 与 `manager.ts:710-713`（provider 找不到返回 `undefined` ⇒ 服务端 JSON 无 `card` 字段） | 独立刷新一个已删除/改名/未配置的实例 | `refreshSingle` 的声明返回类型是 `Promise<AuthCardItem>`（`api.ts:223`），实际会返回 `{ok:true}` 整体对象 → 被写进 `cards/allCards`（`controller.ts:314-317`）→ 下次渲染 `card.groups.map`（`view.ts:1753`）抛 `TypeError` → 在 `emit()` 的 for 循环（`controller.ts:184-186`，**无 try/catch**）中抛出 → 整个 `update()` 中断、后续监听器被跳过，面板卡在半渲染，且每次 emit 复现 | 找不到卡片时抛明确错误（由调用方 toast），绝不 `return data`；`emit()` 内逐个 listener try/catch，避免单点毁全局 | S |
| **A8** | **P1** | `package.json:22-27`（`"platform": "web"`）+ `api.ts` 10 处绝对路径 `/api/dsh-quota/*`；闸门 `dsh-client-modules/lib/index.js:790`；desktop 分支 `dsh-web-frontend/dist/assets/index-BgUyXZcc.js:196` | 未来在 desktop profile 启用（`platform` 不改） / 页面被不同 origin 或挂载基路径托管 | ①`platform:"web"` 是硬闸门，desktop 下插件**静默消失**（不是报错，更难发现）；②即便放开，客户端硬编码文档根绝对路径，在 `__DSH_TRANSPORT__.streamBaseUrl` 与文档 origin 不一致时全部 404（〔推断〕：desktop 由 `dshDesktopBoot` 注入 boot，页面可能非同源） | 路由基址改为 `new URL('api/dsh-quota/', document.baseURI)` 或从 `globalThis.__DSH_TRANSPORT__?.streamBaseUrl` 派生；`platform` 与宿主协商后再扩 | M |
| **A9** | **P1** | `bundle-client.mjs:22`（import 正则 `import\s+[^;]+from\s+['"][^'"]+['"];?`）、`:24`（`export\s+(class|function|const|let|var|type|interface)\s+`）、`:28`（`stripTypeScriptTypes` 作用于拼接后整串） | 任何人新增：`export default ...`、`export { a, b }`、`export * from './x.ts'`、副作用 `import './x.css'`、或 `import` 语句内含 `;` / 字符串 | 前三类**完全漏网** → 产物出现 `export` ⇒ SyntaxError；第四类漏网 ⇒ 残留路径；第五类误删。构建脚本**不校验产物**，`console.log('Successfully built…')` 照常打印。因批次是单个 classic script（0.2），坏包会拖垮同批所有插件 | 见 B3（构建期 `new vm.Script()` 闸门 + 禁顶层裸声明），根治见 B4 | S |
| **A10** | **P2** | `hud.ts:189-206`（pointerdown 才向 `window` 挂 mousemove/mouseup/touchmove/touchend）、`:226-235`（仅在 pointerup 解绑）、`:514-521`（`if (isHovered \|\| isDragging) return` 停轮播） | 拖动中在窗口外/跨窗口松手、或移动端手势被系统打断 | `isDragging` 卡 true：HUD 轮播永久停摆、后续单击被当成拖动；window 级监听残留 | 用 `setPointerCapture` 或 `pointerup/pointercancel` + `window.blur` 兜底解绑 | S |
| **A11** | **P2** | `mount.ts:35-36`（`waitObserver.observe(document.body, {childList:true, subtree:true})`）、`sidebar-entry-core.ts:101-110`（第二个 body 级 subtree observer，回调里跑 `document.body.contains` + `sidebarRoot()` querySelector + `insertBefore`） | 聊天流式输出（每帧多次 DOM 变更）、长会话、侧边栏频繁重渲 | 每个 mutation batch 都进回调；本插件自己就挂了 2 个全站 observer，与宿主自身的 observer 叠加（宿主另有 `subtree:true` 的 drag observer，`index-BgUyXZcc.js:196`）〔推断：CPU 抖动量级依赖宿主渲染节流〕 | 观察范围收窄到目标列的父节点；回调尾部做 rAF 合帧；根治见 B1（槽位化后不需要 observer） | S |
| **A12** | **P2** | `mount.ts:5`（`[data-pane="conversation"], [class*="centerCol"]`）、`sidebar-entry-core.ts:22`（`[data-pane="sidebar"], [class*="sidebarCol"]`）、`mount.ts:57`（`[class*="sessionRow"]` 等 5 个） | 宿主改 class/DOM 结构（宿主版本升级、desktop 变体） | 面板或入口**静默不出现**，无任何日志 | 迁移官方槽位（B1）；过渡期在 `conversationColumn()===undefined` 时降级挂载到 body 并 `console.warn` | M |
| **A13** | **P2** | `view.ts:327-356` `showConfirmModal`（overlay append 到 `document.body`，无句柄返回）、`view.ts:3000-3005`（dispose 仅 `unsubscribe` + 移除 keydown + `styleEl.remove()`） | 确认框打开期间插件被卸载/HMR/禁用 | 遮罩永久留在页面上挡住整个 UI（它没有归属元素可随容器一起移除）；`onConfirm` 闭包连同监听一起泄漏 | modal/toast 纳入 view 的作用域集合，dispose 时逐个 remove | S |
| **A14** | **P2** | `hud.ts:514-521`（4.5s 轮播）、`controller.ts:89-97`（60s 轮询）；`controller.ts:112-121` 只在**变可见**时补刷，`document.hidden` 判断缺失 | 标签页隐藏/最小化（web 与 desktop 均常见） | 后台持续：轮播定时器空转 + 每 60s 一次 `/status`；desktop 场景下是白耗电与上游配额查询 | 统一 scheduler：`document.hidden ⇒ 暂停 setInterval`，可见时按 stale 门限补一次（复用 `controller.ts:116` 已有逻辑） | S |
| **A15** | **P2** | `view.ts:604`（单文件 3008 行；其中 CSS 模板字面量 812 行 / 22.6 KB，`view.ts:606-1417`）；`update()` 单函数 1665-2985（1320 行），内含 **45** 处 `addEventListener`、**16** 处 `container.querySelectorAll`（每次渲染重新绑定约 40 组监听） | 任何 UI 改动/回归排查 | 可维护性差、字符串选择器无类型保护（`querySelector` 返回 `Element \| null` 后大量 `as any`）、每次 emit 的重绑定开销随卡片数线性增长 | 拆 `view/{style.ts, cards.ts, settings.ts, drawer.ts, update.ts}`；改事件委托：容器上 1 个 click + `data-action` 分派 | M |
| **A16** | **P2** | `view.ts:1754-1849`（`state.cards.map(...).join('')` 全量拼接）、`view.ts:2205` | 服务数增长（本机配置 16 个 provider 上限） | 无虚拟化、无增量；一次 emit 重建全部卡片×全部 window 的节点树（16 provider × 2-4 window ≈ 数百节点）〔推断：当前规模 <16ms，属于"可接受但会随规模恶化"〕 | 已具备按分类/分组折叠状态，先做"只渲染可见分类 + 折叠组不展开 children"；必要时再上 windowing | M |
| **A17** | **P2** | `hud.ts:13-31`（localStorage `dsh_quota_hud_pos`，仅在加载时钳制）、`:176-178`；无 `resize`/`orientationchange` 监听 | 窗口缩小、换显示器、desktop 窗口化 | HUD 落到可视区外且拖不回来（`onPointerMove` 的 clamp 只在拖动时生效，用户已看不到它） | 加 resize 监听重新钳制；key 加版本前缀 | S |
| **A18** | **P2** | `src/client/index.ts:13` `export const inject: string[] = []`；`sidebar-entry.ts` 的 `label()`、`view.ts` 全文硬编码中文 | 非中文宿主（host 支持 8 语言） | 侧边栏/面板语言与宿主不一致。**注意语义**：`dsh.client.inject` 空只说明没有包依赖（0.5），与能否拿宿主上下文无关；真正的缺口是 Cordis 侧没声明 `inject:['locale']`，因此 `apply(ctx)` 不会等 `locale` 服务就绪，也没用 `ctx.locale` | 官方用法参考 `dsh-client-ui-conversation/lib/client.js:22588`：`ctx.effect(() => ctx.locale.register(NS,{zh,en,…}))` + `ctx.locale.bind(NS)`；改 `export const inject = ['locale']`，字符串走字典 | M |
| **A19** | **P2** | 主题：131 处 `var(--dsw-*)` 中 **14 处无 fallback**；13 个硬编码色值、约 90 处出现（`#3F7A63`×20、`#ffffff`×14、`#1f2328`×14、`#57606a`×13、`#B04A46`×9、`#BA8137`×2…，`view.ts:180-184`、`hud.ts:423-429`）；无任何 `data-theme`/`prefers-color-scheme` 分支 | 独立 webview 缺少 `--dsw-alias-*`（token 定义在 `body`/`:root`，见 `dsh-client-ui-theme/lib/client.js`）或深色主题 | 无 fallback 的 14 处会退化成继承色；硬编码的语义色（绿/红/黄）在深色底上对比度不达 AA〔推断〕 | 补齐 fallback；状态色改 token 或 `color-mix()`；补 3 个语义色变量 | S |
| **A20** | **P2** | 死代码/契约漂移：`api.ts:255-260` `getHistory` + `controller.ts:348-350` 全链路**无调用点**（`grep getHistory` 仅定义处）；`QuotaHistoryPoint` 同死；`view.ts:170 esc` 与 `api.ts:175 escapeHtmlText` 双实现 | 维护者以为有历史接口、或误用两套转义 | 误导 + 双实现漂移风险（`esc` 未用于卡片字段，见 A6） | 删掉或接上（抽屉里画 7 天趋势，服务端 `sparkline` 已随卡下发） | S |
| **A21** | **P2** | `sidebar-entry-core.ts:73-75`：`if (document.querySelector(options.rowSelector) !== null) return () => {}` | HMR 重新 apply 时旧入口节点仍在 DOM（宿主未清 container） | 新实例不挂载、旧实例已被 dispose 解绑 ⇒ 侧边栏出现一个**死按钮**，且返回空 disposer 让上层以为挂载成功 | 返回"被抑制"标记；或先移除旧节点再挂（dispose 已 `entry.remove()`，二次幂等） | S |
| **A22** | **P2** | 无类型检查：仓库根**无 tsconfig.json**、`package.json` 无 `devDependencies`（全仓库零依赖）；`bundle-client.mjs:28` 只剥类型不做检查 | 任何类型漂移 | A7 这类"声明 `Promise<AuthCardItem>` 实际返回 `{ok:true}`"的问题不可能被发现；`interface ServiceRowItem`（`view.ts:1864`）声明在函数体内也无检查 | 加 `tsc --noEmit`（devDependency）或最低成本 `// @ts-check` + JSDoc；CI 里跑 | S |
| **A23** | **P2** | `lib/client.js`（176,427 B / 4,649 行，无 `sourceMappingURL`）；`bundle-client.mjs:30-58` 无 banner/版本戳 | 任何线上报错 | 生产堆栈只有 `lib/client.js:<拼接行>`；宿主 identity map 只能告诉你"就是这一行"（0.8），拿不到 `view.ts:2205` 这种信息；调试成本全落在维护者身上 | 见 B2（零依赖出 map）/ B4（esbuild 出 map） | S |
| **A24** | **P2** | `routes.ts:13-33` 只写 `Content-Type`，无 `Cache-Control`；`api.ts:218` 无 `cache:'no-store'` | 中间层代理、浏览器启发式缓存 | 理论上可返回旧 JSON（实际无 `Last-Modified`/`ETag` 时启发式缓存通常不触发，风险低）〔推断〕 | `/status` 加 `Cache-Control: no-store` | S |
| **A25** | **P2** | `controller.ts:60,141-151`：`notifiedAlarmIds` 只增不减，key 为 `${instanceId}_${message}` | 长时间运行 + 告警文案随数值变化 | 集合无界增长（每条形如 `deepseek_剩余 12.3%`）；同一条告警在阈值附近抖动会被反复系统通知 | 改用 `${instanceId}_${level}_${windowId}` 作 key，并在告警消失时清理 | S |

---

## B. 优化与升级点

| ID | 级别 | 位置 | 现状 | 收益 | 方案 | 量级 |
|---|---|---|---|---|---|---|
| **B1** | **P1** | 迁移官方 slots：`sidebar.footer.action`（`dsh-client-ui-sidebar/lib/client.js:561`，收 `{wide}`）、`sidebar.panellist`（`:228`，收 `{size, active}`）、`sidebar.panellist.actions`（`:279`）、`sidebar.toggle.badge`（`:400`）；注册范例 `dsh-client-ui-schedule/lib/client.js:19387-19393` | 目前靠 `[data-pane="sidebar"]`/`[class*="logoRow"]`/`[class*="newSession"]` 手工插节点（`sidebar-entry-core.ts:21-70`），配 2 个 body 级 MutationObserver 保活 | ①消除 A11/A12/A21 一整类问题；②免费获得折叠态/宽度/主题/Tooltip/键盘可达性（宿主 `PanelRow` 已实现，`:205-235`）；③宿主升级不再破 UI | 成本与风险：**槽位组件是 React 组件**（`PanelRow` 用 `Tooltip` + `primitives` + `usePanelInfo`），必须 `require('react')`/`('react/jsx-runtime')` —— 它们是 seed word（0.10），但当前"正则删 import"的构建**物理上做不到**（会删掉 import 却无人提供 `require`）。所以路径是先在 `package.json` 声明 `dsh.client.external: ["react","react/jsx-runtime"]`，再换真打包器（B4），最后逐个槽位替换。**建议拆两步上线**（先 B4 不换 UI，再逐槽位），不要一次性同时动构建链与 UI 栈 | L |
| **B2** | P1 | 宿主已有 sourcemap 通道（0.7）；本地已实测 `stripTypeScriptTypes` **保留行与列**：`view.ts` 3009 行 → 剥离后仍 3009 行，`view.ts:604` 剥离后长度 97→97（`export function renderQuotaApp(container             , controller                 )             {`） | 产物无 map，宿主只能 identity 映射 | DevTools 直接落到 `.ts` 行；线上报错可定位；零新增依赖 | 在 `bundle-client.mjs` 拼装时记录每个文件的起始行（当前结构天然可算：IIFE 头 6 行 + 每个文件前一个 `\n`，实测 `sidebar-entry-core.ts` 行 2 → 产物行 9，delta=7），生成 `client.js.map`（indexed sections，每段 identity + `sourcesContent`）；宿主会自己剥 trailer 并重写 combo 引用（0.7），单包与 combo 两种模式都正确 | S |
| **B3** | P1 | `bundle-client.mjs:61-63`（只 `writeFileSync` + 打日志） | 构建期零校验 | 拦住 A9 全部四类破坏 + A1 类回归 | 加 3 道零依赖断言：①`new vm.Script(bundle)` 语法校验；②产物中 `^const\|^let\|^var\|^function` 出现在 IIFE 外即失败；③`__ModuleLoader__.load(` 恰好出现 1 次且 id === `package.json` 的 name。构建失败即非零退出 | S |
| **B4** | P1 | 迁移 esbuild/tsdown（最小可行） | 手写 8 文件拼接 + 正则 + 实验 API | 一次解决 A9/A22/A23；为 B1 铺路 | **保留 classic script + IIFE + 单 id 语义**的前提下，目标形状照抄官方（0.9）：`(function(){ var factory=(require)=>{ var module={exports:{}}; var exports=module.exports; Object.defineProperty(exports,Symbol.toStringTag,{value:"Module"}); <esbuild CJS body>; return module.exports; }; try{ window.__ModuleLoader__.load({id:"@francescoli/dsh-quota", factory}) }catch(e){ if(!/duplicate factory registration/.test(String(e&&e.message))) throw e } })();`。esbuild 命令：`--bundle --format=cjs --platform=browser --target=es2020 --sourcemap=external`（将来接槽位再加 `--external:react --external:react/jsx-runtime`）。**成本**：+1 devDependency（单二进制）；`prepack` 改为调 esbuild（现在 `prepack` 已存在，见 `package.json:40`）。**风险**：①一旦有 `import x from 'y'`，产物变 `require("y")`，必须同步 `dsh.client.external`，否则运行时 `require("...") missed the module table`（`dsh-client-modules/lib/client.js:842`）；②不要 `--minify`：宿主 combo map 依赖行数偏移（`:397` 的 `newlineCount`），且 gzip 后 37,894 B 已很小，收益不抵调试成本；③产物 id 必须继续等于包名 | M |
| **B5** | P2 | 体积/缓存现状 | 176,427 B（gzip 实测 37,894 B），宿主对插件资源发 `immutable` 长缓存（`dsh-client-modules/lib/index.js:188` `public, max-age=31536000, immutable`），URL 带 `rev` | 体积**不是**当前瓶颈 | 不需要为体积做 minify；若要降，优先把 812 行 CSS（22.6 KB）拆成独立 `client.css` 类资源或减少内联样式重复；关注点是首屏 combo URL 长度上限 3 KB（`MAX_COMBO_URL_BYTES`）而非字节数 | S |
| **B6** | P2 | `view.ts:606-1417` CSS 模板字面量注入 `<style>`（812 行，22.6 KB） | 每次 `renderQuotaApp` 都创建并 append 一个 `<style>`；宿主对 materialize 期间注入的 style 做归属登记（`dsh-client-modules/lib/client.js:624-638` `claimStyles`） | 无功能问题，但样式与结构同一文件、无法按需加载 | 抽 `style.ts` 常量，或改用带 `data-plugin-css` 的单例注入（宿主 HMR 会按 tag 清理） | S |
| **B7** | P2 | 状态与渲染的耦合面 | `getSnapshot()`（`controller.ts:188-234`）每次 emit 都 filter+sort 全量卡片并新建 3 个 Set | 每次 emit 的固定开销 | 结果按 `(allCards, activeCategory, config, collapsedGroups)` 记忆化；`emit` 改为带 changed-keys，view 按需重渲区域 | M |
| **B8** | P2 | 面向 desktop 的适配层 | 现在 `platform:"web"` 硬闸门 + 绝对路由（A8） | 为 desktop 预留而不破坏 web | 抽出 `resolveApiBase()`：`globalThis.__DSH_TRANSPORT__?.streamBaseUrl ?? document.baseURI`；`platform` 改为宿主可协商（等宿主支持前保持 web 并在 README 明确说明） | M |

---

## C. 测试/工程化缺口

| ID | 级别 | 位置/事实 | 影响 | 建议 |
|---|---|---|---|---|
| **C1** | **P1** | `c7723f0` 只改了 3 个文件：`CHANGELOG.md` / `bundle-client.mjs` / `lib/client.js`（`git show --stat c7723f0`）——**没有任何测试文件随修复提交** | 这次修复的有效性完全靠人肉在浏览器里验；下一个人改打包脚本时无法知道"IIFE + 单 id + 吞 duplicate"是契约 | 把"二次执行不抛 + 只注册 1 个 id"写成断言测试（见 C2），并在提交规范里要求 fix 必须带回归用例 |
| **C2** | **P1** | `tests/run.mjs:163-190` 的"客户端校验"共 21 条 `assert.ok(clientBundle.includes('...'))` 字符串包含断言；全套 93 条断言**零执行**客户端代码 | 字符串还在就通过：A1~A7 任何一条都不会被发现（旧产物同样包含 `showToast`/`renderSparklineSvg`） | 用 `node:vm` 加最小 `window.__ModuleLoader__` 桩，断言：①脚本执行不抛；②`load()` 调用 1 次；③`id === '@francescoli/dsh-quota'`；④二次执行不抛且不重复注册；⑤`factory(require)` 可物化且 `exports.apply/inject/VERSION` 齐全。共约 30 行，零依赖，已在本次审计中跑通同类桩 |
| **C3** | **P1** | `.github/workflows/release.yml` 步骤只有 `npm run build`（:33）、`validate-release.ps1`（:37）、打包（:42）——**不跑 `npm test`** | 测试永远不 gate 发布；本次 0.4.0 坏产物能发出去与此直接相关 | 在 build 后加 `run: npm test`（并让 C2 的用例进入该套件） |
| **C4** | **P2** | `.github/scripts/validate-release.ps1:48-56` 只校验 `lib/client.js` **存在且非空** | 无法发现"非空但语法错误/未注册"的产物 | 复用 C2 的产物契约断言（PowerShell 里调 node 脚本即可） |
| **C5** | **P2** | 仓库无 DOM 测试环境（无 jsdom/happy-dom 依赖）、无 ESLint/Prettier/Biome 配置（根目录 grep 无命中） | `view.ts` 3008 行、`hud.ts` 533 行为零覆盖；风格/`any` 泛滥无约束 | 至少引入 happy-dom + 3 个冒烟用例（`update()` 不抛、抽屉开关、单卡刷新后不崩）；lint 用零配置的 `oxlint`/`biome` |
| **C6** | **P2** | 无客户端↔服务端契约测试：`api.ts` 的 10 条路径 vs `routes.ts:13-211` 的 8 条路由；`refreshSingle` 的 `{ok,card}` / 兜底 `return data`（A7）无测试 | 契约漂移（如本轮 A7）只能等用户点出来 | 用现有 `tests/run.mjs` 里已起的临时 HTTP server（`tests/run.mjs:294-301`），断言每个客户端调用路径存在且返回形状匹配；对 `?provider=不存在` 明确断言返回 `undefined` 而非 `{ok:true}` |
| **C7** | **P2** | 构建产物入库（`lib/client.js` 在 git 里），但 CI 不校验"源码 → 产物"可复现 | 手工补丁与源码漂移（本机已出现：安装目录产物是 c7723f0 的，而 npm 0.4.0 不是） | 加 `npm run build && git diff --exit-code lib/` 的 CI 检查 |
| **C8** | **P2** | `bundle-client.mjs:28` 依赖 `node:module` 的 `stripTypeScriptTypes`，本机 Node 26 仍打印 `ExperimentalWarning: stripTypeScriptTypes is an experimental feature and might change at any time`；`release.yml` 用 `node-version: 22` | 宿主/CI 的 Node 小版本升级可能导致构建行为变化或直接不可用 | 迁到 esbuild（B4）即消除；过渡期在 CI 钉死精确 Node 版本并 assert 该 API 存在 |

---

## D. 建议优先级 Top 5

1. **P0 · 把 HEAD 的产物真正发出去**（A1）：在 `c7723f0` 上打 `v0.4.1`（`prepack` 自动重建，`package.json:40`）。当前 npm 0.4.0 会在任何二次执行场景抛 `SyntaxError: Identifier 'factory' has already been declared`，并连带拖垮宿主整批 combo 的解码（0.2/0.3）。**证据**：仓库内 tgz 首行 `const factory = ...`、尾部双 id、`node:vm` 双执行实测失败。

2. **P1 · 给构建加闸门 + 产物契约测试**（A9/B3/C1/C2/C3）：`new vm.Script()` 语法校验 + "顶层无裸声明 / 只注册 1 个 id"两条断言，并让 `npm test` 进入 release workflow。这一条直接把"下次同类事故"变成 CI 红灯，成本约半天。

3. **P1 · 修 IM 边界与错误可观测性**（A4/A6/A7）：`refreshSingle` 补 `escapeCardText`（一行，安全）；`emit()` 内 try/catch（防 A7 单点毁全局面板）；静默失败保留 error 并在头部渲染"最后更新"+失败横幅（`state.error`/`lastUpdated` 目前是纯死字段）。

4. **P1 · 轮询与渲染生命周期治理**（A2/A3/A5/A14）：`AbortSignal.timeout` + in-flight 合并 + 失败退避；`document.hidden` 暂停；渲染前保存/恢复 `scrollTop` 并在输入框有焦点时跳过重建——把"每 60 秒把用户正在输入的表单打回原值、把列表滚回顶部"这个体感问题除掉。

5. **P1/P2 · 构建栈迁移（分两步）**（B1/B2/B4/A8）：第一步 esbuild 出 CJS-factory + `.map`（宿主已支持 map，0.7），保留 classic script/IIFE/单 id 语义不变；第二步再评估官方 slots（`sidebar.panellist`/`sidebar.footer.action`）。**关键前置**：槽位组件是 React，必须先进 module table 的 seed word（0.10）并声明 `external`，因此"先打包、后 UI"两步走，避免同时改动构建链与 UI 技术栈。

---

### 附：本次未覆盖/无法验证

- desktop profile 的真实运行时形态：仅在 web shell 里看到 `dshDesktopBoot`/`__DSH_TRANSPORT__.streamBaseUrl` 分支（0.11），未见 desktop 侧宿主包（`node_modules/@deepseek-ai` 下无 electron/desktop 包），故 A8 的 404 风险标为〔推断〕。
- 未执行 `npm install`/`npm pack`/发布流程（按任务约束）；B4 的 esbuild 命令为设计建议，未在本机验证（无该依赖）。
- 未在真实浏览器里测量渲染耗时与 MutationObserver 触发频率（A16/A11 的性能量级均为〔推断〕）。
- 未修改 `/tmp/dsh-quota` 内任何文件，未触碰 `/Users/francesco/.dsh`（仅只读比对 md5）。
