# dsh-quota — Harness-native usage and account quotas

**0.5.0 secure preview · Node.js 24+ · DSH 0.2.2-alpha.2 or newer**

A Sidebar tab showing two different things without confusing them:

1. **Actual Harness token usage** by task, model, provider, hour, day and request purpose.
2. **Official account limits/balances** using accounts already authorized in Harness.

中文：此版本重构了安全边界。通过 Harness Connection 验证所有 API，使用 Harness 凭据与网络策略；统计实际 token 用量，不再用 API 测活代替订阅额度，也不再提供任意地址、代理设置或本地凭据扫描。

## What is measured

- Provider-reported `TokenUsage` from the native Harness session log: normal assistant requests, reported retry attempts and compaction.
- Native `llm/stream` usage for auxiliary calls such as auto-review and session titles, from installation onward. Those numeric records persist in a Harness storage domain; requests are not redirected or reissued.
- Fork-inherited events are excluded from the fork's spend. A task is a root Harness session including its subagent descendants. The current-session filter can include descendants or only that session.
- Exact provider/model filters and explicit IANA time zones for hourly/daily buckets. The UI offers the last hour, today, 7 days and 30 days; the read API supports a range up to 366 days.
- Separate uncached input, cache read, cache write, output and reasoning. Harness cache buckets are **disjoint** from uncached input; reasoning is an output subset and is not added twice.

Unknown counts are not estimates or free calls. The response includes `unknownCalls`, indexing/coverage metadata and explicit limitations. `coverage.sessionsComplete` means all task logs are indexed; `coverage.complete` additionally requires no unknown receipts and complete auxiliary coverage since the persisted `trackingSince` watermark. Historical auxiliary calls without usage in the Harness log cannot be reconstructed. Auxiliary retention is 90 days/20,000 records; live/log reconciliation uses route/purpose/counts and a two-minute completion window because native requests carry no unique request id. Provider token totals are not subscription percentages or a monetary invoice.

## Account quota sources

| Source | What it shows | Credential source |
| --- | --- | --- |
| Codex / ChatGPT | Reported primary/secondary subscription windows and reset times | Harness `llm-pi-ai/openai-codex` OAuth grant |
| Claude Code | Actual five-hour/seven-day subscription windows, including model-specific windows when reported | Harness `llm-pi-ai/anthropic` OAuth grant |
| DeepSeek signed-in account | Recharge and bonus wallet balance by currency | Owning Harness `deepseekAccount` service |
| DeepSeek API | API wallet balance | Exact Harness `DEEPSEEK_API_KEY` reference |
| Other configured providers | Explicit quota API unsupported state | No extra credential access |

A missing, expired or incompatible grant is reported as unavailable; sign in/renew through **Harness**, not this panel. No CLI auth files or browser databases are read. The plugin never refreshes or writes OAuth tokens independently. A missing quota field stays unknown, never fabricated as 100%.

Account reads share a 60-second cache and in-flight work, with at most two concurrent sources, a 15-second minimum forced-refresh interval, eight returned accounts, 8-second per-source deadlines and bounded response bodies. Quota endpoints are fixed HTTPS official origin/path pairs; redirects are forbidden. Calls use the native Host fetch and DSH-installed global proxy dispatcher, not a separate HTTP client or custom proxy fallback.

## UI

Open the right Sidebar's page chooser and choose **Usage & quotas** / **Расход и квоты**. The tab stays inside the Harness layout and uses its theme and locale. Dynamic text is rendered by React, never interpolated into HTML. Usage polling pauses when the tab is hidden. Account tokens and editable endpoint/proxy fields do not exist in the browser.

## Install from this source

```sh
npm run build
npm test
dsh plugin --profile web add /absolute/path/to/dsh-quota
```

When using the Harness agent's plugin tools, install this directory with `plugin_manager.install_bundle`; do not edit a profile composition by hand. Refresh the existing Harness page when updating a previously loaded client generation. No replacement web server is needed. This preview intentionally requires the current Connection, credential, session projection and storage-domain services rather than falling back to unsafe legacy behavior.

## Read API and future router integration

All HTTP paths live under `/api/dsh-quota` and are registered through `ctx.connection.fetch`. Harness owner authentication and Host/Origin admission apply before dispatch:

- `GET /usage` — local token accounting only.
- `GET /accounts` — cached official account state.
- `GET /snapshot` — `{schemaVersion, generatedAt, accountState, usage}`.
- `POST /refresh` — refresh official account state; `Content-Type: application/json`, body `{}` only.

Usage query keys: `from`, `to` (epoch milliseconds, inclusive/exclusive), `timeZone`, `sessionId`, `includeChildren`, `provider`, `model`. Unknown/duplicate parameters are rejected. There are **no** config, test-connection, login, proxy or custom-URL endpoints. Responses are JSON with `Cache-Control: no-store`.

Host plugins may read `ctx.get('quotaMonitor')`:

```js
const monitor = ctx.get('quotaMonitor')
const usage = await monitor.usage({ timeZone: 'Europe/Moscow' })
const accounts = await monitor.accounts()
const snapshot = await monitor.snapshot({ sessionId, includeChildren: true })
```

`version: 1` identifies the service contract. `usage` returns totals and `byProvider`, `byModel`, `byTask` (call purpose), `byHour`, `byDay`, `bySession`, `byRootSession`, `coverage`, `indexing` and `limitations`.

The agent tool `get_quota_status` exposes the same read operations using `action: accounts | usage | snapshot`, plus usage-range filters. `groupBy` selects model/provider/task/session/rootSession/hour/day detail; `limit` bounds it to 1–100 rows (default 20), with explicit truncation metadata. `action: diagnostics` reads only plugin/client revision metadata, with no account access. It does not grant authority, modify credentials, choose models or change routing.

A router belongs in a **separate plugin** with this package as a bundle dependency and `quotaMonitor` as its injected Host service. This monitor provides only observations and does not own or expose router state. Consumers must distinguish stale account observations, unsupported quota APIs, unknown usage and pending historical indexing.

## Security and development

Read [SECURITY.md](./SECURITY.md) for trust boundaries and deployment caveats. Legacy 0.4 source/docs remain in Git for review, but the build emits only the new Host module graph and safe React Client; old raw routes/providers are neither loaded nor included in the published runtime.

```sh
npm run build                 # dependency-free Node TypeScript stripping
npm test                      # isolated fake-credential regressions, no real accounts
npm pack --ignore-scripts     # inspect the already built distribution
```

No runtime dependencies, CDN assets or install-time scripts are introduced. Do not add telemetry, credential scans or an independently configured network stack to implement a quota source. Existing provider/model inference remains owned by Harness.

[Apache-2.0](./LICENSE)
