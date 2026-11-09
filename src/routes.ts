import type { QuotaManager } from './core/manager.ts'

export interface Route {
  kind: 'exact'
  path: string
  handler(req: any, res: any): Promise<void> | void
}

/**
 * Every plugin route is reachable from the browser that hosts the GUI, and the
 * GUI's own auth cookie is not part of this API. Guard rules (defence in depth):
 *
 *  1. a required custom header — a cross-site page cannot attach it without a
 *     CORS preflight, and this server answers no preflight;
 *  2. loopback Host only — a DNS-rebinding page sends its own hostname here;
 *  3. same-origin Origin / Sec-Fetch-Site when the browser sends them —
 *     the Electron desktop shell loads the app from `dsh-app://`, which is an
 *     opaque-looking but trusted local origin, so that scheme is allow-listed;
 *  4. JSON content type on writes, so form/text posts cannot mutate config.
 *
 * `DSH_QUOTA_ALLOW_REMOTE_API=1` opts out of the loopback Host check for users
 * who intentionally expose the GUI on a LAN address.
 */
const API_HEADER = 'x-dsh-quota'
const MAX_BODY_BYTES = 256 * 1024

/** Schemes the Harness desktop shell serves its own UI from (Electron custom scheme). */
const TRUSTED_APP_SCHEMES = new Set(['dsh-app:'])

function isLoopbackHostname(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, '').toLowerCase()
  return host === 'localhost' || host === '127.0.0.1' || host === '::1' || host.endsWith('.localhost')
}

interface GuardFailure {
  status: number
  message: string
}

function checkGuard(req: any): GuardFailure | undefined {
  const header = req?.headers?.[API_HEADER]
  if (header !== '1') return { status: 403, message: '缺少 X-DSH-Quota 请求头' }

  if (process.env.DSH_QUOTA_ALLOW_REMOTE_API !== '1') {
    const hostHeader = String(req?.headers?.host ?? '')
    const hostname = hostHeader.startsWith('[')
      ? hostHeader.slice(0, hostHeader.indexOf(']') + 1)
      : hostHeader.split(':')[0]
    if (!isLoopbackHostname(hostname)) {
      return { status: 403, message: `非本机访问被拒绝 (Host: ${hostHeader || 'unknown'})` }
    }
  }

  const origin = req?.headers?.origin
  let trustedAppOrigin = false
  if (typeof origin === 'string' && origin.length > 0 && origin !== 'null') {
    let originHost = ''
    let originScheme = ''
    try {
      const parsed = new URL(origin)
      originHost = parsed.hostname
      originScheme = parsed.protocol
    } catch {
      return { status: 403, message: 'Origin 无效' }
    }
    if (TRUSTED_APP_SCHEMES.has(originScheme)) trustedAppOrigin = true
    else if (!isLoopbackHostname(originHost)) return { status: 403, message: '跨站请求被拒绝' }
  }

  const site = req?.headers?.['sec-fetch-site']
  if (typeof site === 'string' && site !== 'same-origin' && site !== 'none' && !trustedAppOrigin) {
    return { status: 403, message: `跨站请求被拒绝 (Sec-Fetch-Site: ${site})` }
  }

  return undefined
}

function sendJson(res: any, status: number, payload: unknown): void {
  const body = JSON.stringify(payload)
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(body),
  })
  res.end(body)
}

async function readJsonBody(req: any): Promise<any> {
  let body = ''
  let size = 0
  for await (const chunk of req) {
    size += chunk.length
    if (size > MAX_BODY_BYTES) {
      const error: any = new Error('请求载荷过大 (超过 256KB)')
      error.statusCode = 413
      throw error
    }
    body += chunk
  }
  try {
    return JSON.parse(body || '{}')
  } catch {
    const error: any = new Error('请求体不是合法 JSON')
    error.statusCode = 400
    throw error
  }
}

/** Downsample a trend to at most `limit` points, keeping the newest sample of each bucket. */
function downsample<T extends { timestamp?: number; t?: number }>(points: T[], limit = 500): T[] {
  if (points.length <= limit) return points
  const stride = points.length / limit
  const out: T[] = []
  for (let i = 0; i < limit; i += 1) {
    out.push(points[Math.min(points.length - 1, Math.floor((i + 1) * stride) - 1)]!)
  }
  return out
}

function clampDays(raw: string | null): number {
  const parsed = Number.parseInt(raw ?? '7', 10)
  if (!Number.isFinite(parsed)) return 7
  return Math.min(30, Math.max(1, parsed))
}

export function makeQuotaRoutes(manager: QuotaManager): Route[] {
  const guarded = (
    handler: (req: any, res: any) => Promise<void> | void,
  ): ((req: any, res: any) => Promise<void>) => {
    return async (req: any, res: any) => {
      const failure = checkGuard(req)
      if (failure !== undefined) {
        sendJson(res, failure.status, { ok: false, error: failure.message })
        return
      }
      if (req.method === 'POST' && !/^application\/json\b/i.test(String(req.headers?.['content-type'] ?? ''))) {
        sendJson(res, 415, { ok: false, error: 'POST 必须使用 application/json' })
        return
      }
      try {
        await handler(req, res)
      } catch (err: any) {
        sendJson(res, err?.statusCode ?? 500, { ok: false, error: err?.message ?? String(err) })
      }
    }
  }

  const withAbort = (req: any): AbortSignal => {
    const controller = new AbortController()
    if (typeof req?.on === 'function') {
      req.on('close', () => controller.abort())
      req.on('aborted', () => controller.abort())
    }
    return controller.signal
  }

  return [
    {
      kind: 'exact',
      path: '/api/dsh-quota/status',
      handler: guarded(async (req: any, res: any) => {
        const url = new URL(req.url, 'http://127.0.0.1')
        const force = url.searchParams.get('force') === 'true'
        const provider = url.searchParams.get('provider')
        const signal = withAbort(req)

        if (provider) {
          const card = await manager.refreshSingleProvider(provider, signal)
          if (card === undefined) {
            sendJson(res, 404, { ok: false, error: `未知或未启用的服务商: ${provider}` })
            return
          }
          sendJson(res, 200, { ok: true, card })
          return
        }

        const result = await manager.getQuotaCards(force, undefined, signal)
        sendJson(res, 200, result)
      }),
    },
    {
      kind: 'exact',
      path: '/api/dsh-quota/test-connection',
      handler: guarded(async (req: any, res: any) => {
        if (req.method !== 'POST') {
          sendJson(res, 405, { ok: false, error: '仅支持 POST' })
          return
        }
        const payload = await readJsonBody(req)
        const provider = typeof payload?.provider === 'string' ? payload.provider : ''
        if (!provider) {
          sendJson(res, 400, { ok: false, message: '缺少 provider 参数' })
          return
        }
        const testResult = await manager.testConnection(provider, payload?.accountConfig, withAbort(req))
        sendJson(res, 200, testResult)
      }),
    },
    {
      kind: 'exact',
      path: '/api/dsh-quota/test-all',
      handler: guarded(async (req: any, res: any) => {
        if (req.method !== 'POST') {
          sendJson(res, 405, { ok: false, error: '仅支持 POST' })
          return
        }
        const results = await manager.testAllConnections(withAbort(req))
        sendJson(res, 200, { ok: true, results })
      }),
    },
    {
      kind: 'exact',
      path: '/api/dsh-quota/history',
      handler: guarded(async (req: any, res: any) => {
        const url = new URL(req.url, 'http://127.0.0.1')
        const instanceId = url.searchParams.get('instanceId')
        if (!instanceId) {
          sendJson(res, 400, { ok: false, error: '缺少 instanceId 参数' })
          return
        }
        if (instanceId.length > 200) {
          sendJson(res, 400, { ok: false, error: 'instanceId 过长' })
          return
        }
        const points = manager.historyManager.getTrendPoints(instanceId, clampDays(url.searchParams.get('days')))
        sendJson(res, 200, { ok: true, points: downsample(points) })
      }),
    },
    {
      kind: 'exact',
      path: '/api/dsh-quota/config',
      handler: guarded(async (req: any, res: any) => {
        if (req.method === 'GET') {
          sendJson(res, 200, manager.getSafeConfig())
          return
        }
        if (req.method !== 'POST') {
          sendJson(res, 405, { ok: false, error: '仅支持 GET/POST' })
          return
        }
        const parsed = await readJsonBody(req)
        if (parsed === null || typeof parsed !== 'object' || Array.isArray(parsed)) {
          sendJson(res, 400, { ok: false, error: '配置必须是 JSON 对象' })
          return
        }
        manager.saveConfig(parsed)
        // Refresh in the background; a failure must never become an unhandled rejection.
        void manager.getQuotaCards(true).catch((err: any) => {
          console.warn('[dsh-quota] background refresh after config save failed:', err?.message ?? err)
        })
        sendJson(res, 200, { ok: true })
      }),
    },
    {
      kind: 'exact',
      path: '/api/dsh-quota/auth/codex/start',
      handler: guarded(async (req: any, res: any) => {
        const cfg = manager.getConfig()
        const { authUrl } = await manager.oauthManager.startCodexLogin((tokens) => {
          manager.saveCodexLogin(tokens)
          const current = manager.getConfig()
          const { oauth: _legacyOauth, ...codex } = current.codex ?? {}
          manager.saveConfig({
            ...current,
            codex: { ...codex, enabled: true, autoDetectLocal: true },
          })
          void manager.getQuotaCards(true).catch(() => {})
        }, cfg.httpProxy, cfg.proxyMode)
        sendJson(res, 200, { ok: true, authUrl })
      }),
    },
    {
      kind: 'exact',
      path: '/api/dsh-quota/auth/antigravity/start',
      handler: guarded(async (req: any, res: any) => {
        const cfg = manager.getConfig()
        const { authUrl } = await manager.oauthManager.startAntigravityLogin((tokens) => {
          const current = manager.getConfig()
          manager.saveConfig({
            ...current,
            antigravity: { enabled: true, autoDetectLocal: true, oauth: tokens },
          })
          void manager.getQuotaCards(true).catch(() => {})
        }, cfg.httpProxy, cfg.proxyMode)
        sendJson(res, 200, { ok: true, authUrl })
      }),
    },
    {
      kind: 'exact',
      path: '/api/dsh-quota/auth/cursor/connect',
      handler: guarded(async (req: any, res: any) => {
        const current = manager.getConfig()
        manager.saveConfig({
          ...current,
          cursor: { ...current.cursor, enabled: true, autoDetectLocal: true },
        })
        const q = await manager.getQuotaCards(true)
        const cursorCard = q.cards.find((c) => c.provider === 'cursor')
        sendJson(res, 200, { ok: true, card: cursorCard })
      }),
    },
  ]
}
