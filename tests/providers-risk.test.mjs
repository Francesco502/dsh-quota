/**
 * Risk-track provider tests (0.4.1 contract §2/§3/§4).
 *
 * Covers the six high-risk providers: codex, cursor, antigravity, opencode_go,
 * custom_api, openai_billing. Every provider gets a normal fixture, a missing
 * field fixture and a 401/429 fixture, asserting that no percentage is ever
 * fabricated for unknown/balance/liveness data and that the AbortSignal reaches
 * the outbound fetch.
 *
 * `globalThis.fetch` is monkey-patched per test (fetchWithProxy with
 * `proxyMode: 'direct'` uses the global fetch) and always restored afterwards.
 */
import test from 'node:test'
import assert from 'node:assert/strict'

import { CodexProvider } from '../src/providers/codex.ts'
import { CursorProvider } from '../src/providers/cursor.ts'
import { AntigravityProvider } from '../src/providers/antigravity.ts'
import { OpenCodeGoProvider } from '../src/providers/opencode-go.ts'
import { CustomApiProvider } from '../src/providers/custom-api.ts'
import { OpenAIBillingProvider } from '../src/providers/openai-billing.ts'

const JSON_HEADERS = { 'content-type': 'application/json' }

function baseConfig(extra = {}) {
  // `direct` keeps fetchWithProxy on globalThis.fetch (no env proxy, no undici).
  return { proxyMode: 'direct', alarmThresholdPercent: 15, ...extra }
}

/**
 * Run `fn` with a stubbed fetch. `routes` is a list of
 * `{ match, status?, body?, headers?, networkError? }`; the first `match`
 * substring wins. Returns whatever `fn(calls)` returns.
 */
async function withFetch(routes, fn) {
  const original = globalThis.fetch
  const calls = []
  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : (input?.url ?? String(input))
    calls.push({ url, init })
    const route = routes.find((r) => url.includes(r.match))
    if (!route) throw new Error(`unstubbed fetch: ${url}`)
    if (route.networkError) throw new TypeError(route.networkError)
    const raw = typeof route.body === 'function' ? route.body(url, init) : route.body
    const body = raw === undefined ? '' : (typeof raw === 'string' ? raw : JSON.stringify(raw))
    return new Response(body, { status: route.status ?? 200, headers: route.headers ?? JSON_HEADERS })
  }
  try {
    return await fn(calls)
  } finally {
    globalThis.fetch = original
  }
}

function windowsOf(card) {
  return card.groups.flatMap((g) => g.windows)
}

/** A window may only carry percentages when it declares `quotaKind: 'usage'`. */
function assertNoPercent(win, label) {
  assert.equal(win.usedPercent, undefined, `${label}: usedPercent must be absent`)
  assert.equal(win.remainingPercent, undefined, `${label}: remainingPercent must be absent`)
  assert.notEqual(win.quotaKind, 'usage', `${label}: must not claim a quota ratio`)
}

function assertSignalsWired(calls, controller) {
  assert.ok(calls.length > 0, 'provider made at least one request')
  for (const call of calls) {
    assert.ok(call.init?.signal, `signal forwarded to ${call.url}`)
  }
  controller.abort()
  for (const call of calls) {
    assert.equal(call.init.signal.aborted, true, `signal propagates abort to ${call.url}`)
  }
}

// ---------------------------------------------------------------------------
// codex
// ---------------------------------------------------------------------------

test('codex: dual window parses real used_percent and credits', async () => {
  const controller = new AbortController()
  const { card, calls } = await withFetch(
    [{
      match: 'chatgpt.com/backend-api/wham/usage',
      body: {
        plan_type: 'plus',
        email: 'codex@example.com',
        rate_limit: {
          primary_window: { used_percent: 40, reset_at: 1790000000, limit_window_seconds: 18000 },
          secondary_window: { used_percent: 10, reset_at: 1795000000, limit_window_seconds: 604800 },
        },
        credits: { has_credits: true, balance: 12.5 },
      },
    }],
    async (calls) => {
      const res = await new CodexProvider().fetchCard(
        baseConfig(),
        { id: 'codex-1', provider: 'codex', oauth: { accessToken: 'codex-token', accountId: 'acct' } },
        controller.signal,
      )
      return { card: res.card, calls }
    },
  )

  const windows = windowsOf(card)
  const primary = windows.find((w) => w.id === 'codex-5h')
  assert.ok(primary)
  assert.equal(primary.quotaKind, 'usage')
  assert.equal(primary.usedPercent, 40)
  assert.equal(primary.remainingPercent, 60)
  assert.equal(primary.windowKind, '5h')
  assert.equal(new Date(primary.resetAt).getUTCFullYear(), 2026)

  const weekly = windows.find((w) => w.id === 'codex-weekly')
  assert.equal(weekly.usedPercent, 10)
  assert.equal(weekly.remainingPercent, 90)

  const credits = windows.find((w) => w.id === 'codex-credits')
  assert.ok(credits)
  assert.equal(credits.quotaKind, 'balance')
  assert.equal(credits.amountText, '$12.50')
  assertNoPercent(credits, 'codex credits')

  assert.equal(card.status, 'ok')
  assertSignalsWired(calls, controller)
})

test('codex: window without used_percent is unknown, never 0%/100%', async () => {
  const card = await withFetch(
    [{
      match: 'chatgpt.com/backend-api/wham/usage',
      body: {
        plan_type: 'plus',
        rate_limit: { primary_window: { reset_at: 1790000000 } },
      },
    }],
    async () => {
      const res = await new CodexProvider().fetchCard(
        baseConfig(),
        { id: 'codex-1', provider: 'codex', oauth: { accessToken: 'codex-token' } },
      )
      return res.card
    },
  )

  const windows = windowsOf(card)
  assert.equal(windows.length, 1)
  const win = windows[0]
  assert.equal(win.quotaKind, 'unknown')
  assertNoPercent(win, 'codex missing used_percent')
  assert.equal(win.status, 'unknown')
  assert.equal(win.subtitle, '额度状态未知')
  assert.equal(card.status, 'ok')
})

test('codex: 429 yields an error card (not a fabricated quota)', async () => {
  const card = await withFetch(
    [{ match: 'chatgpt.com/backend-api/wham/usage', status: 429, body: '{"error":"rate_limited"}' }],
    async () => {
      const res = await new CodexProvider().fetchCard(
        baseConfig(),
        { id: 'codex-1', provider: 'codex', oauth: { accessToken: 'codex-token' } },
      )
      return res.card
    },
  )
  assert.equal(card.status, 'error')
  assert.deepEqual(card.groups, [])
  assert.match(card.error, /429|限流|错误|失效/)
})

// ---------------------------------------------------------------------------
// cursor
// ---------------------------------------------------------------------------

test('cursor: plan windows parse percentages and second-based reset', async () => {
  const controller = new AbortController()
  const { card, calls } = await withFetch(
    [
      {
        match: 'cursor.com/api/usage-summary',
        body: {
          individualUsage: { plan: { enabled: true, autoPercentUsed: 20, apiPercentUsed: 60, totalPercentUsed: 20 } },
          startOfMonth: '2026-11-01T00:00:00.000Z',
        },
      },
      { match: 'cursor.com/api/auth/stripe', body: { membershipType: 'pro', currentPeriodEnd: 1798761600 } },
    ],
    async (calls) => {
      const res = await new CursorProvider().fetchCard(
        baseConfig(),
        { id: 'cursor-1', provider: 'cursor', sessionToken: 'WorkosCursorSessionToken=cookie' },
        controller.signal,
      )
      return { card: res.card, calls }
    },
  )

  const windows = windowsOf(card)
  const auto = windows.find((w) => w.id === 'cursor-auto')
  const api = windows.find((w) => w.id === 'cursor-named')
  assert.equal(auto.quotaKind, 'usage')
  assert.equal(auto.usedPercent, 20)
  assert.equal(auto.remainingPercent, 80)
  assert.equal(api.quotaKind, 'usage')
  assert.equal(api.usedPercent, 60)
  assert.equal(api.remainingPercent, 40)

  // currentPeriodEnd seconds must land in 2026/2027, not year 50000.
  assert.ok(auto.resetAt)
  assert.ok(new Date(auto.resetAt).getUTCFullYear() >= 2026)
  assert.ok(new Date(auto.resetAt).getUTCFullYear() < 2100)

  // No hardcoded "$20 API allowance" copy anywhere.
  for (const win of windows) assert.ok(!(win.subtitle ?? '').includes('$20'))

  assert.equal(card.status, 'ok')
  assertSignalsWired(calls, controller)
})

test('cursor: null percentage field stays unknown for that window only', async () => {
  const card = await withFetch(
    [
      {
        match: 'cursor.com/api/usage-summary',
        body: { individualUsage: { plan: { enabled: true, autoPercentUsed: null, apiPercentUsed: 60 } } },
      },
      { match: 'cursor.com/api/auth/stripe', status: 500, body: 'boom' },
    ],
    async () => {
      const res = await new CursorProvider().fetchCard(
        baseConfig(),
        { id: 'cursor-1', provider: 'cursor', sessionToken: 'cookie' },
      )
      return res.card
    },
  )

  const auto = windowsOf(card).find((w) => w.id === 'cursor-auto')
  const api = windowsOf(card).find((w) => w.id === 'cursor-named')
  assert.equal(auto.quotaKind, 'unknown')
  assertNoPercent(auto, 'cursor null autoPercentUsed')
  assert.equal(auto.status, 'unknown')
  assert.equal(api.remainingPercent, 40)
  // A failed stripe endpoint must not hide real usage data.
  assert.equal(card.status, 'ok')
})

test('cursor: missing plan is disabled, not error', async () => {
  const card = await withFetch(
    [
      { match: 'cursor.com/api/usage-summary', body: { individualUsage: {} } },
      { match: 'cursor.com/api/auth/stripe', body: {} },
    ],
    async () => {
      const res = await new CursorProvider().fetchCard(
        baseConfig(),
        { id: 'cursor-1', provider: 'cursor', sessionToken: 'cookie' },
      )
      return res.card
    },
  )
  assert.equal(card.status, 'disabled')
  assert.deepEqual(card.groups, [])
  assert.ok(card.error)
})

test('cursor: card warn tracks the worse of auto/api windows', async () => {
  const card = await withFetch(
    [
      {
        match: 'cursor.com/api/usage-summary',
        body: { individualUsage: { plan: { enabled: true, autoPercentUsed: 10, apiPercentUsed: 95 } } },
      },
      { match: 'cursor.com/api/auth/stripe', body: {} },
    ],
    async () => {
      const res = await new CursorProvider().fetchCard(
        baseConfig(),
        { id: 'cursor-1', provider: 'cursor', sessionToken: 'cookie' },
      )
      return res.card
    },
  )
  const api = windowsOf(card).find((w) => w.id === 'cursor-named')
  assert.equal(api.remainingPercent, 5)
  assert.equal(card.status, 'warn')
})

test('cursor: 401 yields an error card', async () => {
  const card = await withFetch(
    [
      { match: 'cursor.com/api/usage-summary', status: 401, body: '{"error":"unauthorized"}' },
      { match: 'cursor.com/api/auth/stripe', status: 401, body: '{}' },
    ],
    async () => {
      const res = await new CursorProvider().fetchCard(
        baseConfig(),
        { id: 'cursor-1', provider: 'cursor', sessionToken: 'cookie' },
      )
      return res.card
    },
  )
  assert.equal(card.status, 'error')
  assert.deepEqual(card.groups, [])
})

// ---------------------------------------------------------------------------
// antigravity
// ---------------------------------------------------------------------------

test('antigravity: null remainingFraction is unknown, valid bucket is usage', async () => {
  const controller = new AbortController()
  const { card, calls } = await withFetch(
    [{
      match: 'retrieveUserQuotaSummary',
      body: {
        plan: 'Ultra',
        groups: [{
          displayName: 'Gemini',
          buckets: [
            { bucketId: 'gemini-weekly', window: 'WINDOW_WEEKLY', remainingFraction: null },
            { bucketId: 'gemini-5h', window: 'WINDOW_5_HOUR', remainingFraction: 0.4, resetTime: '2026-11-07T00:00:00.000Z' },
          ],
        }],
      },
    }],
    async (calls) => {
      const res = await new AntigravityProvider().fetchCard(
        baseConfig(),
        { id: 'ag-1', provider: 'antigravity', oauth: { accessToken: 'ag-token', email: 'ag@example.com' } },
        controller.signal,
      )
      return { card: res.card, calls }
    },
  )

  const windows = windowsOf(card)
  const unknown = windows.find((w) => w.id === 'gemini-weekly')
  const valid = windows.find((w) => w.id === 'gemini-5h')
  assert.equal(unknown.quotaKind, 'unknown')
  assertNoPercent(unknown, 'antigravity null remainingFraction')
  assert.equal(unknown.status, 'unknown')
  assert.notEqual(unknown.status, 'exhausted')

  assert.equal(valid.quotaKind, 'usage')
  assert.equal(valid.remainingPercent, 40)
  assert.equal(valid.usedPercent, 60)
  assert.equal(card.status, 'ok')
  assertSignalsWired(calls, controller)
})

test('antigravity: empty groups + empty fallback is a partial card, not blank ok', async () => {
  const card = await withFetch(
    [
      { match: 'retrieveUserQuotaSummary', body: { groups: [] } },
      { match: 'fetchAvailableModels', body: { models: {} } },
    ],
    async () => {
      const res = await new AntigravityProvider().fetchCard(
        baseConfig(),
        { id: 'ag-1', provider: 'antigravity', oauth: { accessToken: 'ag-token', email: 'ag@example.com' } },
      )
      return res.card
    },
  )

  assert.notEqual(card.status, 'error')
  assert.equal(card.sourceProvenance.partial, true)
  const windows = windowsOf(card)
  assert.equal(windows.length, 1)
  assert.equal(windows[0].quotaKind, 'unknown')
  assertNoPercent(windows[0], 'antigravity no data')
  assert.match(windows[0].subtitle, /未返回/)
})

test('antigravity: fallback models path produces real percentages and partial provenance', async () => {
  const card = await withFetch(
    [
      { match: 'retrieveUserQuotaSummary', body: { groups: [] } },
      {
        match: 'fetchAvailableModels',
        body: {
          models: {
            'gemini-2.5-pro': {
              displayName: 'Gemini 2.5 Pro',
              quotaInfo: { remainingFraction: 0.25, resetTime: '2026-11-07T00:00:00.000Z' },
            },
          },
        },
      },
    ],
    async () => {
      const res = await new AntigravityProvider().fetchCard(
        baseConfig(),
        { id: 'ag-1', provider: 'antigravity', oauth: { accessToken: 'ag-token', email: 'ag@example.com' } },
      )
      return res.card
    },
  )

  const windows = windowsOf(card)
  assert.equal(windows.length, 1)
  assert.equal(windows[0].quotaKind, 'usage')
  assert.equal(windows[0].remainingPercent, 25)
  assert.equal(windows[0].usedPercent, 75)
  assert.equal(card.sourceProvenance.method, 'model-fallback')
  assert.equal(card.sourceProvenance.partial, true)
  assert.equal(card.status, 'ok')
})

test('antigravity: 401 on every endpoint is an error card', async () => {
  const card = await withFetch(
    [
      { match: 'retrieveUserQuotaSummary', status: 401, body: '{}' },
      { match: 'fetchAvailableModels', status: 401, body: '{}' },
    ],
    async () => {
      const res = await new AntigravityProvider().fetchCard(
        baseConfig(),
        { id: 'ag-1', provider: 'antigravity', oauth: { accessToken: 'ag-token', email: 'ag@example.com' } },
      )
      return res.card
    },
  )
  assert.equal(card.status, 'error')
  assert.match(card.error, /401/)
})

// ---------------------------------------------------------------------------
// custom_api
// ---------------------------------------------------------------------------

const CUSTOM_BASE = 'http://127.0.0.1:8787'
const customAccount = (extra = {}) => ({ id: 'relay-1', provider: 'custom_api', apiKey: 'relay-key', baseUrl: CUSTOM_BASE, ...extra })

test('custom_api: billing ratio uses the granted total as denominator', async () => {
  const controller = new AbortController()
  const { card, calls } = await withFetch(
    [
      { match: '/v1/models', body: { data: [] } },
      { match: '/v1/dashboard/billing/subscription', body: { hard_limit_usd: 100, total_usage: 25 } },
      { match: '/api/user/self', status: 404, body: '{}' },
    ],
    async (calls) => {
      const res = await new CustomApiProvider().fetchCard(baseConfig(), customAccount(), controller.signal)
      return { card: res.card, calls }
    },
  )

  const win = windowsOf(card)[0]
  assert.equal(win.quotaKind, 'usage')
  assert.equal(win.usedPercent, 25)
  assert.equal(win.remainingPercent, 75)
  assert.equal(card.balance.total, 100)
  assert.equal(card.balance.remaining, 75)
  assert.equal(card.status, 'ok')
  assertSignalsWired(calls, controller)
})

test('custom_api: OneAPI data.quota is remaining; used_quota reconstructs the total', async () => {
  const card = await withFetch(
    [
      { match: '/v1/models', body: { data: [] } },
      { match: '/v1/dashboard/billing/subscription', status: 404, body: '{}' },
      { match: '/api/user/self', body: { data: { quota: 250000, used_quota: 250000 } } },
    ],
    async () => {
      const res = await new CustomApiProvider().fetchCard(baseConfig(), customAccount())
      return res.card
    },
  )

  const win = windowsOf(card)[0]
  assert.equal(win.quotaKind, 'usage')
  assert.equal(win.usedPercent, 50)
  assert.equal(win.remainingPercent, 50)
  assert.equal(card.balance.total, 1)
  assert.equal(card.balance.remaining, 0.5)
})

test('custom_api: zero balance is 0%, never a fallback to 100%', async () => {
  const card = await withFetch(
    [
      { match: '/v1/models', body: { data: [] } },
      { match: '/v1/dashboard/billing/subscription', status: 404, body: '{}' },
      { match: '/api/user/self', body: { data: { quota: 0, used_quota: 500000 } } },
    ],
    async () => {
      const res = await new CustomApiProvider().fetchCard(baseConfig(), customAccount())
      return res.card
    },
  )

  const win = windowsOf(card)[0]
  assert.equal(win.quotaKind, 'usage')
  assert.equal(win.remainingPercent, 0)
  assert.equal(win.usedPercent, 100)
  assert.equal(win.status, 'exhausted')
  assert.equal(card.status, 'warn')
  assert.equal(card.balance.remaining, 0)
})

test('custom_api: remaining amount without a total is balance-only (no percentage)', async () => {
  const card = await withFetch(
    [
      { match: '/v1/models', body: { data: [] } },
      { match: '/v1/dashboard/billing/subscription', status: 404, body: '{}' },
      { match: '/api/user/self', body: { data: { quota: 100000 } } },
    ],
    async () => {
      const res = await new CustomApiProvider().fetchCard(baseConfig(), customAccount())
      return res.card
    },
  )

  const win = windowsOf(card)[0]
  assert.equal(win.quotaKind, 'balance')
  assert.equal(win.amountText, '$0.20')
  assertNoPercent(win, 'custom_api balance-only')
  assert.equal(card.balance.remaining, 0.2)
  assert.equal(card.balance.total, undefined)
})

test('custom_api: no billing endpoint yields liveness, never 0/100%', async () => {
  const card = await withFetch(
    [
      { match: '/v1/models', body: { data: [] } },
      { match: '/v1/dashboard/billing/subscription', status: 404, body: '{}' },
      { match: '/api/user/self', status: 404, body: '{}' },
    ],
    async () => {
      const res = await new CustomApiProvider().fetchCard(baseConfig(), customAccount())
      return res.card
    },
  )

  const win = windowsOf(card)[0]
  assert.equal(win.quotaKind, 'liveness')
  assertNoPercent(win, 'custom_api liveness')
  assert.match(win.subtitle, /未提供额度/)
  assert.equal(card.status, 'ok')
})

test('custom_api: unsafe base URL is rejected before any request', async () => {
  const { card, calls } = await withFetch([], async (calls) => {
    const res = await new CustomApiProvider().fetchCard(
      baseConfig(),
      customAccount({ baseUrl: 'http://169.254.169.254' }),
    )
    return { card: res.card, calls }
  })

  assert.equal(calls.length, 0, 'no outbound request for a blocked URL')
  assert.equal(card.status, 'error')
  assert.match(card.error, /安全策略/)
})

test('custom_api: 401 on /v1/models yields an error card', async () => {
  const card = await withFetch(
    [
      { match: '/v1/models', status: 401, body: '{"error":"bad key"}' },
      { match: '/v1/dashboard/billing/subscription', status: 401, body: '{}' },
      { match: '/api/user/self', status: 401, body: '{}' },
    ],
    async () => {
      const res = await new CustomApiProvider().fetchCard(baseConfig(), customAccount())
      return res.card
    },
  )
  assert.equal(card.status, 'error')
  assert.match(card.error, /401/)
})

// ---------------------------------------------------------------------------
// openai_billing
// ---------------------------------------------------------------------------

const OPENAI_BASE = 'http://127.0.0.1:8788'
const openaiAccount = (extra = {}) => ({ id: 'oai-1', provider: 'openai_billing', apiKey: 'sk-test', baseUrl: OPENAI_BASE, ...extra })

test('openai_billing: organization costs produce a real usage ratio', async () => {
  const controller = new AbortController()
  const { card, calls } = await withFetch(
    [
      { match: '/v1/models', body: { data: [] } },
      { match: '/v1/dashboard/billing/subscription', body: { hard_limit_usd: 100 } },
      { match: '/v1/organization/costs', body: { data: [{ results: [{ amount: { value: 25, currency: 'usd' } }] }] } },
      { match: '/v1/dashboard/billing/usage', body: { total_usage: 2500 } },
    ],
    async (calls) => {
      const res = await new OpenAIBillingProvider().fetchCard(baseConfig(), openaiAccount(), controller.signal)
      return { card: res.card, calls }
    },
  )

  const win = windowsOf(card)[0]
  assert.equal(win.quotaKind, 'usage')
  assert.equal(win.usedPercent, 25)
  assert.equal(win.remainingPercent, 75)
  assert.equal(card.balance.total, 100)
  assert.equal(card.balance.remaining, 75)
  assert.equal(card.sourceProvenance.partial, false)
  assertSignalsWired(calls, controller)
})

test('openai_billing: dashboard usage (cents) is used when organization costs fail', async () => {
  const card = await withFetch(
    [
      { match: '/v1/models', body: { data: [] } },
      { match: '/v1/dashboard/billing/subscription', body: { hard_limit_usd: 100 } },
      { match: '/v1/organization/costs', status: 404, body: '{}' },
      { match: '/v1/dashboard/billing/usage', body: { total_usage: 1234 } },
    ],
    async () => {
      const res = await new OpenAIBillingProvider().fetchCard(baseConfig(), openaiAccount())
      return res.card
    },
  )

  const win = windowsOf(card)[0]
  assert.equal(win.quotaKind, 'usage')
  assert.equal(win.usedPercent, 12)
  assert.equal(win.remainingPercent, 88)
  assert.equal(card.balance.used, 12.34)
  assert.equal(card.balance.remaining, 87.66)
  assert.equal(card.sourceProvenance.partial, false)
})

test('openai_billing: unreadable usage is unknown; remaining must not equal hardLimit', async () => {
  const card = await withFetch(
    [
      { match: '/v1/models', body: { data: [] } },
      { match: '/v1/dashboard/billing/subscription', body: { hard_limit_usd: 100 } },
      { match: '/v1/organization/costs', status: 403, body: '{"error":"admin key required"}' },
      { match: '/v1/dashboard/billing/usage', status: 403, body: '{"error":"forbidden"}' },
    ],
    async () => {
      const res = await new OpenAIBillingProvider().fetchCard(baseConfig(), openaiAccount())
      return res.card
    },
  )

  const win = windowsOf(card)[0]
  assert.equal(win.quotaKind, 'unknown')
  assertNoPercent(win, 'openai_billing unknown usage')
  assert.equal(win.status, 'unknown')
  assert.match(win.subtitle, /无法获取用量/)
  assert.equal(card.status, 'ok')
  assert.equal(card.balance.total, 100)
  // The old bug reported `remaining === hardLimit` (100) forever.
  assert.notEqual(card.balance.remaining, 100)
  assert.equal(card.balance.remaining, undefined)
  assert.equal(card.sourceProvenance.partial, true)
})

test('openai_billing: 401 on /v1/models yields an error card', async () => {
  const card = await withFetch(
    [
      { match: '/v1/models', status: 401, body: '{"error":"invalid key"}' },
      { match: '/v1/dashboard/billing/subscription', status: 401, body: '{}' },
      { match: '/v1/organization/costs', status: 401, body: '{}' },
      { match: '/v1/dashboard/billing/usage', status: 401, body: '{}' },
    ],
    async () => {
      const res = await new OpenAIBillingProvider().fetchCard(baseConfig(), openaiAccount())
      return res.card
    },
  )
  assert.equal(card.status, 'error')
  assert.deepEqual(card.groups, [])
})

// ---------------------------------------------------------------------------
// opencode_go
// ---------------------------------------------------------------------------

const OPENCODE_BASE = 'http://127.0.0.1:8789'
const opencodeAccount = (extra = {}) => ({ id: 'oc-1', provider: 'opencode_go', apiKey: 'oc-key', baseUrl: OPENCODE_BASE, ...extra })

test('opencode_go: rolling/weekly/monthly windows with second-based reset', async () => {
  const controller = new AbortController()
  const { card, calls } = await withFetch(
    [{
      match: '/zen/go/v1/usage',
      body: {
        usage: {
          rolling: { percent: 30, resetsAt: 1790000000 },
          weekly: { percent: 10, resetsAt: '2027-01-01T00:00:00.000Z' },
          monthly: { percent: 5 },
        },
      },
    }],
    async (calls) => {
      const res = await new OpenCodeGoProvider().fetchCard(baseConfig(), opencodeAccount(), controller.signal)
      return { card: res.card, calls }
    },
  )

  const windows = windowsOf(card)
  const rolling = windows.find((w) => w.id === 'opencode-rolling')
  const weekly = windows.find((w) => w.id === 'opencode-weekly')
  const monthly = windows.find((w) => w.id === 'opencode-monthly')

  assert.equal(rolling.quotaKind, 'usage')
  assert.equal(rolling.usedPercent, 30)
  assert.equal(rolling.remainingPercent, 70)
  assert.equal(rolling.windowKind, 'sliding')
  assert.equal(new Date(rolling.resetAt).getUTCFullYear(), 2026)
  assert.equal(weekly.remainingPercent, 90)
  assert.equal(new Date(weekly.resetAt).toISOString(), '2027-01-01T00:00:00.000Z')
  assert.equal(monthly.remainingPercent, 95)
  assert.equal(monthly.resetAt, undefined)

  assert.equal(card.status, 'ok')
  assert.equal(card.sourceProvenance.partial, false)
  assertSignalsWired(calls, controller)
})

test('opencode_go: missing percent is unknown, never 0%/100%', async () => {
  const card = await withFetch(
    [{ match: '/zen/go/v1/usage', body: { usage: { rolling: { resetsAt: 1790000000 } } } }],
    async () => {
      const res = await new OpenCodeGoProvider().fetchCard(baseConfig(), opencodeAccount())
      return res.card
    },
  )

  const windows = windowsOf(card)
  assert.equal(windows.length, 1)
  assert.equal(windows[0].quotaKind, 'unknown')
  assertNoPercent(windows[0], 'opencode missing percent')
  assert.equal(windows[0].status, 'unknown')
  assert.equal(card.status, 'ok')
  assert.equal(card.sourceProvenance.partial, true)
})

test('opencode_go: 429 yields an error card with a clear message', async () => {
  const card = await withFetch(
    [{ match: '/zen/go/v1/usage', status: 429, body: '{"error":"rate limited"}' }],
    async () => {
      const res = await new OpenCodeGoProvider().fetchCard(baseConfig(), opencodeAccount())
      return res.card
    },
  )
  assert.equal(card.status, 'error')
  assert.deepEqual(card.groups, [])
  assert.match(card.error, /429|限流/)
})
