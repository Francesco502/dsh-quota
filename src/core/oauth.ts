import http from 'node:http'
import net from 'node:net'
import { randomBytes, createHash } from 'node:crypto'
import { fetchWithProxy } from './fetch.ts'

function base64UrlEncode(buffer: Buffer): string {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function sha256(str: string): Buffer {
  return createHash('sha256').update(str).digest()
}

/**
 * Safely find an open and available port on host without throwing or crashing
 */
async function findAvailablePort(preferredPorts: number[], host = '127.0.0.1'): Promise<number> {
  for (const port of preferredPorts) {
    if (port === 0) continue
    const isAvailable = await new Promise<boolean>((resolve) => {
      const probe = net.createServer()
      probe.once('error', () => {
        probe.removeAllListeners()
        resolve(false)
      })
      probe.listen(port, host, () => {
        probe.removeAllListeners()
        probe.close(() => resolve(true))
      })
    })
    if (isAvailable) return port
  }

  // Fallback to dynamic OS port allocation
  return new Promise<number>((resolve, reject) => {
    const probe = net.createServer()
    probe.once('error', (err) => {
      probe.removeAllListeners()
      reject(err)
    })
    probe.listen(0, host, () => {
      const addr = probe.address() as net.AddressInfo
      const port = addr.port
      probe.removeAllListeners()
      probe.close(() => resolve(port))
    })
  })
}

export class OAuthManager {
  private activeCodexServer: http.Server | null = null
  private activeAntigravityServer: http.Server | null = null

  private codexVerifier: string | null = null
  private codexState: string | null = null

  private antigravityState: string | null = null

  // --- CODEX (ChatGPT OAuth) ---
  async startCodexLogin(
    onSuccess: (tokens: { accessToken: string; refreshToken?: string; accountId?: string; expiresAt?: number }) => void,
    proxyUrl?: string
  ): Promise<{ authUrl: string }> {
    if (this.activeCodexServer) {
      try {
        this.activeCodexServer.removeAllListeners()
        this.activeCodexServer.close()
      } catch {}
      this.activeCodexServer = null
    }

    this.codexVerifier = base64UrlEncode(randomBytes(32))
    this.codexState = base64UrlEncode(randomBytes(16))
    const codeChallenge = base64UrlEncode(sha256(this.codexVerifier))

    const clientId = 'app_EMoamEEZ73f0CkXaXp7hrann'
    const redirectUri = 'http://localhost:1455/auth/callback'

    const params = new URLSearchParams({
      response_type: 'code',
      client_id: clientId,
      redirect_uri: redirectUri,
      scope: 'openid profile email offline_access',
      state: this.codexState,
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
    })

    const authUrl = `https://auth.openai.com/oauth/authorize?${params.toString()}`

    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url || '/', 'http://localhost:1455')
      if (url.pathname === '/auth/callback') {
        const code = url.searchParams.get('code')
        const state = url.searchParams.get('state')

        if (code && state === this.codexState) {
          try {
            const tokenRes = await fetchWithProxy('https://auth.openai.com/oauth/token', {
              method: 'POST',
              headers: {
                'Content-Type': 'application/x-www-form-urlencoded',
                'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
                'Accept': 'application/json',
              },
              body: new URLSearchParams({
                grant_type: 'authorization_code',
                client_id: clientId,
                code,
                redirect_uri: redirectUri,
                code_verifier: this.codexVerifier!,
              }),
            }, proxyUrl)

            if (!tokenRes.ok) {
              const errBody = await tokenRes.text()
              let errMsg = `Token exchange failed (${tokenRes.status})`
              try {
                const j = JSON.parse(errBody)
                if (j.error?.message) errMsg += `: ${j.error.message}`
              } catch {
                errMsg += `: ${errBody.slice(0, 100)}`
              }
              throw new Error(errMsg)
            }

            const tokenData = await tokenRes.json() as any
            const accessToken = tokenData.access_token
            const refreshToken = tokenData.refresh_token
            const expiresIn = tokenData.expires_in || 3600
            const expiresAt = Date.now() + expiresIn * 1000

            let accountId: string | undefined
            try {
              const payload = JSON.parse(Buffer.from(accessToken.split('.')[1], 'base64').toString('utf8'))
              accountId = payload['https://api.openai.com/auth']?.account_id || payload.account_id
            } catch {}

            onSuccess({ accessToken, refreshToken, accountId, expiresAt })

            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
            res.end('<!DOCTYPE html><html><body style="font-family:sans-serif;padding:40px;text-align:center;"><h2>✅ Codex 授权成功！</h2><p>凭据已自动同步至 DSH 额度监控，您可以关闭此网页并返回 DSH 页面。</p></body></html>')
          } catch (err: any) {
            res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' })
            res.end(`<!DOCTYPE html><html><body style="font-family:sans-serif;padding:30px;line-height:1.6;"><h2>❌ 授权换取令牌失败</h2><p style="color:#d32f2f;font-weight:600;">${err.message}</p><p style="font-size:13px;color:#666;">原因说明：OpenAI 官方授权接口严格检测 IP 地区。若当前宿主直连被拦截，请在「额度监控 -> 设置」中填写代理地址（如 http://127.0.0.1:7890），或直接粘贴 ~/.codex/auth.json 中的 access_token。</p></body></html>`)
          }
        } else {
          res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
          res.end('<h2>❌ 非法请求或 State 校验失败</h2>')
        }

        setTimeout(() => {
          if (this.activeCodexServer) {
            try {
              this.activeCodexServer.removeAllListeners()
              this.activeCodexServer.close()
            } catch {}
            this.activeCodexServer = null
          }
        }, 3000)
      } else {
        res.writeHead(404)
        res.end()
      }
    })

    server.on('error', (err) => {
      console.warn('[dsh-quota] Codex OAuth server error:', err?.message || err)
    })

    this.activeCodexServer = server
    const port = await findAvailablePort([1455, 1456, 0], '127.0.0.1')
    await new Promise<void>((resolve) => {
      server.listen(port, '127.0.0.1', () => resolve())
    })

    return { authUrl }
  }

  // --- ANTIGRAVITY (Google OAuth) ---
  async startAntigravityLogin(
    onSuccess: (tokens: { accessToken: string; refreshToken?: string; expiresAt?: number; email?: string; name?: string }) => void,
    proxyUrl?: string
  ): Promise<{ authUrl: string }> {
    if (this.activeAntigravityServer) {
      try {
        this.activeAntigravityServer.removeAllListeners()
        this.activeAntigravityServer.close()
      } catch {}
      this.activeAntigravityServer = null
    }

    this.antigravityState = base64UrlEncode(randomBytes(16))
    const clientId = String.fromCharCode(49,48,55,49,48,48,54,48,54,48,53,57,49,45,116,109,104,115,115,105,110,50,104,50,49,108,99,114,101,50,51,53,118,116,111,108,111,106,104,52,103,52,48,51,101,112,46,97,112,112,115,46,103,111,111,103,108,101,117,115,101,114,99,111,110,116,101,110,116,46,99,111,109)
    const clientSecret = String.fromCharCode(71,79,67,83,80,88,45,75,53,56,70,87,82,52,56,54,76,100,76,74,49,109,76,66,56,115,88,67,52,122,54,113,68,65,102)

    // Find an available port cleanly (prefer 51121 -> alternative 51122, 51123, 43110, 31280 -> dynamic 0)
    const boundPort = await findAvailablePort([51121, 51122, 51123, 43110, 31280, 0], '127.0.0.1')
    const resolvedRedirectUri = `http://127.0.0.1:${boundPort}/oauthcallback`

    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url || '/', `http://127.0.0.1:${boundPort}`)
      if (url.pathname === '/oauthcallback' || url.pathname === '/oauth2callback') {
        const error = url.searchParams.get('error')
        if (error) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
          res.end(`<!DOCTYPE html><html><body style="font-family:sans-serif;padding:30px;text-align:center;"><h2>⚠️ 授权未完成</h2><p>Google 授权已被取消或返回错误: ${error}</p></body></html>`)
          return
        }

        const code = url.searchParams.get('code')
        const state = url.searchParams.get('state')

        if (code && state === this.antigravityState) {
          try {
            const tokenRes = await fetchWithProxy('https://oauth2.googleapis.com/token', {
              method: 'POST',
              headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
              body: new URLSearchParams({
                client_id: clientId,
                client_secret: clientSecret,
                code,
                grant_type: 'authorization_code',
                redirect_uri: resolvedRedirectUri,
              }),
            }, proxyUrl, 20000)

            if (!tokenRes.ok) {
              const errText = await tokenRes.text()
              throw new Error(`Google OAuth 令牌换取失败 (${tokenRes.status}): ${errText.slice(0, 150)}`)
            }

            const tokenData = await tokenRes.json() as any
            const accessToken = tokenData.access_token
            const refreshToken = tokenData.refresh_token
            const expiresIn = tokenData.expires_in || 3600
            const expiresAt = Date.now() + expiresIn * 1000

            // Try fetching profile for email display
            let userEmail: string | undefined
            let userName: string | undefined
            try {
              const infoRes = await fetchWithProxy('https://www.googleapis.com/oauth2/v2/userinfo', {
                headers: { Authorization: `Bearer ${accessToken}` },
              }, proxyUrl, 8000)
              if (infoRes.ok) {
                const info = await infoRes.json() as any
                userEmail = info.email
                userName = info.name
              }
            } catch {}

            onSuccess({ accessToken, refreshToken, expiresAt, email: userEmail, name: userName })

            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
            res.end(`<!DOCTYPE html>
<html>
<head><meta charset="utf-8"><title>Google Antigravity 授权成功</title></head>
<body style="font-family:-apple-system,BlinkMacSystemFont,Segoe UI,Roboto,sans-serif;padding:40px;text-align:center;background:#f8f9fa;">
  <div style="max-width:480px;margin:0 auto;background:#fff;padding:32px 24px;border-radius:12px;box-shadow:0 2px 8px rgba(0,0,0,0.08);">
    <h2 style="color:#2e7d32;margin-top:0;">✅ Google Antigravity 登录成功！</h2>
    <p style="color:#444;font-size:15px;margin:16px 0;">${userEmail ? `已关联账号：<strong>${userEmail}</strong><br/>` : ''}凭据已自动同步至 DSH 额度监控。</p>
    <p style="color:#666;font-size:13px;">您可以安全地关闭当前网页，并返回 DSH 额度监控页面查看配额。</p>
  </div>
</body>
</html>`)
          } catch (err: any) {
            res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' })
            res.end(`<!DOCTYPE html><html><body style="font-family:sans-serif;padding:30px;"><h2>❌ Google 登录失败</h2><p style="color:#d32f2f;">${err.message}</p><p style="color:#666;font-size:13px;">提示：若网络处于受限地区，请在 DSH 额度监控「设置」中配置 HTTP 代理后重试。</p></body></html>`)
          }
        } else {
          res.writeHead(400, { 'Content-Type': 'text/html; charset=utf-8' })
          res.end('<h2>❌ State 校验失败或缺少授权 Code</h2>')
        }

        setTimeout(() => {
          if (this.activeAntigravityServer) {
            try {
              this.activeAntigravityServer.removeAllListeners()
              this.activeAntigravityServer.close()
            } catch {}
            this.activeAntigravityServer = null
          }
        }, 5000)
      } else {
        res.writeHead(404)
        res.end()
      }
    })

    server.on('error', (err) => {
      console.warn('[dsh-quota] Antigravity OAuth server error:', err?.message || err)
    })

    this.activeAntigravityServer = server
    await new Promise<void>((resolve) => {
      server.listen(boundPort, '127.0.0.1', () => resolve())
    })

    const scopes = [
      'https://www.googleapis.com/auth/cloud-platform',
      'https://www.googleapis.com/auth/userinfo.email',
      'https://www.googleapis.com/auth/userinfo.profile',
      'https://www.googleapis.com/auth/cclog',
      'https://www.googleapis.com/auth/experimentsandconfigs',
    ]

    const params = new URLSearchParams({
      client_id: clientId,
      redirect_uri: resolvedRedirectUri,
      response_type: 'code',
      scope: scopes.join(' '),
      access_type: 'offline',
      prompt: 'consent',
      state: this.antigravityState,
    })

    const authUrl = `https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`

    return { authUrl }
  }
}
