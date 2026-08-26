import type { QuotaManager } from './core/manager.ts'

export interface Route {
  kind: 'exact'
  path: string
  handler(req: any, res: any): Promise<void> | void
}

export function makeQuotaRoutes(manager: QuotaManager): Route[] {
  return [
    {
      kind: 'exact',
      path: '/api/dsh-quota/status',
      async handler(req: any, res: any) {
        try {
          const url = new URL(req.url, 'http://127.0.0.1')
          const force = url.searchParams.get('force') === 'true'
          const provider = url.searchParams.get('provider')
          if (provider) {
            const card = await manager.refreshSingleProvider(provider)
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ ok: true, card }))
            return
          }
          const result = await manager.getQuotaCards(force)
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify(result))
        } catch (err: any) {
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: err.message }))
        }
      },
    },
    {
      kind: 'exact',
      path: '/api/dsh-quota/refresh-single',
      async handler(req: any, res: any) {
        try {
          const url = new URL(req.url, 'http://127.0.0.1')
          const provider = url.searchParams.get('provider')
          if (!provider) {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Missing provider parameter' }))
            return
          }
          const card = await manager.refreshSingleProvider(provider)
          if (!card) {
            res.writeHead(404, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Provider not found' }))
            return
          }
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: true, card }))
        } catch (err: any) {
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: err.message }))
        }
      },
    },
    {
      kind: 'exact',
      path: '/api/dsh-quota/config',
      async handler(req: any, res: any) {
        if (req.method === 'GET') {
          try {
            const cfg = manager.getConfig()
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify(cfg))
          } catch (err: any) {
            res.writeHead(500, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: err.message }))
          }
          return
        }
        if (req.method !== 'POST') {
          res.writeHead(405, { 'Allow': 'GET, POST', 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'method not allowed' }))
          return
        }
        try {
          let body = ''
          for await (const chunk of req) {
            body += chunk
          }
          const parsed = JSON.parse(body)
          manager.saveConfig(parsed)
          void manager.getQuotaCards(true)
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: true }))
        } catch (err: any) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: err.message }))
        }
      },
    },
    {
      kind: 'exact',
      path: '/api/dsh-quota/auth/codex/start',
      async handler(req: any, res: any) {
        try {
          const cfg = manager.getConfig()
          const { authUrl } = await manager.oauthManager.startCodexLogin((tokens) => {
            manager.saveCodexLogin(tokens)
            const current = manager.getConfig()
            const { oauth: _legacyOauth, ...codex } = current.codex ?? {}
            manager.saveConfig({
              ...current,
              codex: {
                ...codex,
                enabled: true,
                autoDetectLocal: true,
              },
            })
            void manager.getQuotaCards(true)
          }, cfg.httpProxy)
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: true, authUrl }))
        } catch (err: any) {
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: err.message }))
        }
      },
    },
    {
      kind: 'exact',
      path: '/api/dsh-quota/auth/antigravity/start',
      async handler(req: any, res: any) {
        try {
          const cfg = manager.getConfig()
          const { authUrl } = await manager.oauthManager.startAntigravityLogin((tokens) => {
            const current = manager.getConfig()
            manager.saveConfig({
              ...current,
              antigravity: {
                enabled: true,
                autoDetectLocal: true,
                oauth: tokens,
              },
            })
            void manager.getQuotaCards(true)
          }, cfg.httpProxy)
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: true, authUrl }))
        } catch (err: any) {
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: err.message }))
        }
      },
    },
    {
      kind: 'exact',
      path: '/api/dsh-quota/auth/cursor/connect',
      async handler(req: any, res: any) {
        try {
          const current = manager.getConfig()
          manager.saveConfig({
            ...current,
            cursor: {
              ...current.cursor,
              enabled: true,
              autoDetectLocal: true,
            },
          })
          const q = await manager.getQuotaCards(true)
          const cursorCard = q.cards.find(c => c.provider === 'cursor')
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: true, card: cursorCard }))
        } catch (err: any) {
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: err.message }))
        }
      },
    },
  ]
}
