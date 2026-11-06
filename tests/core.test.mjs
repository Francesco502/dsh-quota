/**
 * Core track tests (0.4.1): history JSONL persistence + manager concurrency/alarm/fetch.
 *
 * Run with:  node --test tests/core.test.mjs
 * Every test isolates itself with a fresh `DSH_HOME` (mkdtemp) so the real profile
 * is never touched.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { existsSync, mkdtempSync, readFileSync, readdirSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { QuotaHistoryManager } from '../src/core/history.ts'
import { QuotaManager } from '../src/core/manager.ts'
import { QuotaAlarmDetector } from '../src/core/alarm.ts'
import { fetchWithProxy } from '../src/core/fetch.ts'
import { PLUGIN_VERSION } from '../src/core/types.ts'

const DAY_MS = 24 * 3600 * 1000
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

function makeHome() {
  const home = mkdtempSync(join(tmpdir(), 'dsh-quota-core-'))
  process.env.DSH_HOME = home
  return home
}

function usageCard(id, remainingPercent, options = {}) {
  return {
    id,
    name: options.name ?? id,
    provider: options.provider ?? 'fake',
    category: 'domestic_llm',
    status: options.status ?? 'ok',
    groups: [
      {
        id: options.groupId ?? 'grp',
        title: options.groupTitle ?? 'Quota',
        windows: [
          {
            id: options.windowId ?? 'w1',
            label: '5h',
            quotaKind: 'usage',
            status: 'active',
            remainingPercent,
            usedPercent: 100 - remainingPercent,
          },
        ],
      },
    ],
    lastUpdated: Date.now(),
  }
}

/** Manager whose provider registry contains exactly one controllable fake provider. */
async function makeManager(fetchImpl) {
  makeHome()
  const provider = {
    name: 'fake',
    category: 'domestic_llm',
    calls: 0,
    signals: [],
    async fetchCard(_config, _account, signal) {
      provider.calls += 1
      provider.signals.push(signal)
      return { card: await fetchImpl(signal) }
    },
  }
  const manager = new QuotaManager()
  manager.providers.clear()
  manager.providers.set('fake', provider)
  manager.saveConfig({
    accounts: [{ id: 'fake-1', provider: 'fake', enabled: true }],
    enabledProviders: ['fake-1'],
    custom_compatible: [],
    refreshIntervalSeconds: 60,
  })
  await manager.historyManager.ready
  return { manager, provider }
}


/** Manager with several independent fake providers (one card each). */
async function makeMultiManager(defs) {
  makeHome()
  const manager = new QuotaManager()
  manager.providers.clear()
  for (const def of defs) {
    manager.providers.set(def.name, {
      name: def.name,
      category: def.category ?? 'domestic_llm',
      async fetchCard() {
        return { card: def.card() }
      },
    })
  }
  manager.saveConfig({
    accounts: defs.map((def) => ({ id: def.name, provider: def.name, enabled: true })),
    enabledProviders: defs.map((def) => def.name),
    custom_compatible: [],
    ...Object.fromEntries(defs.map((def) => [def.name, { enabled: true }])),
  })
  await manager.historyManager.ready
  return manager
}

// ---------------------------------------------------------------- history (A4/A5/A8/A16)

test('JSONL: append changed points, dedupe unchanged ones, reload consistently', async () => {
  const home = makeHome()
  const history = new QuotaHistoryManager()
  await history.ready

  history.recordSnapshots([usageCard('j1', 80)])
  await sleep(5)
  history.recordSnapshots([usageCard('j1', 70)])
  assert.equal(await history.flush(), true)

  const journal = join(home, 'quota-history.jsonl')
  const readCardLines = () =>
    readFileSync(journal, 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map((line) => JSON.parse(line))
      .filter((entry) => entry.k === 'j1')
  const cardLines = readCardLines()
  assert.equal(cardLines.length, 2, 'only changed card-level points are appended')
  assert.equal(cardLines[0].r, 80)
  assert.equal(cardLines[0].u, 20)
  assert.equal(cardLines[1].r, 70)
  assert.equal(
    readFileSync(journal, 'utf8').trim().split('\n').filter(Boolean).length,
    4,
    'two changed points per snapshot (card-level + window-level)',
  )

  // Same remaining percent within 5 minutes → no new line.
  history.recordSnapshots([usageCard('j1', 70)])
  assert.equal(await history.flush(), true)
  assert.equal(readFileSync(journal, 'utf8').trim().split('\n').filter(Boolean).length, 4)

  const reloaded = new QuotaHistoryManager()
  await reloaded.ready
  const points = reloaded.getTrendPoints('j1', 30)
  assert.equal(points.length, 2)
  assert.deepEqual(points.map((point) => point.remainingPercent), [80, 70])
  assert.equal(points[0].instanceId, 'j1')
  assert.equal(reloaded.getTrendPoints('j1::grp::w1', 30).length, 2, 'window-level series persisted too')

  history.close()
  reloaded.close()
})

test('migrates legacy quota-history.json once and renames it', async () => {
  const home = makeHome()
  const now = Date.now()
  writeFileSync(
    join(home, 'quota-history.json'),
    JSON.stringify({
      version: 2,
      records: {
        'legacy-1': [{ timestamp: now - 60_000, instanceId: 'legacy-1', remainingPercent: 42, usedPercent: 58 }],
        'legacy-1::pool::w': [
          { timestamp: now - 30_000, instanceId: 'legacy-1', poolId: 'pool', windowId: 'w', remainingPercent: 43, usedPercent: 57 },
        ],
      },
    }),
  )

  const history = new QuotaHistoryManager()
  await history.ready
  assert.ok(
    readdirSync(home).some((name) => name.startsWith('quota-history.json.migrated-')),
    'legacy file must be renamed, not deleted',
  )
  assert.equal(history.getTrendPoints('legacy-1', 30).length, 1)
  assert.equal(history.getTrendPoints('legacy-1::pool::w', 30).length, 1)

  const reloaded = new QuotaHistoryManager()
  await reloaded.ready
  assert.equal(reloaded.getTrendPoints('legacy-1', 30)[0].remainingPercent, 42, 'migrated points survive restart')
  history.close()
  reloaded.close()
})

test('trims a single key to the 2000-point cap on load and compaction', async () => {
  const home = makeHome()
  const now = Date.now()
  const journal = join(home, 'quota-history.jsonl')
  const lines = []
  for (let i = 0; i < 2500; i += 1) {
    lines.push(JSON.stringify({ k: 'cap', ts: now - (2500 - i) * 1000, r: 50, u: 50, kind: 'usage' }))
  }
  writeFileSync(journal, `${lines.join('\n')}\n`)

  const history = new QuotaHistoryManager()
  await history.ready
  const points = history.getTrendPoints('cap', 30)
  assert.equal(points.length, 2000, 'in-memory cap applies at load')
  assert.equal(points[0].timestamp, now - 2000 * 1000, 'oldest points are the ones dropped')

  assert.equal(await history.compact(), true)
  assert.ok(existsSync(`${journal}.bak`), 'compaction keeps the previous journal as .bak')
  const afterCompaction = readFileSync(journal, 'utf8').trim().split('\n').filter(Boolean)
  assert.equal(afterCompaction.length, 2000, 'compaction enforces the cap on disk')
  history.close()
})

test('retention drops points older than 30 days (load + compaction)', async () => {
  const home = makeHome()
  const now = Date.now()
  const journal = join(home, 'quota-history.jsonl')
  writeFileSync(
    journal,
    [
      JSON.stringify({ k: 'age', ts: now - 40 * DAY_MS, r: 10, u: 90, kind: 'usage' }),
      JSON.stringify({ k: 'age', ts: now - 3600 * 1000, r: 55, u: 45, kind: 'usage' }),
      '',
    ].join('\n'),
  )

  const history = new QuotaHistoryManager()
  await history.ready
  const points = history.getTrendPoints('age', 30)
  assert.equal(points.length, 1, '40-day-old point is not loaded into the window')
  assert.equal(points[0].remainingPercent, 55)

  assert.equal(await history.compact(), true)
  const retained = readFileSync(journal, 'utf8').trim().split('\n').filter(Boolean)
  assert.equal(retained.length, 1, 'compaction drops the expired line from disk')
  assert.equal(readFileSync(`${journal}.bak`, 'utf8').trim().split('\n').filter(Boolean).length, 2)
  history.close()
})

test('corrupt journal is quarantined, then rebuilt', async () => {
  const home = makeHome()
  const journal = join(home, 'quota-history.jsonl')
  writeFileSync(journal, 'this is not json\n')

  const history = new QuotaHistoryManager()
  await history.ready
  const quarantined = readdirSync(home).filter((name) => name.startsWith('quota-history.jsonl.corrupt-'))
  assert.equal(quarantined.length, 1, 'corrupt journal must be preserved for inspection')

  history.recordSnapshots([usageCard('rebuilt', 55)])
  assert.equal(await history.flush(), true)
  const reloaded = new QuotaHistoryManager()
  await reloaded.ready
  assert.equal(reloaded.getTrendPoints('rebuilt', 30)[0].remainingPercent, 55, 'new journal is valid again')
  history.close()
  reloaded.close()
})

test('balance-only snapshots store amounts, never a fabricated percentage', async () => {
  const home = makeHome()
  const history = new QuotaHistoryManager()
  await history.ready
  const card = {
    id: 'bal',
    name: 'Balance Only',
    provider: 'kimi',
    category: 'domestic_llm',
    status: 'ok',
    groups: [{ title: '余额', windows: [{ id: 'b', label: '余额', quotaKind: 'balance', amountText: '¥12.00', status: 'active' }] }],
    balance: { currency: 'CNY', remaining: 12, total: 20 },
    lastUpdated: Date.now(),
  }
  history.recordSnapshots([card])
  assert.equal(await history.flush(), true)
  const line = JSON.parse(readFileSync(join(home, 'quota-history.jsonl'), 'utf8').trim().split('\n')[0])
  assert.equal(line.k, 'bal')
  assert.equal(line.balance, 12)
  assert.equal(line.r, undefined, 'no synthesized percentage on a balance point')
  const points = history.getTrendPoints('bal', 30)
  assert.equal(points[0].remainingPercent, undefined)
  assert.equal(history.calculateBurnRate('bal', 50).burnRatePerHour, undefined, 'burn rate ignores balance series')
  history.close()
})

// ------------------------------------------------------- manager concurrency (A6/A10/A11/A12)

test('concurrent force refreshes are single-flighted into one upstream call', async () => {
  const { manager, provider } = await makeManager(async () => {
    await sleep(30)
    return usageCard('fake-1', 66)
  })

  const [first, second] = await Promise.all([manager.getQuotaCards(true), manager.getQuotaCards(true)])
  assert.equal(provider.calls, 1, 'two concurrent rounds must share one provider sweep')
  assert.equal(first.cards.length, 1)
  assert.equal(first.cards[0].id, 'fake-1')
  assert.equal(second.lastUpdated, first.lastUpdated)

  // Per-instance single flight (refreshSingleProvider path).
  manager.cardCache.clear()
  manager.lastForcedAt.clear()
  const before = provider.calls
  await Promise.all([manager.refreshSingleProvider('fake-1'), manager.refreshSingleProvider('fake-1')])
  assert.equal(provider.calls, before + 1, 'concurrent single-provider refreshes share one call')
})

test('force is throttled to one real refresh per 5 seconds, then allowed again', async () => {
  const { manager, provider } = await makeManager(async () => {
    await sleep(5)
    return usageCard('fake-1', 80)
  })

  const first = await manager.getQuotaCards(true)
  assert.equal(provider.calls, 1)

  const second = await manager.getQuotaCards(true)
  assert.equal(provider.calls, 1, 'force within 5 s returns the cache')
  assert.equal(second.lastUpdated, first.lastUpdated)

  // Push the throttle window into the past instead of sleeping 5 s in the test.
  manager.lastForcedAt.set('fake-1', Date.now() - 6000)
  await manager.getQuotaCards(true)
  assert.equal(provider.calls, 2, 'force is allowed again after the 5 s window')
})

test('AbortSignal is forwarded to provider.fetchCard and aborts the round', async () => {
  let captured
  const { manager } = await makeManager(
    (signal) =>
      new Promise((_resolve, reject) => {
        captured = signal
        const onAbort = () => {
          const error = new Error('The operation was aborted')
          error.name = 'AbortError'
          reject(error)
        }
        if (signal?.aborted) onAbort()
        else signal?.addEventListener('abort', onAbort, { once: true })
      }),
  )

  const controller = new AbortController()
  const pending = manager.getQuotaCards(true, undefined, controller.signal)
  await sleep(20)
  assert.ok(captured, 'provider received a signal')
  controller.abort()
  await assert.rejects(pending, /abort|取消/i)
  assert.equal(captured.aborted, true, 'provider saw the abort')
})

test('cache timestamp is the request completion time, not the start time', async () => {
  const { manager } = await makeManager(async () => {
    await sleep(40)
    return usageCard('fake-1', 60)
  })
  const startedAt = Date.now()
  await manager.getQuotaCards(true)
  const entry = manager.cardCache.get('fake-1')
  assert.ok(entry, 'card cached')
  assert.ok(entry.fetchedAt - startedAt >= 30, 'fetchedAt includes provider latency')
})

test('failed instances back off exponentially (60 s base, capped at 10 min)', async () => {
  const { manager, provider } = await makeManager(() => {
    throw new Error('boom')
  })

  const first = await manager.getQuotaCards(true)
  assert.equal(provider.calls, 1)
  assert.equal(first.cards[0].status, 'error')
  assert.equal(first.cards[0].error, 'boom')
  const backoff = manager.backoffs.get('fake-1')
  assert.equal(backoff.failures, 1)
  const firstDelay = backoff.retryAt - Date.now()
  assert.ok(firstDelay > 55_000 && firstDelay <= 60_000, `first backoff ≈60 s, got ${firstDelay}`)
  assert.ok(first.cards[0].retryAfter >= backoff.retryAt - 1000, 'error card exposes retryAfter')

  manager.lastForcedAt.set('fake-1', Date.now() - 6000)
  await manager.getQuotaCards(true)
  assert.equal(provider.calls, 1, 'active backoff skips the network entirely')

  manager.backoffs.get('fake-1').retryAt = Date.now() - 1
  await manager.getQuotaCards(true)
  assert.equal(provider.calls, 2)
  const secondDelay = manager.backoffs.get('fake-1').retryAt - Date.now()
  assert.ok(secondDelay > 110_000, `second backoff ≈120 s, got ${secondDelay}`)
})

test('a refresh started under an old config never writes the new cache', async () => {
  let release
  const { manager } = await makeManager(
    () =>
      new Promise((resolve) => {
        release = () => resolve(usageCard('fake-1', 50))
      }),
  )

  const pending = manager.getQuotaCards(true)
  await sleep(20)
  manager.saveConfig({
    accounts: [{ id: 'fake-1', provider: 'fake', enabled: true }],
    enabledProviders: ['fake-1'],
    custom_compatible: [],
    refreshIntervalSeconds: 60,
  })
  release()
  await pending
  assert.equal(manager.cardCache.has('fake-1'), false, 'stale-generation result must not pollute the new cache')
})

test('a stale-generation failure does not install a backoff for the new config', async () => {
  let fail
  const { manager } = await makeManager(
    () =>
      new Promise((_resolve, reject) => {
        fail = () => reject(new Error('old key'))
      }),
  )
  const pending = manager.getQuotaCards(true)
  await sleep(20)
  manager.saveConfig({
    accounts: [{ id: 'fake-1', provider: 'fake', enabled: true }],
    enabledProviders: ['fake-1'],
    custom_compatible: [],
    refreshIntervalSeconds: 60,
  })
  fail()
  await pending
  assert.equal(manager.backoffs.has('fake-1'), false, 'new config must be allowed to try immediately')
})

test('safeRefresh never rejects; it records lastError instead', async () => {
  const { manager } = await makeManager(async () => usageCard('fake-1', 90))
  manager.buildInstanceTasks = () => {
    throw new Error('config broken')
  }
  const ok = await manager.safeRefresh()
  assert.equal(ok, false)
  assert.match(manager.getLastError(), /config broken/)
})

// ---------------------------------------------------------- config secret handling

test('getSafeConfig masks sessionKey too and never echoes real key characters', () => {
  makeHome()
  const manager = new QuotaManager()
  manager.saveConfig({
    claude: { enabled: true, apiKey: 'sk-ant-real-key-123456789', sessionKey: 'sess-secret-987654321' },
  })
  const safe = manager.getSafeConfig()
  const serialized = JSON.stringify(safe)
  assert.ok(!serialized.includes('sk-ant-real-key-123456789'), 'apiKey must not leak')
  assert.ok(!serialized.includes('sess-secret-987654321'), 'sessionKey must not leak')
  assert.equal(safe.claude.sessionKey, '••••••••', 'fixed-width mask')
  assert.equal(safe.claude.apiKey, '••••••••')
})

test('changing baseUrl/provider drops the masked secret instead of replaying it', () => {
  makeHome()
  const manager = new QuotaManager()
  manager.saveConfig({
    accounts: [
      { id: 'acct', provider: 'custom_api', apiKey: 'sk-real-secret-abcdef', baseUrl: 'https://relay.example.com' },
    ],
  })

  const safe = manager.getSafeConfig()
  const evil = JSON.parse(JSON.stringify(safe))
  evil.accounts[0].baseUrl = 'https://attacker.example.com'
  manager.saveConfig(evil)
  assert.equal(
    manager.getConfig().accounts.find((account) => account.id === 'acct').apiKey,
    '',
    'a masked key must be cleared when baseUrl changes',
  )

  // Re-establish the key, then change only the provider: same rule.
  manager.saveConfig({
    accounts: [{ id: 'acct', provider: 'custom_api', apiKey: 'sk-real-secret-abcdef', baseUrl: 'https://attacker.example.com' }],
  })
  const safe2 = manager.getSafeConfig()
  safe2.accounts[0].provider = 'deepseek'
  manager.saveConfig(safe2)
  assert.equal(
    manager.getConfig().accounts.find((account) => account.id === 'acct').apiKey,
    '',
    'a masked key must be cleared when provider changes',
  )
})

// ------------------------------------------------------------------ agent routing

test('smart routing picks the highest quantified headroom, never a liveness/balance card', async () => {
  const manager = await makeMultiManager([
    { name: 'deepseek', card: () => usageCard('deepseek', 30, { provider: 'deepseek' }) },
    { name: 'siliconflow', card: () => usageCard('siliconflow', 85, { provider: 'siliconflow' }) },
    {
      name: 'kimi',
      card: () => ({
        id: 'kimi',
        name: 'Kimi',
        provider: 'kimi',
        category: 'domestic_llm',
        status: 'ok',
        balance: { currency: 'CNY', remaining: 3, total: 100 },
        groups: [{ title: '余额', windows: [{ id: 'b', label: '余额', quotaKind: 'balance', amountText: '¥3.00', status: 'active' }] }],
        lastUpdated: Date.now(),
      }),
    },
    {
      name: 'glm',
      card: () => ({
        id: 'glm',
        name: 'GLM',
        provider: 'glm',
        category: 'domestic_llm',
        status: 'ok',
        groups: [{ title: '连通性', windows: [{ id: 'l', label: '已连接', quotaKind: 'liveness', status: 'active' }] }],
        lastUpdated: Date.now(),
      }),
    },
  ])

  const summary = await manager.getAgentQuotaSummary()
  assert.equal(summary.recommendation.status, 'healthy')
  assert.equal(summary.recommendation.primaryProvider, 'siliconflow', 'most remaining headroom wins')
  assert.doesNotMatch(summary.recommendation.reason, /额度充足/)
  const kimi = summary.services.find((service) => service.id === 'kimi')
  assert.equal(kimi.quotaKind, 'balance')
  assert.equal(kimi.quotas[0].windows[0].remaining, '¥3.00', 'balance reports amount text, not a %')
  const glm = summary.services.find((service) => service.id === 'glm')
  assert.equal(glm.quotaKind, 'liveness')
  assert.equal(glm.quotas[0].windows[0].remaining, '—')
})

test('smart routing prefers deepseek only on an exact tie', async () => {
  const manager = await makeMultiManager([
    { name: 'deepseek', card: () => usageCard('deepseek', 70, { provider: 'deepseek' }) },
    { name: 'siliconflow', card: () => usageCard('siliconflow', 70, { provider: 'siliconflow' }) },
  ])
  const summary = await manager.getAgentQuotaSummary()
  assert.equal(summary.recommendation.primaryProvider, 'deepseek', 'deepseek breaks ties')
})

// ------------------------------------------------------------------------ alarms (A19)

test('alarms ignore liveness/unknown windows; balance alarms only at zero', () => {
  const detector = new QuotaAlarmDetector()
  const liveness = usageCard('liveness-card', 0)
  liveness.groups[0].windows[0] = {
    id: 'l1',
    label: 'Connected',
    quotaKind: 'liveness',
    status: 'active',
    // A provider must not leave a ratio on a liveness window; even if it does, it is ignored.
    remainingPercent: 2,
    usedPercent: 98,
  }
  const unknown = usageCard('unknown-card', 0)
  unknown.groups[0].windows[0] = { id: 'u1', label: 'Unknown', quotaKind: 'unknown', status: 'unknown' }
  const emptyBalance = {
    id: 'balance-zero',
    name: 'Balance Zero',
    provider: 'kimi',
    category: 'domestic_llm',
    status: 'ok',
    balance: { currency: 'CNY', remaining: 0, total: 10 },
    groups: [{ title: '余额', windows: [{ id: 'b1', label: '余额', quotaKind: 'balance', amountText: '¥0.00', status: 'active' }] }],
    lastUpdated: Date.now(),
  }

  const alarms = detector.detectAlarms([liveness, unknown, emptyBalance], 15)
  assert.equal(alarms.length, 1, 'only the exhausted balance alarms')
  assert.equal(alarms[0].instanceId, 'balance-zero')
  assert.equal(alarms[0].level, 'critical')
  assert.match(alarms[0].message, /余额/)

  // Low (but non-zero) balance must NOT be turned into a percentage alarm.
  const lowBalance = {
    ...emptyBalance,
    id: 'balance-low',
    balance: { currency: 'CNY', remaining: 0.5, total: 100 },
    groups: [{ title: '余额', windows: [{ id: 'b2', label: '余额', quotaKind: 'balance', amountText: '¥0.50', status: 'active' }] }],
  }
  const lowAlarms = detector.detectAlarms([lowBalance], 15)
  assert.equal(lowAlarms.length, 0, 'balance amounts never produce a threshold alarm')

  // A quantified usage window still alarms normally.
  const usageAlarms = detector.detectAlarms([usageCard('usage-low', 10)], 15)
  assert.equal(usageAlarms.length, 1)
  assert.equal(usageAlarms[0].level, 'warn')

  // Ghost cleanup: instances that disappear from the round drop their active alarms.
  const cleared = detector.detectAlarms([liveness], 15)
  assert.equal(cleared.length, 0)
  assert.equal(detector.getActiveAlarms().length, 0, 'no ghost alarms remain')
})

// ------------------------------------------------------------------------- fetch (D)

test('fetchWithProxy sends dsh-quota User-Agent by default and respects an explicit one', async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify({ ua: req.headers['user-agent'] ?? null }))
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  try {
    const defaultRes = await fetchWithProxy(`${base}/echo`, {}, undefined, 5000)
    assert.equal((await defaultRes.json()).ua, `dsh-quota/${PLUGIN_VERSION}`)

    const customRes = await fetchWithProxy(`${base}/echo`, { headers: { 'User-Agent': 'custom-agent/9' } }, undefined, 5000)
    assert.equal((await customRes.json()).ua, 'custom-agent/9', 'caller User-Agent wins')
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})

test('a 429 becomes a clear rate-limit error carrying Retry-After', async () => {
  const server = http.createServer((_req, res) => {
    res.writeHead(429, { 'Content-Type': 'application/json', 'Retry-After': '42' })
    res.end('{"error":"rate limited"}')
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const url = `http://127.0.0.1:${server.address().port}/limited`
  try {
    await assert.rejects(fetchWithProxy(url, {}, undefined, 5000), (error) => {
      assert.match(error.message, /限流/)
      assert.match(error.message, /42/)
      assert.equal(error.status, 429)
      assert.equal(error.retryAfterSeconds, 42)
      return true
    })
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})
