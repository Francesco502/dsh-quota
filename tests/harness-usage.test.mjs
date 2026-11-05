/**
 * Native Harness usage accounting tests. These use fake Host contexts and fake
 * Session logs only: no DSH runtime package is imported, no profile or
 * credential file is read, and no real Session is written.
 *
 * Run: node --test tests/harness-usage.test.mjs
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import {
  USAGE_PROJECTION_KEY,
  USAGE_PROJECTION_VERSION,
  advanceUsageProjection,
  createUsageTracker,
  initUsageProjection,
  normalizeUsage,
  usageProjectionDefinition,
} from '../src/harness/usage.ts'

const NOW = Date.parse('2026-11-05T12:00:00.000Z')

// ---------------------------------------------------------------------------
// Fake Host surface
// ---------------------------------------------------------------------------

function session({ id, events = [], inheritedEventCount = 0, parentSession, createdAt = 0 }) {
  return {
    id,
    header: {
      id,
      version: 2,
      createdAt,
      isSeeded: parentSession !== undefined,
      ...(parentSession === undefined ? {} : { parentSession }),
    },
    inheritedEventCount,
    get seq() {
      return events.length
    },
    events,
    snapshotEvents() {
      return events
    },
  }
}

function event(type, seq, time, data) {
  return { type, seq, time, data }
}

function assistantMessage({ seq, time, provider = 'p', model = 'm', usage, stream }) {
  return event('assistant/message', seq, time, {
    turn: 1,
    step: 1,
    message: { role: 'assistant', content: [], source: { kind: 'model', provider, model } },
    stream: stream ?? (usage === undefined ? [] : [{ type: 'chunk', time, chunk: { type: 'usage', usage } }]),
    ...(usage === undefined ? {} : { usage }),
  })
}

function assistantAttempt({ seq, time, usage }) {
  return event('assistant/attempt', seq, time, {
    turn: 1,
    step: 1,
    stream: usage === undefined ? [] : [{ type: 'chunk', time, chunk: { type: 'usage', usage } }],
  })
}

function compactionSummary({ seq, time, provider = 'p', model = 'm', usage }) {
  return event('compaction/summary', seq, time, {
    provider,
    model,
    ...(usage === undefined ? {} : { usage }),
  })
}

function requestHeader({ seq, time, provider, model }) {
  return event('request/header', seq, time, {
    header: { config: { provider, model } },
    reason: 'initial',
  })
}

function projectionService() {
  const definitions = new Map()
  return {
    definitions,
    async register(definition) {
      definitions.set(definition.key, definition)
      return {
        stateOf(session) {
          // Fold from scratch each read: tests mutate the fake log between reads.
          let state = definition.init(session.header, session.inheritedEventCount)
          for (const item of session.events) state = definition.apply(state, item)
          return state
        },
        async dispose() {},
      }
    },
  }
}

function fakeCtx({ live = [], cold = new Map(), storageDomain } = {}) {
  const listeners = new Map()
  const projections = projectionService()
  const allHeaders = new Map()
  for (const item of live) allHeaders.set(item.id, item.header)
  for (const [id, item] of cold) allHeaders.set(id, item.header)

  const store = {
    list: () => live,
    get: id => live.find(item => item.id === id),
  }

  const descendantsOf = id => {
    const children = []
    for (const header of allHeaders.values()) {
      if (header.parentSession === id) children.push(header.id)
    }
    return children
  }
  const tree = id => descendantsOf(id).map(child => ({
    session: { header: allHeaders.get(child) },
    descendants: tree(child),
  }))

  const query = {
    async listSessions() {
      const seen = new Set()
      const records = []
      for (const item of live) {
        if (seen.has(item.id)) continue
        seen.add(item.id)
        records.push({ header: item.header, live: true, persisted: false })
      }
      for (const [id, item] of cold) {
        if (seen.has(id)) continue
        seen.add(id)
        records.push({ header: item.header, live: false, persisted: true })
      }
      return records
    },
    async observeSession(id) {
      const item = cold.get(id)
      if (item === undefined) throw new Error(`fake session ${id} not found`)
      return {
        header: item.header,
        inheritedEventCount: item.inheritedEventCount,
        events: item.events,
        cursor: item.events.length === 0 ? -1 : item.events.at(-1).seq,
        [Symbol.dispose]() {},
      }
    },
    async traceSession(id) {
      return {
        target: { header: allHeaders.get(id) },
        ancestors: [],
        descendants: tree(id),
        complete: true,
        root: { header: allHeaders.get(id) },
      }
    },
  }

  const ctx = {
    sessions: store,
    sessionQuery: query,
    sessionProjections: projections,
    storageDomain,
    on(name, listener) {
      listeners.set(name, listener)
      return () => listeners.delete(name)
    },
    get(name) {
      return ctx[name]
    },
  }
  return { ctx, listeners, projections, store, query }
}

function fakeStorage() {
  const tables = new Map()
  return {
    tables,
    async open(spec) {
      assert.equal(spec.version, 1)
      assert.equal(spec.layout, 'per-record')
      assert.ok(spec.name === 'dsh_quota_usage' || spec.name === 'dsh_quota_meta')
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
              // Mirror DomainFacility's durable read boundary validation.
              schema.parse(value)
              table.set(key, structuredClone(value))
            },
            async delete(key) {
              return table.delete(key)
            },
          }
        },
        async close() {},
      }
    },
  }
}

async function startTracker(ctx, options = {}) {
  const tracker = createUsageTracker(ctx, {
    now: () => NOW,
    prewarm: false,
    ...options,
  })
  const stop = await tracker.start()
  return { tracker, stop }
}

function commit(f, session, item) {
  session.events.push(item)
  f.listeners.get('session/event')?.(session, item)
}

async function consume(f, options, chunks) {
  const listener = f.listeners.get('llm/stream')
  assert.equal(typeof listener, 'function', 'llm/stream listener registered')
  const stream = listener(options, () => (async function* generate() {
    for (const chunk of chunks) yield chunk
  })())
  const seen = []
  for await (const chunk of stream) seen.push(chunk)
  return seen
}

function row(rows, key) {
  return rows.find(item => item.key === key)
}

function usageSnapshotJson(snapshot) {
  return JSON.stringify(snapshot)
}

// ---------------------------------------------------------------------------
// Counting
// ---------------------------------------------------------------------------

test('final message and retry attempt are each counted once; live twin is deduped', async () => {
  const s1 = session({ id: 's1' })
  const f = fakeCtx({ live: [s1] })
  const { tracker } = await startTracker(f.ctx)

  // A loop call emits cumulative usage snapshots; only the last one is a count.
  await consume(f, { provider: 'deepseek', model: 'deepseek-chat', sessionId: 's1' }, [
    { type: 'usage', usage: { inputTokens: 40, outputTokens: 20 } },
    { type: 'usage', usage: { inputTokens: 100, outputTokens: 50 } },
    { type: 'finish', reason: { kind: 'stop' } },
  ])

  commit(f, s1, requestHeader({ seq: 0, time: NOW, provider: 'deepseek', model: 'deepseek-chat' }))
  commit(f, s1, assistantAttempt({ seq: 1, time: NOW + 1, usage: { inputTokens: 10, outputTokens: 5 } }))
  commit(f, s1, assistantMessage({
    seq: 2,
    time: NOW + 2,
    provider: 'deepseek',
    model: 'deepseek-chat',
    usage: { inputTokens: 100, outputTokens: 50 },
  }))

  const snap = await tracker.snapshot({ from: 0, to: NOW + 60_000 })
  assert.equal(snap.totals.inputTokens, 110)
  assert.equal(snap.totals.outputTokens, 55)
  assert.equal(snap.totals.totalTokens, 165)
  assert.equal(snap.totals.calls, 2, 'retry attempt + final message, live copy deduped')
  assert.equal(snap.totals.unknownCalls, 0)
  assert.equal(snap.coverage.committedCalls, 2)
  assert.equal(snap.coverage.liveAuxiliaryCalls, 0)

  const task = row(snap.byTask, 'assistant')
  assert.equal(task.calls, 2)
  assert.equal(task.label, 'Assistant')
  await tracker.dispose()
})

test('old committed call with identical counts does not absorb a new live call', async () => {
  let clock = NOW
  const s1 = session({ id: 's1' })
  const f = fakeCtx({ live: [s1] })
  const { tracker } = await startTracker(f.ctx, { now: () => clock })

  commit(f, s1, assistantMessage({
    seq: 0,
    time: NOW - 3 * 60 * 60 * 1000,
    provider: 'p',
    model: 'm',
    usage: { inputTokens: 12, outputTokens: 4 },
  }))

  clock = NOW
  await consume(f, { provider: 'p', model: 'm', sessionId: 's1' }, [
    { type: 'usage', usage: { inputTokens: 12, outputTokens: 4 } },
    { type: 'finish', reason: { kind: 'stop' } },
  ])

  const snap = await tracker.snapshot({ from: 0, to: NOW + 60_000 })
  assert.equal(snap.totals.calls, 2, 'hours-old log and new uncommitted live are distinct calls')
  assert.equal(snap.totals.inputTokens, 24)
  assert.equal(snap.coverage.committedCalls, 1)
  assert.equal(snap.coverage.liveAuxiliaryCalls, 1)
  await tracker.dispose()
})

test('two identical live calls plus one commit remain two, consuming one log receipt', async () => {
  let clock = NOW
  const s1 = session({ id: 's1' })
  const f = fakeCtx({ live: [s1] })
  const { tracker } = await startTracker(f.ctx, { now: () => clock })

  await consume(f, { provider: 'p', model: 'm', sessionId: 's1' }, [
    { type: 'usage', usage: { inputTokens: 20, outputTokens: 5 } },
    { type: 'finish', reason: { kind: 'stop' } },
  ])
  clock = NOW + 1_000
  await consume(f, { provider: 'p', model: 'm', sessionId: 's1' }, [
    { type: 'usage', usage: { inputTokens: 20, outputTokens: 5 } },
    { type: 'finish', reason: { kind: 'stop' } },
  ])
  clock = NOW + 2_000
  commit(f, s1, assistantMessage({
    seq: 0,
    time: NOW + 2_000,
    provider: 'p',
    model: 'm',
    usage: { inputTokens: 20, outputTokens: 5 },
  }))

  const snap = await tracker.snapshot({ from: 0, to: NOW + 60_000 })
  assert.equal(snap.totals.calls, 2, 'one commit consumes exactly one identical live copy')
  assert.equal(snap.totals.inputTokens, 40)
  assert.equal(snap.coverage.committedCalls, 1)
  assert.equal(snap.coverage.liveAuxiliaryCalls, 1)
  await tracker.dispose()
})

test('usage chunks are full-call snapshots, not deltas', async () => {
  const stream = [
    { type: 'chunk', time: NOW, chunk: { type: 'usage', usage: { inputTokens: 40, outputTokens: 20 } } },
    { type: 'chunk', time: NOW, chunk: { type: 'usage', usage: { inputTokens: 100, outputTokens: 50 } } },
  ]
  const cold = new Map([['cold-1', session({
    id: 'cold-1',
    events: [assistantMessage({ seq: 0, time: NOW, usage: undefined, stream })],
  })]])
  const f = fakeCtx({ cold })
  const { tracker } = await startTracker(f.ctx)

  const snap = await tracker.snapshot({ from: 0, to: NOW + 60_000 })
  assert.equal(snap.totals.inputTokens, 100)
  assert.equal(snap.totals.outputTokens, 50)
  assert.equal(snap.totals.totalTokens, 150)
  assert.equal(snap.totals.calls, 1)
  await tracker.dispose()
})

test('logged title requests report unmeasured auxiliary coverage', async () => {
  const cold = new Map([['title-reader', session({
    id: 'title-reader',
    events: [
      event('session/title-llm-request', 0, NOW, {
        titleProvider: 'deepseek',
        route: { provider: 'deepseek', model: 'deepseek-chat' },
      }),
      assistantMessage({ seq: 1, time: NOW, usage: { inputTokens: 3, outputTokens: 1 } }),
    ],
  })]])
  const f = fakeCtx({ cold })
  const { tracker } = await startTracker(f.ctx)

  const snap = await tracker.snapshot({ from: 0, to: NOW + 60_000 })
  assert.equal(snap.totals.calls, 1)
  assert.equal(snap.coverage.unreportedAuxiliaryCalls, 1)
  assert.equal(snap.coverage.historicalAuxiliary, 'live-only')
  await tracker.dispose()
})

test('retry attempts without a usage receipt are explicit unknown calls', async () => {
  const s1 = session({ id: 's1' })
  const f = fakeCtx({ live: [s1] })
  const { tracker } = await startTracker(f.ctx)

  commit(f, s1, requestHeader({ seq: 0, time: NOW, provider: 'p', model: 'm' }))
  commit(f, s1, assistantAttempt({ seq: 1, time: NOW + 1, usage: undefined }))

  const onlyAttempt = await tracker.snapshot({ from: 0, to: NOW + 60_000 })
  assert.equal(onlyAttempt.totals.calls, 1, 'no receipt does not prove the request was free')
  assert.equal(onlyAttempt.totals.unknownCalls, 1)

  commit(f, s1, assistantMessage({ seq: 2, time: NOW + 2, provider: 'p', model: 'm', usage: undefined }))
  const withMessage = await tracker.snapshot({ from: 0, to: NOW + 60_000 })
  assert.equal(withMessage.totals.calls, 2)
  assert.equal(withMessage.totals.unknownCalls, 2, 'both settled attempts are explicit unknowns')
  await tracker.dispose()
})

test('a live unknown call is deduped against its committed unknown twin', async () => {
  const s1 = session({ id: 's1' })
  const f = fakeCtx({ live: [s1] })
  const { tracker } = await startTracker(f.ctx)

  await consume(f, { provider: 'p', model: 'm', sessionId: 's1' }, [
    { type: 'finish', reason: { kind: 'error', failure: { message: 'fail', code: 'SERVER' } } },
  ])
  let snap = await tracker.snapshot({ from: 0, to: NOW + 60_000 })
  assert.equal(snap.totals.calls, 1)
  assert.equal(snap.totals.unknownCalls, 1)

  commit(f, s1, assistantMessage({ seq: 0, time: NOW, provider: 'p', model: 'm', usage: undefined }))
  snap = await tracker.snapshot({ from: 0, to: NOW + 60_000 })
  assert.equal(snap.totals.calls, 1, 'the committed unknown wins; the live copy is removed')
  assert.equal(snap.totals.unknownCalls, 1)
  assert.equal(snap.coverage.liveAuxiliaryCalls, 0)
  await tracker.dispose()
})

test('auto-review and session-title calls are counted from the llm/stream seam', async () => {
  const s1 = session({ id: 's1' })
  const f = fakeCtx({ live: [s1] })
  const { tracker } = await startTracker(f.ctx)

  await consume(f, {
    provider: 'deepseek',
    model: 'deepseek-chat',
    sessionId: 's1',
    purpose: 'auto-review',
    messages: [{ role: 'user', content: [{ type: 'text', text: 'SECRET REVIEW PROMPT' }] }],
  }, [
    { type: 'usage', usage: { inputTokens: 30, outputTokens: 10 } },
    { type: 'finish', reason: { kind: 'stop' } },
  ])
  await consume(f, {
    provider: 'deepseek',
    model: 'deepseek-chat',
    sessionId: 's1',
    purpose: 'session-title',
  }, [
    { type: 'usage', usage: { inputTokens: 5, outputTokens: 2 } },
    { type: 'finish', reason: { kind: 'stop' } },
  ])

  const snap = await tracker.snapshot({ from: 0, to: NOW + 60_000 })
  assert.equal(snap.totals.inputTokens, 35)
  assert.equal(snap.totals.outputTokens, 12)
  assert.equal(snap.totals.calls, 2)
  assert.equal(snap.coverage.liveAuxiliaryCalls, 2)
  assert.equal(snap.coverage.historicalAuxiliary, 'live-only')
  assert.equal(row(snap.byTask, 'auto-review').label, 'Auto review')
  assert.equal(row(snap.byTask, 'session-title').label, 'Session title')
  assert.ok(!usageSnapshotJson(snap).includes('SECRET REVIEW PROMPT'), 'prompt text is never persisted')
  await tracker.dispose()
})

test('fork-inherited replay is skipped; only own events are backfilled', async () => {
  const inherited = assistantMessage({
    seq: 0,
    time: NOW - 10_000,
    usage: { inputTokens: 999, outputTokens: 999 },
  })
  const own = assistantMessage({
    seq: 1,
    time: NOW,
    usage: { inputTokens: 10, outputTokens: 3 },
  })
  const child = session({
    id: 'fork-child',
    parentSession: 'parent',
    inheritedEventCount: 1,
    events: [inherited, own],
  })
  const f = fakeCtx({ cold: new Map([['fork-child', child]]) })
  const { tracker } = await startTracker(f.ctx)

  const snap = await tracker.snapshot({ from: 0, to: NOW + 60_000, sessionId: 'fork-child' })
  assert.equal(snap.totals.inputTokens, 10)
  assert.equal(snap.totals.outputTokens, 3)
  assert.equal(snap.totals.calls, 1)
  assert.equal(snap.coverage.backfilledFromLogs, true)
  await tracker.dispose()

  // The pure unit makes the same decision without a SessionQuery.
  let state = initUsageProjection(child.header, 1)
  state = advanceUsageProjection(state, inherited)
  assert.equal(state.observedCalls, 0)
  state = advanceUsageProjection(state, own)
  assert.equal(state.observedCalls, 1)
})

test('compaction usage is counted once from the durable summary', async () => {
  const s1 = session({ id: 's1' })
  const f = fakeCtx({ live: [s1] })
  const { tracker } = await startTracker(f.ctx)

  // Live compaction stream (also observed by llm/stream) and its committed summary.
  await consume(f, {
    provider: 'deepseek',
    model: 'deepseek-chat',
    sessionId: 's1',
    purpose: 'compaction',
  }, [
    { type: 'usage', usage: { inputTokens: 70, outputTokens: 20 } },
    { type: 'finish', reason: { kind: 'stop' } },
  ])
  commit(f, s1, compactionSummary({
    seq: 0,
    time: NOW,
    provider: 'deepseek',
    model: 'deepseek-chat',
    usage: { inputTokens: 70, outputTokens: 20 },
  }))

  const snap = await tracker.snapshot({ from: 0, to: NOW + 60_000 })
  assert.equal(snap.totals.calls, 1)
  assert.equal(snap.totals.inputTokens, 70)
  assert.equal(row(snap.byTask, 'compaction').label, 'Compaction')
  await tracker.dispose()
})

test('missing usage is an explicit unknown call, never a silent zero', async () => {
  const cold = new Map([['u1', session({
    id: 'u1',
    events: [assistantMessage({ seq: 0, time: NOW, usage: undefined })],
  })]])
  const f = fakeCtx({ cold })
  const { tracker } = await startTracker(f.ctx)

  const snap = await tracker.snapshot({ from: 0, to: NOW + 60_000 })
  assert.equal(snap.totals.calls, 1)
  assert.equal(snap.totals.unknownCalls, 1)
  assert.equal(snap.coverage.unknownUsageCalls, 1)
  assert.equal(snap.totals.totalTokens, 0)
  assert.equal(row(snap.byHour, snap.byHour[0].key).calls, 1)
  await tracker.dispose()
})

test('cache and reasoning buckets never double count output/total', async () => {
  const normalized = normalizeUsage({
    inputTokens: 100,
    outputTokens: 50,
    cacheReadTokens: 20,
    cacheWriteTokens: 10,
    reasoningTokens: 30,
    totalTokens: 210,
  })
  assert.equal(normalized.reported, true)
  assert.equal(normalized.totalTokens, 180, 'cache is disjoint; provider total folding it is not added again')
  assert.equal(normalized.reasoningTokens, 30)

  const cold = new Map([['c1', session({
    id: 'c1',
    events: [assistantMessage({
      seq: 0,
      time: NOW,
      usage: {
        inputTokens: 100,
        outputTokens: 50,
        cacheReadTokens: 20,
        cacheWriteTokens: 10,
        reasoningTokens: 30,
        totalTokens: 210,
      },
    })],
  })]])
  const f = fakeCtx({ cold })
  const { tracker } = await startTracker(f.ctx)
  const snap = await tracker.snapshot({ from: 0, to: NOW + 60_000 })
  assert.equal(snap.totals.inputTokens, 100)
  assert.equal(snap.totals.outputTokens, 50)
  assert.equal(snap.totals.cacheReadTokens, 20)
  assert.equal(snap.totals.cacheWriteTokens, 10)
  assert.equal(snap.totals.reasoningTokens, 30)
  assert.equal(snap.totals.totalTokens, 180)
  await tracker.dispose()
})

// ---------------------------------------------------------------------------
// Grouping, filtering, time zones
// ---------------------------------------------------------------------------

test('provider and model grouping is exact', async () => {
  const s1 = session({ id: 's1' })
  const s2 = session({ id: 's2' })
  const f = fakeCtx({ live: [s1, s2] })
  const { tracker } = await startTracker(f.ctx)
  commit(f, s1, assistantMessage({
    seq: 0,
    time: NOW,
    provider: 'deepseek',
    model: 'deepseek-chat',
    usage: { inputTokens: 10, outputTokens: 1 },
  }))
  commit(f, s2, assistantMessage({
    seq: 0,
    time: NOW,
    provider: 'openrouter',
    model: 'anthropic/claude',
    usage: { inputTokens: 20, outputTokens: 2 },
  }))

  const snap = await tracker.snapshot({ from: 0, to: NOW + 60_000 })
  assert.equal(row(snap.byProvider, 'deepseek').inputTokens, 10)
  assert.equal(row(snap.byProvider, 'openrouter').inputTokens, 20)
  assert.equal(row(snap.byModel, 'deepseek/deepseek-chat').inputTokens, 10)
  assert.equal(row(snap.byModel, 'openrouter/anthropic/claude').inputTokens, 20)

  const filtered = await tracker.snapshot({ from: 0, to: NOW + 60_000, provider: 'deepseek', model: 'deepseek-chat' })
  assert.equal(filtered.totals.inputTokens, 10)
  assert.equal(filtered.byProvider.length, 1)
  assert.equal(filtered.byModel.length, 1)

  await assert.rejects(
    tracker.snapshot({ provider: 'x'.repeat(257) }),
    /provider must be at most 256/,
  )
  await tracker.dispose()
})

test('time range excludes calls outside [from, to)', async () => {
  const s1 = session({ id: 's1' })
  const f = fakeCtx({ live: [s1] })
  const { tracker } = await startTracker(f.ctx)
  commit(f, s1, assistantMessage({
    seq: 0,
    time: 1_000,
    usage: { inputTokens: 1, outputTokens: 1 },
  }))
  commit(f, s1, assistantMessage({
    seq: 1,
    time: 5_000,
    usage: { inputTokens: 5, outputTokens: 5 },
  }))

  const snap = await tracker.snapshot({ from: 2_000, to: 6_000 })
  assert.equal(snap.totals.calls, 1)
  assert.equal(snap.totals.inputTokens, 5)
  assert.equal(snap.from, 2_000)
  assert.equal(snap.to, 6_000)
  await tracker.dispose()
})

test('hour/day buckets honor the explicit IANA time zone', async () => {
  const when = Date.parse('2026-11-05T12:34:56.000Z')
  const cold = new Map([['tz', session({
    id: 'tz',
    events: [assistantMessage({ seq: 0, time: when, usage: { inputTokens: 1, outputTokens: 1 } })],
  })]])
  const f = fakeCtx({ cold })
  const { tracker } = await startTracker(f.ctx)

  const moscow = await tracker.snapshot({ from: 0, to: when + 60_000, timeZone: 'Europe/Moscow' })
  assert.equal(moscow.byHour[0].key, '2026-11-05T15:00:00+03:00')
  assert.equal(moscow.byDay[0].key, '2026-11-05T00:00:00+03:00')

  const kolkata = await tracker.snapshot({ from: 0, to: when + 60_000, timeZone: 'Asia/Kolkata' })
  assert.equal(kolkata.byHour[0].key, '2026-11-05T18:00:00+05:30')
  assert.equal(kolkata.byDay[0].key, '2026-11-05T00:00:00+05:30')

  const utc = await tracker.snapshot({ from: 0, to: when + 60_000, timeZone: 'UTC' })
  assert.equal(utc.byHour[0].key, '2026-11-05T12:00:00+00:00')

  await assert.rejects(tracker.snapshot({ timeZone: 'Not/AZone' }), /unknown IANA time zone/)
  await tracker.dispose()
})

// ---------------------------------------------------------------------------
// Child rollups and persistence
// ---------------------------------------------------------------------------

test('child sessions roll up under the root session', async () => {
  const parent = session({ id: 'root' })
  const child = session({ id: 'child', parentSession: 'root' })
  const grandchild = session({ id: 'grandchild', parentSession: 'child' })
  const f = fakeCtx({ live: [parent, child, grandchild] })
  const { tracker } = await startTracker(f.ctx)
  commit(f, parent, assistantMessage({ seq: 0, time: NOW, usage: { inputTokens: 10, outputTokens: 1 } }))
  commit(f, child, assistantMessage({ seq: 0, time: NOW, usage: { inputTokens: 20, outputTokens: 2 } }))
  commit(f, grandchild, assistantMessage({ seq: 0, time: NOW, usage: { inputTokens: 5, outputTokens: 1 } }))

  const rolled = await tracker.snapshot({ from: 0, to: NOW + 60_000, sessionId: 'root' })
  assert.equal(rolled.totals.inputTokens, 35)
  assert.equal(rolled.totals.calls, 3)
  assert.equal(rolled.coverage.childSessionsIncluded, true)
  assert.equal(row(rolled.byRootSession, 'root').inputTokens, 35)
  assert.equal(row(rolled.bySession, 'root').inputTokens, 10)
  assert.equal(row(rolled.bySession, 'child').inputTokens, 20)
  assert.equal(row(rolled.bySession, 'grandchild').inputTokens, 5)
  assert.equal(rolled.bySession.length, 3)

  const direct = await tracker.snapshot({ from: 0, to: NOW + 60_000, sessionId: 'root', includeChildren: false })
  assert.equal(direct.totals.inputTokens, 10)
  assert.equal(direct.coverage.childSessionsIncluded, false)
  await tracker.dispose()
})

test('coverage.complete is false when any call lacks a usage receipt', async () => {
  const cold = new Map([['u1', session({
    id: 'u1',
    events: [assistantMessage({ seq: 0, time: NOW, usage: undefined })],
  })]])
  const f = fakeCtx({ cold })
  const { tracker } = await startTracker(f.ctx)

  const snap = await tracker.snapshot({ from: NOW, to: NOW + 60_000 })
  assert.equal(snap.coverage.sessionsComplete, true)
  assert.equal(snap.coverage.historicalAuxComplete, true)
  assert.equal(snap.coverage.unknownUsageCalls, 1)
  assert.equal(snap.coverage.complete, false, 'unknown calls make the account total incomplete')
  assert.ok(snap.limitations.some(line => line.includes('had no usage receipt')))
  await tracker.dispose()
})

test('coverage.complete is false when the range starts before tracking began', async () => {
  const cold = new Map([['t1', session({
    id: 't1',
    events: [assistantMessage({ seq: 0, time: NOW, usage: { inputTokens: 3, outputTokens: 1 } })],
  })]])
  const f = fakeCtx({ cold })
  const { tracker } = await startTracker(f.ctx)

  const historical = await tracker.snapshot({ from: 0, to: NOW + 60_000 })
  assert.equal(historical.coverage.trackingSince, NOW)
  assert.equal(historical.coverage.sessionsComplete, true)
  assert.equal(historical.coverage.historicalAuxComplete, false)
  assert.equal(historical.coverage.complete, false)
  assert.ok(historical.limitations.some(line => line.includes('began tracking')))

  const tracked = await tracker.snapshot({ from: NOW, to: NOW + 60_000 })
  assert.equal(tracked.coverage.historicalAuxComplete, true)
  assert.equal(tracked.coverage.complete, true)
  await tracker.dispose()
})

test('trackingSince is persisted across a restart', async () => {
  const storage = fakeStorage()
  const firstCtx = fakeCtx({ storageDomain: storage })
  const first = await startTracker(firstCtx.ctx)
  await first.tracker.dispose()
  assert.deepEqual(
    storage.tables.get('dsh_quota_meta:meta').get('trackingSince'),
    { trackingSince: NOW },
  )

  const secondCtx = fakeCtx({ storageDomain: storage })
  const second = await startTracker(secondCtx.ctx, { now: () => NOW + 3_600_000 })
  const snap = await second.tracker.snapshot({ from: NOW, to: NOW + 60_000 })
  assert.equal(snap.coverage.trackingSince, NOW, 'watermark survives restart')
  assert.equal(snap.coverage.historicalAuxComplete, true)
  assert.equal(snap.coverage.complete, true)
  await second.tracker.dispose()
})

test('cold Sessions are backfilled from SessionQuery exactly once', async () => {
  const cold = new Map([['cold-a', session({
    id: 'cold-a',
    events: [assistantMessage({ seq: 0, time: NOW, usage: { inputTokens: 42, outputTokens: 8 } })],
  })]])
  const f = fakeCtx({ cold })
  const { tracker } = await startTracker(f.ctx)

  const first = await tracker.snapshot({ from: NOW, to: NOW + 60_000 })
  assert.equal(first.totals.inputTokens, 42)
  assert.equal(first.coverage.coldSessions, 1)
  assert.equal(first.coverage.backfilledFromLogs, true)
  assert.equal(first.coverage.complete, true)
  assert.equal(first.indexing.status, 'ready')

  const second = await tracker.snapshot({ from: NOW, to: NOW + 60_000 })
  assert.equal(second.totals.inputTokens, 42, 'refreshing a cached cold Session does not add again')
  assert.equal(second.totals.calls, 1)
  await tracker.dispose()
})

test('cold indexing is bounded per snapshot and reports warming coverage', async () => {
  const cold = new Map([
    ['cold-1', session({
      id: 'cold-1',
      events: [assistantMessage({ seq: 0, time: NOW, usage: { inputTokens: 10, outputTokens: 1 } })],
    })],
    ['cold-2', session({
      id: 'cold-2',
      events: [assistantMessage({ seq: 0, time: NOW, usage: { inputTokens: 20, outputTokens: 2 } })],
    })],
  ])
  const f = fakeCtx({ cold })
  const { tracker } = await startTracker(f.ctx, { maxColdPerSnapshot: 1 })

  const first = await tracker.snapshot({ from: NOW, to: NOW + 60_000 })
  assert.equal(first.coverage.sessionsIndexed, 1)
  assert.equal(first.coverage.sessionsConsidered, 2)
  assert.equal(first.coverage.complete, false)
  assert.equal(first.indexing.status, 'warming')
  assert.equal(first.indexing.pendingSessions, 1)

  const second = await tracker.snapshot({ from: NOW, to: NOW + 60_000 })
  assert.equal(second.coverage.sessionsIndexed, 2)
  assert.equal(second.coverage.complete, true)
  assert.equal(second.indexing.status, 'ready')
  assert.equal(second.indexing.pendingSessions, 0)
  assert.equal(second.totals.inputTokens, 30)
  await tracker.dispose()
})

test('LRU cache eviction never drops records from a requested range', async () => {
  const cold = new Map([
    ['evict-1', session({
      id: 'evict-1',
      events: [assistantMessage({ seq: 0, time: NOW, usage: { inputTokens: 10, outputTokens: 1 } })],
    })],
    ['evict-2', session({
      id: 'evict-2',
      events: [assistantMessage({ seq: 0, time: NOW, usage: { inputTokens: 20, outputTokens: 2 } })],
    })],
  ])
  const f = fakeCtx({ cold })
  const { tracker } = await startTracker(f.ctx, { maxCachedSessions: 1 })

  const first = await tracker.snapshot({ from: NOW, to: NOW + 60_000 })
  assert.equal(first.totals.inputTokens, 30)
  assert.equal(first.totals.calls, 2)
  assert.equal(first.coverage.complete, true)

  // The cache can hold only one Session, but the next query re-reads the
  // evicted one from its source log instead of dropping its rows.
  const second = await tracker.snapshot({ from: NOW, to: NOW + 60_000 })
  assert.equal(second.totals.inputTokens, 30)
  assert.equal(second.totals.calls, 2)
  assert.equal(second.coverage.complete, true)
  await tracker.dispose()
})

test('a live Session that becomes cold is re-indexed from its final log', async () => {
  const live = []
  const cold = new Map()
  const s1 = session({ id: 's1' })
  live.push(s1)
  const f = fakeCtx({ live, cold })
  const { tracker } = await startTracker(f.ctx)

  commit(f, s1, assistantMessage({ seq: 0, time: NOW, usage: { inputTokens: 10, outputTokens: 1 } }))
  const whileLive = await tracker.snapshot({ from: 0, to: NOW + 60_000 })
  assert.equal(whileLive.totals.inputTokens, 10)

  // Simulate disposal, with a final event that landed after the last live read.
  s1.events.push(assistantMessage({ seq: 1, time: NOW + 1, usage: { inputTokens: 5, outputTokens: 1 } }))
  live.length = 0
  cold.set('s1', s1)

  const afterDispose = await tracker.snapshot({ from: 0, to: NOW + 60_000 })
  assert.equal(afterDispose.totals.inputTokens, 15)
  assert.equal(afterDispose.totals.calls, 2)
  assert.equal(afterDispose.coverage.backfilledFromLogs, true)
  await tracker.dispose()
})

test('persisted auxiliary usage survives restart and is not duplicated', async () => {
  const storage = fakeStorage()
  const s1 = session({ id: 's1' })
  const f1 = fakeCtx({ live: [s1], storageDomain: storage })
  const first = await startTracker(f1.ctx)

  await consume(f1, {
    provider: 'deepseek',
    model: 'deepseek-chat',
    sessionId: 's1',
    purpose: 'auto-review',
  }, [
    { type: 'usage', usage: { inputTokens: 7, outputTokens: 3 } },
    { type: 'finish', reason: { kind: 'stop' } },
  ])
  const before = await first.tracker.snapshot({ from: 0, to: NOW + 60_000 })
  assert.equal(before.totals.calls, 1)
  assert.equal(storage.tables.get('dsh_quota_usage:live').size, 1, 'only log-absent auxiliary calls are persisted')
  await first.tracker.dispose()

  // A second process starts with the same storage table; no live Session and no
  // Session log replay of this auxiliary call.
  const f2 = fakeCtx({ storageDomain: storage })
  const second = await startTracker(f2.ctx)
  const after = await second.tracker.snapshot({ from: 0, to: NOW + 60_000 })
  assert.equal(after.totals.inputTokens, 7)
  assert.equal(after.totals.outputTokens, 3)
  assert.equal(after.totals.calls, 1)
  assert.equal(row(after.byTask, 'auto-review').label, 'Auto review')

  const again = await second.tracker.snapshot({ from: 0, to: NOW + 60_000 })
  assert.equal(again.totals.calls, 1, 'repeated snapshots are not additive')
  await second.tracker.dispose()
})

test('persisted unknown live call is deduped against a log twin after restart', async () => {
  const storage = fakeStorage()
  const s1 = session({ id: 's1' })
  const f1 = fakeCtx({ live: [s1], storageDomain: storage })
  const first = await startTracker(f1.ctx)

  await consume(f1, { provider: 'p', model: 'm', sessionId: 's1' }, [
    { type: 'finish', reason: { kind: 'error', failure: { message: 'fail', code: 'SERVER' } } },
  ])
  assert.equal(storage.tables.get('dsh_quota_usage:live').size, 1, 'an unknown loop call is persisted so it survives restart')
  await first.tracker.dispose()

  const twin = session({
    id: 's1',
    events: [assistantMessage({ seq: 0, time: NOW, provider: 'p', model: 'm', usage: undefined })],
  })
  const f2 = fakeCtx({ cold: new Map([['s1', twin]]), storageDomain: storage })
  const second = await startTracker(f2.ctx)
  const snap = await second.tracker.snapshot({ from: 0, to: NOW + 60_000 })
  assert.equal(snap.totals.calls, 1)
  assert.equal(snap.totals.unknownCalls, 1)
  assert.equal(snap.coverage.liveAuxiliaryCalls, 0, 'the committed unknown wins')
  await second.tracker.dispose()
})

test('a committed live twin is reconciled even without the cleanup event', async () => {
  const s1 = session({ id: 's1' })
  const f = fakeCtx({ live: [s1] })
  const { tracker } = await startTracker(f.ctx)

  await consume(f, { provider: 'p', model: 'm', sessionId: 's1' }, [
    { type: 'usage', usage: { inputTokens: 12, outputTokens: 4 } },
    { type: 'finish', reason: { kind: 'stop' } },
  ])
  // Deliberately do not dispatch session/event; snapshot-time reconciliation
  // must still prefer the committed message.
  s1.events.push(assistantMessage({
    seq: 0,
    time: NOW,
    usage: { inputTokens: 12, outputTokens: 4 },
  }))

  const snap = await tracker.snapshot({ from: 0, to: NOW + 60_000 })
  assert.equal(snap.totals.calls, 1)
  assert.equal(snap.totals.inputTokens, 12)
  assert.equal(snap.coverage.liveAuxiliaryCalls, 0)
  await tracker.dispose()
})

test('missing llm/stream observation is reported as partial coverage', async () => {
  const f = fakeCtx({ live: [session({ id: 's1' })] })
  delete f.ctx.on
  const { tracker } = await startTracker(f.ctx)
  const snap = await tracker.snapshot({ from: 0, to: NOW + 60_000 })
  assert.equal(snap.coverage.historicalAuxiliary, 'partial')
  assert.ok(snap.limitations.some(line => line.includes('llm/stream observation is unavailable')))
  await tracker.dispose()
})

test('dispose removes observers and is idempotent', async () => {
  const f = fakeCtx({ live: [session({ id: 's1' })] })
  const { tracker } = await startTracker(f.ctx)
  assert.equal(f.listeners.has('llm/stream'), true)
  await tracker.dispose()
  await tracker.dispose()
  assert.equal(f.listeners.has('llm/stream'), false)
})

test('projection definition is host-only and versioned', () => {
  assert.equal(usageProjectionDefinition.key, USAGE_PROJECTION_KEY)
  assert.equal(usageProjectionDefinition.stateVersion, USAGE_PROJECTION_VERSION)
  assert.equal(usageProjectionDefinition.wire, undefined)
})
