# @francescoli/dsh-quota 版本管理与发布标准规范

本文档定义了 **@francescoli/dsh-quota**（DeepSeek Harness AI 额度与用量监控插件）的版本号管理、分支开发模型、变更日志规范、发布前门禁及自动化发布流程。后续的所有功能迭代、修复和版本发布均须严格遵循本规范。

---

## 1. 唯一版本来源 (Single Source of Truth)

- **唯一人工维护的版本源**：根目录 `package.json` 中的 `"version"` 字段。
- **派生与同步规则**：
  - 插件运行时、Host 端与 Client 端构建产物中的版本标识统一由构建脚本或包元数据注入，严禁在代码中独立硬编码分散的版本常量。
  - `README.md` 中的版本徽章、`CHANGELOG.md` 对应发布段落必须与 `package.json` 的版本号保持严格一致。
- **发布前校验**：必须通过本地或 CI 的发布校验脚本：
  ```powershell
  npm run validate:release -- --tag vX.Y.Z
  ```

---

## 2. 语义化版本号标准 (Semantic Versioning 2.0.0)

本项目严格采用 [SemVer 2.0.0](https://semver.org/lang/zh-CN/) 规范，版本号格式为：

$$\text{v}\mathbf{MAJOR}.\mathbf{MINOR}.\mathbf{PATCH}$$

Git 标签必须严格遵循带 `v` 前缀的格式，例如 `v0.1.0`、`v0.1.1`、`v0.2.0`、`v1.0.0`。

### 2.1 版本号递增原则

| 级别 | 格式变动 | 触发场景 | 示例 |
| :--- | :--- | :--- | :--- |
| **MAJOR (主版本)** | `X.0.0` | 发生不向下兼容的重大架构重构、DSH 插件注入契约变更、移除了关键服务提供商、数据存储结构重大破坏性变更 | `0.1.0` → `1.0.0` |
| **MINOR (次版本)** | `x.Y.0` | 新增向下兼容的功能或模块（如接入新的 AI 提供商 Codex / DeepSeek / Claude、新增 HUD 独立监控浮窗、新增配置项等） | `0.1.0` → `0.2.0` |
| **PATCH (修订号)** | `x.y.Z` | 向下兼容的缺陷修复（Bugfix）、UI 样式/配色/排版调优、倒计时与用量算法修正、性能优化、文档更新 | `0.1.0` → `0.1.1` |

### 2.2 0.y.z 初始阶段原则

- 项目在 `0.y.z` 阶段属于初始迭代期，`0.1.0` 为首个具备完整功能（Codex, Cursor, Antigravity, OpenCode-Go 监控看板与 HUD 聚合）的基础版本。
- 后续新增功能递增次版本号（如 `0.2.0`），修复和调优递增修订号（如 `0.1.1`）。

### 2.3 版本不可变性原则

- 已经推送到 GitHub 远程仓库的 Git 标签（Tag）和已公开的 GitHub Release **严禁移动、删除或覆盖**。
- 若发布后发现缺陷，必须通过递增 PATCH 版本发布新版本进行修复。

---

## 3. 变更日志标准 (Keep a Changelog)

根目录维护 `CHANGELOG.md`，遵循 [Keep a Changelog 1.0.0](https://keepachangelog.com/zh-CN/1.0.0/) 规范：

1. **保留 `[Unreleased]` 节**：顶部始终保留 `## [Unreleased]` 章节，用于在日常开发中随时记录尚未发布的用户可见改动。
2. **发布归档**：在正式发布版本时，将 `[Unreleased]` 中的条目移动到带日期的新版本章节，格式必须严格为：
   ```markdown
   ## [X.Y.Z] - YYYY-MM-DD
   ```
3. **标准分类标签**：
   - `Added`：新功能、新支持的 AI 平台、新 UI 交互组件；
   - `Changed`：对已有功能的调整、UI/交互重构；
   - `Fixed`：缺陷与异常修复；
   - `Deprecated`：未来即将废弃的配置或特性；
   - `Removed`：已移除的特性或配置；
   - `Security`：安全与凭据保护相关改进（如敏感 Token 脱敏、权限收紧）。

---

## 4. 发布前门禁 (Release Gates)

在创建版本 Git 标签之前，必须满足以下所有门禁条件：

1. **代码与工作区整洁**：所有开发代码已通过审查并提交至 `main` 分支，工作区无未提交的脏更改。
2. **构建与测试通过**：运行 `npm run build` 与 `npm test`，确保 `lib/` 产物可复现（CI 会执行 `git diff --exit-code -- lib/`）且全量测试通过。
3. **版本元数据一致**：`package.json`、`CHANGELOG.md`、`README.md` 中的版本号完全一致。
4. **自动化校验脚本通过**（跨平台 Node 脚本，CI 与本机一致）：
   ```bash
   npm run validate:release -- --tag vX.Y.Z
   ```
   脚本将执行以下硬性检查：
   - Tag 格式符合 `^v\d+\.\d+\.\d+$`；
   - `package.json` 中的 `version` 与 Tag 一致；
   - `CHANGELOG.md` 中包含对应版本的日期标题 `## [X.Y.Z] - YYYY-MM-DD` 且保留 `## [Unreleased]`；
   - 构建产物 `lib/index.js`、`lib/client.js` 及其 source map 存在且非空；
   - `lib/client.js` 是 classic-script IIFE、只注册一个规范 id、带 sourceMappingURL（0.4.0 事故的回归门禁）。

---

## 5. 标准发布操作流程 (Step-by-Step Flow)

以发布 `v0.1.0`（或后续版本 `vX.Y.Z`）为例，发布人员需按以下顺序操作：

### 步骤 1：完成开发并验证构建

```powershell
npm run build
```

### 步骤 2：递增版本号

修改 `package.json` 中的 `version` 字段为目标版本（如 `"0.1.0"`）。

### 步骤 3：更新变更记录

在 `CHANGELOG.md` 中，将 `[Unreleased]` 中的改动归档到新的版本段落：
```markdown
## [Unreleased]

## [0.1.0] - 2026-08-26
### Added
- ...
```

### 步骤 4：运行本地门禁验证

```powershell
npm run validate:release -- --tag v0.1.0
```

### 步骤 5：提交发布代码并打标签

```powershell
git add .
git commit -m "chore(release): v0.1.0"
git tag -a v0.1.0 -m "Release v0.1.0: DSH AI Quota & Usage Monitor"
```

### 步骤 6：推送到 GitHub 远程仓库

```powershell
git push origin main
git push origin v0.1.0
```

### 步骤 7：GitHub Actions 自动构建与 Release

- 标签推送将自动触发 `.github/workflows/release.yml` 工作流。
- 工作流将自动执行编译、打包、SHA-256 校验和计算、生成 `release-manifest.json`，并发布 GitHub Release。

### 步骤 8：市场分发（可选 / 视发布目标而定）

- **npm 官方包发布**（需发布者 npm 权限）：
  ```powershell
  npm publish --access public
  ```
- **DSH 官方插件市场分发**：
  向 [awesome-dsh-plugin/awesome-dsh-plugin](https://github.com/awesome-dsh-plugin/awesome-dsh-plugin) 提交 PR，更新 `plugins.json` 里的版本与元数据。

---

## 6. Release 资产契约 (Release Assets Contract)

每个由 CI 构建的稳定版 GitHub Release 必须包含以下标准化资产：

| 资产文件名 | 类型 | 描述 |
| :--- | :--- | :--- |
| `dsh-quota-vX.Y.Z.tgz` | `application/gzip` | 标准 npm 打包产物，包含源码与构建产物（`npm pack`） |
| `dsh-quota-bundles.zip` | `application/zip` | 前后端构建产物压缩包（`lib/index.js`, `lib/client.js`, `cordis.patch.yml`） |
| `release-manifest.json` | `application/json` | 包含项目名、版本号、Commit SHA、构建时间及所有资产 SHA-256 校验信息的元数据文件 |
| `*.sha256` | `text/plain` | 对应资产的独立 SHA-256 校验文本 |

### `release-manifest.json` 规范 (Schema v1)

```json
{
  "schema_version": 1,
  "project": "Francesco502/dsh-quota",
  "version": "0.1.0",
  "tag": "v0.1.0",
  "commit": "<git-sha>",
  "generated_at": "<iso-timestamp>",
  "assets": [
    {
      "name": "dsh-quota-v0.1.0.tgz",
      "sha256": "<sha256-hash>",
      "type": "application/gzip"
    },
    {
      "name": "dsh-quota-bundles.zip",
      "sha256": "<sha256-hash>",
      "type": "application/zip"
    }
  ]
}
```

---

## 7. 异常回滚与应急流程

1. **缺陷发现**：若新发布版本存在阻塞性缺陷，不得撤销已发布的 Tag，应立即在 `CHANGELOG.md` 中记录缺陷并在本地分支修复。
2. **快速热修复**：按本规范流程递增 PATCH 版本（例如 `0.1.1`），重新执行完整门禁、打标并推送。
3. **用户降级建议**：在 GitHub Release Notes 或社区说明中标记故障版本，并指引用户安装上一个稳定的具体 Tag 版本。
