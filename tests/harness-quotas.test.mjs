// Security-focused tests for the native Harness quota backend.
// Every credential/token below is fabricated; no filesystem, real credential,
// global fetch, or network access is used.
import test from 'node:test'
import assert from 'node:assert/strict'
import { createQuotaMonitor } from '../src/harness/quotas.ts'

const T0 = 1_700_000_000_000
const CODEX_URL = 'https://chatgpt.com/backend-api/wham/usage'
const CLAUDE_URL = 'https://api.anthropic.com/api/oauth/usage'
const DEEPSEEK_URL = 'https://api.deepseek.com/user/balance'

const CODEX_RECORD = 'llm-pi-ai/openai-codex'
const CLAUDE_RECORD = 'llm-pi-ai/anthropic'

const FAKE_CODEX_ACCESS = 'FAKE_CODEX_ACCESS_TOKEN_123'
const FAKE_CLAUDE_ACCESS = 'FAKE_CLAUDE_ACCESS_TOKEN_456'
const FAKE_DEEPSEEK_KEY = 'FAKE_DEEPSEEK_API_KEY_789'
const FAKE_REFRESH = 'FAKE_REFRESH_TOKEN_000'

function delay(ms) {
  return new Promise(resolve => setTimeout(resolve, ms))
}

function json(body, init = {}) {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  })
}

function grant(access, extra = {}) {
  return {
    kind: 'grant',
    payload: {
      type: 'oauth',
      access,
      refresh: FAKE_REFRESH,
      expires: T0 + 3_600_000,
      ...extra,
    },
  }
}

function fakeCredentials(records = {}, resolved = {}) {
  const calls = []
  return {
    calls,
    service: {
      async readRecord(key) {
        calls.push(['readRecord', key])
        return records[key]
      },
      async resolve(ref) {
        calls.push(['resolve', ref])
        return Object.hasOwn(resolved, ref) ? { value: resolved[ref], source: 'test' } : undefined
      },
      async listRecords() {
        throw new Error('listRecords must never be called')
      },
      async modifyRecord() {
        throw new Error('modifyRecord must never be called')
      },
      async deleteRecord() {
        throw new Error('deleteRecord must never be called')
      },
    },
  }
}

function fakeDeepSeek(balance) {
  const calls = []
  return {
    calls,
    service: {
      async getBalance(client) {
        calls.push(client)
        if (typeof balance === 'function') return balance(client)
        return balance
      },
    },
  }
}

function cordisContext(services = {}) {
  const target = {
    get(name) {
      if (Object.hasOwn(services, name)) return services[name]
      throw new Error(`Cordis service ${name} is not provided`)
    },
  }
  return new Proxy(target, {
    get(object, property, receiver) {
      if (property in object) return Reflect.get(object, property, receiver)
      // Cordis throws for a service the plugin did not declare in `inject`;
      // optional services must therefore be read through ctx.get().
      throw new Error(`Cordis service ${String(property)} is not declared`)
    },
  })
}

function fakeFetch(handlers) {
  const calls = []
  const fetch = async (input, init = {}) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.toString() : input.url
    calls.push({ url, init })
    const handler = handlers[url]
    if (handler === undefined) throw new Error(`unexpected request destination: ${url}`)
    return handler(init)
  }
  return { fetch, calls }
}

function standardBodies() {
  const resetAt = 1_700_003_600
  const weeklyResetAt = 1_700_500_000
  return {
    codex: {
      plan_type: 'plus',
      rate_limit: {
        allowed: true,
        primary_window: { used_percent: 25, limit_window_seconds: 18_000, reset_at: resetAt },
        secondary_window: { used_percent: 40, limit_window_seconds: 604_800, reset_at: weeklyResetAt },
      },
      credits: { has_credits: false, unlimited: true, balance: null },
    },
    claude: {
      five_hour: { utilization: 10, resets_at: '2026-01-01T05:00:00Z' },
      seven_day: { utilization: 20, resets_at: '2026-01-07T00:00:00Z' },
      seven_day_opus: { utilization: 30, resets_at: '2026-01-07T00:00:00Z' },
      seven_day_sonnet: null,
      extra_usage: { is_enabled: false },
    },
    deepseek: {
      is_available: true,
      balance_infos: [
        { currency: 'USD', total_balance: '5.00', granted_balance: '1.00', topped_up_balance: '4.00' },
      ],
    },
  }
}

function fullRecords(extra = {}) {
  return {
    [CODEX_RECORD]: grant(FAKE_CODEX_ACCESS, { accountId: 'acct_fake_123' }),
    [CLAUDE_RECORD]: grant(FAKE_CLAUDE_ACCESS),
    ...extra,
  }
}

function deepseekReference() {
  return { DEEPSEEK_API_KEY: FAKE_DEEPSEEK_KEY }
}

function standardHandlers(bodies = standardBodies()) {
  return {
    [CODEX_URL]: async () => json(bodies.codex),
    [CLAUDE_URL]: async () => json(bodies.claude),
    [DEEPSEEK_URL]: async () => json(bodies.deepseek),
  }
}

function accountById(snapshot, id) {
  const account = snapshot.accounts.find(candidate => candidate.id === id)
  assert.ok(account, `missing account ${id}`)
  return account
}

function assertNoSecrets(value, secrets = [FAKE_CODEX_ACCESS, FAKE_CLAUDE_ACCESS, FAKE_DEEPSEEK_KEY, FAKE_REFRESH]) {
  const serialized = JSON.stringify(value)
  assert.ok(!/Bearer\s+/i.test(serialized), 'serialized result must not contain an Authorization value')
  for (const secret of secrets) assert.ok(!serialized.includes(secret), `serialized result leaked ${secret}`)
}

test('reads optional services through ctx.get without touching undeclared properties', async () => {
  const credentials = fakeCredentials(fullRecords(), deepseekReference())
  const balance = fakeDeepSeek({
    status: 'ready',
    value: [{ currency: 'CNY', balance: '7.00' }],
    bonusWallets: [],
  })
  const requests = fakeFetch(standardHandlers())
  const ctx = cordisContext({
    credentials: credentials.service,
    deepseekAccount: balance.service,
    llm: { listProviders: () => [{ id: 'openai-codex', name: 'OpenAI Codex' }] },
  })
  const monitor = createQuotaMonitor(ctx, { fetch: requests.fetch, now: () => T0 })
  const snapshot = await monitor.snapshot({ refresh: true })
  assert.equal(accountById(snapshot, 'codex').status, 'ok')
  assert.equal(accountById(snapshot, 'claude').status, 'ok')
  assert.equal(accountById(snapshot, 'deepseek-account:CNY').status, 'ok')
  assert.equal(accountById(snapshot, 'deepseek-api:USD').status, 'ok')

  const bareRequests = fakeFetch(standardHandlers())
  const bareMonitor = createQuotaMonitor(cordisContext({}), { fetch: bareRequests.fetch, now: () => T0 })
  const bare = await bareMonitor.snapshot({ refresh: true })
  assert.equal(accountById(bare, 'codex').status, 'unavailable')
  assert.equal(accountById(bare, 'claude').status, 'unavailable')
  assert.equal(accountById(bare, 'deepseek-account').status, 'unavailable')
  assert.equal(accountById(bare, 'deepseek-api').status, 'unavailable')
  assert.equal(bareRequests.calls.length, 0)
})

test('reads only exact official endpoints with fixed redirect/cookie-free request init', async () => {
  const credentials = fakeCredentials(fullRecords(), deepseekReference())
  const balance = fakeDeepSeek({
    status: 'ready',
    value: [{ currency: 'CNY', balance: '12.30' }],
    bonusWallets: [{ currency: 'CNY', balance: '1.70' }],
  })
  const requests = fakeFetch(standardHandlers())
  const monitor = createQuotaMonitor(
    {
      credentials: credentials.service,
      deepseekAccount: balance.service,
      llm: {
        listProviders: () => [
          { id: 'openai-codex', name: 'OpenAI Codex' },
          { id: 'anthropic', name: 'Anthropic' },
          { id: 'cursor', name: 'Cursor' },
          { id: 'openrouter', name: 'OpenRouter' },
        ],
      },
    },
    { fetch: requests.fetch, now: () => T0 },
  )

  const snapshot = await monitor.snapshot({ refresh: true })

  assert.equal(snapshot.updatedAt, T0)
  assert.equal(accountById(snapshot, 'codex').status, 'ok')
  assert.equal(accountById(snapshot, 'claude').status, 'ok')
  assert.equal(accountById(snapshot, 'deepseek-account:CNY').status, 'ok')
  assert.equal(accountById(snapshot, 'deepseek-api:USD').status, 'ok')
  assert.equal(accountById(snapshot, 'cursor').status, 'unsupported')
  assert.equal(accountById(snapshot, 'openrouter').status, 'unsupported')

  assert.deepEqual(requests.calls.map(call => call.url).sort(), [CLAUDE_URL, CODEX_URL, DEEPSEEK_URL].sort())
  for (const call of requests.calls) {
    assert.equal(call.init.method, 'GET')
    assert.equal(call.init.redirect, 'error')
    assert.equal(call.init.credentials, 'omit')
    assert.equal(call.init.cache, 'no-store')
    assert.equal(call.init.referrerPolicy, 'no-referrer')
    assert.ok(call.init.signal instanceof AbortSignal)
    assert.equal(call.init.dispatcher, undefined, 'no caller/undici dispatcher is accepted')
  }

  const codex = requests.calls.find(call => call.url === CODEX_URL)
  assert.deepEqual(Object.keys(codex.init.headers).sort(), ['Accept', 'Authorization', 'ChatGPT-Account-Id', 'User-Agent'])
  assert.equal(codex.init.headers.Authorization, `Bearer ${FAKE_CODEX_ACCESS}`)
  assert.equal(codex.init.headers['ChatGPT-Account-Id'], 'acct_fake_123')

  const claude = requests.calls.find(call => call.url === CLAUDE_URL)
  assert.deepEqual(
    Object.keys(claude.init.headers).sort(),
    ['Accept', 'Authorization', 'Content-Type', 'anthropic-beta', 'anthropic-version'],
  )
  assert.equal(claude.init.headers.Authorization, `Bearer ${FAKE_CLAUDE_ACCESS}`)
  assert.equal(claude.init.headers['anthropic-beta'], 'oauth-2025-04-20')

  const deepseek = requests.calls.find(call => call.url === DEEPSEEK_URL)
  assert.deepEqual(Object.keys(deepseek.init.headers).sort(), ['Accept', 'Authorization'])
  assert.equal(deepseek.init.headers.Authorization, `Bearer ${FAKE_DEEPSEEK_KEY}`)

  assert.ok(
    credentials.calls.every(([method]) => method === 'readRecord' || method === 'resolve'),
    'only readRecord/resolve may be used',
  )
  const readCalls = credentials.calls.filter(([method]) => method === 'readRecord')
  assert.deepEqual(
    new Set(readCalls.map(([, key]) => key)),
    new Set([CODEX_RECORD, CLAUDE_RECORD]),
  )
  assert.deepEqual(
    credentials.calls.filter(([method]) => method === 'resolve'),
    [['resolve', 'DEEPSEEK_API_KEY']],
  )

  assert.equal(balance.calls.length, 1)
  assert.deepEqual(Object.keys(balance.calls[0]).sort(), ['locale', 'timezoneOffsetSeconds', 'version'])
  assert.equal(balance.calls[0].version, '0.5.0')
  assert.equal(balance.calls[0].locale, 'en-US')
  assert.ok(Number.isInteger(balance.calls[0].timezoneOffsetSeconds))

  const codexAccount = accountById(snapshot, 'codex')
  assert.deepEqual(codexAccount.windows, [
    {
      id: 'primary',
      label: '5-hour window',
      usedPercent: 25,
      remainingPercent: 75,
      resetsAt: new Date(1_700_003_600_000).toISOString(),
    },
    {
      id: 'secondary',
      label: 'Weekly window',
      usedPercent: 40,
      remainingPercent: 60,
      resetsAt: new Date(1_700_500_000_000).toISOString(),
    },
  ])
  const claudeAccount = accountById(snapshot, 'claude')
  assert.deepEqual(claudeAccount.windows.map(window => [window.id, window.usedPercent, window.remainingPercent]), [
    ['five_hour', 10, 90],
    ['seven_day', 20, 80],
    ['seven_day_opus', 30, 70],
  ])
  assert.equal(accountById(snapshot, 'deepseek-account:CNY').balance.amount, '14')
  assert.equal(accountById(snapshot, 'deepseek-account:CNY').balance.currency, 'CNY')
  assert.deepEqual(accountById(snapshot, 'deepseek-api:USD').balance, { amount: '5.00', currency: 'USD' })
  assert.equal(snapshot.accounts.length, 6)
  assertNoSecrets(snapshot)
})

test('caches, shares one in-flight refresh, enforces 15s minimum, and marks stale reads', async () => {
  let clock = T0
  const requests = fakeFetch(standardHandlers())
  const credentials = fakeCredentials(fullRecords(), deepseekReference())
  const monitor = createQuotaMonitor(
    { credentials: credentials.service, deepseekAccount: fakeDeepSeek({
      status: 'ready',
      value: [{ currency: 'CNY', balance: '3.00' }],
      bonusWallets: [],
    }).service },
    { fetch: requests.fetch, now: () => clock },
  )

  const first = await monitor.snapshot({ refresh: true })
  assert.equal(requests.calls.length, 3)

  clock += 1_000
  const withinMinimum = await monitor.snapshot({ refresh: true })
  assert.equal(requests.calls.length, 3, 'force refresh must respect the minimum interval')
  assert.equal(withinMinimum.updatedAt, first.updatedAt)

  clock += 20_000
  const afterMinimum = await monitor.snapshot({ refresh: true })
  assert.equal(requests.calls.length, 6)
  assert.ok(afterMinimum.updatedAt >= first.updatedAt)

  const cached = await monitor.snapshot()
  assert.equal(requests.calls.length, 6, 'default reads never start network work')
  assert.equal(cached.updatedAt, afterMinimum.updatedAt)

  clock = afterMinimum.updatedAt + 60_001
  const stale = await monitor.snapshot()
  assert.equal(requests.calls.length, 6)
  assert.ok(stale.accounts.every(account => account.stale === true), 'old cache is marked stale, not invented')
})

test('shares a concurrent forced refresh across callers', async () => {
  const requests = fakeFetch({
    [CODEX_URL]: async () => {
      await delay(10)
      return json(standardBodies().codex)
    },
    [CLAUDE_URL]: async () => {
      await delay(10)
      return json(standardBodies().claude)
    },
    [DEEPSEEK_URL]: async () => {
      await delay(10)
      return json(standardBodies().deepseek)
    },
  })
  const credentials = fakeCredentials(fullRecords(), deepseekReference())
  const monitor = createQuotaMonitor(
    { credentials: credentials.service, deepseekAccount: fakeDeepSeek({
      status: 'ready',
      value: [{ currency: 'CNY', balance: '1.00' }],
      bonusWallets: [],
    }).service },
    { fetch: requests.fetch, now: () => T0 },
  )

  const [left, right] = await Promise.all([
    monitor.snapshot({ refresh: true }),
    monitor.snapshot({ refresh: true }),
  ])
  assert.equal(requests.calls.length, 3, 'concurrent refreshes share one in-flight read')
  assert.equal(left.updatedAt, right.updatedAt)
})

test('honors caller cancellation and labels only live unsupported routes', async () => {
  const requests = fakeFetch(standardHandlers())
  const credentials = fakeCredentials({})
  const monitor = createQuotaMonitor(
    {
      credentials: credentials.service,
      deepseekAccount: fakeDeepSeek(null).service,
      llm: {
        listProviders: () => [
          { id: 'openai-codex', name: 'OpenAI Codex' },
          { id: 'my-gateway', name: 'My Gateway' },
        ],
      },
    },
    { fetch: requests.fetch, now: () => T0 },
  )
  const aborted = new AbortController()
  aborted.abort()
  await assert.rejects(monitor.snapshot({ signal: aborted.signal }), error => error.name === 'AbortError')
  assert.equal(requests.calls.length, 0, 'an aborted read starts no network work')

  const snapshot = await monitor.snapshot({ refresh: true })
  assert.deepEqual(
    snapshot.accounts.filter(account => account.status === 'unsupported').map(account => [account.id, account.label]),
    [['my-gateway', 'My Gateway']],
  )
})

test('turns HTTP, transport, redirect and oversized-body failures into sanitized reasons', async () => {
  const authFailure = fakeFetch({
    [CODEX_URL]: async () => new Response(
      JSON.stringify({ error: `leaked ${FAKE_CODEX_ACCESS}` }),
      { status: 401, headers: { 'content-type': 'application/json' } },
    ),
  })
  const authCredentials = fakeCredentials({ [CODEX_RECORD]: grant(FAKE_CODEX_ACCESS, { accountId: 'acct_fake' }) })
  const authMonitor = createQuotaMonitor(
    { credentials: authCredentials.service, deepseekAccount: fakeDeepSeek(null).service },
    { fetch: authFailure.fetch, now: () => T0 },
  )
  const authSnapshot = await authMonitor.snapshot({ refresh: true })
  const authCodex = accountById(authSnapshot, 'codex')
  assert.equal(authCodex.status, 'error')
  assert.match(authCodex.reason, /HTTP 401/)
  assert.ok(!authCodex.reason.includes(FAKE_CODEX_ACCESS))
  assertNoSecrets(authSnapshot)

  const transportFailure = fakeFetch({
    [CLAUDE_URL]: async () => {
      throw new Error(`socket failed with ${FAKE_CLAUDE_ACCESS}`)
    },
  })
  const transportCredentials = fakeCredentials({ [CLAUDE_RECORD]: grant(FAKE_CLAUDE_ACCESS) })
  const transportMonitor = createQuotaMonitor(
    { credentials: transportCredentials.service, deepseekAccount: fakeDeepSeek(null).service },
    { fetch: transportFailure.fetch, now: () => T0 },
  )
  const transportSnapshot = await transportMonitor.snapshot({ refresh: true })
  const transportClaude = accountById(transportSnapshot, 'claude')
  assert.equal(transportClaude.status, 'error')
  assert.match(transportClaude.reason, /transport failed/)
  assertNoSecrets(transportSnapshot)

  const redirectFailure = fakeFetch({
    [CODEX_URL]: async () => Response.redirect(`https://evil.invalid/collect?token=${FAKE_CODEX_ACCESS}`, 302),
  })
  const redirectCredentials = fakeCredentials({ [CODEX_RECORD]: grant(FAKE_CODEX_ACCESS, { accountId: 'acct_fake' }) })
  const redirectMonitor = createQuotaMonitor(
    { credentials: redirectCredentials.service, deepseekAccount: fakeDeepSeek(null).service },
    { fetch: redirectFailure.fetch, now: () => T0 },
  )
  const redirectSnapshot = await redirectMonitor.snapshot({ refresh: true })
  const redirectCodex = accountById(redirectSnapshot, 'codex')
  assert.equal(redirectCodex.status, 'error')
  assert.match(redirectCodex.reason, /unexpected redirect/)
  assert.ok(!JSON.stringify(redirectSnapshot).includes('evil.invalid'))
  assertNoSecrets(redirectSnapshot)

  const oversizedFailure = fakeFetch({
    [DEEPSEEK_URL]: async () => new Response('x'.repeat(65 * 1024), { status: 200 }),
  })
  const oversizedCredentials = fakeCredentials({}, deepseekReference())
  const oversizedMonitor = createQuotaMonitor(
    { credentials: oversizedCredentials.service, deepseekAccount: fakeDeepSeek(null).service },
    { fetch: oversizedFailure.fetch, now: () => T0, timeoutMs: 1_000 },
  )
  const oversizedSnapshot = await oversizedMonitor.snapshot({ refresh: true })
  const oversizedDeepSeek = accountById(oversizedSnapshot, 'deepseek-api')
  assert.equal(oversizedDeepSeek.status, 'error')
  assert.match(oversizedDeepSeek.reason, /size limit/)
  assertNoSecrets(oversizedSnapshot)
})

test('cancels unread error bodies and aborted response streams without waiting on them', async () => {
  let errorBodyCancelled = false
  const errorStream = new ReadableStream({
    pull() {},
    cancel() { errorBodyCancelled = true },
  })
  const errorRequests = fakeFetch({
    [CODEX_URL]: async () => new Response(errorStream, { status: 429 }),
  })
  const errorCredentials = fakeCredentials({ [CODEX_RECORD]: grant(FAKE_CODEX_ACCESS, { accountId: 'acct_fake' }) })
  const errorMonitor = createQuotaMonitor(
    { credentials: errorCredentials.service, deepseekAccount: fakeDeepSeek(null).service },
    { fetch: errorRequests.fetch, now: () => T0, timeoutMs: 50 },
  )
  const errorSnapshot = await errorMonitor.snapshot({ refresh: true })
  assert.equal(accountById(errorSnapshot, 'codex').status, 'error')
  assert.match(accountById(errorSnapshot, 'codex').reason, /HTTP 429/)
  assert.equal(errorBodyCancelled, true, 'an unread non-2xx body is cancelled')

  let abortedStreamCancelled = false
  const abortedStream = new ReadableStream({
    start() {},
    cancel() { abortedStreamCancelled = true },
  })
  const abortedRequests = fakeFetch({
    [CODEX_URL]: async () => new Response(abortedStream, { status: 200 }),
  })
  const abortedCredentials = fakeCredentials({ [CODEX_RECORD]: grant(FAKE_CODEX_ACCESS, { accountId: 'acct_fake' }) })
  const abortedMonitor = createQuotaMonitor(
    { credentials: abortedCredentials.service, deepseekAccount: fakeDeepSeek(null).service },
    { fetch: abortedRequests.fetch, now: () => T0, timeoutMs: 25 },
  )
  const abortedSnapshot = await abortedMonitor.snapshot({ refresh: true })
  assert.equal(accountById(abortedSnapshot, 'codex').status, 'error')
  assert.match(accountById(abortedSnapshot, 'codex').reason, /timed out/)
  assert.equal(abortedStreamCancelled, true, 'an aborted response stream is cancelled')

  let lateStreamCancelled = false
  const lateStream = new ReadableStream({
    pull() {},
    cancel() { lateStreamCancelled = true },
  })
  const lateRequests = fakeFetch({
    [CODEX_URL]: () => new Promise(resolve => {
      setTimeout(() => resolve(new Response(lateStream, { status: 200 })), 80)
    }),
  })
  const lateCredentials = fakeCredentials({ [CODEX_RECORD]: grant(FAKE_CODEX_ACCESS, { accountId: 'acct_fake' }) })
  const lateMonitor = createQuotaMonitor(
    { credentials: lateCredentials.service, deepseekAccount: fakeDeepSeek(null).service },
    { fetch: lateRequests.fetch, now: () => T0, timeoutMs: 20 },
  )
  const lateSnapshot = await lateMonitor.snapshot({ refresh: true })
  assert.equal(accountById(lateSnapshot, 'codex').status, 'error')
  for (let attempt = 0; attempt < 100 && !lateStreamCancelled; attempt += 1) await delay(10)
  assert.equal(lateStreamCancelled, true, 'a response arriving after the deadline is cancelled')
})

test('bounds a hanging official request by its deadline', async () => {
  const requests = fakeFetch({
    [CODEX_URL]: () => new Promise(() => {}),
  })
  const credentials = fakeCredentials({ [CODEX_RECORD]: grant(FAKE_CODEX_ACCESS, { accountId: 'acct_fake' }) })
  const monitor = createQuotaMonitor(
    { credentials: credentials.service, deepseekAccount: fakeDeepSeek(null).service },
    { fetch: requests.fetch, now: () => T0, timeoutMs: 25 },
  )
  const snapshot = await monitor.snapshot({ refresh: true })
  const codex = accountById(snapshot, 'codex')
  assert.equal(codex.status, 'error')
  assert.match(codex.reason, /timed out/)
})

test('bounds an unresolved DeepSeek account read by the same deadline', async () => {
  let calls = 0
  const monitor = createQuotaMonitor(
    {
      credentials: fakeCredentials({}).service,
      deepseekAccount: {
        getBalance() {
          calls += 1
          return new Promise(() => {})
        },
      },
    },
    { fetch: fakeFetch({}).fetch, now: () => T0, timeoutMs: 25 },
  )
  const snapshot = await monitor.snapshot({ refresh: true })
  const account = accountById(snapshot, 'deepseek-account')
  assert.equal(account.status, 'error')
  assert.match(account.reason, /timed out/)
  assert.match(account.reason, /client 0\.5\.0/)
  assert.equal(calls, 1)
})

test('dispose aborts an unresolved DeepSeek account read', async () => {
  let calls = 0
  const monitor = createQuotaMonitor(
    {
      credentials: fakeCredentials({}).service,
      deepseekAccount: {
        getBalance() {
          calls += 1
          return new Promise(() => {})
        },
      },
    },
    { fetch: fakeFetch({}).fetch, now: () => T0, timeoutMs: 60_000 },
  )
  const pending = monitor.snapshot({ refresh: true })
  for (let attempt = 0; attempt < 100 && calls === 0; attempt += 1) await delay(5)
  assert.equal(calls, 1)
  const startedAt = Date.now()
  await monitor.dispose()
  assert.ok(Date.now() - startedAt < 2_000)
  await assert.rejects(pending, error => error.name === 'AbortError')
})

test('reports missing, expired, non-OAuth and unsupported credentials honestly', async () => {
  const emptyMonitor = createQuotaMonitor(
    {
      credentials: fakeCredentials({}).service,
      deepseekAccount: fakeDeepSeek(null).service,
      llm: {
        listProviders: () => [
          { id: 'openai-codex', name: 'OpenAI Codex' },
          { id: 'anthropic', name: 'Anthropic' },
          { id: 'cursor', name: 'Cursor' },
          { id: 'copilot', name: 'GitHub Copilot' },
        ],
      },
    },
    { fetch: fakeFetch(standardHandlers()).fetch, now: () => T0 },
  )
  const empty = await emptyMonitor.snapshot({ refresh: true })
  assert.equal(accountById(empty, 'codex').status, 'unavailable')
  assert.equal(accountById(empty, 'claude').status, 'unavailable')
  // A route never signed in to produces no card: an "Unavailable" row for a
  // deployment that only uses an API key is noise.
  assert.equal(empty.accounts.some(account => account.id === 'deepseek-account'), false)
  assert.equal(accountById(empty, 'deepseek-api').status, 'unavailable')
  const emptyUnsupported = empty.accounts.filter(candidate => candidate.status === 'unsupported')
  assert.deepEqual(emptyUnsupported.map(account => account.id), ['cursor', 'copilot'])
  for (const account of emptyUnsupported) {
    assert.equal(account.windows.length, 0)
    assert.ok(!JSON.stringify(account).includes('remainingPercent'))
  }
  assert.ok(empty.accounts.length <= 8)
  assertNoSecrets(empty)

  const noLlmMonitor = createQuotaMonitor(
    {
      credentials: fakeCredentials({}).service,
      deepseekAccount: fakeDeepSeek(null).service,
    },
    { fetch: fakeFetch(standardHandlers()).fetch, now: () => T0 },
  )
  const noLlm = await noLlmMonitor.snapshot({ refresh: true })
  // One fewer than before: the signed-out DeepSeek account no longer produces a card.
  assert.equal(noLlm.accounts.length, 3, 'no live provider list means no unrelated unsupported rows')
  assert.equal(noLlm.accounts.filter(candidate => candidate.status === 'unsupported').length, 0)

  let fetchedExpired = 0
  const expiredRequests = fakeFetch({ [CODEX_URL]: async () => { fetchedExpired += 1; return json({}) } })
  const expiredMonitor = createQuotaMonitor(
    {
      credentials: fakeCredentials({
        [CODEX_RECORD]: { kind: 'grant', payload: { type: 'oauth', access: FAKE_CODEX_ACCESS, expires: T0 - 1, accountId: 'acct' } },
      }).service,
      deepseekAccount: fakeDeepSeek(null).service,
    },
    { fetch: expiredRequests.fetch, now: () => T0 },
  )
  const expired = await expiredMonitor.snapshot({ refresh: true })
  assert.equal(accountById(expired, 'codex').status, 'unavailable')
  assert.match(accountById(expired, 'codex').reason, /expired/)
  assert.equal(fetchedExpired, 0, 'expired OAuth is never refreshed or replayed')

  const apiKeyMonitor = createQuotaMonitor(
    {
      credentials: fakeCredentials({ [CODEX_RECORD]: { kind: 'api-key', key: FAKE_CODEX_ACCESS } }).service,
      deepseekAccount: fakeDeepSeek(null).service,
    },
    { fetch: fakeFetch(standardHandlers()).fetch, now: () => T0 },
  )
  const apiKeySnapshot = await apiKeyMonitor.snapshot({ refresh: true })
  assert.equal(accountById(apiKeySnapshot, 'codex').status, 'unavailable')
  assert.match(accountById(apiKeySnapshot, 'codex').reason, /not a subscription OAuth grant/)

  const unknownRefCredentials = fakeCredentials({})
  const unknownRefMonitor = createQuotaMonitor(
    { credentials: unknownRefCredentials.service, deepseekAccount: fakeDeepSeek(null).service },
    { fetch: fakeFetch(standardHandlers()).fetch, now: () => T0, deepseekApiKeyRef: 'AWS_SECRET_ACCESS_KEY' },
  )
  const unknownRef = await unknownRefMonitor.snapshot({ refresh: true })
  assert.equal(accountById(unknownRef, 'deepseek-api').status, 'unsupported')
  assert.ok(!unknownRefCredentials.calls.some(([method]) => method === 'resolve'))
})

test('caps accounts and runs official requests at most two at a time', async () => {
  let active = 0
  let maxActive = 0
  const tracked = handler => async init => {
    active += 1
    maxActive = Math.max(maxActive, active)
    try {
      await delay(15)
      return handler(init)
    } finally {
      active -= 1
    }
  }
  const requests = fakeFetch({
    [CODEX_URL]: tracked(async () => json(standardBodies().codex)),
    [CLAUDE_URL]: tracked(async () => json(standardBodies().claude)),
    [DEEPSEEK_URL]: tracked(async () => json(standardBodies().deepseek)),
  })
  const credentials = fakeCredentials(fullRecords(), deepseekReference())
  const monitor = createQuotaMonitor(
    { credentials: credentials.service, deepseekAccount: fakeDeepSeek({
      status: 'ready',
      value: [{ currency: 'CNY', balance: '1.00' }],
      bonusWallets: [],
    }).service },
    { fetch: requests.fetch, now: () => T0, concurrency: 2 },
  )
  const snapshot = await monitor.snapshot({ refresh: true })
  assert.ok(maxActive <= 2, `active requests ${maxActive} exceeded concurrency 2`)
  assert.ok(maxActive >= 2, 'test should observe parallelism')
  assert.ok(snapshot.accounts.length <= 8)

  const one = createQuotaMonitor(
    { credentials: credentials.service, deepseekAccount: fakeDeepSeek(null).service },
    { fetch: requests.fetch, now: () => T0, maxAccounts: 1 },
  )
  const oneSnapshot = await one.snapshot({ refresh: true })
  assert.equal(oneSnapshot.accounts.length, 1)
})

test('dispose aborts in-flight work, settles within its deadline and rejects later reads', async () => {
  let fetchStarted = false
  const credentials = fakeCredentials({ [CODEX_RECORD]: grant(FAKE_CODEX_ACCESS, { accountId: 'acct_fake' }) })
  const hanging = (input, init) => new Promise((resolve, reject) => {
    fetchStarted = true
    const onAbort = () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' }))
    if (init.signal.aborted) onAbort()
    else init.signal.addEventListener('abort', onAbort, { once: true })
  })
  const monitor = createQuotaMonitor(
    { credentials: credentials.service, deepseekAccount: fakeDeepSeek(null).service },
    { fetch: hanging, now: () => T0 },
  )
  const pending = monitor.snapshot({ refresh: true })
  for (let attempt = 0; attempt < 100 && !fetchStarted; attempt += 1) await delay(5)
  assert.equal(fetchStarted, true)
  const startedAt = Date.now()
  await monitor.dispose()
  assert.ok(Date.now() - startedAt < 2_000)
  await assert.rejects(pending, error => error.name === 'AbortError')
  await assert.rejects(monitor.snapshot(), error => error.name === 'AbortError')
})

test('explicit transport wins and global fetch is never consulted', async () => {
  const original = globalThis.fetch
  let globalCalls = 0
  globalThis.fetch = async () => {
    globalCalls += 1
    throw new Error('global fetch must not be used when a transport is injected')
  }
  try {
    const requests = fakeFetch(standardHandlers())
    const credentials = fakeCredentials(fullRecords(), deepseekReference())
    const monitor = createQuotaMonitor(
      { credentials: credentials.service, deepseekAccount: fakeDeepSeek({
        status: 'ready',
        value: [{ currency: 'CNY', balance: '1.00' }],
        bonusWallets: [],
      }).service },
      { fetch: requests.fetch, now: () => T0 },
    )
    await monitor.snapshot({ refresh: true })
    assert.equal(requests.calls.length, 3)
    assert.equal(globalCalls, 0)
  } finally {
    globalThis.fetch = original
  }
})
