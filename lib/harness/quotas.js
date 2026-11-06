/**
 * Read-only quota backends for the credentials a Harness installation already
 * owns.
 *
 * This module deliberately does not discover, refresh, persist, or proxy
 * credentials. It reads two exact `llm-pi-ai` authorization records, the exact
 * DeepSeek account service, and the exact `DEEPSEEK_API_KEY` reference. Every
 * request goes to one literal HTTPS origin and path.
 *
 * Transport evidence from the DSH checkout this plugin targets:
 * - `packages/util/http-proxy/src/install.ts` installs the deployment proxy as
 *   the global undici dispatcher (`setGlobalDispatcher`) and its README says
 *   ordinary `fetch()` callers need no changes.
 * - `packages/llm/llm-pi-ai/src/discovery.ts` and
 *   `packages/llm/llm-deepseek/src/files-api.ts` use `globalThis.fetch` as the
 *   native Harness path (the latter explicitly defaults to it).
 * Current DSH therefore exposes no `ctx.fetch` network Service. This module
 * accepts an explicit transport in `options.fetch` (the root plugin passes
 * `globalThis.fetch` so the deployment dispatcher and inspector hooks stay in
 * effect) and otherwise invokes `globalThis.fetch` lazily, at request time. It
 * never creates an undici client, ProxyAgent, dispatcher, proxy URL, or custom
 * init override; the request init below is fixed by this module.
 */



/** One independently resetting subscription window. */











/** One existing Harness credential or one explicitly unsupported provider. */












/** Complete, renderer-ready account state. */





/** Cancellation and force-refresh options for one snapshot read. */





/** The monitor contract. It starts no polling work of its own. */





/** Test/embedding override for the Harness transport. */











































































const DEFAULT_CACHE_TTL_MS = 60_000
const DEFAULT_MIN_REFRESH_INTERVAL_MS = 15_000
const DEFAULT_MAX_ACCOUNTS = 8
const DEFAULT_CONCURRENCY = 2
const DEFAULT_TIMEOUT_MS = 8_000
const MAX_BODY_BYTES = 64 * 1024
const DISPOSE_WAIT_MS = 1_000
const PI_AI_RECORD_SCOPE = 'llm-pi-ai'
const DEEPSEEK_API_KEY_REF = 'DEEPSEEK_API_KEY'

/**
 * Exact official endpoints. The three literals below are the only network
 * destinations this module can ever request. Their origins and paths are also
 * re-checked against each response so a transport that follows a redirect (or
 * returns a rewritten URL) cannot silently widen the allowlist.
 */
const ENDPOINTS                                                                 = Object.freeze({
  codex: Object.freeze({
    url: 'https://chatgpt.com/backend-api/wham/usage',
    origin: 'https://chatgpt.com',
    path: '/backend-api/wham/usage',
  }),
  claude: Object.freeze({
    url: 'https://api.anthropic.com/api/oauth/usage',
    origin: 'https://api.anthropic.com',
    path: '/api/oauth/usage',
  }),
  deepseekApi: Object.freeze({
    url: 'https://api.deepseek.com/user/balance',
    origin: 'https://api.deepseek.com',
    path: '/user/balance',
  }),
})

/**
 * Exact credential records owned by the `llm-pi-ai` adapter family. The table
 * is fixed: no provider id, record id, path, or settings value is interpolated
 * into a lookup.
 */
const AUTH_RECORDS = Object.freeze({
  codex: `${PI_AI_RECORD_SCOPE}/openai-codex`,
  claude: `${PI_AI_RECORD_SCOPE}/anthropic`,
})

/** Routes this backend actually reads; every other live route is unsupported. */
const SUPPORTED_PROVIDER_IDS                      = new Set([
  'openai-codex',
  'anthropic',
  'deepseek',
  'deepseek-account',
  'deepseek-official',
  'deepseek-api',
])

/** Display fallbacks only; a live route's own name always wins. */
const UNSUPPORTED_LABELS                                   = Object.freeze({
  cursor: 'Cursor',
  copilot: 'GitHub Copilot',
  antigravity: 'Google Antigravity',
  openrouter: 'OpenRouter',
  openai: 'OpenAI API',
})

const CODEX_LABEL = 'Codex (ChatGPT subscription)'
const CLAUDE_LABEL = 'Claude Code (subscription)'
const DEEPSEEK_ACCOUNT_LABEL = 'DeepSeek (signed-in account)'
const DEEPSEEK_API_LABEL = 'DeepSeek (API key)'

class FetchFailure extends Error {
  code
  status

  constructor(code                      , status         ) {
    super(code)
    this.name = 'QuotaFetchFailure'
    this.code = code
    this.status = status
  }
}

function abortError()        {
  const error = new Error('Quota snapshot aborted')
  error.name = 'AbortError'
  return error
}

function isAbortError(error         )          {
  return error instanceof Error && error.name === 'AbortError'
}

function isRecord(value         )                                   {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function finiteNumber(value         )                     {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return parsed
  }
  return undefined
}

function clampPercent(value        )         {
  return Math.max(0, Math.min(100, value))
}

function safeOpaqueHeader(value         )                     {
  if (typeof value !== 'string' || value.length === 0 || value.length > 4_096) return undefined
  // Printable ASCII without space or any control character: rejects header
  // injection and keeps opaque bearer/account values exactly as stored.
  return /^[\x21-\x7e]+$/.test(value) ? value : undefined
}

function safeAccountId(value         )                     {
  if (typeof value !== 'string' || value.length === 0 || value.length > 160) return undefined
  return /^[A-Za-z0-9._-]+$/.test(value) ? value : undefined
}

function isoFromSeconds(value         )                     {
  const seconds = finiteNumber(value)
  if (seconds === undefined || seconds <= 0) return undefined
  const date = new Date(seconds * 1_000)
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined
}

function isoFromString(value         )                     {
  if (typeof value !== 'string' || value.length === 0 || value.length > 80) return undefined
  const date = new Date(value)
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined
}

function normalizeCurrency(value         )                     {
  if (typeof value !== 'string') return undefined
  const currency = value.trim().toUpperCase()
  return /^[A-Z]{3}$/.test(currency) ? currency : undefined
}

function normalizeAmount(value         )                     {
  if (typeof value !== 'string' && typeof value !== 'number') return undefined
  const amount = String(value).trim()
  return /^-?\d+(?:\.\d+)?$/.test(amount) && amount.length <= 80 ? amount : undefined
}

/** Add two decimal strings without binary floating-point rounding. */
function addAmounts(left        , right        )                     {
  const leftMatch = /^(-?)(\d+)(?:\.(\d+))?$/.exec(left)
  const rightMatch = /^(-?)(\d+)(?:\.(\d+))?$/.exec(right)
  if (leftMatch === null || rightMatch === null) return undefined
  const scale = Math.max(leftMatch[3]?.length ?? 0, rightMatch[3]?.length ?? 0)
  const scaled = (match                 )         => {
    const fraction = (match[3] ?? '').padEnd(scale, '0')
    const magnitude = BigInt(`${match[2] ?? '0'}${fraction}`)
    return match[1] === '-' ? -magnitude : magnitude
  }
  const sum = scaled(leftMatch) + scaled(rightMatch)
  const negative = sum < 0n
  const digits = (negative ? -sum : sum).toString().padStart(scale + 1, '0')
  if (scale === 0) return `${negative ? '-' : ''}${digits}`
  const whole = digits.slice(0, -scale)
  const fraction = digits.slice(-scale).replace(/0+$/, '')
  return `${negative ? '-' : ''}${whole}${fraction === '' ? '' : `.${fraction}`}`
}

function windowLabelFromSeconds(value         )                     {
  const seconds = finiteNumber(value)
  if (seconds === undefined || seconds <= 0) return undefined
  const minutes = Math.ceil(seconds / 60)
  if (minutes === 300) return '5-hour window'
  if (minutes === 10_080) return 'Weekly window'
  if (minutes % 1_440 === 0) return `${minutes / 1_440}-day window`
  if (minutes % 60 === 0) return `${minutes / 60}-hour window`
  return `${minutes}-minute window`
}

function responseReason(prefix        , failure              )         {
  switch (failure.code) {
    case 'timeout':
      return `${prefix} usage request timed out.`
    case 'redirect':
    case 'url':
      return `${prefix} usage endpoint returned an unexpected redirect.`
    case 'body':
      return `${prefix} usage response exceeded the size limit.`
    case 'json':
      return `${prefix} usage response was not valid JSON.`
    case 'http':
      return failure.status === 429
        ? `${prefix} usage endpoint is rate limited (HTTP 429).`
        : `${prefix} usage request was rejected (HTTP ${String(failure.status ?? 'error')}).`
    case 'no-transport':
      return `${prefix} usage transport is unavailable.`
    default:
      return `${prefix} usage transport failed.`
  }
}

function unavailableAccount(id        , provider        , label        , reason        , now        )               {
  return { id, provider, label, status: 'unavailable', windows: [], reason, fetchedAt: now }
}

function unsupportedAccount(id        , provider        , label        , reason        , now        )               {
  return { id, provider, label, status: 'unsupported', windows: [], reason, fetchedAt: now }
}

function errorAccount(id        , provider        , label        , reason        , now        )               {
  return { id, provider, label, status: 'error', windows: [], reason, fetchedAt: now }
}

function cloneSnapshot(snapshot               , stale         )                {
  return {
    updatedAt: snapshot.updatedAt,
    accounts: snapshot.accounts.map(account => ({
      ...account,
      windows: account.windows.map(window => ({ ...window })),
      ...(account.balance === undefined ? {} : { balance: { ...account.balance } }),
      ...(stale ? { stale: true } : {}),
    })),
  }
}

function raceWithAbort   (promise            , signal                         )             {
  if (signal === undefined) return promise
  if (signal.aborted) return Promise.reject(abortError())
  return new Promise   ((resolve, reject) => {
    const onAbort = ()       => {
      signal.removeEventListener('abort', onAbort)
      reject(abortError())
    }
    signal.addEventListener('abort', onAbort, { once: true })
    promise.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        resolve(value)
      },
      (error         ) => {
        signal.removeEventListener('abort', onAbort)
        reject(error)
      },
    )
  })
}

/**
 * Read one optional Cordis service without touching an undeclared service
 * property. A Cordis context throws for a service the plugin did not declare
 * in `inject`, so direct `ctx.deepseekAccount`/`ctx.credentials` reads can
 * abort a whole snapshot. `ctx.get(name)` is the safe optional lookup; the
 * direct property read is only a fallback for plain test/embedding contexts
 * that have no `get` method at all.
 */
function optionalService   (ctx                              , name        )                {
  if (ctx === undefined || ctx === null) return undefined
  let getter
  try {
    getter = (ctx                     ).get
  } catch {
    return undefined
  }
  if (typeof getter === 'function') {
    try {
      return (getter                                  ).call(ctx, name)
    } catch {
      return undefined
    }
  }
  try {
    return (ctx                                            )[name]
  } catch {
    return undefined
  }
}

/**
 * Resolve the request transport from the caller's explicit Harness fetch seam
 * or the native DSH `globalThis.fetch` path. There is no `ctx.fetch` service;
 * probing it would read an undeclared Cordis service and can throw.
 *
 * No caller-supplied init, dispatcher, ProxyAgent, or proxy URL reaches the
 * request. `requestJson` builds the complete RequestInit itself.
 */
function resolveFetcher(options                     )               {
  if (options.fetch !== undefined && typeof options.fetch !== 'function') {
    return () => Promise.reject(new FetchFailure('no-transport'))
  }
  if (options.fetch !== undefined) return options.fetch
  return (input, init) => {
    const globalFetch = globalThis.fetch
    if (typeof globalFetch !== 'function') {
      return Promise.reject(new FetchFailure('no-transport'))
    }
    return globalFetch.call(globalThis, input, init)
  }
}














function deadlineWith(parent             , timeoutMs        )           {
  const controller = new AbortController()
  let timedOut = false
  let timer
  const abort = ()       => controller.abort()
  if (parent.aborted) {
    controller.abort()
    return { signal: controller.signal, timedOut: () => false, clear: () => {} }
  }
  parent.addEventListener('abort', abort, { once: true })
  timer = setTimeout(() => {
    timedOut = true
    controller.abort()
  }, timeoutMs)
  return {
    signal: controller.signal,
    timedOut: () => timedOut,
    clear: () => {
      if (timer !== undefined) clearTimeout(timer)
      timer = undefined
      parent.removeEventListener('abort', abort)
    },
  }
}

function isResponseLike(value         )                    {
  if (typeof value !== 'object' || value === null) return false
  const candidate = value
  return typeof candidate.status === 'number'
    && typeof candidate.ok === 'boolean'
    && (typeof candidate.text === 'function' || candidate.body !== undefined)
}

function normalizedResponseUrl(response          )                     {
  return typeof response.url === 'string' && response.url.length > 0 ? response.url : undefined
}

function assertResponseDestination(response          , endpoint          )       {
  if (response.redirected) throw new FetchFailure('redirect')
  if (typeof response.status === 'number' && response.status >= 300 && response.status < 400) {
    throw new FetchFailure('redirect')
  }
  const finalUrl = normalizedResponseUrl(response)
  if (finalUrl === undefined) return
  let parsed
  try {
    parsed = new URL(finalUrl)
  } catch {
    throw new FetchFailure('url')
  }
  if (parsed.origin !== endpoint.origin || parsed.pathname !== endpoint.path || parsed.search !== '' || parsed.hash !== '') {
    throw new FetchFailure('url')
  }
}

/**
 * Cancel a body/reader without awaiting it. A transport is untrusted: its
 * cancel() may never settle, so waiting here could pin a snapshot or disposal.
 * Every rejection is consumed so no unhandled rejection escapes.
 */
function cancelStream(stream                            )       {
  try {
    const result = stream.cancel()
    if (result !== undefined && typeof result.then === 'function') result.then(undefined, () => {})
  } catch {
    // A locked or already errored stream has nothing left to cancel.
  }
}

function cancelReader(reader                                         )       {
  try {
    const result = reader.cancel()
    if (result !== undefined && typeof result.then === 'function') result.then(undefined, () => {})
  } catch {
    // A reader released/errored by the transport may refuse cancellation.
  }
}

function cancelResponseBody(response          )       {
  const body = response.body
  if (body !== null && body !== undefined) cancelStream(body)
}

async function readBoundedText(response          , signal             , maxBytes        )                  {
  const body = response.body
  if (body !== null && body !== undefined && typeof body.getReader === 'function') {
    const reader = body.getReader()
    const chunks               = []
    let total = 0
    let complete = false
    try {
      for (;;) {
        signal.throwIfAborted()
        const part = await raceWithAbort(reader.read(), signal)
        if (part.done) {
          complete = true
          break
        }
        const value = part.value
        total += value.byteLength
        if (total > maxBytes) throw new FetchFailure('body')
        chunks.push(value)
      }
    } finally {
      if (complete) {
        try {
          reader.releaseLock()
        } catch {
          // The transport may have released the reader already.
        }
      } else {
        // Cancel closes the stream; immediately releasing a reader with a
        // pending read can throw. Do not await the untrusted cancel promise.
        cancelReader(reader)
      }
    }
    const joined = new Uint8Array(total)
    let offset = 0
    for (const chunk of chunks) {
      joined.set(chunk, offset)
      offset += chunk.byteLength
    }
    return new TextDecoder().decode(joined)
  }
  const text = await raceWithAbort(response.text(), signal)
  if (new TextEncoder().encode(text).byteLength > maxBytes) throw new FetchFailure('body')
  return text
}

async function requestJson(
  fetcher              ,
  endpoint          ,
  headers                                  ,
  signal             ,
  timeoutMs        ,
)                   {
  const deadline = deadlineWith(signal, timeoutMs)
  try {
    let response
    try {
      // A transport that ignores its AbortSignal must not hang the snapshot:
      // race the call itself against the same deadline. If it later resolves
      // after cancellation, close the unread body rather than leaking it.
      const operation = fetcher(endpoint.url, {
        method: 'GET',
        headers: { ...headers },
        redirect: 'error',
        credentials: 'omit',
        cache: 'no-store',
        referrerPolicy: 'no-referrer',
        signal: deadline.signal,
      })
      void operation.then(
        (lateResponse) => {
          if (deadline.signal.aborted) cancelResponseBody(lateResponse)
        },
        () => {},
      )
      response = await raceWithAbort(operation, deadline.signal)
    } catch (error) {
      if (isAbortError(error) || deadline.signal.aborted) {
        if (deadline.timedOut()) throw new FetchFailure('timeout')
        throw abortError()
      }
      throw new FetchFailure('transport')
    }
    if (!isResponseLike(response)) throw new FetchFailure('transport')
    try {
      assertResponseDestination(response, endpoint)
    } catch (error) {
      cancelResponseBody(response)
      throw error
    }
    if (!response.ok) {
      cancelResponseBody(response)
      throw new FetchFailure('http', response.status)
    }
    let text
    try {
      text = await readBoundedText(response, deadline.signal, MAX_BODY_BYTES)
    } catch (error) {
      cancelResponseBody(response)
      if (error instanceof FetchFailure) throw error
      if (isAbortError(error) || deadline.signal.aborted) {
        if (deadline.timedOut()) throw new FetchFailure('timeout')
        throw abortError()
      }
      throw new FetchFailure('transport')
    }
    try {
      return JSON.parse(text)
    } catch {
      throw new FetchFailure('json')
    }
  } finally {
    deadline.clear()
  }
}

async function boundedAccountCall   (operation            , parent             , timeoutMs        )             {
  const deadline = deadlineWith(parent, timeoutMs)
  try {
    return await raceWithAbort(operation, deadline.signal)
  } catch (error) {
    if (isAbortError(error) || deadline.signal.aborted) {
      if (deadline.timedOut()) throw new FetchFailure('timeout')
      throw abortError()
    }
    throw error
  } finally {
    deadline.clear()
  }
}

async function runBounded   (tasks                                 , limit        )               {
  const results = new Array   (tasks.length)
  let next = 0
  const workers = Array.from({ length: Math.max(1, Math.min(limit, tasks.length)) }, async () => {
    for (;;) {
      const index = next
      next += 1
      if (index >= tasks.length) return
      results[index] = await tasks[index] ()
    }
  })
  await Promise.all(workers)
  return results
}







function oauthGrantOf(record                                  , now        , requiresAccountId         )                      {
  if (record === undefined) return 'No Harness OAuth credential is stored.'
  if (record.kind !== 'grant' || !isRecord(record.payload)) {
    return 'The stored Harness credential is not a subscription OAuth grant.'
  }
  const payload = record.payload
  if (payload.type !== 'oauth') return 'The stored Harness credential is not a subscription OAuth grant.'
  const access = safeOpaqueHeader(payload.access)
  if (access === undefined) return 'The stored Harness OAuth grant has no usable access token.'
  const expires = finiteNumber(payload.expires)
  if (expires !== undefined && expires <= now) {
    return 'The Harness OAuth access token has expired; sign in again in Harness to refresh it.'
  }
  const accountId = safeAccountId(payload.accountId)
  if (requiresAccountId && accountId === undefined) {
    return 'The Harness OAuth grant does not include a ChatGPT account id.'
  }
  return {
    access,
    ...(expires === undefined ? {} : { expires }),
    ...(accountId === undefined ? {} : { accountId }),
  }
}

function isGrantFailure(value                     )                  {
  return typeof value === 'string'
}

function configuredUnsupportedProviders(ctx                              )                                       {
  const service = optionalService                (ctx, 'llm')
  if (service === undefined || typeof service.listProviders !== 'function') return []
  let listed
  try {
    listed = service.listProviders()
  } catch {
    return []
  }
  if (!Array.isArray(listed)) return []
  const seen = new Set        ()
  const providers                                       = []
  for (const info of listed) {
    if (!isRecord(info) || typeof info.id !== 'string') continue
    const id = info.id
    if (SUPPORTED_PROVIDER_IDS.has(id) || seen.has(id) || !/^[a-z0-9][a-z0-9-]{0,63}$/.test(id)) continue
    seen.add(id)
    const rawName = typeof info.name === 'string' ? info.name.trim() : ''
    const label = rawName.length > 0 && rawName.length <= 80 && !/[\u0000-\u001f\u007f]/.test(rawName)
      ? rawName
      : UNSUPPORTED_LABELS[id] ?? id
    providers.push({ id, label })
  }
  return providers
}

function codexWindow(
  id        ,
  value         ,
)                          {
  if (!isRecord(value)) return undefined
  const used = finiteNumber(value.used_percent)
  if (used === undefined) return undefined
  const usedPercent = clampPercent(used)
  const label = windowLabelFromSeconds(value.limit_window_seconds) ?? (id === 'primary' ? 'Primary window' : 'Secondary window')
  const resetsAt = isoFromSeconds(value.reset_at)
  return {
    id,
    label,
    usedPercent,
    remainingPercent: clampPercent(100 - usedPercent),
    ...(resetsAt === undefined ? {} : { resetsAt }),
  }
}

function codexBalance(value         )                                                   {
  if (!isRecord(value)) return undefined
  if (value.has_credits !== true || value.unlimited === true) return undefined
  const raw = value.balance
  if (typeof raw !== 'string') return undefined
  const match = /^\$(\d+(?:\.\d+)?)$/.exec(raw.trim())
  if (match === null) return undefined
  return { amount: match[1] , currency: 'USD' }
}

function claudeWindow(id        , label        , value         )                          {
  if (!isRecord(value)) return undefined
  const used = finiteNumber(value.utilization)
  if (used === undefined) return undefined
  const usedPercent = clampPercent(used)
  const resetsAt = isoFromString(value.resets_at)
  return {
    id,
    label,
    usedPercent,
    remainingPercent: clampPercent(100 - usedPercent),
    ...(resetsAt === undefined ? {} : { resetsAt }),
  }
}

function walletAccounts(
  provider        ,
  label        ,
  wallets                                                        ,
  now        ,
)                 {
  const totals = new Map                ()
  for (const wallet of wallets) {
    const currency = normalizeCurrency(wallet.currency)
    const amount = normalizeAmount(wallet.balance)
    if (currency === undefined || amount === undefined) continue
    const prior = totals.get(currency)
    if (prior === undefined) {
      totals.set(currency, amount)
      continue
    }
    const sum = addAmounts(prior, amount)
    if (sum !== undefined) totals.set(currency, sum)
  }
  const accounts                 = []
  for (const [currency, amount] of totals) {
    accounts.push({
      id: `${provider}:${currency}`,
      provider,
      label: `${label} · ${currency}`,
      status: 'ok',
      windows: [],
      balance: { amount, currency },
      fetchedAt: now,
    })
    // One account per currency is truthful; a monitor never needs more than
    // the two currencies DeepSeek actually reports.
    if (accounts.length >= 2) break
  }
  return accounts
}

/**
 * Create the read-only quota monitor.
 *
 * The monitor is inert until `snapshot()` is called. A forced refresh still
 * respects `minRefreshIntervalMs`; while a refresh is in flight, all callers
 * share it. `dispose()` aborts the shared request and waits a bounded time for
 * it to settle.
 */
export function createQuotaMonitor(ctx                  , options                      = {})               {
  const now = options.now ?? (() => Date.now())
  const cacheTtlMs = Math.max(0, options.cacheTtlMs ?? DEFAULT_CACHE_TTL_MS)
  const minRefreshIntervalMs = Math.max(0, options.minRefreshIntervalMs ?? DEFAULT_MIN_REFRESH_INTERVAL_MS)
  const maxAccounts = Math.max(1, Math.min(8, Math.trunc(options.maxAccounts ?? DEFAULT_MAX_ACCOUNTS)))
  const concurrency = Math.max(1, Math.min(2, Math.trunc(options.concurrency ?? DEFAULT_CONCURRENCY)))
  const timeoutMs = Math.max(1, Math.min(60_000, Math.trunc(options.timeoutMs ?? DEFAULT_TIMEOUT_MS)))
  const fetcher = resolveFetcher(options)
  const deepseekKeyRef = options.deepseekApiKeyRef ?? DEEPSEEK_API_KEY_REF
  // DSH exposes no runtime-version Service or context metadata to a plugin.
  // The caller may pass the native build version; otherwise this release's
  // fixed public version keeps the account header valid and non-secret.
  const clientVersion = typeof options.clientVersion === 'string' && /^[0-9A-Za-z.+-]{1,40}$/.test(options.clientVersion)
    ? options.clientVersion
    : '0.5.0'
  const lifetime = new AbortController()

  let disposed = false
  let cached
  let lastRefreshCompletedAt = 0
  let inFlight

  const codexAccounts = async ()                          => {
    const credentials = optionalService                       (ctx, 'credentials')
    if (credentials === undefined || typeof credentials.readRecord !== 'function') {
      return [unavailableAccount('codex', 'codex', CODEX_LABEL, 'The Harness credential service is unavailable.', now())]
    }
    const grant = oauthGrantOf(await credentials.readRecord(AUTH_RECORDS.codex), now(), true)
    if (isGrantFailure(grant)) return [unavailableAccount('codex', 'codex', CODEX_LABEL, grant, now())]
    const payload = await requestJson(
      fetcher,
      ENDPOINTS.codex,
      {
        Accept: 'application/json',
        Authorization: `Bearer ${grant.access}`,
        'ChatGPT-Account-Id': grant.accountId ,
        'User-Agent': 'codex-cli',
      },
      lifetime.signal,
      timeoutMs,
    )
    if (!isRecord(payload) || !isRecord(payload.rate_limit)) {
      return [errorAccount('codex', 'codex', CODEX_LABEL, 'Codex usage response contained no rate-limit data.', now())]
    }
    const windows                = []
    const primary = codexWindow('primary', payload.rate_limit.primary_window)
    const secondary = codexWindow('secondary', payload.rate_limit.secondary_window)
    if (primary !== undefined) windows.push(primary)
    if (secondary !== undefined) windows.push(secondary)
    const balance = codexBalance(payload.credits)
    if (windows.length === 0 && balance === undefined) {
      return [errorAccount('codex', 'codex', CODEX_LABEL, 'Codex usage response contained no usable windows.', now())]
    }
    return [{
      id: 'codex',
      provider: 'codex',
      label: CODEX_LABEL,
      status: 'ok',
      windows,
      ...(balance === undefined ? {} : { balance }),
      fetchedAt: now(),
    }]
  }

  const claudeAccounts = async ()                          => {
    const credentials = optionalService                       (ctx, 'credentials')
    if (credentials === undefined || typeof credentials.readRecord !== 'function') {
      return [unavailableAccount('claude', 'claude', CLAUDE_LABEL, 'The Harness credential service is unavailable.', now())]
    }
    const grant = oauthGrantOf(await credentials.readRecord(AUTH_RECORDS.claude), now(), false)
    if (isGrantFailure(grant)) return [unavailableAccount('claude', 'claude', CLAUDE_LABEL, grant, now())]
    const payload = await requestJson(
      fetcher,
      ENDPOINTS.claude,
      {
        Accept: 'application/json',
        Authorization: `Bearer ${grant.access}`,
        'Content-Type': 'application/json',
        'anthropic-beta': 'oauth-2025-04-20',
        'anthropic-version': '2023-06-01',
      },
      lifetime.signal,
      timeoutMs,
    )
    if (!isRecord(payload)) {
      return [errorAccount('claude', 'claude', CLAUDE_LABEL, 'Claude usage response was not an object.', now())]
    }
    const windows                = []
    const known                                  = [
      ['five_hour', '5-hour window'],
      ['seven_day', 'Weekly window'],
      ['seven_day_opus', 'Weekly Opus window'],
      ['seven_day_sonnet', 'Weekly Sonnet window'],
    ]
    for (const [id, label] of known) {
      const window = claudeWindow(id, label, payload[id])
      if (window !== undefined) windows.push(window)
    }
    if (windows.length === 0) {
      return [errorAccount('claude', 'claude', CLAUDE_LABEL, 'Claude usage response contained no usable windows.', now())]
    }
    return [{
      id: 'claude',
      provider: 'claude',
      label: CLAUDE_LABEL,
      status: 'ok',
      windows,
      fetchedAt: now(),
    }]
  }

  const deepseekAccountAccounts = async ()                          => {
    const service = optionalService                            (ctx, 'deepseekAccount')
    const clientNote = ` (client ${clientVersion})`
    if (service === undefined || typeof service.getBalance !== 'function') {
      return [unavailableAccount(
        'deepseek-account',
        'deepseek-account',
        DEEPSEEK_ACCOUNT_LABEL,
        'The Harness DeepSeek account service is unavailable.',
        now(),
      )]
    }
    let balance
    try {
      // The owning service has its own Platform deadline, but a broken/never
      // settling implementation must not pin this snapshot or its disposal.
      balance = await boundedAccountCall(service.getBalance({
        version: clientVersion,
        locale: 'en-US',
        timezoneOffsetSeconds: -new Date().getTimezoneOffset() * 60,
      }), lifetime.signal, timeoutMs)
    } catch (error) {
      if (isAbortError(error) && lifetime.signal.aborted) throw error
      if (error instanceof FetchFailure && error.code === 'timeout') {
        return [errorAccount(
          'deepseek-account',
          'deepseek-account',
          DEEPSEEK_ACCOUNT_LABEL,
          `DeepSeek account balance request timed out${clientNote}.`,
          now(),
        )]
      }
      return [errorAccount(
        'deepseek-account',
        'deepseek-account',
        DEEPSEEK_ACCOUNT_LABEL,
        `DeepSeek account balance is unavailable${clientNote}.`,
        now(),
      )]
    }
    // A route the user never signed in to is not an account they keep: an
    // "Unavailable" card for a deployment that only uses an API key is noise.
    if (balance === null) return []
    if (balance.status === 'failed') {
      return [errorAccount(
        'deepseek-account',
        'deepseek-account',
        DEEPSEEK_ACCOUNT_LABEL,
        `DeepSeek account balance is unavailable${clientNote}.`,
        now(),
      )]
    }
    if (balance.status !== 'ready') {
      return [errorAccount(
        'deepseek-account',
        'deepseek-account',
        DEEPSEEK_ACCOUNT_LABEL,
        `DeepSeek account balance response was not usable${clientNote}.`,
        now(),
      )]
    }
    const wallets                                                 = []
    if (Array.isArray(balance.value)) {
      for (const wallet of balance.value                        ) {
        if (isRecord(wallet)) wallets.push({ currency: wallet.currency, balance: wallet.balance })
      }
    }
    if (Array.isArray(balance.bonusWallets)) {
      for (const wallet of balance.bonusWallets                        ) {
        if (isRecord(wallet)) wallets.push({ currency: wallet.currency, balance: wallet.balance })
      }
    }
    const accounts = walletAccounts('deepseek-account', DEEPSEEK_ACCOUNT_LABEL, wallets, now())
    if (accounts.length === 0) {
      return [errorAccount(
        'deepseek-account',
        'deepseek-account',
        DEEPSEEK_ACCOUNT_LABEL,
        'DeepSeek account balance contained no usable wallet.',
        now(),
      )]
    }
    return accounts
  }

  const deepseekApiAccounts = async ()                          => {
    if (deepseekKeyRef !== DEEPSEEK_API_KEY_REF) {
      return [unsupportedAccount(
        'deepseek-api',
        'deepseek-api',
        DEEPSEEK_API_LABEL,
        'The configured DeepSeek API key reference is not a known Harness credential.',
        now(),
      )]
    }
    const credentials = optionalService                       (ctx, 'credentials')
    if (credentials === undefined) {
      return [unavailableAccount('deepseek-api', 'deepseek-api', DEEPSEEK_API_LABEL, 'The Harness credential service is unavailable.', now())]
    }
    if (typeof credentials.resolve !== 'function') {
      return [unavailableAccount('deepseek-api', 'deepseek-api', DEEPSEEK_API_LABEL, 'The Harness credential service cannot resolve references.', now())]
    }
    // Only the exact official DeepSeek reference is read. A record such as
    // `llm-pi-ai/deepseek` can belong to a user-overridden route whose key
    // must not be replayed to the official origin.
    const resolved = await credentials.resolve(DEEPSEEK_API_KEY_REF)
    const apiKey = safeOpaqueHeader(resolved?.value)
    if (apiKey === undefined) {
      return [unavailableAccount(
        'deepseek-api',
        'deepseek-api',
        DEEPSEEK_API_LABEL,
        'No DeepSeek API key credential is configured in Harness.',
        now(),
      )]
    }
    const payload = await requestJson(
      fetcher,
      ENDPOINTS.deepseekApi,
      {
        Accept: 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      lifetime.signal,
      timeoutMs,
    )
    if (!isRecord(payload) || !Array.isArray(payload.balance_infos)) {
      return [errorAccount('deepseek-api', 'deepseek-api', DEEPSEEK_API_LABEL, 'DeepSeek balance response contained no balance data.', now())]
    }
    const wallets                                                 = []
    for (const item of payload.balance_infos) {
      if (!isRecord(item)) continue
      wallets.push({ currency: item.currency, balance: item.total_balance })
    }
    const accounts = walletAccounts('deepseek-api', DEEPSEEK_API_LABEL, wallets, now())
    if (accounts.length === 0) {
      return [errorAccount('deepseek-api', 'deepseek-api', DEEPSEEK_API_LABEL, 'DeepSeek balance response contained no usable wallet.', now())]
    }
    if (payload.is_available === false) {
      for (const account of accounts) {
        account.status = 'unavailable'
        account.reason = 'The DeepSeek account balance is insufficient for API requests.'
      }
    }
    return accounts
  }

  const collect = async ()                         => {
    const sources                             = [
      { id: 'codex', provider: 'codex', label: CODEX_LABEL, run: codexAccounts },
      { id: 'claude', provider: 'claude', label: CLAUDE_LABEL, run: claudeAccounts },
      { id: 'deepseek-account', provider: 'deepseek-account', label: DEEPSEEK_ACCOUNT_LABEL, run: deepseekAccountAccounts },
      { id: 'deepseek-api', provider: 'deepseek-api', label: DEEPSEEK_API_LABEL, run: deepseekApiAccounts },
    ]
    const results = await runBounded(
      sources.map(source => async () => {
        try {
          return await source.run()
        } catch (error) {
          if (isAbortError(error)) throw error
          if (error instanceof FetchFailure) {
            // A missing transport means the harness cannot reach the provider;
            // that is an availability fact, not a provider error.
            const reason = responseReason(source.label.replace(/ \(.*\)$/, ''), error)
            return [error.code === 'no-transport'
              ? unavailableAccount(source.id, source.provider, source.label, reason, now())
              : errorAccount(source.id, source.provider, source.label, reason, now())]
          }
          return [errorAccount(source.id, source.provider, source.label, 'Quota reading is unavailable.', now())]
        }
      }),
      concurrency,
    )
    const accounts = results.flat()
    for (const provider of configuredUnsupportedProviders(ctx)) {
      if (accounts.length >= maxAccounts) break
      accounts.push(unsupportedAccount(
        provider.id,
        provider.id,
        provider.label,
        'No safe official quota API is available through Harness; no value is estimated.',
        now(),
      ))
    }
    return {
      accounts: accounts.slice(0, maxAccounts),
      updatedAt: now(),
    }
  }

  const startRefresh = ()                         => {
    if (inFlight !== undefined) return inFlight
    let pending
    pending = collect().then(
      (snapshot) => {
        if (!disposed) {
          cached = snapshot
          lastRefreshCompletedAt = now()
        }
        return snapshot
      },
    ).finally(() => {
      if (inFlight === pending) inFlight = undefined
    })
    inFlight = pending
    return pending
  }

  return {
    async snapshot(snapshotOptions                       = {})                         {
      if (disposed) throw abortError()
      const signal = snapshotOptions.signal
      if (signal?.aborted === true) throw abortError()
      const refresh = snapshotOptions.refresh === true
      if (!refresh && cached !== undefined) {
        return cloneSnapshot(cached, now() - cached.updatedAt > cacheTtlMs)
      }
      if (cached !== undefined && lastRefreshCompletedAt !== 0
        && now() - lastRefreshCompletedAt < minRefreshIntervalMs) {
        return cloneSnapshot(cached, now() - cached.updatedAt > cacheTtlMs)
      }
      const fresh = await raceWithAbort(startRefresh(), signal)
      return cloneSnapshot(fresh, false)
    },

    async dispose()                {
      if (disposed) return
      disposed = true
      lifetime.abort()
      const pending = inFlight
      if (pending === undefined) return
      await Promise.race([
        pending.catch(() => {}),
        new Promise      ((resolve) => {
          const timer = setTimeout(resolve, DISPOSE_WAIT_MS)
          if (typeof timer === 'object' && timer !== null && 'unref' in timer) {
            (timer                          ).unref?.()
          }
        }),
      ])
    },
  }
}
