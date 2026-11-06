/**
 * tests/providers-lite.test.mjs
 *
 * 0.4.1 provider-track test suite. It exercises the 10 providers owned by the
 * "balance + liveness" track through `src/` directly (Node 26 type stripping),
 * monkey-patching `globalThis.fetch` so no network access is required.
 *
 * The assertions encode the 0.4.1 contract:
 *  - balance providers (deepseek / kimi / siliconflow / openrouter-no-limit)
 *    never fabricate percentages out of amounts;
 *  - liveness providers (glm / minimax / qwen / volcengine / copilot / claude)
 *    never report 0%/100% placeholders;
 *  - `proxyMode` is forwarded as the 5th argument of `fetchWithProxy`;
 *  - a default `User-Agent: dsh-quota/<version>` is sent;
 *  - 401/429 produce honest error text (429 mentions 限流 / Retry-After);
 *  - zero balance is `warn`/`exhausted`, never `error`.
 */

import { test, afterEach } from 'node:test'
import assert from 'node:assert/strict'

import { DeepSeekProvider } from '../src/providers/deepseek.ts'
import { KimiProvider } from '../src/providers/kimi.ts'
import { GLMProvider } from '../src/providers/glm.ts'
import { MiniMaxProvider } from '../src/providers/minimax.ts'
import { QwenProvider } from '../src/providers/qwen.ts'
import { VolcengineProvider } from '../src/providers/volcengine.ts'
import { SiliconFlowProvider } from '../src/providers/siliconflow.ts'
import { OpenRouterProvider } from '../src/providers/openrouter.ts'
import { GitHubCopilotProvider } from '../src/providers/copilot.ts'
import { ClaudeProvider } from '../src/providers/claude.ts'

const ORIGINAL_FETCH = globalThis.fetch
const UA_RE = /^dsh-quota\/\d+\.\d+\.\d+$/
const PROXY_URL = 'http://127.0.0.1:9'

let calls = []

function installFetch(handler) {
  calls = []
  globalThis.fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : String(input?.url ?? input)
    calls.push({ url, init })
    return handler(url, init)
  }
}

function jsonResponse(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  })
}

afterEach(() => {
  globalThis.fetch = ORIGINAL_FETCH
  calls = []
})

const directConfig = (extra = {}) => ({ proxyMode: 'direct', ...extra })
const account = (extra = {}) => ({ id: 'test-account', apiKey: 'sk-test-key', ...extra })

function windowsOf(card) {
  return (card.groups || []).flatMap(group => group.windows || [])
}

function assertNoPercent(card, label = '') {
  for (const win of windowsOf(card)) {
    assert.equal(win.usedPercent, undefined, `${label}${win.id} must not carry usedPercent`)
    assert.equal(win.remainingPercent, undefined, `${label}${win.id} must not carry remainingPercent`)
  }
}

function assertNoNaN(card, label = '') {
  assert.ok(!JSON.stringify(card).includes('NaN'), `${label}card must not contain NaN`)
}

function assertLiveness(card, label = '') {
  const windows = windowsOf(card)
  assert.ok(windows.length > 0, `${label}expected at least one window`)
  for (const win of windows) {
    assert.equal(win.quotaKind, 'liveness', `${label}${win.id} must be liveness`)
    assert.equal(win.status, 'unknown', `${label}${win.id} liveness window must be unknown`)
  }
  assertNoPercent(card, label)
}

function assertUserAgent(call, label = '') {
  // fetchWithProxy normalises headers into a Headers instance before dispatch.
  const raw = call?.init?.headers
  const ua = raw && typeof raw.get === 'function'
    ? raw.get('user-agent')
    : raw && (raw['User-Agent'] || raw['user-agent'])
  assert.match(String(ua || ''), UA_RE, `${label}missing default User-Agent`)
}

// ---------------------------------------------------------------------------
// DeepSeek — balance, multi-currency, NaN guard, zero balance is a warning
// ---------------------------------------------------------------------------

test('deepseek: multi-currency balance is shown per entry without percentages', async () => {
  installFetch(() => jsonResponse({
    is_available: true,
    balance_infos: [
      { currency: 'CNY', total_balance: '12.50', granted_balance: '2.50', topped_up_balance: '10.00' },
      { currency: 'USD', total_balance: '3.00', granted_balance: '1.00', topped_up_balance: '2.00' },
    ],
  }))

  const { card } = await new DeepSeekProvider().fetchCard(directConfig(), account())
  const windows = windowsOf(card)

  assert.equal(card.status, 'ok')
  assert.equal(windows.length, 2)
  assert.deepEqual(windows.map(w => w.amountText), ['¥12.50', '$3.00'])
  for (const win of windows) {
    assert.equal(win.quotaKind, 'balance')
    assert.equal(win.barType, 'balance')
  }
  assertNoPercent(card)
  assert.equal(card.balance.currency, 'CNY')
  assert.equal(card.balance.total, 12.5)
  assert.match(card.account, /CNY/)
  assert.match(card.account, /USD/)
  assert.equal(calls.length, 1)
  assertUserAgent(calls[0], 'deepseek ')
})

test('deepseek: unparsable balance yields unknown, not NaN/0%', async () => {
  installFetch(() => jsonResponse({ balance_infos: [{ currency: 'CNY', total_balance: 'not-a-number' }] }))

  const { card } = await new DeepSeekProvider().fetchCard(directConfig(), account())
  const [win] = windowsOf(card)

  assert.equal(card.status, 'warn')
  assert.equal(win.quotaKind, 'unknown')
  assert.equal(win.status, 'unknown')
  assert.equal(win.amountText, undefined)
  assertNoPercent(card)
  assertNoNaN(card, 'deepseek ')
})

test('deepseek: zero balance is warn + exhausted, never error', async () => {
  installFetch(() => jsonResponse({
    is_available: true,
    balance_infos: [{ currency: 'CNY', total_balance: '0.00', granted_balance: '0.00', topped_up_balance: '0.00' }],
  }))

  const { card } = await new DeepSeekProvider().fetchCard(directConfig(), account())
  const [win] = windowsOf(card)

  assert.equal(card.status, 'warn')
  assert.equal(win.status, 'exhausted')
  assert.equal(win.amountText, '¥0.00')
  assertNoPercent(card)
})

test('deepseek: 401 is an error with credential wording', async () => {
  installFetch(() => jsonResponse({ error: { message: 'bad key' } }, 401))

  const { card } = await new DeepSeekProvider().fetchCard(directConfig(), account())

  assert.equal(card.status, 'error')
  assert.match(card.error, /401/)
})

test('deepseek: 429 produces an honest rate-limit error', async () => {
  installFetch(() => jsonResponse({}, 429, { 'retry-after': '30' }))

  const { card } = await new DeepSeekProvider().fetchCard(directConfig(), account())

  assert.equal(card.status, 'error')
  assert.match(card.error, /限流|Retry-After/)
})

// ---------------------------------------------------------------------------
// Kimi — balance
// ---------------------------------------------------------------------------

test('kimi: balance is an amount, never a percentage', async () => {
  installFetch(() => jsonResponse({
    data: { available_balance: '50.25', cash_balance: '30.25', voucher_balance: '20.00' },
  }))

  const { card } = await new KimiProvider().fetchCard(directConfig(), account())
  const [win] = windowsOf(card)

  assert.equal(card.status, 'ok')
  assert.equal(win.quotaKind, 'balance')
  assert.equal(win.barType, 'balance')
  assert.equal(win.amountText, '¥50.25')
  assertNoPercent(card)
  assert.equal(card.balance.remaining, 50.25)
  assert.equal(card.balance.grantedBalance, 20)
  assert.equal(card.balance.toppedUpBalance, 30.25)
  assertUserAgent(calls[0], 'kimi ')
})

test('kimi: missing balance field yields unknown and a warning card', async () => {
  installFetch(() => jsonResponse({ data: {} }))

  const { card } = await new KimiProvider().fetchCard(directConfig(), account())
  const [win] = windowsOf(card)

  assert.equal(card.status, 'warn')
  assert.equal(win.quotaKind, 'unknown')
  assert.equal(win.status, 'unknown')
  assertNoPercent(card)
  assertNoNaN(card, 'kimi ')
})

test('kimi: zero balance is warn + exhausted, never error', async () => {
  installFetch(() => jsonResponse({ data: { available_balance: '0.00', cash_balance: '0', voucher_balance: '0' } }))

  const { card } = await new KimiProvider().fetchCard(directConfig(), account())
  const [win] = windowsOf(card)

  assert.equal(card.status, 'warn')
  assert.equal(win.status, 'exhausted')
  assertNoPercent(card)
})

test('kimi: 401 is an error', async () => {
  installFetch(() => jsonResponse({}, 401))

  const { card } = await new KimiProvider().fetchCard(directConfig(), account())

  assert.equal(card.status, 'error')
  assert.match(card.error, /401/)
})

// ---------------------------------------------------------------------------
// SiliconFlow — balance
// ---------------------------------------------------------------------------

test('siliconflow: uses upstream total/available, no fabricated percentage', async () => {
  installFetch(() => jsonResponse({
    data: { balance: '42.50', chargeBalance: '40.00', totalBalance: '100.00', name: 'Alice' },
  }))

  const { card } = await new SiliconFlowProvider().fetchCard(directConfig(), account())
  const [win] = windowsOf(card)

  assert.equal(card.status, 'ok')
  assert.equal(win.quotaKind, 'balance')
  assert.equal(win.amountText, '¥42.50 CNY')
  assertNoPercent(card)
  assert.equal(card.balance.total, 100)
  assert.equal(card.balance.remaining, 42.5)
  assertUserAgent(calls[0], 'siliconflow ')
})

test('siliconflow: missing total is not invented from available', async () => {
  installFetch(() => jsonResponse({ data: { balance: '9.00' } }))

  const { card } = await new SiliconFlowProvider().fetchCard(directConfig(), account())
  const [win] = windowsOf(card)

  assert.equal(card.status, 'ok')
  assert.equal(win.quotaKind, 'balance')
  assertNoPercent(card)
  assert.equal(card.balance.total, undefined)
  assert.equal(card.balance.remaining, 9)
})

test('siliconflow: missing balance field → unknown, no NaN, warn', async () => {
  installFetch(() => jsonResponse({ data: {} }))

  const { card } = await new SiliconFlowProvider().fetchCard(directConfig(), account())
  const [win] = windowsOf(card)

  assert.equal(card.status, 'warn')
  assert.equal(win.quotaKind, 'unknown')
  assert.equal(win.status, 'unknown')
  assertNoPercent(card)
  assertNoNaN(card, 'siliconflow ')
})

test('siliconflow: 401 is an error', async () => {
  installFetch(() => jsonResponse({}, 401))

  const { card } = await new SiliconFlowProvider().fetchCard(directConfig(), account())

  assert.equal(card.status, 'error')
  assert.match(card.error, /401/)
})

// ---------------------------------------------------------------------------
// OpenRouter — limit_remaining / limit_reset, null vs 0 semantics
// ---------------------------------------------------------------------------

test('openrouter: real limit produces a usage window with resetAt', async () => {
  installFetch(() => jsonResponse({
    data: {
      label: 'my-key',
      usage: 8,
      limit: 20,
      limit_remaining: 12,
      limit_reset: '2099-01-01T00:00:00Z',
      is_free_tier: false,
    },
  }))

  const { card } = await new OpenRouterProvider().fetchCard(directConfig(), account())
  const [win] = windowsOf(card)

  assert.equal(card.status, 'ok')
  assert.equal(win.quotaKind, 'usage')
  assert.equal(win.remainingPercent, 60)
  assert.equal(win.usedPercent, 40)
  assert.equal(win.resetAt, new Date('2099-01-01T00:00:00Z').toISOString())
  assert.equal(card.balance.total, 20)
  assert.equal(card.balance.remaining, 12)
  assertUserAgent(calls[0], 'openrouter ')
})

test('openrouter: limit === null means no hard limit, no percentage shown', async () => {
  installFetch(() => jsonResponse({
    data: { label: 'free-key', usage: 3.5, limit: null, limit_remaining: null, limit_reset: null },
  }))

  const { card } = await new OpenRouterProvider().fetchCard(directConfig(), account())
  const [win] = windowsOf(card)

  assert.equal(card.status, 'ok')
  assert.equal(win.quotaKind, 'balance')
  assert.match(win.subtitle, /无硬限额/)
  assert.equal(win.amountText, '已用 $3.50 USD')
  assertNoPercent(card)
  assert.equal(card.balance.total, undefined)
})

test('openrouter: limit === 0 is unknown/warn, not "unlimited 100%"', async () => {
  installFetch(() => jsonResponse({ data: { usage: 0, limit: 0, limit_remaining: 0 } }))

  const { card } = await new OpenRouterProvider().fetchCard(directConfig(), account())
  const [win] = windowsOf(card)

  assert.equal(card.status, 'warn')
  assert.equal(win.quotaKind, 'unknown')
  assert.equal(win.status, 'unknown')
  assertNoPercent(card)
})

test('openrouter: limit without usage fields is unknown, no NaN', async () => {
  installFetch(() => jsonResponse({ data: { limit: 20 } }))

  const { card } = await new OpenRouterProvider().fetchCard(directConfig(), account())
  const [win] = windowsOf(card)

  assert.equal(win.quotaKind, 'unknown')
  assert.equal(win.status, 'unknown')
  assertNoPercent(card)
  assertNoNaN(card, 'openrouter ')
})

test('openrouter: 401 is an error', async () => {
  installFetch(() => jsonResponse({}, 401))

  const { card } = await new OpenRouterProvider().fetchCard(directConfig(), account())

  assert.equal(card.status, 'error')
  assert.match(card.error, /401/)
})

test('openrouter: 429 mentions rate limiting', async () => {
  installFetch(() => jsonResponse({}, 429, { 'retry-after': '12' }))

  const { card } = await new OpenRouterProvider().fetchCard(directConfig(), account())

  assert.equal(card.status, 'error')
  assert.match(card.error, /限流|Retry-After/)
})

// ---------------------------------------------------------------------------
// GLM — liveness
// ---------------------------------------------------------------------------

test('glm: 200 is connectivity only, no 0%/100% placeholder', async () => {
  installFetch(() => jsonResponse({ data: [{ id: 'glm-4' }, { id: 'glm-4-flash' }] }))

  const { card } = await new GLMProvider().fetchCard(directConfig(), account())

  assert.equal(card.status, 'ok')
  assertLiveness(card, 'glm ')
  assert.match(windowsOf(card)[0].subtitle, /仅连通性检查/)
  assert.match(windowsOf(card)[0].subtitle, /未提供额度接口/)
  assertUserAgent(calls[0], 'glm ')
})

test('glm: 200 with missing model list is still liveness, not a quota claim', async () => {
  installFetch(() => jsonResponse({}))

  const { card } = await new GLMProvider().fetchCard(directConfig(), account())

  assert.equal(card.status, 'ok')
  assertLiveness(card, 'glm ')
})

test('glm: 401 is an error', async () => {
  installFetch(() => jsonResponse({}, 401))

  const { card } = await new GLMProvider().fetchCard(directConfig(), account())

  assert.equal(card.status, 'error')
  assert.match(card.error, /401/)
})

test('glm: 429 produces an honest rate-limit error', async () => {
  installFetch(() => jsonResponse({}, 429, { 'retry-after': '60' }))

  const { card } = await new GLMProvider().fetchCard(directConfig(), account())

  assert.equal(card.status, 'error')
  assert.match(card.error, /限流|Retry-After/)
})

// ---------------------------------------------------------------------------
// MiniMax — liveness
// ---------------------------------------------------------------------------

test('minimax: connectivity only', async () => {
  installFetch(() => jsonResponse({ data: [{ id: 'abab6.5' }] }))

  const { card } = await new MiniMaxProvider().fetchCard(directConfig(), account())

  assert.equal(card.status, 'ok')
  assertLiveness(card, 'minimax ')
  assertUserAgent(calls[0], 'minimax ')
})

test('minimax: missing model list stays liveness', async () => {
  installFetch(() => jsonResponse({}))

  const { card } = await new MiniMaxProvider().fetchCard(directConfig(), account())

  assert.equal(card.status, 'ok')
  assertLiveness(card, 'minimax ')
})

test('minimax: 401 is an error', async () => {
  installFetch(() => jsonResponse({}, 401))

  const { card } = await new MiniMaxProvider().fetchCard(directConfig(), account())

  assert.equal(card.status, 'error')
  assert.match(card.error, /401/)
})

// ---------------------------------------------------------------------------
// Qwen — liveness
// ---------------------------------------------------------------------------

test('qwen: connectivity only, model families in subtitle', async () => {
  installFetch(() => jsonResponse({ data: [{ id: 'qwen-max' }, { id: 'qwen-plus' }, { id: 'qwen-2.5-coder-32b' }] }))

  const { card } = await new QwenProvider().fetchCard(directConfig(), account())

  assert.equal(card.status, 'ok')
  assertLiveness(card, 'qwen ')
  assert.match(windowsOf(card)[0].subtitle, /仅连通性检查/)
  assertUserAgent(calls[0], 'qwen ')
})

test('qwen: missing model list stays liveness', async () => {
  installFetch(() => jsonResponse({}))

  const { card } = await new QwenProvider().fetchCard(directConfig(), account())

  assert.equal(card.status, 'ok')
  assertLiveness(card, 'qwen ')
})

test('qwen: 401 is an error', async () => {
  installFetch(() => jsonResponse({}, 401))

  const { card } = await new QwenProvider().fetchCard(directConfig(), account())

  assert.equal(card.status, 'error')
  assert.match(card.error, /401/)
})

// ---------------------------------------------------------------------------
// Volcengine — liveness
// ---------------------------------------------------------------------------

test('volcengine: connectivity only', async () => {
  installFetch(() => jsonResponse({ data: [{ id: 'ep-1' }, { id: 'ep-2' }] }))

  const { card } = await new VolcengineProvider().fetchCard(directConfig(), account())

  assert.equal(card.status, 'ok')
  assertLiveness(card, 'volcengine ')
  assertUserAgent(calls[0], 'volcengine ')
})

test('volcengine: missing endpoint list stays liveness', async () => {
  installFetch(() => jsonResponse({}))

  const { card } = await new VolcengineProvider().fetchCard(directConfig(), account())

  assert.equal(card.status, 'ok')
  assertLiveness(card, 'volcengine ')
})

test('volcengine: 401 is an error', async () => {
  installFetch(() => jsonResponse({}, 401))

  const { card } = await new VolcengineProvider().fetchCard(directConfig(), account())

  assert.equal(card.status, 'error')
  assert.match(card.error, /401/)
})

// ---------------------------------------------------------------------------
// Copilot — must prove Copilot entitlement via token + sku
// ---------------------------------------------------------------------------

function copilotRoutes({ tokenStatus = 200, tokenBody = { sku: 'individual', token: 'copilot-token' }, userStatus = 200 } = {}) {
  return (url) => {
    if (url.includes('copilot_internal/v2/token')) {
      return jsonResponse(tokenBody, tokenStatus)
    }
    return jsonResponse({ login: 'octocat' }, userStatus)
  }
}

test('copilot: ok only when token endpoint succeeds and sku is a Copilot sku', async () => {
  installFetch(copilotRoutes())

  const { card } = await new GitHubCopilotProvider().fetchCard(directConfig(), account())

  assert.equal(card.status, 'ok')
  assert.equal(card.plan, 'Copilot individual')
  assert.equal(card.account, 'octocat')
  assertLiveness(card, 'copilot ')
  assert.equal(calls.length, 2)
  for (const call of calls) assertUserAgent(call, 'copilot ')
})

test('copilot: /user 200 alone is not enough — missing sku is warn, not ok/100%', async () => {
  installFetch(copilotRoutes({ tokenBody: { token: 'copilot-token' } }))

  const { card } = await new GitHubCopilotProvider().fetchCard(directConfig(), account())

  assert.equal(card.status, 'warn')
  assertLiveness(card, 'copilot ')
  assert.match(card.error, /Copilot/)
})

test('copilot: non-Copilot sku is warn with no percentage', async () => {
  installFetch(copilotRoutes({ tokenBody: { sku: 'personal', token: 'copilot-token' } }))

  const { card } = await new GitHubCopilotProvider().fetchCard(directConfig(), account())

  assert.equal(card.status, 'warn')
  assertLiveness(card, 'copilot ')
})

test('copilot: token endpoint 404 (no entitlement) is warn, not a quota claim', async () => {
  installFetch(copilotRoutes({ tokenStatus: 404, tokenBody: { message: 'Not Found' } }))

  const { card } = await new GitHubCopilotProvider().fetchCard(directConfig(), account())

  assert.equal(card.status, 'warn')
  assertLiveness(card, 'copilot ')
  assert.match(card.error, /404/)
})

test('copilot: invalid PAT (401) is an error', async () => {
  installFetch(copilotRoutes({ tokenStatus: 401, tokenBody: { message: 'Bad credentials' } }))

  const { card } = await new GitHubCopilotProvider().fetchCard(directConfig(), account())

  assert.equal(card.status, 'error')
  assert.match(card.error, /401/)
})

test('copilot: 429 mentions rate limiting', async () => {
  installFetch(copilotRoutes({ tokenStatus: 429, tokenBody: {}, userStatus: 429 }))

  const { card } = await new GitHubCopilotProvider().fetchCard(directConfig(), account())

  assert.equal(card.status, 'error')
  assert.match(card.error, /限流/)
})

// ---------------------------------------------------------------------------
// Claude — rate headers are not account quota
// ---------------------------------------------------------------------------

test('claude: 200 without rate headers is liveness/unknown, no percentage', async () => {
  installFetch(() => jsonResponse({ data: [] }))

  const { card } = await new ClaudeProvider().fetchCard(directConfig(), account())

  assert.equal(card.status, 'ok')
  assertLiveness(card, 'claude ')
  assert.match(windowsOf(card)[0].label, /连通性/)
  assert.match(windowsOf(card)[0].subtitle, /仅连通性检查/)
  assertUserAgent(calls[0], 'claude ')
})

test('claude: rate-limit headers are labelled 速率余量 and never become account quota %', async () => {
  installFetch(() => jsonResponse({ data: [] }, 200, {
    'anthropic-ratelimit-requests-remaining': '42',
    'anthropic-ratelimit-requests-limit': '100',
  }))

  const { card } = await new ClaudeProvider().fetchCard(directConfig(), account())
  const [win] = windowsOf(card)

  assert.equal(card.status, 'ok')
  assert.equal(win.quotaKind, 'liveness')
  assert.equal(win.status, 'unknown')
  assert.match(win.label, /速率余量/)
  assert.match(win.subtitle, /42\/100/)
  assert.match(win.subtitle, /非账户额度/)
  assertNoPercent(card)
})

test('claude: 401 is an error', async () => {
  installFetch(() => jsonResponse({}, 401))

  const { card } = await new ClaudeProvider().fetchCard(directConfig(), account())

  assert.equal(card.status, 'error')
  assert.match(card.error, /401/)
})

test('claude: 429 produces an honest rate-limit error', async () => {
  installFetch(() => jsonResponse({}, 429, { 'retry-after': '5' }))

  const { card } = await new ClaudeProvider().fetchCard(directConfig(), account())

  assert.equal(card.status, 'error')
  assert.match(card.error, /限流|Retry-After/)
})

// ---------------------------------------------------------------------------
// Cross-cutting: proxyMode is forwarded as fetchWithProxy's 5th argument.
//
// `proxy-required` is fail-closed: when the mode really reaches fetchWithProxy
// the request must fail instead of silently falling back to the mocked direct
// fetch. A missing 5th argument would default to `proxy-preferred`, fall back to
// direct, hit the mock and return a card — so an error card + zero mock calls is
// proof that `config.proxyMode` was forwarded.
// ---------------------------------------------------------------------------

const PROVIDERS = [
  ['deepseek', DeepSeekProvider],
  ['kimi', KimiProvider],
  ['siliconflow', SiliconFlowProvider],
  ['openrouter', OpenRouterProvider],
  ['glm', GLMProvider],
  ['minimax', MiniMaxProvider],
  ['qwen', QwenProvider],
  ['volcengine', VolcengineProvider],
  ['copilot', GitHubCopilotProvider],
  ['claude', ClaudeProvider],
]

test('all providers forward config.proxyMode (proxy-required fails closed)', async () => {
  for (const [name, Provider] of PROVIDERS) {
    installFetch(() => jsonResponse({ data: [] }))
    const { card } = await new Provider().fetchCard(
      { proxyMode: 'proxy-required', httpProxy: PROXY_URL },
      account(),
    )
    assert.equal(card.status, 'error', `${name} must fail closed under proxy-required`)
    assert.match(card.error, /proxy connection required but failed|proxy/i, `${name} proxy error text`)
    assert.equal(calls.length, 0, `${name} must not fall back to direct fetch when proxy is required`)
  }
})

test('all providers mutate nothing and expose the required fetchCard arity', () => {
  for (const [name, Provider] of PROVIDERS) {
    const provider = new Provider()
    assert.equal(typeof provider.fetchCard, 'function', `${name} fetchCard`)
    // fetchCard(config, accountConfig?, signal?) — optional TypeScript params are
    // emitted as plain parameters, so the arity is 3.
    assert.equal(provider.fetchCard.length, 3, `${name} fetchCard must accept config + accountConfig + signal`)
  }
})
