/** Owner-only read API. Connection owns authentication, Host and Origin fences. */
export const API_ROOT = '/api/dsh-quota'
export const MAX_RANGE_MS = 366 * 86400000
const QUERY_KEYS = new Set(['from', 'to', 'timeZone', 'sessionId', 'includeChildren', 'provider', 'model'])
export class RequestError extends Error {
  status: number
  constructor(message: string, status = 400) { super(message); this.status = status }
}

export function parseUsageQuery(input: Record<string, unknown>, now = Date.now()) {
  for (const key of Object.keys(input)) if (!QUERY_KEYS.has(key)) throw new RequestError('Unknown usage parameter')
  const parseTime = (value: unknown, fallback: number) => {
    if (value === undefined) return fallback
    if ((typeof value !== 'string' && typeof value !== 'number') || String(value).trim() === '') throw new RequestError('Invalid time range')
    const n = Number(value)
    if (!Number.isSafeInteger(n) || n < 0) throw new RequestError('Invalid time range')
    return n
  }
  const to = parseTime(input.to, now)
  const from = parseTime(input.from, Math.max(0, to - 7 * 86400000))
  if (to <= from || to - from > MAX_RANGE_MS || to > now + 60000) throw new RequestError('Time range must be positive and at most 366 days')
  const timeZone = input.timeZone ?? 'UTC'
  if (typeof timeZone !== 'string' || timeZone.length > 80) throw new RequestError('Invalid timezone')
  try { new Intl.DateTimeFormat('en', { timeZone }).format(0) } catch { throw new RequestError('Invalid timezone') }
  const sessionId = input.sessionId
  if (sessionId !== undefined && (typeof sessionId !== 'string' || !/^[A-Za-z0-9_-]{1,160}$/.test(sessionId))) throw new RequestError('Invalid session id')
  let includeChildren = true
  if (input.includeChildren !== undefined) {
    if (![true, false, 'true', 'false'].includes(input.includeChildren as any)) throw new RequestError('Invalid includeChildren')
    includeChildren = input.includeChildren === true || input.includeChildren === 'true'
  }
  const filters: Record<string, string> = {}
  for (const key of ['provider', 'model']) {
    const value = input[key]
    if (value === undefined) continue
    if (typeof value !== 'string' || value.length < 1 || value.length > (key === 'provider' ? 160 : 256) || /[\u0000-\u001f\u007f]/.test(value)) throw new RequestError('Invalid model/provider filter')
    filters[key] = value
  }
  return { from, to, timeZone, ...(sessionId === undefined ? {} : { sessionId }), includeChildren, ...filters }
}

const DIMENSIONS: Record<string, string> = { provider: 'byProvider', model: 'byModel', task: 'byTask', session: 'bySession', rootSession: 'byRootSession', hour: 'byHour', day: 'byDay' }
/** Keep model-facing output bounded; the Host read service retains full detail. */
export function usageForTool(snapshot: any, groupBy = 'model', limit = 20) {
  if (!Object.hasOwn(DIMENSIONS, groupBy)) throw new RequestError('Invalid usage dimension')
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new RequestError('Row limit must be 1–100')
  const { byProvider, byModel, byTask, bySession, byRootSession, byHour, byDay, ...summary } = snapshot
  const key = DIMENSIONS[groupBy]!
  const rows = snapshot[key] ?? []
  return { ...summary, groupBy, [key]: rows.slice(0, limit), detail: { totalRows: rows.length, returnedRows: Math.min(rows.length, limit), truncated: rows.length > limit } }
}

function queryOf(request: Request) {
  const params = new URL(request.url).searchParams
  const input: Record<string, unknown> = {}
  for (const [key, value] of params) {
    if (Object.hasOwn(input, key)) throw new RequestError('Duplicate query parameter')
    input[key] = value
  }
  return parseUsageQuery(input)
}
function reply(value: unknown, status = 200) {
  return Response.json(value, { status, headers: {
    'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; frame-ancestors 'none'",
  } })
}
function guard(operation: (request: Request) => Promise<unknown>) {
  return async (request: Request) => {
    try {
      request.signal.throwIfAborted()
      return reply(await operation(request))
    } catch (error) {
      // Never echo arbitrary error messages; upstream bodies can contain secrets.
      return error instanceof RequestError
        ? reply({ error: error.message }, error.status)
        : reply({ error: request.signal.aborted ? 'Request cancelled' : 'Usage service unavailable' }, request.signal.aborted ? 499 : 503)
    }
  }
}
export function registerQuotaRoutes(ctx: any, monitor: any) {
  const routes = [
    { path: `${API_ROOT}/usage`, methods: ['GET'], requestBody: 'buffered', fetch: guard(request => monitor.usage(queryOf(request))) },
    { path: `${API_ROOT}/snapshot`, methods: ['GET'], requestBody: 'buffered', fetch: guard(request => monitor.snapshot(queryOf(request), { signal: request.signal })) },
    { path: `${API_ROOT}/accounts`, methods: ['GET'], requestBody: 'buffered', fetch: guard(request => {
      if (new URL(request.url).search) throw new RequestError('Account query parameters are not supported')
      return monitor.accounts({ signal: request.signal })
    }) },
    { path: `${API_ROOT}/refresh`, methods: ['POST'], requestBody: 'streaming', fetch: guard(async request => {
      if (new URL(request.url).search) throw new RequestError('Refresh query parameters are not supported')
      if (!request.headers.get('content-type')?.toLowerCase().startsWith('application/json')) throw new RequestError('Expected application/json', 415)
      // No payload is needed. Read at most 32 bytes; never accept credentials/endpoints.
      const reader = request.body?.getReader()
      let body = ''
      if (reader) {
        try {
          let bytes = 0
          const decoder = new TextDecoder()
          for (;;) {
            const { done, value } = await reader.read()
            if (done) break
            bytes += value.byteLength
            if (bytes > 32) { await reader.cancel(); throw new RequestError('Refresh body too large', 413) }
            body += decoder.decode(value, { stream: true })
          }
          body += decoder.decode()
        } finally { reader.releaseLock() }
      }
      if (body.trim() !== '' && body.trim() !== '{}') throw new RequestError('Refresh accepts an empty object only')
      return monitor.accounts({ refresh: true, signal: request.signal })
    }) },
  ]
  const disposers: Array<() => unknown> = []
  try {
    // No webServer exact handlers: only Connection can admit the owner.
    for (const route of routes) disposers.push(ctx.connection.fetch.register(route))
  } catch (error) { for (const dispose of disposers.reverse()) void dispose(); throw error }
  return async () => { for (const dispose of disposers.reverse()) await dispose() }
}
