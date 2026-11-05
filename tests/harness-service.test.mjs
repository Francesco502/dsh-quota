import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { createMonitorService, inject, VERSION } from '../src/index.ts'

test('shared monitor service serves UI and agent data without enabling routing', async () => {
  const reads = []
  const usage = { async snapshot(q) { reads.push(q); return { totals: { calls: 2 }, byModel: [] } }, async dispose() {} }
  const quotas = { async snapshot(options) { assert.equal(options.signal.aborted, false); return { accounts: [{ id: 'fake', status: 'unsupported', windows: [] }] } }, async dispose() {} }
  const monitor = createMonitorService(usage, quotas)
  const result = await monitor.snapshot({ timeZone: 'Europe/Moscow', provider: 'fake-provider' })
  assert.equal(result.schemaVersion, 1)
  assert.equal(Object.hasOwn(result, 'routingEnabled'), false)
  assert.equal(result.usage.totals.calls, 2)
  assert.equal(result.accountState.accounts[0].status, 'unsupported')
  assert.equal(reads[0].timeZone, 'Europe/Moscow')
  assert.equal(reads[0].provider, 'fake-provider')
  assert.throws(() => monitor.usage({ baseUrl: 'http://attacker.invalid' }))
  await assert.rejects(() => monitor.snapshot({ apiKey: 'FAKE' }))
  await monitor.dispose()
})
test('request and plugin lifetimes cancel account reads; both backends dispose', async () => {
  const signals = []; let disposed = 0
  const monitor = createMonitorService({ snapshot() {}, async dispose() { disposed++ } }, {
    async snapshot({ signal }) { signals.push(signal); return { accounts: [] } }, async dispose() { disposed++ },
  })
  const request = new AbortController()
  await monitor.accounts({ signal: request.signal })
  request.abort(); assert.equal(signals[0].aborted, true)
  await monitor.accounts(); await monitor.dispose()
  assert.equal(signals[1].aborted, true)
  assert.equal(disposed, 2)
})
test('published UI does not display or own the separate router state', () => {
  const client = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
  assert.equal(client.includes('Monitoring only'), false)
  assert.equal(client.includes('automatic routing is off'), false)
  assert.equal(client.includes('noRouting'), false)
})
test('activation requires native accounting, credential, admission and durable storage services', () => {
  for (const key of ['connection', 'llm', 'credentials', 'sessionQuery', 'sessionProjections', 'storageDomain', 'tools']) assert.ok(inject.includes(key))
  assert.equal(inject.includes('webServer'), false)
  assert.match(VERSION, /^0\.5\./)
})
