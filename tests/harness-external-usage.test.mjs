/**
 * External receipt ingestion tests: fake Host context, fake live domain, no
 * Harness runtime package, no credential file, no network.
 *
 * Run: node --test tests/harness-external-usage.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { createUsageTracker } from '../src/harness/usage.ts'

const NOW = Date.parse('2026-11-05T12:00:00.000Z')

/**
 * One per-record domain double. `put` can be gated so a test can observe
 * disposal before the write settles.
 */
function fakeStorage({ put } = {}) {
  const tables = new Map()
  const events = []
  return {
    tables,
    events,
    async open(spec) {
      const tableName = Object.keys(spec.tables)[0]
      const schema = spec.tables[tableName].valueSchema
      const fullName = `${spec.name}:${tableName}`
      let table = tables.get(fullName)
      if (table === undefined) {
        table = new Map()
        tables.set(fullName, table)
      }
      return {
        name: spec.name,
        table(name) {
          assert.equal(name, tableName)
          return {
            entries: () => table.entries(),
            get: key => table.get(key),
            async put(key, value) {
              schema.parse(value)
              if (put !== undefined) await put(key, value)
              table.set(key, structuredClone(value))
              events.push(`put:${key}`)
            },
            async delete(key) {
              events.push(`delete:${key}`)
              return table.delete(key)
            },
          }
        },
        async close() {
          events.push('close')
        },
      }
    },
  }
}

function fakeCtx({ storage } = {}) {
  const listeners = new Map()
  const ctx = {
    get(name) {
      return name === 'storageDomain' ? storage : undefined
    },
    on(name, listener) {
      listeners.set(name, listener)
      return () => listeners.delete(name)
    },
  }
  return { ctx, listeners }
}

async function startTracker(ctx, options = {}) {
  const tracker = createUsageTracker(ctx, { now: () => NOW, prewarm: false, ...options })
  await tracker.start()
  return tracker
}

/** Feed one native stream through the registered `llm/stream` observer. */
function receipt(overrides = {}) {
  return {
    callId: 'coordinator-groq-1',
    sessionId: 's1',
    provider: 'groq',
    model: 'openai/gpt-oss-120b',
    task: 'coordinator-groq',
    time: NOW,
    usage: { inputTokens: 222, outputTokens: 183 },
    ...overrides,
  }
}

test('a reported receipt is counted, persisted, and visible in a snapshot', async () => {
  const storage = fakeStorage()
  const f = fakeCtx({ storage })
  const tracker = await startTracker(f.ctx)

  const result = await tracker.recordExternalUsage(receipt())
  assert.deepEqual(result, { status: 'stored', persisted: true })
  assert.ok(storage.tables.get('dsh_quota_usage:live')?.has('external:coordinator-groq-1'))

  const snap = await tracker.snapshot({ from: 0, to: NOW + 60_000 })
  assert.equal(snap.totals.calls, 1)
  assert.equal(snap.totals.inputTokens, 222)
  assert.equal(snap.totals.outputTokens, 183)
  assert.equal(snap.totals.totalTokens, 405)
  assert.equal(snap.totals.unknownCalls, 0)
  assert.equal(snap.byTask.find(row => row.key === 'coordinator-groq')?.calls, 1)
  await tracker.dispose()
})

test('absent usage stays an explicit unknown call, never a free one', async () => {
  const storage = fakeStorage()
  const f = fakeCtx({ storage })
  const tracker = await startTracker(f.ctx)

  await tracker.recordExternalUsage(receipt({ callId: 'jev-1', provider: 'typesafe', model: 'jev-latest', task: 'coordinator-jev', usage: null }))
  await tracker.recordExternalUsage(receipt({ callId: 'jev-2', provider: 'typesafe', model: 'jev-latest', task: 'coordinator-jev', usage: undefined }))

  const snap = await tracker.snapshot({ from: 0, to: NOW + 60_000 })
  assert.equal(snap.totals.calls, 2)
  assert.equal(snap.totals.unknownCalls, 2)
  assert.equal(snap.totals.inputTokens, 0)
  await tracker.dispose()
})

test('replaying the same id reuses the durable commit in one process', async () => {
  const storage = fakeStorage()
  const f = fakeCtx({ storage })
  const tracker = await startTracker(f.ctx)

  assert.deepEqual(await tracker.recordExternalUsage(receipt()), { status: 'stored', persisted: true })
  assert.deepEqual(await tracker.recordExternalUsage(receipt()), { status: 'duplicate', persisted: true })

  const snap = await tracker.snapshot({ from: 0, to: NOW + 60_000 })
  assert.equal(snap.totals.calls, 1)
  await tracker.dispose()
})

test('a duplicate cannot acknowledge a receipt whose first commit is still pending', async () => {
  let release
  const gate = new Promise(resolve => { release = resolve })
  const storage = fakeStorage({ put: async key => { if (key.startsWith('external:')) await gate } })
  const f = fakeCtx({ storage })
  const tracker = await startTracker(f.ctx)

  const first = tracker.recordExternalUsage(receipt({ callId: 'barrier-1' }))
  await new Promise(resolve => setImmediate(resolve))

  let duplicateSettled = false
  const duplicate = tracker.recordExternalUsage(receipt({ callId: 'barrier-1' }))
    .then(result => {
      duplicateSettled = true
      return result
    })
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(duplicateSettled, false, 'the duplicate waits for the shared commit')
  assert.equal(storage.events.includes('put:external:barrier-1'), false)

  release()
  assert.deepEqual(await first, { status: 'stored', persisted: true })
  assert.deepEqual(await duplicate, { status: 'duplicate', persisted: true })
  assert.equal(storage.events.includes('put:external:barrier-1'), true)
  await tracker.dispose()
})

test('a failed first write reports no durability and a replay retries it', async () => {
  let attempts = 0
  const storage = fakeStorage({
    put: async key => {
      if (!key.startsWith('external:')) return
      attempts += 1
      if (attempts === 1) throw new Error('domain write failed')
    },
  })
  const f = fakeCtx({ storage })
  const tracker = await startTracker(f.ctx)

  assert.deepEqual(await tracker.recordExternalUsage(receipt({ callId: 'retry-1' })), { status: 'stored', persisted: false })
  assert.equal(storage.tables.get('dsh_quota_usage:live')?.has('external:retry-1'), false)
  assert.equal((await tracker.snapshot({ from: 0, to: NOW + 60_000 })).totals.calls, 1, 'the call is still counted in this process')

  assert.deepEqual(await tracker.recordExternalUsage(receipt({ callId: 'retry-1' })), { status: 'duplicate', persisted: true })
  assert.equal(attempts, 2)
  assert.equal(storage.tables.get('dsh_quota_usage:live')?.has('external:retry-1'), true)
  assert.equal((await tracker.snapshot({ from: 0, to: NOW + 60_000 })).totals.calls, 1, 'the retry does not double count')
  await tracker.dispose()
})

test('a replayed receipt stays a durable duplicate after a restart', async () => {
  const storage = fakeStorage()
  const first = fakeCtx({ storage })
  const firstTracker = await startTracker(first.ctx)
  assert.deepEqual(await firstTracker.recordExternalUsage(receipt()), { status: 'stored', persisted: true })
  await firstTracker.dispose()

  const second = fakeCtx({ storage })
  const secondTracker = await startTracker(second.ctx)
  assert.deepEqual(await secondTracker.recordExternalUsage(receipt()), { status: 'duplicate', persisted: true })
  const snap = await secondTracker.snapshot({ from: 0, to: NOW + 60_000 })
  assert.equal(snap.totals.calls, 1)
  assert.equal(snap.totals.inputTokens, 222)
  await secondTracker.dispose()
})

test('distinct receipts with the same route, task, and time are both stored', async () => {
  const storage = fakeStorage()
  const f = fakeCtx({ storage })
  const tracker = await startTracker(f.ctx)

  // No route/task/time heuristic may merge two callers' distinct requests.
  assert.deepEqual(await tracker.recordExternalUsage(receipt({ callId: 'pair-1' })), { status: 'stored', persisted: true })
  assert.deepEqual(await tracker.recordExternalUsage(receipt({ callId: 'pair-2' })), { status: 'stored', persisted: true })

  const snap = await tracker.snapshot({ from: 0, to: NOW + 60_000 })
  assert.equal(snap.totals.calls, 2)
  assert.equal(snap.totals.inputTokens, 444)
  await tracker.dispose()
})

test('malformed receipts name the rejected field', async () => {
  const storage = fakeStorage()
  const f = fakeCtx({ storage })
  const tracker = await startTracker(f.ctx)

  await assert.rejects(tracker.recordExternalUsage(receipt({ callId: '' })), /callId/)
  await assert.rejects(tracker.recordExternalUsage(receipt({ callId: 'bad\nid' })), /control characters/)
  await assert.rejects(tracker.recordExternalUsage(receipt({ provider: undefined })), /provider/)
  await assert.rejects(tracker.recordExternalUsage(receipt({ usage: '222/183' })), /usage must be an object or null/)
  await assert.rejects(tracker.recordExternalUsage(receipt({ usage: { inputTokens: -1, outputTokens: 5 } })), /inputTokens/)
  await assert.rejects(tracker.recordExternalUsage(receipt({ usage: { inputTokens: 1.5, outputTokens: 5 } })), /inputTokens/)
  await assert.rejects(tracker.recordExternalUsage(receipt({ time: -1 })), /time/)
  await assert.rejects(tracker.recordExternalUsage(null), /receipt must be an object/)

  const snap = await tracker.snapshot({ from: 0, to: NOW + 60_000 })
  assert.equal(snap.totals.calls, 0, 'rejected receipts never reach the index')
  await tracker.dispose()
})

test('an aborted caller records nothing and later calls fail after disposal', async () => {
  const storage = fakeStorage()
  const f = fakeCtx({ storage })
  const tracker = await startTracker(f.ctx)

  const controller = new AbortController()
  controller.abort()
  await assert.rejects(
    tracker.recordExternalUsage(receipt({ callId: 'aborted-1' }), { signal: controller.signal }),
    error => error.name === 'AbortError',
  )
  assert.equal(storage.tables.get('dsh_quota_usage:live')?.has('external:aborted-1'), false)

  await tracker.dispose()
  await assert.rejects(tracker.recordExternalUsage(receipt({ callId: 'after-dispose' })), /disposed/)
})

test('disposal drains an accepted write before closing the domain', async () => {
  let release
  const gate = new Promise(resolve => { release = resolve })
  // Gate only the receipt write: the tracking watermark is written during start.
  const storage = fakeStorage({ put: async key => { if (key.startsWith('external:')) await gate } })
  const f = fakeCtx({ storage })
  const tracker = await startTracker(f.ctx)

  const ingestion = tracker.recordExternalUsage(receipt({ callId: 'drain-1' }))
  await new Promise(resolve => setImmediate(resolve))
  const disposal = tracker.dispose()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(storage.events.includes('close'), false, 'the domain stays open while a write is in flight')

  release()
  await disposal
  await ingestion
  const putAt = storage.events.indexOf('put:external:drain-1')
  const closeAt = storage.events.indexOf('close')
  assert.ok(putAt >= 0, 'the accepted receipt was written')
  assert.ok(closeAt > putAt, 'close happens after the write settled')
})

test('a missing storage facility keeps the receipt in process memory only', async () => {
  const f = fakeCtx()
  const tracker = await startTracker(f.ctx)

  const result = await tracker.recordExternalUsage(receipt({ callId: 'memory-1' }))
  assert.deepEqual(result, { status: 'stored', persisted: false })

  const snap = await tracker.snapshot({ from: 0, to: NOW + 60_000 })
  assert.equal(snap.totals.calls, 1)
  await tracker.dispose()
})
