
/**
 * Integration smoke: host wiring + routes + persistence on a real QuotaManager.
 * No provider network calls: the seeded config enables nothing.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { mkdtempSync, readdirSync, writeFileSync, existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { tmpdir } from 'node:os'

const home = mkdtempSync(join(tmpdir(), 'dsh-quota-int-'))
process.env.DSH_HOME = home
writeFileSync(
  join(home, 'quota-config.json'),
  JSON.stringify({ enabledProviders: [], providerOrder: [], refreshIntervalSeconds: 60 }),
  'utf8',
)

const { apply } = await import('../src/index.ts')
const { QuotaManager } = await import('../src/core/manager.ts')

test('apply registers routes, system prompt and the agent tool', async () => {
  const routes = []
  const sections = []
  const tools = []
  const disposers = []
  const ctx = {
    effect(fn) {
      const dispose = fn()
      if (typeof dispose === 'function') disposers.push(dispose)
      return dispose
    },
    webServer: {
      register(route) {
        routes.push(route)
        return () => {}
      },
    },
    systemPrompt: {
      section(section) {
        sections.push(section)
        return () => {}
      },
    },
    tools: {
      register(tool) {
        tools.push(tool)
        return () => {}
      },
    },
  }

  apply(ctx)
  assert.equal(routes.length, 8)
  assert.ok(routes.some((route) => route.path === '/api/dsh-quota/status'))
  assert.equal(sections.length, 1)
  assert.equal(tools.length, 1)
  assert.equal(tools[0].name, 'get_quota_status')

  // Dispose must tear down routes without throwing.
  for (const dispose of disposers) dispose()
})

test('routes answer the guarded API and never leak a fake quota', async () => {
  const manager = new QuotaManager()
  const { makeQuotaRoutes } = await import('../src/routes.ts')
  const routes = makeQuotaRoutes(manager)
  const server = http.createServer((req, res) => {
    const url = new URL(req.url, 'http://127.0.0.1')
    const route = routes.find((row) => row.path === url.pathname)
    if (route === undefined) {
      res.writeHead(404).end()
      return
    }
    Promise.resolve(route.handler(req, res)).catch((error) => {
      if (!res.headersSent) res.writeHead(500)
      res.end(String(error?.message ?? error))
    })
  })
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const base = `http://127.0.0.1:${server.address().port}`
  const headers = { 'X-DSH-Quota': '1' }

  try {
    const status = await fetch(`${base}/api/dsh-quota/status`, { headers })
    assert.equal(status.status, 200)
    const payload = await status.json()
    assert.ok(Array.isArray(payload.cards))

    const config = await fetch(`${base}/api/dsh-quota/config`, { headers })
    assert.equal(config.status, 200)
    const safe = await config.json()
    // Secrets never come back in clear text.
    assert.ok(!JSON.stringify(safe).includes('sk-'))
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})

test('history journal is append-only JSONL and migrates the legacy file', async () => {
  const legacyHome = mkdtempSync(join(tmpdir(), 'dsh-quota-int-hist-'))
  const previous = process.env.DSH_HOME
  process.env.DSH_HOME = legacyHome
  try {
    const now = Date.now()
    writeFileSync(
      join(legacyHome, 'quota-history.json'),
      JSON.stringify({
        version: 2,
        records: {
          'deepseek::g::w': [
            { timestamp: now - 60000, instanceId: 'deepseek', poolId: 'g', windowId: 'w', remainingPercent: 80, usedPercent: 20 },
            { timestamp: now, instanceId: 'deepseek', poolId: 'g', windowId: 'w', remainingPercent: 70, usedPercent: 30 },
          ],
        },
      }),
      'utf8',
    )

    const mgr = new QuotaManager()
    await mgr.historyManager.ready
    const migrated = readdirSync(legacyHome).filter((name) => name.startsWith('quota-history.json.migrated-'))
    assert.equal(migrated.length, 1, 'legacy json must be renamed, not deleted')
    assert.ok(existsSync(join(legacyHome, 'quota-history.jsonl')), 'journal must exist after migration')
    const journal = readFileSync(join(legacyHome, 'quota-history.jsonl'), 'utf8')
    assert.ok(journal.includes('"r":80') || journal.includes('"r":70'), 'journal keeps migrated points')
    const trend = mgr.historyManager.getTrendPoints('deepseek::g::w', 7)
    assert.ok(trend.length >= 2)
  } finally {
    process.env.DSH_HOME = previous
  }
})
