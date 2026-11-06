import test from 'node:test'
import assert from 'node:assert/strict'
import { registerQuotaRoutes, parseUsageQuery, usageForTool } from '../src/harness/api.ts'

function fixture() {
  const routes = new Map(); const calls = []
  const ctx = {
    get webServer() { throw new Error('Raw routes must never be used') },
    connection: { fetch: { register(route) { routes.set(route.path, route); return () => routes.delete(route.path) } } },
  }
  const monitor = {
    async usage(query) { calls.push(['usage', query]); return { totals: {} } },
    async snapshot(query) { calls.push(['snapshot', query]); return { usage: {} } },
    async accounts(options) { calls.push(['accounts', options]); return { accounts: [] } },
  }
  const dispose = registerQuotaRoutes(ctx, monitor)
  async function invoke(path, options = {}) {
    const request = new Request('http://dsh.internal' + path, options)
    const route = routes.get(new URL(request.url).pathname)
    if (!route || !route.methods.includes(request.method)) return new Response(null, { status: 404 })
    return route.fetch(request)
  }
  return { routes, calls, dispose, invoke }
}
test('registers only Connection routes; no mutable config, login, arbitrary endpoint or proxy route', async () => {
  const f = fixture()
  assert.equal(f.routes.size, 5)
  for (const path of ['/config', '/test-connection', '/test-all', '/auth/codex/start', '/auth/cursor/connect']) {
    assert.equal((await f.invoke('/api/dsh-quota' + path)).status, 404)
  }
  await f.dispose(); assert.equal(f.routes.size, 0)
})
test('all read replies are no-store, JSON and nosniff; invalid parameters never reach service', async () => {
  const f = fixture()
  const response = await f.invoke('/api/dsh-quota/usage?timeZone=Europe%2FMoscow')
  assert.equal(response.status, 200)
  assert.equal(response.headers.get('cache-control'), 'no-store')
  assert.equal(response.headers.get('x-content-type-options'), 'nosniff')
  assert.equal(f.calls[0][1].timeZone, 'Europe/Moscow')
  for (const query of ['baseUrl=https://attacker.invalid', 'proxy=http://evil.invalid', 'from=0&from=1', 'timeZone=bad', 'sessionId=../secrets', 'includeChildren=yes']) {
    assert.equal((await f.invoke('/api/dsh-quota/usage?' + query)).status, 400, query)
  }
  assert.equal(f.calls.length, 1)
})
test('refresh accepts POST JSON empty object only, with bounded body and no URL inputs', async () => {
  const f = fixture()
  assert.equal((await f.invoke('/api/dsh-quota/refresh')).status, 404)
  assert.equal((await f.invoke('/api/dsh-quota/refresh', { method: 'POST', body: '{}' })).status, 415)
  const send = body => f.invoke('/api/dsh-quota/refresh', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body })
  assert.equal((await send('{"baseUrl":"x"}')).status, 400)
  assert.equal((await send(' '.repeat(33))).status, 413)
  assert.equal((await send('{}')).status, 200)
  assert.equal(f.calls.length, 1)
  assert.equal(f.calls[0][1].refresh, true)
})
test('server errors redact arbitrary upstream bodies, tokens and URLs', async () => {
  let route
  registerQuotaRoutes({ connection: { fetch: { register(r) { if (r.path.endsWith('/accounts')) route = r; return () => {} } } } }, {
    accounts() { throw new Error('Bearer TOP_SECRET https://private.invalid <img src=x onerror=alert(1)>') },
  })
  const response = await route.fetch(new Request('http://dsh.internal/api/dsh-quota/accounts'))
  assert.equal(response.status, 503)
  assert.deepEqual(await response.json(), { error: 'Usage service unavailable' })
})
test('model-facing detail is bounded, declares truncation, and preserves complete totals', () => {
  const result = usageForTool({ totals: { totalTokens: 10000 }, coverage: { complete: false }, byModel: [{ key: 'a' }, { key: 'b' }], byDay: [{ key: 'd' }] }, 'model', 1)
  assert.deepEqual(result.totals, { totalTokens: 10000 })
  assert.deepEqual(result.byModel, [{ key: 'a' }])
  assert.deepEqual(result.detail, { totalRows: 2, returnedRows: 1, truncated: true })
  assert.equal(Object.hasOwn(result, 'byDay'), false)
  assert.throws(() => usageForTool({}, 'bad'))
  assert.throws(() => usageForTool({}, 'day', 101))
})
test('query range and filter validation has no writable route parameters', () => {
  assert.deepEqual(parseUsageQuery({ from: 100, to: 200, provider: 'official', model: 'test/model' }, 1000), {
    from: 100, to: 200, timeZone: 'UTC', includeChildren: true, provider: 'official', model: 'test/model',
  })
  for (const query of [{ from: -1 }, { from: 100, to: 100 }, { from: 0, to: 400 * 86400000 }, { apiKey: 'secret' }, { model: '\nsecret' }]) {
    assert.throws(() => parseUsageQuery(query, 1000))
  }
})
