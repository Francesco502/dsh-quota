/**
 * Native Harness token usage accounting for dsh-quota.
 *
 * The Session log is the source of truth for every call the Agent loop settles:
 * `assistant/message` (the final attempt, including interrupted messages) and
 * `assistant/attempt` (a retry attempt the loop abandoned) carry provider
 * `TokenUsage`, and `compaction/summary` carries the summarization call's usage.
 * A host-only projection unit folds those events once per Session, skips the
 * fork-inherited prefix, and is checkpointed by the Harness projection cache.
 *
 * Auxiliary traffic that never enters a Session log (`auto-review`,
 * `session-title`, custom purposes) is observed at the `llm/stream` waterfall.
 * The waterfall sees every streaming model call, including retries; the last
 * `usage` chunk is a full-call snapshot, never a delta. A committed event wins
 * over its live twin: the live copy is removed as soon as the corresponding
 * event lands, and `snapshot()` also reconciles leftovers (for example after a
 * crash between commit and cleanup).
 *
 * No prompts, message content, audio, credentials, or credentials-bearing URLs
 * are read or stored. Only provider/model/task/token counts and timestamps are
 * retained. Money is not estimated: this module never invents prices.
 *
 * @module dsh-quota/harness/usage
 */





/** Projection key owned by this module. Host-only: it is never a client wire value. */
export const USAGE_PROJECTION_KEY = 'quotaUsage'
/** Persisted projection state version. Bump when fold semantics change. */
export const USAGE_PROJECTION_VERSION = 2
/** Storage domain holding live auxiliary calls not present in any Session log. */
export const USAGE_DOMAIN_NAME = 'dsh_quota_usage'
/** Small separate domain holding the persisted tracking-start watermark. */
export const USAGE_META_DOMAIN_NAME = 'dsh_quota_meta'
/** Cold Sessions indexed per snapshot before the rest wait for background backfill. */
const DEFAULT_MAX_COLD_PER_SNAPSHOT = Number.POSITIVE_INFINITY
/** Bound on the in-process Session fold cache. */
const DEFAULT_MAX_CACHED_SESSIONS = 1024
/** Bound on call records retained across the in-process Session cache. */
const MAX_CACHED_CALLS = 250_000
/**
 * A committed event and its live copy are the same call inside this tight
 * window. `recordLive.time` is the stream completion, and the loop commits the
 * event immediately after, so a match need not span a long stream.
 */
const LIVE_MATCH_WINDOW_MS = 2 * 60 * 1000
/** Live-only auxiliary records are pruned after this horizon. */
const LIVE_RETENTION_MS = 90 * 24 * 60 * 60 * 1000
/** Hard bound on persisted live-only auxiliary records. */
const MAX_LIVE_RECORDS = 20_000
/** Session listing is cached briefly so a refresh is not a persistence listing. */
const LISTING_TTL_MS = 2_000
/**
 * Stable persisted-id namespace for ingested receipts. Native live ids are
 * `time-counter-random`, so this prefix cannot collide with one.
 */
const EXTERNAL_ID_PREFIX = 'external:'
/** Bound on a caller-supplied idempotency key. */
const MAX_RECEIPT_ID_LENGTH = 200
/** Bound on a caller-supplied route/task/session label. */
const MAX_RECEIPT_FIELD_LENGTH = 256
/** Default purpose label for a receipt that names no task. */
const EXTERNAL_DEFAULT_TASK = 'external'

const UNKNOWN = 'unknown'
const UNATTRIBUTED = '(unattributed)'

/** Dimension names accepted by {@link UsageQuery.groupBy}. All rows are always returned. */


/** Provider-reported counts for a set of calls. Cache fields are disjoint from input. */











/** One aggregate row. Meaningful dimension fields are present on every row. */












/**
 * Snapshot request. `from` is inclusive, `to` exclusive; both are epoch
 * milliseconds. Provider/model filters are applied before totals and grouping.
 */
















/** How complete and trustworthy a snapshot is. */






































/** Background indexing state, useful while cold Sessions are backfilled. */








/** Snapshot shape returned by {@link UsageTracker.snapshot}. */




















/** Tunables that affect indexing, never the meaning of a stored count. */


















/** Provider-reported counts for one call that bypassed the Harness `llm` service. */










/**
 * One direct model call that never entered the Harness `llm` service, so the
 * native Session log and `llm/stream` observer cannot see it. Use it for
 * side-channel calls (Jev, Groq, GLM); a call made through `ctx.llm` is already
 * observed and must not be reported here.
 */

















/** Outcome of one {@link UsageTracker.recordExternalUsage} call. */











/** Options shared by receipt ingestion. */





/** Public tracker returned by {@link createUsageTracker}. */























/** One provider-reported call as stored in a projection. */
















/** Pure projection state. Plain JSON; rewritten by value on every counted event. */










































/** Minimal structural schema: the projection seam only calls `parse`. */
const usageStateSchema = {
  parse(value         )                       {
    return parseUsageState(value)
  },
  safeParse(value         )                                                                                   {
    try {
      return { success: true, data: parseUsageState(value) }
    } catch (error         ) {
      return { success: false, error: error instanceof Error ? error : new Error(String(error)) }
    }
  },
}

/**
 * The pure usage fold registered on `ctx.sessionProjections`.
 *
 * `init` captures the fork-inherited cut; `apply` ignores events below it, so a
 * forked Session's replay of its parent's calls is never counted twice.
 */
export const usageProjectionDefinition = {
  key: USAGE_PROJECTION_KEY,
  stateVersion: USAGE_PROJECTION_VERSION,
  stateSchema: usageStateSchema,
  init: initUsageProjection,
  apply: advanceUsageProjection,
}

/**
 * Create a usage tracker for one Host context. Call {@link UsageTracker.start}.
 * @param ctx - Host context carrying `sessionProjections`, `sessionQuery`, and `llm`.
 * @param options - clock/indexing seams; never changes stored count semantics.
 * @returns the public tracker.
 */
export function createUsageTracker(ctx         , options                      = {})               {
  return new UsageTrackerImpl(ctx, options)
}

/** Initial fold state for one Session lifecycle. */
export function initUsageProjection(_header               , inherited        )                       {
  return {
    version: USAGE_PROJECTION_VERSION,
    inherited: isCount(inherited) ? inherited : 0,
    calls: [],
    observedCalls: 0,
    unknownCalls: 0,
    unreportedAuxiliary: 0,
  }
}

/**
 * Fold one committed Session event into usage state.
 *
 * Counted events: `assistant/message`, `assistant/attempt` (retry attempts that
 * never produced a message), and `compaction/summary`. Every counted event is a
 * distinct provider request; the final message and a retry attempt never
 * describe the same request.
 *
 * @param state - state before the event.
 * @param event - next committed event.
 * @returns the same reference for events this unit does not count.
 */
export function advanceUsageProjection(state                      , event              )                       {
  if (!event || typeof event !== 'object') return state
  const time = isCount(event.time) ? event.time : 0
  const seq = typeof (event                     ).seq === 'number' ? (event                   ).seq : 0
  // Fork replay: everything below the inherited cut belongs to the parent lifecycle.
  if (seq < state.inherited) return state
  const data = (event                                      ).data ?? {}
  switch ((event                     ).type) {
    case 'request/header': {
      const header = data.header
      return withRoute(state, header?.config?.provider, header?.config?.model)
    }
    case 'request/context':
      return withRoute(state, data.provider, data.model)
    case 'assistant/message': {
      const message = data.message
      const route = {
        provider: stringOr(message?.source?.provider, state.route?.provider ?? UNKNOWN),
        model: stringOr(message?.source?.model, state.route?.model ?? UNKNOWN),
      }
      const usage = data.usage ?? usageFromStream(data.stream)
      return appendUsage(
        withRoute(state, route.provider, route.model),
        time,
        route.provider,
        route.model,
        'assistant',
        normalizeUsage(usage),
        'log',
      )
    }
    case 'assistant/attempt': {
      const route = state.route ?? { provider: UNKNOWN, model: UNKNOWN }
      const usage = usageFromStream(data.stream)
      // A settled attempt without a usage receipt is still a provider request
      // opportunity: absence of a receipt does not prove the call was free.
      // Count it as an explicit unknown call.
      return appendUsage(state, time, route.provider, route.model, 'assistant', normalizeUsage(usage), 'log')
    }
    case 'compaction/summary':
      return appendUsage(
        state,
        time,
        stringOr(data.provider, UNKNOWN),
        stringOr(data.model, UNKNOWN),
        'compaction',
        normalizeUsage(data.usage),
        'log',
      )
    case 'session/title-llm-request':
      // The log records that an auxiliary title request happened but never its
      // response usage; live observation (or the persisted live table) is the
      // only source for those counts.
      return { ...state, unreportedAuxiliary: state.unreportedAuxiliary + 1 }
    default:
      return state
  }
}

/** Normalize one provider usage record without ever double-counting cache or reasoning. */
export function normalizeUsage(raw         )                  {
  if (!isRecord(raw)) return { ...zeroCounts(), totalTokens: 0, reported: false }
  // An explicitly unknown record (an event or live row that settled without
  // provider counts) must stay unknown even though its stored counts are zero.
  if (raw.reported === false) return { ...zeroCounts(), totalTokens: 0, reported: false }
  const inputTokens = countOrUndefined(raw.inputTokens)
  const outputTokens = countOrUndefined(raw.outputTokens)
  if (inputTokens === undefined || outputTokens === undefined) {
    return { ...zeroCounts(), totalTokens: 0, reported: false }
  }

  const cacheReadTokens = countOrUndefined(raw.cacheReadTokens)
  const cacheWriteTokens = countOrUndefined(raw.cacheWriteTokens)
  let reasoningTokens = countOrUndefined(raw.reasoningTokens)
  // Reasoning is an output subset; an impossible value is discarded rather
  // than added a second time.
  if (reasoningTokens !== undefined && reasoningTokens > outputTokens) reasoningTokens = undefined

  const explicitTotal = countOrUndefined(raw.totalTokens)
  const hasCacheBucket = cacheReadTokens !== undefined || cacheWriteTokens !== undefined
  const derivedTotal = safeAdd(
    safeAdd(inputTokens, outputTokens),
    safeAdd(cacheReadTokens ?? 0, cacheWriteTokens ?? 0),
  )
  // TokenUsage cache buckets are DISJOINT from inputTokens. When the provider
  // supplies them, the derived disjoint sum is authoritative; a provider total
  // that folded cache into prompt tokens must not be added on top.
  const totalTokens = hasCacheBucket
    ? derivedTotal
    : explicitTotal !== undefined && explicitTotal >= derivedTotal
      ? explicitTotal
      : derivedTotal

  return {
    inputTokens,
    outputTokens,
    ...cacheReadTokens === undefined ? {} : { cacheReadTokens },
    ...cacheWriteTokens === undefined ? {} : { cacheWriteTokens },
    ...reasoningTokens === undefined ? {} : { reasoningTokens },
    totalTokens,
    reported: true,
  }
}

/** Empty aggregate. */
export function emptyTotals()              {
  return {
    inputTokens: 0,
    outputTokens: 0,
    cacheReadTokens: 0,
    cacheWriteTokens: 0,
    reasoningTokens: 0,
    totalTokens: 0,
    calls: 0,
    unknownCalls: 0,
  }
}

/** Copy an aggregate so callers never share mutable row state. */
export function cloneTotals(totals             )              {
  return {
    inputTokens: totals.inputTokens,
    outputTokens: totals.outputTokens,
    cacheReadTokens: totals.cacheReadTokens,
    cacheWriteTokens: totals.cacheWriteTokens,
    reasoningTokens: totals.reasoningTokens,
    totalTokens: totals.totalTokens,
    calls: totals.calls,
    unknownCalls: totals.unknownCalls,
  }
}

// ---------------------------------------------------------------------------
// Projection state helpers
// ---------------------------------------------------------------------------

function withRoute(state                      , providerRaw         , modelRaw         )                       {
  const provider = stringOr(providerRaw, '')
  const model = stringOr(modelRaw, '')
  if (provider.length === 0 || model.length === 0) return state
  if (state.route?.provider === provider && state.route.model === model) return state
  return { ...state, route: { provider, model } }
}

function appendUsage(
  state                      ,
  time        ,
  provider        ,
  model        ,
  task        ,
  usage                 ,
  source                ,
)                       {
  const record                  = {
    time,
    provider: provider.length === 0 ? UNKNOWN : provider,
    model: model.length === 0 ? UNKNOWN : model,
    task,
    inputTokens: usage.inputTokens,
    outputTokens: usage.outputTokens,
    ...usage.cacheReadTokens === undefined ? {} : { cacheReadTokens: usage.cacheReadTokens },
    ...usage.cacheWriteTokens === undefined ? {} : { cacheWriteTokens: usage.cacheWriteTokens },
    ...usage.reasoningTokens === undefined ? {} : { reasoningTokens: usage.reasoningTokens },
    totalTokens: usage.totalTokens,
    reported: usage.reported,
    source,
  }
  return {
    ...state,
    calls: [...state.calls, record],
    observedCalls: state.observedCalls + 1,
    unknownCalls: state.unknownCalls + (usage.reported ? 0 : 1),
  }
}

function parseUsageState(value         )                       {
  if (!isRecord(value)) throw new Error('quota usage projection: state must be an object')
  if (value.version !== 1 && value.version !== USAGE_PROJECTION_VERSION) {
    throw new Error(`quota usage projection: unsupported state version ${String(value.version)}`)
  }
  if (!isCount(value.inherited)) throw new Error('quota usage projection: inherited must be a count')
  if (!Array.isArray(value.calls)) throw new Error('quota usage projection: calls must be an array')
  for (const raw of value.calls) parseCallRecord(raw)
  if (!isCount(value.observedCalls)) throw new Error('quota usage projection: observedCalls')
  if (!isCount(value.unknownCalls)) throw new Error('quota usage projection: unknownCalls')
  if (!isCount(value.unreportedAuxiliary)) throw new Error('quota usage projection: unreportedAuxiliary')
  if (value.route !== undefined) {
    if (!isRecord(value.route)
      || typeof value.route.provider !== 'string'
      || typeof value.route.model !== 'string') {
      throw new Error('quota usage projection: route must be provider/model strings')
    }
  }
  // v1 stored a lossy per-Session `trimmed` aggregate. v2 keeps every own
  // call so provider/model/hour/day rows stay exact for any requested range;
  // a v1 checkpoint is migrated by trusting its detailed calls and dropping
  // the old aggregate. (No v1 build shipped.)
  return {
    version: USAGE_PROJECTION_VERSION,
    inherited: value.inherited,
    ...value.route === undefined
      ? {}
      : { route: { provider: value.route.provider, model: value.route.model } },
    calls: value.calls                     ,
    observedCalls: value.observedCalls,
    unknownCalls: value.unknownCalls,
    unreportedAuxiliary: value.unreportedAuxiliary,
  }
}

function parseCallRecord(value         )                  {
  if (!isRecord(value)) throw new Error('quota usage projection: call must be an object')
  if (!isCount(value.time)) throw new Error('quota usage projection: call time')
  if (typeof value.provider !== 'string' || typeof value.model !== 'string' || typeof value.task !== 'string') {
    throw new Error('quota usage projection: call route/task must be strings')
  }
  if (!isCount(value.inputTokens) || !isCount(value.outputTokens) || !isCount(value.totalTokens)) {
    throw new Error('quota usage projection: call token counts')
  }
  for (const key of ['cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens']         ) {
    if (value[key] !== undefined && !isCount(value[key])) throw new Error(`quota usage projection: call ${key}`)
  }
  if (typeof value.reported !== 'boolean') throw new Error('quota usage projection: call reported')
  if (value.source !== 'log' && value.source !== 'live') throw new Error('quota usage projection: call source')
  return value
}

// ---------------------------------------------------------------------------
// Stream helpers
// ---------------------------------------------------------------------------

/**
 * The last `usage` chunk in an assistant stream is the full-call snapshot.
 * Providers may emit cumulative updates; summing them double counts.
 */
function usageFromStream(stream         )                         {
  if (!Array.isArray(stream)) return undefined
  for (let index = stream.length - 1; index >= 0; index--) {
    const entry = stream[index]
    if (!isRecord(entry) || entry.type !== 'chunk') continue
    const chunk = entry.chunk
    if (!isRecord(chunk) || chunk.type !== 'usage') continue
    if (isRecord(chunk.usage)) return chunk.usage
  }
  return undefined
}

function usageFingerprint(usage                 )         {
  return [
    usage.inputTokens,
    usage.outputTokens,
    usage.cacheReadTokens ?? '-',
    usage.cacheWriteTokens ?? '-',
    usage.reasoningTokens ?? '-',
    usage.totalTokens,
    usage.reported ? 'r' : 'u',
  ].join(':')
}

// ---------------------------------------------------------------------------
// Live table schema (hand-rolled so the module has no runtime dependency)
// ---------------------------------------------------------------------------

const liveRecordSchema = {
  parse(value         )                  {
    if (!isRecord(value)) throw new Error('quota live usage: record must be an object')
    if (typeof value.id !== 'string' || value.id.length === 0) throw new Error('quota live usage: id')
    if (value.sessionId !== undefined && typeof value.sessionId !== 'string') {
      throw new Error('quota live usage: sessionId')
    }
    if (!isCount(value.time)) throw new Error('quota live usage: time')
    if (typeof value.provider !== 'string' || typeof value.model !== 'string' || typeof value.task !== 'string') {
      throw new Error('quota live usage: route/task')
    }
    for (const key of ['inputTokens', 'outputTokens', 'totalTokens']         ) {
      if (!isCount(value[key])) throw new Error(`quota live usage: ${key}`)
    }
    for (const key of ['cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens']         ) {
      if (value[key] !== undefined && !isCount(value[key])) throw new Error(`quota live usage: ${key}`)
    }
    if (typeof value.reported !== 'boolean') throw new Error('quota live usage: reported')
    return value
  },
  safeParse(value         )          {
    try {
      liveRecordSchema.parse(value)
      return true
    } catch {
      return false
    }
  },
}

function usageDomainSpec()          {
  return {
    name: USAGE_DOMAIN_NAME,
    version: 1,
    layout: 'per-record',
    invalidRecords: 'backup-and-skip',
    tables: { live: { valueSchema: liveRecordSchema } },
  }
}





const trackingWatermarkSchema = {
  parse(value         )                          {
    if (!isRecord(value) || !isCount(value.trackingSince) || value.trackingSince <= 0) {
      throw new Error('quota tracking watermark: trackingSince must be a positive count')
    }
    return { trackingSince: value.trackingSince }
  },
  safeParse(value         )          {
    try {
      trackingWatermarkSchema.parse(value)
      return true
    } catch {
      return false
    }
  },
}

function usageMetaDomainSpec()          {
  return {
    name: USAGE_META_DOMAIN_NAME,
    version: 1,
    layout: 'per-record',
    invalidRecords: 'backup-and-skip',
    tables: { meta: { valueSchema: trackingWatermarkSchema } },
  }
}

// ---------------------------------------------------------------------------
// Tracker
// ---------------------------------------------------------------------------

class UsageTrackerImpl                         {
                   ctx
                   options
                   now
                   defaultTimeZone
                   maxColdPerSnapshot
                   maxCachedSessions

          started = false
          startPromise
          disposed = false
          handle
                   disposers                    = []
          domain
          liveTable
          metaDomain
          metaTable
          trackingSince = 0
          startedAt = 0
          liveStorageAvailable = false
          liveCapacityPruned = false

                   live = new Map                         ()
                   cachedSessions = new Map                       ()
  /** Domain writes in flight; disposal awaits these before closing storage. */
                   pendingWrites = new Set                  ()
  /** Accepted receipt writes by live id, so a duplicate observes the same commit. */
                   externalWrites = new Map                          ()
  /** Receipt ids already in the live domain; memory holds every accepted record. */
                   persistedExternal = new Set        ()
          cachedCallCount = 0
          listing
          prewarmRunning = false
          liveObservationAvailable = false
          indexingErrors = 0
          lastIndexedAt
          liveCounter = 0
                   notes           = []
                   boundDispose = ()       => {
    void this.dispose()
  }

  constructor(ctx         , options                     ) {
    this.ctx = ctx
    this.options = options
    this.now = options.now ?? (() => Date.now())
    this.defaultTimeZone = options.timeZone ?? 'UTC'
    this.maxColdPerSnapshot = nonNegativeInt(options.maxColdPerSnapshot, DEFAULT_MAX_COLD_PER_SNAPSHOT)
    this.maxCachedSessions = positiveInt(options.maxCachedSessions, DEFAULT_MAX_CACHED_SESSIONS)
  }

  async start()                      {
    if (this.disposed) return this.boundDispose
    if (this.startPromise === undefined) {
      this.startPromise = this.startInternal()
    }
    await this.startPromise
    return this.boundDispose
  }

          async startInternal()                {
    if (this.started || this.disposed) return
    this.started = true
    this.startedAt = this.now()

    const projections = this.service

      ('sessionProjections')
    if (projections !== undefined && typeof projections.register === 'function') {
      try {
        this.handle = await projections.register(usageProjectionDefinition)
      } catch (error         ) {
        this.indexingErrors += 1
        this.notes.push(`Session projection registration failed (${errorCode(error)}); live usage falls back to log folds.`)
      }
    } else {
      this.notes.push('sessionProjections is unavailable; usage is folded from SessionQuery observations only.')
    }

    const on = (this.ctx

     ).on
    if (typeof on === 'function') {
      try {
        const offStream = on.call(this.ctx, 'llm/stream', ((options         , next                              ) => {
          return this.observeStream(options, next)
        })         , { global: true })
        if (typeof offStream === 'function') {
          this.disposers.push(offStream              )
          this.liveObservationAvailable = true
        }
      } catch (error         ) {
        this.notes.push(`llm/stream observation unavailable (${errorCode(error)}).`)
      }
    }

    await this.openLiveStorage()
    await this.openTrackingWatermark()

    if (this.options.prewarm !== false) {
      // Background backfill: bounded, one Session at a time, never on start's critical path.
      void this.prewarm()
    }
  }

  async dispose()                {
    if (this.disposed) return
    this.disposed = true
    for (const dispose of this.disposers.splice(0)) {
      try {
        dispose()
      } catch {
        // Best-effort: a throwing observer must not keep the others registered.
      }
    }
    if (this.handle !== undefined) {
      try {
        await this.handle.dispose()
      } catch {
        // The registration may already be gone with the plugin fiber.
      }
      this.handle = undefined
    }
    // A receipt write accepted before disposal must reach the domain before it closes.
    await this.drainWrites()
    if (this.domain !== undefined) {
      try {
        await this.domain.close()
      } catch {
        // Closing an already-closed domain is harmless.
      }
      this.domain = undefined
      this.liveTable = undefined
    }
    if (this.metaDomain !== undefined) {
      try {
        await this.metaDomain.close()
      } catch {
        // Closing an already-closed domain is harmless.
      }
      this.metaDomain = undefined
      this.metaTable = undefined
    }
    this.live.clear()
    this.externalWrites.clear()
    this.persistedExternal.clear()
    this.cachedSessions.clear()
    this.cachedCallCount = 0
    this.listing = undefined
  }

  async snapshot(query             = {})                         {
    if (this.startPromise !== undefined) await this.startPromise
    else if (!this.started && !this.disposed) await this.start()
    const generatedAt = this.now()
    const from = numberOr(query.from, 0)
    if (!Number.isFinite(from) || from < 0) throw new RangeError('usage snapshot: from must be a non-negative epoch millisecond')
    const to = numberOr(query.to, generatedAt + 1)
    if (!Number.isFinite(to) || to < 0) throw new RangeError('usage snapshot: to must be a non-negative epoch millisecond')
    const timeZone = query.timeZone ?? this.defaultTimeZone
    assertTimeZone(timeZone)
    const providerFilter = filterString(query.provider, 'provider', 256)
    const modelFilter = filterString(query.model, 'model', 256)
    const includeChildren = query.includeChildren !== false
    const requestedGroupBy = query.groupBy
    const dimensionHint = Array.isArray(requestedGroupBy)
      ? [...requestedGroupBy]
      : typeof requestedGroupBy === 'string'
        ? [requestedGroupBy]
        : undefined

    const all = await this.listSessions()
    const byId = new Map                     ()
    for (const meta of all) byId.set(meta.header.id, meta)
    const rootOf = buildRootResolver(byId)

    let candidates
    let childSessionsIncluded = false
    if (typeof query.sessionId === 'string' && query.sessionId.length > 0) {
      const target = byId.get(query.sessionId) ?? this.liveMeta(query.sessionId)
      const ids = new Set        ([query.sessionId])
      if (includeChildren) {
        const descendants = await this.descendantIds(query.sessionId, byId)
        for (const id of descendants) {
          if (id !== query.sessionId) {
            ids.add(id)
            childSessionsIncluded = true
          }
        }
      }
      candidates = []
      for (const id of ids) {
        const meta = byId.get(id) ?? (id === query.sessionId ? target : undefined)
        if (meta !== undefined) candidates.push(meta)
      }
      if (candidates.length === 0 && target !== undefined) candidates.push(target)
    } else {
      candidates = [...all]
    }
    candidates = candidates.filter(meta => meta.header.createdAt <= to)

    const totals = emptyTotals()
    const byProvider = new Map                  ()
    const byModel = new Map                  ()
    const byTask = new Map                  ()
    const byHour = new Map                  ()
    const byDay = new Map                  ()
    const bySession = new Map                  ()
    const byRootSession = new Map                  ()

    let sessionsIndexed = 0
    let liveSessions = 0
    let coldSessions = 0
    let unavailableSessions = 0
    let committedCalls = 0
    let liveAuxiliaryCalls = 0
    let unattributedCalls = 0
    let unreportedAuxiliaryCalls = 0
    // An explicit Session/task query is a bounded request: index its whole
    // subtree so the range is exact. A corpus-wide query also indexes every
    // candidate by default; an explicit finite maxColdPerSnapshot trades
    // completeness for a bounded response and reports the remainder.
    let coldBudget = typeof query.sessionId === 'string' && query.sessionId.length > 0
      ? Number.POSITIVE_INFINITY
      : this.maxColdPerSnapshot

    const logRecords                    = []
    const logOwners           = []

    for (const meta of candidates) {
      const resolved = await this.resolveState(meta)
      let state = resolved.state
      let isLive = resolved.live
      if (state === undefined && coldBudget > 0) {
        coldBudget -= 1
        state = await this.indexCold(meta)
        if (state !== undefined) isLive = false
      }
      if (state === undefined) {
        unavailableSessions += 1
        continue
      }
      sessionsIndexed += 1
      if (isLive) liveSessions += 1
      else coldSessions += 1
      unreportedAuxiliaryCalls += state.unreportedAuxiliary

      for (const record of state.calls) {
        if (record.time < from || record.time >= to) continue
        if (providerFilter !== undefined && record.provider !== providerFilter) continue
        if (modelFilter !== undefined && record.model !== modelFilter) continue
        logRecords.push(record)
        logOwners.push(meta.header.id)
      }
    }

    // Live calls: reconcile against committed log calls first, so a crash
    // between commit and live-record cleanup cannot double count.
    const pendingLog = new Map                           ()
    for (let index = 0; index < logRecords.length; index++) {
      const record = logRecords[index]
      const sessionId = logOwners[index]
      const key = liveKey(sessionId, record.provider, record.model, record.task)
      const list = pendingLog.get(key)
      if (list === undefined) pendingLog.set(key, [record])
      else list.push(record)
    }

    const buckets = new Map                                       ()
    const candidateIds = new Set(candidates.map(meta => meta.header.id))
    for (const record of this.live.values()) {
      if (record.sessionId !== undefined && typeof query.sessionId === 'string' && query.sessionId.length > 0
        && record.sessionId !== query.sessionId
        && !candidateIds.has(record.sessionId)) {
        continue
      }
      if (record.time < from || record.time >= to) continue
      if (providerFilter !== undefined && record.provider !== providerFilter) continue
      if (modelFilter !== undefined && record.model !== modelFilter) continue
      if (matchesCommitted(pendingLog, record)) {
        // The committed log is authoritative; drop the leftover live copy so
        // later snapshots and restarts do not reconsider it.
        this.live.delete(record.id)
        this.persistedExternal.delete(record.id)
        if (this.liveTable !== undefined) {
          void this.trackWrite(this.liveTable.delete(record.id)).catch(() => {})
        }
        continue
      }
      if (record.sessionId === undefined) {
        unattributedCalls += 1
      }
      liveAuxiliaryCalls += 1
      addLiveRecord(totals, record, {
        byProvider, byModel, byTask, byHour, byDay, bySession, byRootSession, buckets,
        sessionId: record.sessionId,
        rootSessionId: record.sessionId === undefined ? undefined : rootOf(record.sessionId),
        timeZone,
      })
    }

    for (let index = 0; index < logRecords.length; index++) {
      const record = logRecords[index]
      const sessionId = logOwners[index]
      committedCalls += 1
      addOwnedRecord(totals, record, {
        byProvider, byModel, byTask, byHour, byDay, bySession, byRootSession, buckets,
        sessionId,
        rootSessionId: rootOf(sessionId),
        timeZone,
      })
    }

    const pendingSessions = Math.max(0, candidates.length - sessionsIndexed)
    const sessionsComplete = pendingSessions === 0 && unavailableSessions === 0
    const retentionFloor = this.now() - LIVE_RETENTION_MS
    // Auxiliary history is provable only when live observation exists, the
    // query starts after the persisted tracking watermark, retention still
    // covers the range, and (when live storage is unavailable) the range does
    // not precede this process.
    const auxFloor = Math.max(
      this.trackingSince,
      this.liveStorageAvailable ? 0 : this.startedAt,
      retentionFloor,
    )
    const historicalAuxComplete = this.liveObservationAvailable
      && this.trackingSince > 0
      && !this.liveCapacityPruned
      && from >= auxFloor
    const complete = sessionsComplete && historicalAuxComplete && totals.unknownCalls === 0

    const limitations = [...this.notes]
    limitations.push('Auto-review and session-title calls stay out of the Session log; only calls observed live are counted.')
    if (!this.liveObservationAvailable) {
      limitations.push('llm/stream observation is unavailable in this composition; auxiliary call usage is absent from this snapshot.')
    } else if (this.trackingSince === 0) {
      limitations.push('Tracking start is unknown; historical auxiliary coverage cannot be proven.')
    } else if (from < this.trackingSince) {
      limitations.push(`Query starts before tracking began at ${isoTime(this.trackingSince)}; earlier auxiliary usage may be missing.`)
    } else if (!this.liveStorageAvailable && from < this.startedAt) {
      limitations.push('Live auxiliary storage is unavailable; only calls observed since this process started count.')
    } else if (from < retentionFloor) {
      limitations.push('Query starts before the 90-day auxiliary retention horizon; older auxiliary calls may be missing.')
    }
    limitations.push('Live auxiliary records are kept for 90 days, up to 20,000.')
    if (this.liveCapacityPruned) {
      limitations.push('The live auxiliary capacity was exceeded; older auxiliary calls may be missing from this snapshot.')
    }
    limitations.push('Token counts only; no money estimate.')
    if (unavailableSessions > 0) {
      limitations.push(`${unavailableSessions} Session(s) could not be read; their usage is absent from this snapshot.`)
    }
    if (pendingSessions > 0) {
      limitations.push(`${pendingSessions} Session(s) are still being indexed; refresh after background backfill settles.`)
    }
    if (totals.unknownCalls > 0) {
      limitations.push(`${totals.unknownCalls} call(s) reported no usage; totals exclude them and that is not proof they were free.`)
    }
    limitations.push('Loop and compaction usage is durable once its Session event is committed.')
    limitations.push('Live and logged calls are matched within 2 minutes; identical calls can be confused without a provider request id.')

    return {
      generatedAt,
      from,
      to,
      timeZone,
      totals: cloneTotals(totals),
      byProvider: finishRows(byProvider),
      byModel: finishRows(byModel),
      byTask: finishRows(byTask),
      byHour: finishRows(byHour),
      byDay: finishRows(byDay),
      bySession: finishRows(bySession),
      byRootSession: finishRows(byRootSession),
      coverage: {
        complete,
        sessionsComplete,
        historicalAuxComplete,
        trackingSince: this.trackingSince,
        sessionsConsidered: candidates.length,
        sessionsIndexed,
        liveSessions,
        coldSessions,
        committedCalls,
        liveAuxiliaryCalls,
        historicalAuxiliary: this.liveObservationAvailable ? 'live-only' : 'partial',
        unreportedAuxiliaryCalls,
        unknownUsageCalls: totals.unknownCalls,
        childSessionsIncluded,
        backfilledFromLogs: coldSessions > 0,
        unavailableSessions,
        trimmedCalls: 0,
        unattributedCalls,
      },
      indexing: {
        status: this.prewarmRunning || pendingSessions > 0
          ? 'warming'
          : this.indexingErrors > 0
            ? 'degraded'
            : 'ready',
        pendingSessions,
        indexedSessions: sessionsIndexed,
        ...this.lastIndexedAt === undefined ? {} : { lastIndexedAt: this.lastIndexedAt },
        errors: this.indexingErrors,
      },
      limitations,
      ...dimensionHint === undefined ? {} : { groupBy: dimensionHint },
    }
  }

  // -- live observation ------------------------------------------------------

          observeStream(options         , next                              )                         {
    const tracker = this
    // Resolve the rest of the waterfall synchronously, as the contract expects;
    // only the chunk observation is deferred to iteration.
    const inner = next()
    return (async function* tracked()                         {
      let lastUsage
      let sawFinish = false
      try {
        for await (const chunk of inner) {
          if (isRecord(chunk)) {
            if (chunk.type === 'usage' && isRecord(chunk.usage)) lastUsage = chunk.usage
            else if (chunk.type === 'finish') sawFinish = true
          }
          yield chunk
        }
      } finally {
        try {
          tracker.recordLive(options, lastUsage, sawFinish)
        } catch {
          // Observation must never break a model call.
        }
      }
    })()
  }

          recordLive(options         , usage                        , sawFinish         )       {
    if (this.disposed || !isRecord(options)) return
    const purpose = typeof options.purpose === 'string' && options.purpose.length > 0 ? options.purpose : 'assistant'
    const provider = stringOr(options.provider, UNKNOWN)
    const model = stringOr(options.model, UNKNOWN)
    const sessionId = typeof options.sessionId === 'string' && options.sessionId.length > 0 ? options.sessionId : undefined
    const normalized = normalizeUsage(usage)

    if (!normalized.reported) {
      // A terminal call with no usage receipt is an explicit unknown call.
      // No receipt is not proof of a free request: the provider may have
      // processed it and simply omitted counts. The committed event (when one
      // lands) dedupes this live copy by session/route/task/time.
      if (!sawFinish) return
      const time = this.now()
      this.addLive({
        id: this.nextLiveId(time),
        ...sessionId === undefined ? {} : { sessionId },
        time,
        provider,
        model,
        task: purpose,
        inputTokens: 0,
        outputTokens: 0,
        totalTokens: 0,
        reported: false,
        source: 'live',
      })
      return
    }

    const time = this.now()
    this.addLive({
      id: this.nextLiveId(time),
      ...sessionId === undefined ? {} : { sessionId },
      time,
      provider,
      model,
      task: purpose,
      inputTokens: normalized.inputTokens,
      outputTokens: normalized.outputTokens,
      ...normalized.cacheReadTokens === undefined ? {} : { cacheReadTokens: normalized.cacheReadTokens },
      ...normalized.cacheWriteTokens === undefined ? {} : { cacheWriteTokens: normalized.cacheWriteTokens },
      ...normalized.reasoningTokens === undefined ? {} : { reasoningTokens: normalized.reasoningTokens },
      totalTokens: normalized.totalTokens,
      reported: true,
      source: 'live',
    })
  }

          nextLiveId(time        )         {
    this.liveCounter += 1
    return `${time.toString(36)}-${this.liveCounter.toString(36)}-${Math.random().toString(36).slice(2, 8)}`
  }

  // -- external receipts -----------------------------------------------------

  async recordExternalUsage(receipt                      , options                       = {})                               {
    if (this.disposed) throw new Error('quota external usage: the usage tracker is disposed')
    options.signal?.throwIfAborted()
    if (this.startPromise !== undefined) await this.startPromise
    else if (!this.started) await this.start()
    options.signal?.throwIfAborted()
    // Validation runs at this JSON boundary: a malformed receipt must name its
    // field instead of silently becoming an unknown or zero-token call.
    const normalized = normalizeExternalReceipt(receipt, this.now())
    const id = `${EXTERNAL_ID_PREFIX}${normalized.callId}`
    // An accepted write is the id's commit: a duplicate must observe it, not
    // acknowledge it before the record is durable.
    const inFlight = this.externalWrites.get(id)
    if (inFlight !== undefined) return { status: 'duplicate', persisted: await inFlight }
    if (this.live.has(id)) {
      // The record may be memory-only because its first write failed; replay
      // retries persistence instead of reporting a durable duplicate.
      return { status: 'duplicate', persisted: await this.retryExternal(id) }
    }
    const record                  = {
      id,
      ...normalized.sessionId === undefined ? {} : { sessionId: normalized.sessionId },
      time: normalized.time,
      provider: normalized.provider,
      model: normalized.model,
      task: normalized.task,
      inputTokens: normalized.usage.inputTokens,
      outputTokens: normalized.usage.outputTokens,
      ...normalized.usage.cacheReadTokens === undefined ? {} : { cacheReadTokens: normalized.usage.cacheReadTokens },
      ...normalized.usage.cacheWriteTokens === undefined ? {} : { cacheWriteTokens: normalized.usage.cacheWriteTokens },
      ...normalized.usage.reasoningTokens === undefined ? {} : { reasoningTokens: normalized.usage.reasoningTokens },
      totalTokens: normalized.usage.totalTokens,
      reported: normalized.usage.reported,
      source: 'live',
    }
    return { status: 'stored', persisted: await this.writeExternal(id, record) }
  }

  /**
   * Retry persistence for a receipt this process already holds.
   * @param id - live id of the accepted receipt.
   * @returns whether the record is durable after this attempt.
   */
          retryExternal(id        )                   {
    if (this.persistedExternal.has(id)) return Promise.resolve(true)
    const inFlight = this.externalWrites.get(id)
    if (inFlight !== undefined) return inFlight
    const existing = this.live.get(id)
    if (existing === undefined) return Promise.resolve(false)
    return this.writeExternal(id, existing)
  }

  /**
   * Start the one commit for an id and expose it to duplicates.
   * @param id - live id of the accepted receipt.
   * @param record - accepted record, unchanged on replay.
   * @returns whether the write reached the live domain.
   */
          writeExternal(id        , record                 )                   {
    const write = this.persistExternal(id, record)
    this.externalWrites.set(id, write)
    void write.finally(() => {
      // A failed write leaves no entry so a replay can try again.
      if (this.externalWrites.get(id) === write) this.externalWrites.delete(id)
    })
    return write
  }

  /**
   * Commit one receipt to the live domain, keeping it in memory regardless.
   * @param id - live id of the accepted receipt.
   * @param record - accepted record.
   * @returns whether the domain accepted the record.
   */
          async persistExternal(id        , record                 )                   {
    this.live.set(id, record)
    this.pruneLive(id)
    const table = this.liveTable
    if (table === undefined) return false
    try {
      await this.trackWrite(table.put(id, record))
    } catch {
      // Fail-soft: this process still counts the record, and the caller sees
      // `persisted: false` so it can replay instead of assuming durability.
      return false
    }
    this.persistedExternal.add(id)
    return true
  }

  /**
   * Store one live record in memory and, unless the call already has a durable
   * Session-log home, in the live domain.
   * @param record - the record to store.
   */
          addLive(record                 )       {
    this.live.set(record.id, record)
    // Reported loop calls already have an authoritative durable home in the
    // Session log; unknown calls and auxiliary purposes are persisted so a
    // restart can still count them (and dedupe them against a late log event).
    const persist = !(record.reported && (record.task === 'assistant' || record.task === 'compaction'))
    const table = this.liveTable
    if (persist && table !== undefined) {
      void this.trackWrite(table.put(record.id, record)).catch(() => {
        // Fail-soft: live-only history is best effort, like the projection cache.
      })
    }
    this.pruneLive(record.id)
  }

  /**
   * Keep the live map within its record bound, deleting the oldest rows.
   * @param keepId - the just-accepted record, never pruned by its own insert.
   */
          pruneLive(keepId        )       {
    while (this.live.size > MAX_LIVE_RECORDS) {
      const oldest = this.live.keys().next()
      if (oldest.done === true || oldest.value === keepId) break
      this.live.delete(oldest.value)
      this.persistedExternal.delete(oldest.value)
      this.liveCapacityPruned = true
      if (this.liveTable !== undefined) {
        void this.trackWrite(this.liveTable.delete(oldest.value)).catch(() => {})
      }
    }
  }

  /** Keep one domain write visible to disposal until it settles. */
          trackWrite   (write            )             {
    const tracked             = write.finally(() => {
      this.pendingWrites.delete(tracked)
    })
    this.pendingWrites.add(tracked)
    return tracked
  }

  /** Wait for every accepted domain write, including failures. */
          async drainWrites()                {
    while (this.pendingWrites.size > 0) {
      await Promise.allSettled([...this.pendingWrites])
    }
  }

  // -- cold indexing ---------------------------------------------------------

          async resolveState(meta             )                                                                      {
    const live = this.liveSession(meta.header.id)
    if (live !== undefined) {
      if (this.handle !== undefined) {
        try {
          const state = this.handle.stateOf(live)
          this.cacheSession(meta.header, state, lastSeqOf(live), true)
          return { state, live: true }
        } catch {
          // Fall through to the public SessionQuery observation path.
        }
      }
      // No projection handle (or it failed): read the live Session through the
      // same public SessionQuery face used for cold bodies. The deprecated
      // in-memory snapshot API is deliberately not used.
      const lastSeq = lastSeqOf(live)
      const cached = this.cachedSessions.get(meta.header.id)
      if (cached !== undefined && cached.live && cached.lastSeq === lastSeq) {
        return { state: cached.state, live: true }
      }
      const state = await this.indexSession(meta, true)
      return { state, live: state !== undefined }
    }

    const cached = this.cachedSessions.get(meta.header.id)
    if (cached !== undefined && !cached.live) {
      // Refresh LRU position; the fold covers the complete cold log.
      this.cachedSessions.delete(meta.header.id)
      this.cachedSessions.set(meta.header.id, cached)
      return { state: cached.state, live: false }
    }
    if (cached !== undefined) {
      // A live fold can lag the final events appended before disposal; a
      // Session that is cold now must be read from its complete stored log.
      this.cachedSessions.delete(meta.header.id)
      this.cachedCallCount = Math.max(0, this.cachedCallCount - cached.state.calls.length)
    }
    return { state: undefined, live: false }
  }

          async indexCold(meta             )                                            {
    return this.indexSession(meta, false)
  }

  /** Fold one Session body from the public SessionQuery observation face. */
          async indexSession(meta             , live         )                                            {
    const query = this.service








      ('sessionQuery')
    if (query === undefined || typeof query.observeSession !== 'function') return undefined
    let observation
    try {
      observation = await query.observeSession(meta.header.id, { projectionMode: 'none' })
      const header = observation.header ?? meta.header
      const inherited = numberOf(observation.inheritedEventCount, 0)
      const events = Array.isArray(observation.events) ? observation.events : []
      const state = foldUsage(header, inherited, events)
      const lastSeq = typeof observation.cursor === 'number' ? observation.cursor : lastSeqOfEvents(events)
      this.cacheSession(header, state, lastSeq, live)
      this.lastIndexedAt = this.now()
      return state
    } catch {
      this.indexingErrors += 1
      return undefined
    } finally {
      if (observation !== undefined) {
        try {
          if (typeof observation[Symbol.dispose] === 'function') observation[Symbol.dispose]()
          else if (typeof observation.dispose === 'function') observation.dispose()
        } catch {
          // Lease cleanup is best effort.
        }
      }
    }
  }

          cacheSession(header               , state                      , lastSeq        , live         )       {
    if (this.disposed) return
    const id = header.id
    const previous = this.cachedSessions.get(id)
    if (previous !== undefined) this.cachedCallCount = Math.max(0, this.cachedCallCount - previous.state.calls.length)
    this.cachedSessions.delete(id)
    this.cachedSessions.set(id, { header, state, lastSeq, live })
    this.cachedCallCount += state.calls.length
    while (this.cachedSessions.size > this.maxCachedSessions || this.cachedCallCount > MAX_CACHED_CALLS) {
      const oldest = this.cachedSessions.keys().next()
      if (oldest.done === true) break
      if (oldest.value === id && this.cachedSessions.size === 1) break
      const evicted = this.cachedSessions.get(oldest.value)
      this.cachedSessions.delete(oldest.value)
      if (evicted !== undefined) this.cachedCallCount = Math.max(0, this.cachedCallCount - evicted.state.calls.length)
    }
  }

          async prewarm()                {
    if (this.prewarmRunning || this.disposed) return
    this.prewarmRunning = true
    try {
      // Yield to the event loop between Sessions so a large corpus cannot stall
      // request handling or make `start()` look synchronous.
      await Promise.resolve()
      const all = await this.listSessions()
      for (const meta of all) {
        if (this.disposed) return
        if (this.liveSession(meta.header.id) !== undefined) continue
        if (this.cachedSessions.has(meta.header.id)) continue
        await this.indexCold(meta)
      }
    } finally {
      this.prewarmRunning = false
    }
  }

  // -- session discovery -----------------------------------------------------

          async listSessions(force = false)                         {
    const now = this.now()
    if (!force && this.listing !== undefined && now - this.listing.at < LISTING_TTL_MS) {
      return this.withLiveSessions(this.listing.records)
    }
    const query = this.service                                                                                                                        ('sessionQuery')
    let records                = []
    if (query !== undefined && typeof query.listSessions === 'function') {
      try {
        const listed = await query.listSessions()
        records = listed.map(record => ({
          header: record.header,
          live: record.live === true,
          persisted: record.persisted !== false,
        }))
      } catch {
        this.indexingErrors += 1
      }
    }
    this.listing = { at: now, records }
    return this.withLiveSessions(records)
  }

  /**
   * Always supplement a (possibly 2s-cached) listing with currently live
   * Sessions. A Session created after the cache was taken is still live and
   * must be visible to the next refresh.
   */
          withLiveSessions(records               )                {
    const store = this.service                                              ('sessions')
    if (store === undefined || typeof store.list !== 'function') return records
    let live
    try {
      live = store.list()
    } catch {
      this.indexingErrors += 1
      return records
    }
    if (records.length === 0) {
      return live.map(session => ({ header: session.header, live: true, persisted: false }))
    }
    const seen = new Set(records.map(record => record.header.id))
    const merged = [...records]
    for (const session of live) {
      if (seen.has(session.header.id)) continue
      merged.push({ header: session.header, live: true, persisted: false })
    }
    return merged
  }

          liveSession(id        )          {
    const store = this.service                              ('sessions')
    if (store === undefined || typeof store.get !== 'function') return undefined
    try {
      return store.get(id)
    } catch {
      return undefined
    }
  }

          liveMeta(id        )                          {
    const session = this.liveSession(id)
    if (session === undefined || !isRecord(session)) return undefined
    const header = (session                              ).header
    return header === undefined ? undefined : { header, live: true, persisted: false }
  }

          async descendantIds(sessionId        , byId                          )                    {
    const query = this.service



      ('sessionQuery')
    if (query !== undefined && typeof query.traceSession === 'function') {
      try {
        const trace = await query.traceSession(sessionId)
        const ids           = []
        const visit = (nodes         )       => {
          if (!Array.isArray(nodes)) return
          for (const node of nodes) {
            if (!isRecord(node)) continue
            const session = node.session
            const id = session?.header?.id
            if (typeof id === 'string') ids.push(id)
            visit(node.descendants)
          }
        }
        visit(trace.descendants)
        return ids
      } catch {
        // Fall back to the parent linkage already in the corpus.
      }
    }
    // Corpus fallback: walk parentSession links (bounded by the listing size).
    const children = new Map                  ()
    for (const meta of byId.values()) {
      const parent = meta.header.parentSession
      if (parent === undefined) continue
      const list = children.get(parent)
      if (list === undefined) children.set(parent, [meta.header.id])
      else list.push(meta.header.id)
    }
    const ids           = []
    const stack = [...(children.get(sessionId) ?? [])]
    const seen = new Set        ()
    while (stack.length > 0) {
      const id = stack.pop()
      if (seen.has(id)) continue
      seen.add(id)
      ids.push(id)
      stack.push(...(children.get(id) ?? []))
    }
    return ids
  }

  // -- storage ---------------------------------------------------------------

          async openLiveStorage()                {
    const facility = this.service                                                                                            ('storageDomain')
    if (facility === undefined || typeof facility.open !== 'function') {
      this.notes.push('storageDomain is unavailable; live auxiliary usage is process-local only.')
      return
    }
    try {
      const domain = await facility.open(usageDomainSpec())
      this.domain = domain
      const table = domain.table('live')




      this.liveTable = table
      this.liveStorageAvailable = true
      const cutoff = this.now() - LIVE_RETENTION_MS
      for (const [id, raw] of table.entries()) {
        try {
          const parsed = liveRecordSchema.parse(raw)
          if (parsed.time < cutoff || this.live.size >= MAX_LIVE_RECORDS) {
            if (this.live.size >= MAX_LIVE_RECORDS) this.liveCapacityPruned = true
            void this.trackWrite(table.delete(id)).catch(() => {})
            continue
          }
          this.live.set(id, parsed)
          // The record came from the domain, so its id is already durable.
          if (id.startsWith(EXTERNAL_ID_PREFIX)) this.persistedExternal.add(id)
        } catch {
          // The domain already skips invalid records when the backend supports
          // backup-and-skip; ignore anything else defensively.
        }
      }
    } catch (error         ) {
      this.notes.push(`Live usage storage is unavailable (${errorCode(error)}); auxiliary usage is process-local only.`)
    }
  }

  /**
   * Persist the first instant this installation began observing live-only
   * auxiliary traffic. A query that starts before this watermark cannot prove
   * historical auto-review/session-title coverage, so `coverage.complete`
   * stays false. Without storage the watermark is conservative (current start).
   */
          async openTrackingWatermark()                {
    const facility = this.service                                                                                            ('storageDomain')
    if (facility === undefined || typeof facility.open !== 'function') {
      this.trackingSince = this.now()
      this.notes.push('Tracking-start storage is unavailable; historical auxiliary coverage is conservative from this start.')
      return
    }
    try {
      const domain = await facility.open(usageMetaDomainSpec())
      this.metaDomain = domain
      const table = domain.table('meta')
      this.metaTable = table
      const stored = table.get('trackingSince')
      if (stored !== undefined && trackingWatermarkSchema.safeParse(stored)) {
        this.trackingSince = (stored                           ).trackingSince
        return
      }
      const since = this.now()
      this.trackingSince = since
      await table.put('trackingSince', { trackingSince: since })
    } catch (error         ) {
      if (this.trackingSince === 0) this.trackingSince = this.now()
      this.notes.push(`Tracking-start storage is unavailable (${errorCode(error)}); historical auxiliary coverage is conservative from this start.`)
    }
  }

  // -- service lookup --------------------------------------------------------

          service   (name        )                {
    const ctx = this.ctx



    if (typeof ctx.get === 'function') {
      try {
        const found = ctx.get(name)
        if (found !== undefined && found !== null) return found
      } catch {
        // Optional services reject when absent; fall through to the property.
      }
    }
    const direct = ctx[name]
    return direct === undefined || direct === null ? undefined : direct
  }
}

// ---------------------------------------------------------------------------
// Snapshot assembly helpers
// ---------------------------------------------------------------------------









                           






function addOwnedRecord(totals             , record                 , sinks          )       {
  mergeTotals(totals, record)
  mergeTotals(rowFor(sinks.byProvider, record.provider, { provider: record.provider }), record)
  mergeTotals(rowFor(sinks.byModel, `${record.provider}/${record.model}`, {
    provider: record.provider,
    model: record.model,
  }), record)
  mergeTotals(rowFor(sinks.byTask, record.task, { task: record.task, label: taskLabel(record.task) }), record)
  const minute = Math.floor(record.time / 60_000)
  let buckets = sinks.buckets.get(minute)
  if (buckets === undefined) {
    buckets = {
      hour: hourBucket(record.time, sinks.timeZone),
      day: dayBucket(record.time, sinks.timeZone),
    }
    sinks.buckets.set(minute, buckets)
  }
  mergeTotals(rowFor(sinks.byHour, buckets.hour, { bucket: buckets.hour }), record)
  mergeTotals(rowFor(sinks.byDay, buckets.day, { bucket: buckets.day }), record)
  if (sinks.sessionId !== undefined) {
    mergeTotals(rowFor(sinks.bySession, sinks.sessionId, {
      sessionId: sinks.sessionId,
      rootSessionId: sinks.rootSessionId,
    }), record)
    if (sinks.rootSessionId !== undefined) {
      mergeTotals(rowFor(sinks.byRootSession, sinks.rootSessionId, {
        rootSessionId: sinks.rootSessionId,
      }), record)
    }
  }
}

function addLiveRecord(totals             , record                 , sinks          )       {
  const sessionId = record.sessionId ?? UNATTRIBUTED
  const rootSessionId = record.sessionId === undefined ? UNATTRIBUTED : sinks.rootSessionId ?? UNATTRIBUTED
  addOwnedRecord(totals, record, { ...sinks, sessionId, rootSessionId })
}

function mergeTotals(target             , source                               )       {
  target.inputTokens = safeAdd(target.inputTokens, source.inputTokens)
  target.outputTokens = safeAdd(target.outputTokens, source.outputTokens)
  target.cacheReadTokens = safeAdd(target.cacheReadTokens, source.cacheReadTokens ?? 0)
  target.cacheWriteTokens = safeAdd(target.cacheWriteTokens, source.cacheWriteTokens ?? 0)
  target.reasoningTokens = safeAdd(target.reasoningTokens, source.reasoningTokens ?? 0)
  target.totalTokens = safeAdd(target.totalTokens, source.totalTokens)
  if ('calls' in source) {
    target.calls += source.calls
    target.unknownCalls += source.unknownCalls
  } else {
    target.calls += 1
    if (!source.reported) target.unknownCalls += 1
  }
}

function rowFor(
  map                       ,
  key        ,
  fields                   ,
)           {
  const existing = map.get(key)
  if (existing !== undefined) return existing
  const row           = { key, ...emptyTotals(), ...fields }
  map.set(key, row)
  return row
}

function finishRows(map                       )             {
  return [...map.values()]
    .map(row => ({ ...row }))
    .sort((left, right) => left.key < right.key ? -1 : left.key > right.key ? 1 : 0)
}

function liveKey(sessionId        , provider        , model        , task        )         {
  return `${sessionId}\0${provider}\0${model}\0${task}`
}

function matchesCommitted(
  pending                                ,
  live                 ,
)          {
  if (live.sessionId === undefined) return false
  const key = liveKey(live.sessionId, live.provider, live.model, live.task)
  const list = pending.get(key)
  if (list === undefined) return false
  const fingerprint = usageFingerprint(normalizeUsage(live))
  for (let index = 0; index < list.length; index++) {
    const record = list[index]
    // Tight time identity is mandatory: identical counts on separate calls
    // are common, and one live completion must consume at most one committed
    // receipt. When both sides report counts they must also agree exactly.
    if (Math.abs(record.time - live.time) > LIVE_MATCH_WINDOW_MS) continue
    if (live.reported && record.reported
      && usageFingerprint(normalizeUsage(record)) !== fingerprint) continue
    list.splice(index, 1)
    return true
  }
  return false
}

function buildRootResolver(byId                          )                         {
  const memo = new Map                ()
  const resolve = (id        )         => {
    const known = memo.get(id)
    if (known !== undefined) return known
    let current = id
    const seen = new Set        ()
    while (true) {
      const meta = byId.get(current)
      const parent = meta?.header.parentSession
      if (parent === undefined || parent === current || seen.has(parent) || !byId.has(parent)) break
      seen.add(current)
      current = parent
    }
    memo.set(id, current)
    return current
  }
  return resolve
}

function foldUsage(header               , inherited        , events                         )                       {
  let state = initUsageProjection(header, inherited)
  for (const event of events) state = advanceUsageProjection(state, event)
  return state
}

function lastSeqOf(session         )         {
  const value = isRecord(session) ? session.seq : undefined
  return typeof value === 'number' ? Math.max(-1, value - 1) : -1
}

function lastSeqOfEvents(events                         )         {
  const last = events.at(-1)
  return typeof last?.seq === 'number' ? last.seq : -1
}

// ---------------------------------------------------------------------------
// Time-zone buckets
// ---------------------------------------------------------------------------

const formatterCache = new Map                             ()
const offsetFormatterCache = new Map                             ()

function formatterFor(timeZone        )                      {
  let formatter = formatterCache.get(timeZone)
  if (formatter === undefined) {
    formatter = new Intl.DateTimeFormat('en-US', {
      timeZone,
      calendar: 'gregory',
      numberingSystem: 'latn',
      hourCycle: 'h23',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit',
    })
    if (formatterCache.size >= 64) formatterCache.clear()
    formatterCache.set(timeZone, formatter)
  }
  return formatter
}

function assertTimeZone(timeZone        )       {
  if (typeof timeZone !== 'string' || timeZone.length === 0) {
    throw new RangeError('usage snapshot: timeZone must be an IANA time zone')
  }
  try {
    formatterFor(timeZone)
  } catch {
    throw new RangeError(`usage snapshot: unknown IANA time zone "${timeZone}"`)
  }
}








function localParts(time        , timeZone        )             {
  const parts = formatterFor(timeZone).formatToParts(new Date(time))
  const found                         = {}
  for (const part of parts) {
    if (part.type !== 'literal') found[part.type] = part.value
  }
  return {
    year: found.year ?? '1970',
    month: found.month ?? '01',
    day: found.day ?? '01',
    hour: found.hour ?? '00',
  }
}

function hourBucket(time        , timeZone        )         {
  const parts = localParts(time, timeZone)
  return `${parts.year}-${parts.month}-${parts.day}T${parts.hour}:00:00${offsetAt(time, timeZone)}`
}

function dayBucket(time        , timeZone        )         {
  const parts = localParts(time, timeZone)
  const midnight = zonedMidnight(Number(parts.year), Number(parts.month), Number(parts.day), timeZone)
  return `${parts.year}-${parts.month}-${parts.day}T00:00:00${offsetAt(midnight, timeZone)}`
}

function zonedMidnight(year        , month        , day        , timeZone        )         {
  const guess = Date.UTC(year, month - 1, day, 0, 0, 0)
  const first = offsetMinutes(guess, timeZone)
  let candidate = guess - first * 60_000
  const second = offsetMinutes(candidate, timeZone)
  if (second !== first) candidate = guess - second * 60_000
  return candidate
}

function offsetMinutes(time        , timeZone        )         {
  const offset = offsetAt(time, timeZone)
  const sign = offset.startsWith('-') ? -1 : 1
  const [hours, minutes] = offset.slice(1).split(':')
  return sign * (Number(hours) * 60 + Number(minutes))
}

function offsetAt(time        , timeZone        )         {
  try {
    let offsetFormatter = offsetFormatterCache.get(timeZone)
    if (offsetFormatter === undefined) {
      offsetFormatter = new Intl.DateTimeFormat('en-US', {
        timeZone,
        timeZoneName: 'longOffset',
        hour: '2-digit',
      })
      if (offsetFormatterCache.size >= 64) offsetFormatterCache.clear()
      offsetFormatterCache.set(timeZone, offsetFormatter)
    }
    const parts = offsetFormatter.formatToParts(new Date(time))
    const name = parts.find(part => part.type === 'timeZoneName')?.value
    if (name === undefined || name === 'GMT' || name === 'UTC') return '+00:00'
    const matched = /GMT([+-]\d{2}:\d{2})/.exec(name)
    return matched?.[1] ?? '+00:00'
  } catch {
    return '+00:00'
  }
}

// ---------------------------------------------------------------------------
// Primitive helpers
// ---------------------------------------------------------------------------

function zeroCounts()                                                    {
  return { inputTokens: 0, outputTokens: 0 }
}

function isRecord(value         )                                   {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function isCount(value         )                  {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

function countOrUndefined(value         )                     {
  return isCount(value) ? value : undefined
}

function safeAdd(left        , right        )         {
  const sum = left + right
  return Number.isSafeInteger(sum) ? sum : Number.MAX_SAFE_INTEGER
}

function stringOr(value         , fallback        )         {
  return typeof value === 'string' && value.length > 0 ? value : fallback
}

/**
 * Safe purpose/task display label. Deliberately a fixed vocabulary keyed by
 * the `GenerateOptions.purpose` id: never derived from prompt content, model
 * output, or any other user text.
 */
function taskLabel(task        )         {
  switch (task) {
    case 'assistant':
      return 'Assistant'
    case 'compaction':
      return 'Compaction'
    case 'auto-review':
      return 'Auto review'
    case 'session-title':
      return 'Session title'
    default:
      // A purpose id is code-owned, never prompt content. Bound it anyway so a
      // third-party purpose cannot inflate a UI label.
      return task.length <= 160 ? task : task.slice(0, 160)
  }
}

/** Trim and bound one exact-match filter string; empty means "no filter". */
function filterString(value         , name        , maxLength        )                     {
  if (value === undefined) return undefined
  if (typeof value !== 'string') throw new TypeError(`usage snapshot: ${name} must be a string`)
  const trimmed = value.trim()
  if (trimmed.length === 0) return undefined
  if (trimmed.length > maxLength) {
    throw new RangeError(`usage snapshot: ${name} must be at most ${maxLength} characters`)
  }
  return trimmed
}

function numberOr(value         , fallback        )         {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

// ---------------------------------------------------------------------------
// External receipt validation
// ---------------------------------------------------------------------------

/**
 * Read one caller-supplied label from a receipt.
 * @param value - raw field value.
 * @param field - field name reported on rejection.
 * @param maxLength - upper bound in characters.
 * @returns the validated string.
 */
function receiptString(value         , field        , maxLength        )         {
  if (typeof value !== 'string' || value.length === 0 || value.length > maxLength) {
    throw new Error(`quota external usage: ${field} must be a non-empty string of at most ${maxLength} characters`)
  }
  if (/[\u0000-\u001f\u007f]/.test(value)) {
    throw new Error(`quota external usage: ${field} must not contain control characters`)
  }
  return value
}

/**
 * Validate one receipt and normalize its counts.
 * @param receipt - raw JSON-shaped receipt from a caller.
 * @param now - completion time used when the receipt omits one.
 * @returns the validated fields with normalized usage.
 */
function normalizeExternalReceipt(receipt         , now        )







  {
  if (!isRecord(receipt)) throw new Error('quota external usage: receipt must be an object')
  const callId = receiptString(receipt.callId, 'callId', MAX_RECEIPT_ID_LENGTH)
  const provider = receiptString(receipt.provider, 'provider', MAX_RECEIPT_FIELD_LENGTH)
  const model = receiptString(receipt.model, 'model', MAX_RECEIPT_FIELD_LENGTH)
  const task = receipt.task === undefined
    ? EXTERNAL_DEFAULT_TASK
    : receiptString(receipt.task, 'task', MAX_RECEIPT_FIELD_LENGTH)
  const sessionId = receipt.sessionId === undefined || receipt.sessionId === null
    ? undefined
    : receiptString(receipt.sessionId, 'sessionId', MAX_RECEIPT_FIELD_LENGTH)
  const time = receipt.time === undefined ? now : receipt.time
  if (!isCount(time)) throw new Error('quota external usage: time must be a non-negative safe integer in epoch milliseconds')
  return {
    callId,
    ...sessionId === undefined ? {} : { sessionId },
    provider,
    model,
    task,
    time,
    usage: normalizeExternalUsage(receipt.usage),
  }
}

/**
 * Validate provider counts; an absent record stays explicitly unknown.
 * @param raw - raw `usage` value from a receipt.
 * @returns normalized counts with `reported` false when the caller supplied none.
 */
function normalizeExternalUsage(raw         )                  {
  if (raw === undefined || raw === null) return { ...zeroCounts(), totalTokens: 0, reported: false }
  if (!isRecord(raw)) throw new Error('quota external usage: usage must be an object or null')
  for (const key of ['inputTokens', 'outputTokens']         ) {
    if (!isCount(raw[key])) {
      throw new Error(`quota external usage: usage.${key} must be a non-negative safe integer`)
    }
  }
  for (const key of ['cacheReadTokens', 'cacheWriteTokens', 'reasoningTokens', 'totalTokens']         ) {
    if (raw[key] !== undefined && !isCount(raw[key])) {
      throw new Error(`quota external usage: usage.${key} must be a non-negative safe integer when present`)
    }
  }
  return normalizeUsage(raw)
}

function numberOf(value         , fallback        )         {
  return typeof value === 'number' && Number.isFinite(value) ? value : fallback
}

function positiveInt(value         , fallback        )         {
  return typeof value === 'number' && Number.isSafeInteger(value) && value > 0 ? value : fallback
}

function nonNegativeInt(value         , fallback        )         {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : fallback
}

function isoTime(time        )         {
  try {
    return new Date(time).toISOString()
  } catch {
    return 'unknown time'
  }
}

function errorCode(error         )         {
  if (isRecord(error) && typeof error.code === 'string' && error.code.length > 0) return error.code
  return 'unavailable'
}
