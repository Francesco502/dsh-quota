/**
 * Route guard tests: the plugin API is reachable from the local machine, so
 * cross-site pages must not be able to drive it. These tests pin the four rules
 * (custom header, loopback host, same-origin origin, JSON content type).
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import http from 'node:http'
import { makeQuotaRoutes } from '../src/routes.ts'

function fakeManager(overrides = {}) {
  const calls = { getQuotaCards: 0, saveConfig: 0, historyDays: [] }
  const manager = {
    getQuotaCards: async () => {
      calls.getQuotaCards += 1
      return { cards: [], allCards: [], alarms: [], lastUpdated: Date.now() }
    },
    refreshSingleProvider: async (id) =>
      id === 'deepseek' ? { id: 'deepseek', name: 'DeepSeek', provider: 'deepseek', category: 'domestic_llm', status: 'ok', groups: [], lastUpdated: Date.now() } : undefined,
    testConnection: async () => ({ ok: true, provider: 'x', message: 'ok' }),
    testAllConnections: async () => ({}),
    saveConfig: () => {
      calls.saveConfig += 1
    },
    getSafeConfig: () => ({ deepseek: { enabled: true } }),
    getConfig: () => ({ deepseek: { enabled: true } }),
    historyManager: {
      getTrendPoints: (id, days) => {
        calls.historyDays.push(days)
        return []
      },
    },
    ...overrides,
  }
  return { manager, calls }
}

async function startServer(manager) {
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
  const { port } = server.address()
  return { server, base: `http://127.0.0.1:${port}` }
}

async function withServer(fn) {
  const { manager, calls } = fakeManager()
  const { server, base } = await startServer(manager)
  try {
    await fn({ base, calls, manager })
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
}

test('rejects requests without the X-DSH-Quota header', async () => {
  await withServer(async ({ base }) => {
    const response = await fetch(`${base}/api/dsh-quota/status`)
    assert.equal(response.status, 403)
  })
})

test('accepts a same-origin request that carries the header', async () => {
  await withServer(async ({ base, calls }) => {
    const response = await fetch(`${base}/api/dsh-quota/status`, {
      headers: { 'X-DSH-Quota': '1' },
    })
    assert.equal(response.status, 200)
    assert.equal(calls.getQuotaCards, 1)
  })
})

test('rejects a cross-origin Origin', async () => {
  await withServer(async ({ base }) => {
    const response = await fetch(`${base}/api/dsh-quota/status`, {
      headers: { 'X-DSH-Quota': '1', Origin: 'http://evil.example' },
    })
    assert.equal(response.status, 403)
  })
})

test('rejects a cross-site Sec-Fetch-Site', async () => {
  await withServer(async ({ base }) => {
    const response = await fetch(`${base}/api/dsh-quota/status`, {
      headers: { 'X-DSH-Quota': '1', 'Sec-Fetch-Site': 'cross-site' },
    })
    assert.equal(response.status, 403)
  })
})

test('rejects text/plain writes (no-preflight CSRF shape)', async () => {
  await withServer(async ({ base, calls }) => {
    const response = await fetch(`${base}/api/dsh-quota/config`, {
      method: 'POST',
      headers: { 'X-DSH-Quota': '1', 'Content-Type': 'text/plain' },
      body: JSON.stringify({ httpProxy: 'http://attacker.example:8080' }),
    })
    assert.equal(response.status, 415)
    assert.equal(calls.saveConfig, 0)
  })
})

test('accepts a JSON config write with the header', async () => {
  await withServer(async ({ base, calls }) => {
    const response = await fetch(`${base}/api/dsh-quota/config`, {
      method: 'POST',
      headers: { 'X-DSH-Quota': '1', 'Content-Type': 'application/json' },
      body: JSON.stringify({ deepseek: { enabled: true } }),
    })
    assert.equal(response.status, 200)
    assert.equal(calls.saveConfig, 1)
  })
})

test('returns 404 for an unknown provider instead of a fake success', async () => {
  await withServer(async ({ base }) => {
    const response = await fetch(`${base}/api/dsh-quota/status?provider=nope`, {
      headers: { 'X-DSH-Quota': '1' },
    })
    assert.equal(response.status, 404)
  })
})

test('clamps the history window to 1..30 days', async () => {
  await withServer(async ({ base, calls }) => {
    for (const days of ['9999', 'abc', '0']) {
      await fetch(`${base}/api/dsh-quota/history?instanceId=codex&days=${days}`, {
        headers: { 'X-DSH-Quota': '1' },
      })
    }
    assert.deepEqual(calls.historyDays, [30, 7, 1])
  })
})

test('rejects non-loopback Host (DNS rebinding shape)', async () => {
  await withServer(async ({ base }) => {
    const url = new URL(base)
    const response = await new Promise((resolve, reject) => {
      const request = http.request(
        {
          host: '127.0.0.1',
          port: url.port,
          path: '/api/dsh-quota/status',
          headers: { 'X-DSH-Quota': '1', Host: 'rebind.evil.example' },
        },
        (res) => resolve(res),
      )
      request.on('error', reject)
      request.end()
    })
    assert.equal(response.statusCode, 403)
  })
})
