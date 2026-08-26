import http from 'node:http'
import net from 'node:net'
import { randomBytes, createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync } from 'node:fs'
import { join } from 'node:path'
import { homedir, platform } from 'node:os'
import { DatabaseSync } from 'node:sqlite'

/**
 * Data structures for Quota tracking & Single Long Card UI
 * @version 0.1.0
 */

const PLUGIN_VERSION = '0.1.0'

                        
            
               
                   
                     
                          
                  
                                                                                     
 

                       
               
                       
                         
 

                        
            
              
                                                                       
                                              
               
                  
                
                       
                     
 

                       
                                                                                                
                                                                                       
                                                    
                                                                                       
                                                                                
            
                     
                             
                         
   
           
                     
                             
             
                          
                           
                        
                        
     
   
                 
                     
                             
             
                          
                           
                        
                    
                   
     
   
                 
                     
                   
                    
   
                                 
 

                          
                    
 

                          
              
                                                         
 

/**
 * Standardized reset text formatter across all providers:
 * - 100% remaining / 0% used: "已用 0% · 额度充足"
 * - Used > 0%: "已用 X% · 预计 5天3小时后重置 (8/31 15:36)"
 */
function formatQuotaResetText(resetInput                         , usedPercent = 0, isWeekly = false)         {
  if (usedPercent <= 0) return '已用 0% · 额度充足'
  
  const usedPrefix = `已用 ${usedPercent}%`
  if (!resetInput) return `${usedPrefix} · 周期重置`

  const resetDate = new Date(resetInput)
  if (isNaN(resetDate.getTime())) return `${usedPrefix} · 周期重置`

  const diffMs = resetDate.getTime() - Date.now()
  if (diffMs <= 0) return `${usedPrefix} · 即将重置`

  const totalMinutes = Math.ceil(diffMs / (60 * 1000))
  const days = Math.floor(totalMinutes / (24 * 60))
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60)
  const minutes = totalMinutes % 60

  const m = resetDate.getMonth() + 1
  const d = resetDate.getDate()
  const hh = String(resetDate.getHours()).padStart(2, '0')
  const mm = String(resetDate.getMinutes()).padStart(2, '0')
  
  const dateStr = `${m}/${d}`
  const timeStr = `${hh}:${mm}`
  const fullTimeStr = isWeekly || days > 0 ? `${dateStr} ${timeStr}` : timeStr

  let countdownStr = ''
  if (days > 0) {
    countdownStr = `${days} 天${hours > 0 ? ` ${hours} 小时` : ''}后`
  } else if (hours > 0) {
    countdownStr = `${hours} 小时${minutes > 0 ? ` ${minutes} 分钟` : ''}后`
  } else {
    countdownStr = `${minutes} 分钟后`
  }

  return `${usedPrefix} · 预计 ${countdownStr}重置 (${fullTimeStr})`
}





/**
 * Universal fetch with proxy support and timeout
 */
export async function fetchWithProxy(
  url        ,
  init                                     = {},
  proxyUrl         ,
  timeoutMs = 20000
)                    {
  const proxy = proxyUrl || process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.https_proxy || process.env.http_proxy
  
  let signal = init.signal
  if (!signal && typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal) {
    signal = (AbortSignal       ).timeout(timeoutMs)
  }

  if (!proxy) {
    return fetch(url, { ...init, signal })
  }

  try {
    const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh')
    const requireFromProfile = createRequire(join(dshHome, 'profiles', 'web', 'package.json'))
    const { ProxyAgent } = requireFromProfile('undici')
    const dispatcher = new ProxyAgent(proxy)
    return fetch(url, { ...init, signal, dispatcher }       )
  } catch {
    // If ProxyAgent fails to load, fallback to standard fetch
    return fetch(url, { ...init, signal })
  }
}






function base64UrlEncode(buffer        )         {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function sha256(str        )         {
  return createHash('sha256').update(str).digest()
}

/**
 * Safely find an open and available port on host without throwing or crashing
 */
async function findAvailablePort(preferredPorts          , host = '127.0.0.1')                  {
  for (const port of preferredPorts) {
    if (port === 0) continue
    const isAvailable = await new Promise         ((resolve) => {
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
  return new Promise        ((resolve, reject) => {
    const probe = net.createServer()
    probe.once('error', (err) => {
      probe.removeAllListeners()
      reject(err)
    })
    probe.listen(0, host, () => {
      const addr = probe.address()                   
      const port = addr.port
      probe.removeAllListeners()
      probe.close(() => resolve(port))
    })
  })
}

class OAuthManager {
          activeCodexServer                     = null
          activeAntigravityServer                     = null

          codexVerifier                = null
          codexState                = null

          antigravityState                = null

  // --- CODEX (ChatGPT OAuth) ---
  async startCodexLogin(
    onSuccess                                                                                                          ,
    proxyUrl         
  )                               {
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
                code_verifier: this.codexVerifier ,
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

            const tokenData = await tokenRes.json()       
            const accessToken = tokenData.access_token
            const refreshToken = tokenData.refresh_token
            const expiresIn = tokenData.expires_in || 3600
            const expiresAt = Date.now() + expiresIn * 1000

            let accountId                    
            try {
              const payload = JSON.parse(Buffer.from(accessToken.split('.')[1], 'base64').toString('utf8'))
              accountId = payload['https://api.openai.com/auth']?.account_id || payload.account_id
            } catch {}

            onSuccess({ accessToken, refreshToken, accountId, expiresAt })

            res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
            res.end('<!DOCTYPE html><html><body style="font-family:sans-serif;padding:40px;text-align:center;"><h2>✅ Codex 授权成功！</h2><p>凭据已自动同步至 DSH 额度监控，您可以关闭此网页并返回 DSH 页面。</p></body></html>')
          } catch (err     ) {
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
    await new Promise      ((resolve) => {
      server.listen(port, '127.0.0.1', () => resolve())
    })

    return { authUrl }
  }

  // --- ANTIGRAVITY (Google OAuth) ---
  async startAntigravityLogin(
    onSuccess                                                                                                                     ,
    proxyUrl         
  )                               {
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

            const tokenData = await tokenRes.json()       
            const accessToken = tokenData.access_token
            const refreshToken = tokenData.refresh_token
            const expiresIn = tokenData.expires_in || 3600
            const expiresAt = Date.now() + expiresIn * 1000

            // Try fetching profile for email display
            let userEmail                    
            let userName                    
            try {
              const infoRes = await fetchWithProxy('https://www.googleapis.com/oauth2/v2/userinfo', {
                headers: { Authorization: `Bearer ${accessToken}` },
              }, proxyUrl, 8000)
              if (infoRes.ok) {
                const info = await infoRes.json()       
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
          } catch (err     ) {
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
    await new Promise      ((resolve) => {
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



                       
                     
                
                
                         
 

class CursorProvider                           {
  name = 'cursor'

          databasePaths()           {
    const home = homedir()
    const paths           = []
    if (platform() === 'win32' && process.env.APPDATA) {
      paths.push(join(process.env.APPDATA, 'Cursor', 'User', 'globalStorage', 'state.vscdb'))
    } else if (platform() === 'darwin') {
      paths.push(join(home, 'Library', 'Application Support', 'Cursor', 'User', 'globalStorage', 'state.vscdb'))
    } else {
      paths.push(join(home, '.config', 'Cursor', 'User', 'globalStorage', 'state.vscdb'))
      paths.push('/mnt/c/Users/81017/AppData/Roaming/Cursor/User/globalStorage/state.vscdb')
      if (process.env.USERPROFILE) paths.push(join(process.env.USERPROFILE, 'AppData', 'Roaming', 'Cursor', 'User', 'globalStorage', 'state.vscdb'))
    }
    return [...new Set(paths)]
  }

          findLocalLogin()                     {
    for (const path of this.databasePaths()) {
      if (!existsSync(path)) continue
      try {
        const db = new DatabaseSync(path, { readOnly: true })
        const rows = db.prepare("SELECT key, value FROM ItemTable WHERE key LIKE 'cursorAuth/%'").all()                                         
        db.close()
        const values = Object.fromEntries(rows.map(row => [row.key, row.value]))
        const accessToken = values['cursorAuth/accessToken']?.trim()
        const userId = values['cursorAuth/stripeMembershipAuthId']?.trim()
        if (accessToken && userId) {
          return {
            accessToken,
            userId,
            email: values['cursorAuth/cachedEmail'],
            membershipType: values['cursorAuth/stripeMembershipType'],
          }
        }
      } catch {}
    }
    return null
  }

  async fetchCard(config             )                          {
    let cookie = ''
    let email                    
    let membershipType                    

    if (config.cursor?.sessionToken?.trim()) {
      const tokenInput = config.cursor.sessionToken.trim()
      cookie = tokenInput.startsWith('WorkosCursorSessionToken=') ? tokenInput : `WorkosCursorSessionToken=${tokenInput}`
    } else {
      const login = this.findLocalLogin()
      if (login) {
        cookie = `WorkosCursorSessionToken=${login.userId}::${login.accessToken}`
        email = login.email
        membershipType = login.membershipType
      }
    }

    if (!cookie) {
      return {
        card: {
          id: 'cursor',
          name: 'Cursor',
          provider: 'cursor',
          status: 'disabled',
          error: '未连接 Cursor。请点击「连接 Cursor」自动读取本地登录，或在设置中手动填入 Session',
          groups: [],
          lastUpdated: Date.now(),
        },
      }
    }

    try {
      const headers = { Cookie: cookie, Accept: 'application/json', 'User-Agent': 'Mozilla/5.0' }
      const [usageRes, stripeRes] = await Promise.all([
        fetch('https://cursor.com/api/usage-summary', { headers }),
        fetch('https://cursor.com/api/auth/stripe', { headers }),
      ])
      if (!usageRes.ok) throw new Error(`Cursor 登录态失效或接口错误 (${usageRes.status})`)
      const data = await usageRes.json()       
      const stripe = stripeRes.ok ? await stripeRes.json()        : {}
      const plan = data.individualUsage?.plan
      if (!plan?.enabled) throw new Error('Cursor 当前账户未返回可用订阅额度')

      // Exact values matching Cursor's official dashboard:
      // 1. autoPercentUsed (e.g. 49% used -> "Cursor Models · Includes Cursor Grok and Composer")
      // 2. apiPercentUsed / totalPercentUsed (e.g. 65% used -> "Other Models")
      const autoPercent = Math.max(0, Math.min(100, Math.round(plan.autoPercentUsed ?? plan.totalPercentUsed ?? 0)))
      const apiPercent = Math.max(0, Math.min(100, Math.round(plan.apiPercentUsed ?? 0)))
      const autoRemaining = Math.max(0, 100 - autoPercent)
      const apiRemaining = Math.max(0, 100 - apiPercent)

      let resetTimestamp                    
      if (stripe?.currentPeriodEnd) {
        resetTimestamp = stripe.currentPeriodEnd * 1000
      } else if (data?.startOfMonth) {
        const d = new Date()
        d.setMonth(d.getMonth() + 1, 1)
        d.setHours(0, 0, 0, 0)
        resetTimestamp = d.getTime()
      }

      const autoSubtitle = resetTimestamp
        ? formatQuotaResetText(resetTimestamp, autoPercent, true)
        : (autoRemaining < 100 ? `已用 ${autoPercent}% · 包含 Composer / Grok` : '已用 0% · 额度充足')

      const apiSubtitle = apiRemaining < 100
        ? `已用 ${apiPercent}% · 包含 $20 API 用量`
        : '已用 0% · 额度充足'

      return {
        card: {
          id: 'cursor',
          name: 'Cursor',
          provider: 'cursor',
          status: autoRemaining <= 15 ? 'warn' : 'ok',
          plan: (stripe.membershipType ?? data.membershipType ?? membershipType ?? 'Cursor').toUpperCase(),
          account: email || stripe.paymentId,
          groups: [
            {
              title: 'Cursor Plan Usage',
              windows: [
                {
                  id: 'cursor-auto',
                  label: 'Fast Requests (Cursor 核心模型)',
                  subtitle: autoSubtitle,
                  usedPercent: autoPercent,
                  remainingPercent: autoRemaining,
                  barType: 'circle',
                },
                {
                  id: 'cursor-named',
                  label: 'Other Models (其他通用模型)',
                  subtitle: apiSubtitle,
                  usedPercent: apiPercent,
                  remainingPercent: apiRemaining,
                  barType: 'circle',
                },
              ],
            },
          ],
          lastUpdated: Date.now(),
        },
      }
    } catch (err     ) {
      return {
        card: {
          id: 'cursor',
          name: 'Cursor',
          provider: 'cursor',
          status: 'error',
          plan: '已连接',
          account: email,
          error: err.message,
          groups: [],
          lastUpdated: Date.now(),
        },
      }
    }
  }
}



                     
                    
            
                         
                          
                       
   
 

                       
                       
                   
                               
 

                      
                    
                
                                                                               
                                                           
                                                                            
 

class CodexProvider                           {
  name = 'codex'

          authPaths()           {
    const home = homedir()
    const paths = [
      process.env.CODEX_HOME ? join(process.env.CODEX_HOME, 'auth.json') : '',
      join(home, '.config', 'codex', 'auth.json'),
      join(home, '.codex', 'auth.json'),
    ].filter(Boolean)
    for (const user of ['/mnt/c/Users/81017', process.env.USERPROFILE ?? '']) {
      if (user) paths.push(join(user, '.codex', 'auth.json'))
    }
    return [...new Set(paths)]
  }

          loadAuth(config             )                                                                     {
    const localCandidates                                                                                         = []

    if (config.codex?.autoDetectLocal !== false) {
      for (const path of this.authPaths()) {
        if (!existsSync(path)) continue
        try {
          const auth = JSON.parse(readFileSync(path, 'utf8'))             
          if (auth.tokens?.access_token) {
            localCandidates.push({
              accessToken: auth.tokens.access_token,
              accountId: auth.tokens.account_id,
              source: path,
              modifiedAt: statSync(path).mtimeMs,
            })
          }
        } catch {}
      }
    }

    if (localCandidates.length > 0) {
      localCandidates.sort((a, b) => b.modifiedAt - a.modifiedAt)
      const { modifiedAt: _modifiedAt, ...auth } = localCandidates[0]
      return auth
    }

    if (config.codex?.oauth?.accessToken) {
      return {
        accessToken: config.codex.oauth.accessToken,
        accountId: config.codex.oauth.accountId,
        source: '旧版 DSH OAuth 登录',
      }
    }

    return null
  }

          async fetchCodexUsage(url        , headers     , proxyUrl         )                    {
    const proxy = proxyUrl || process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.https_proxy || process.env.http_proxy
    if (!proxy) return fetch(url, { headers })

    const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh')
    const requireFromProfile = createRequire(join(dshHome, 'profiles', 'web', 'package.json'))
    const { ProxyAgent } = requireFromProfile('undici')
    const dispatcher = new ProxyAgent(proxy)
    return fetch(url, { headers, dispatcher }       )
  }

  async fetchCard(config             )                          {
    const creds = this.loadAuth(config)
    if (!creds) {
      return {
        card: {
          id: 'codex',
          name: 'Codex (OpenAI)',
          provider: 'codex',
          status: 'disabled',
          error: '未连接 Codex。请点击「登录 Codex」通过网页登录，或在「设置」中配置代理/Token',
          groups: [],
          lastUpdated: Date.now(),
        },
      }
    }

    try {
      const headers                         = {
        Authorization: `Bearer ${creds.accessToken}`,
        Accept: 'application/json',
        'User-Agent': 'codex-cli',
      }
      if (creds.accountId) headers['ChatGPT-Account-Id'] = creds.accountId
      const res = await this.fetchCodexUsage('https://chatgpt.com/backend-api/wham/usage', headers, config.httpProxy)
      if (!res.ok) {
        const cloudflare = res.status === 403 && (res.headers.get('content-type') ?? '').includes('text/html')
        throw new Error(cloudflare
          ? '已读取 Codex 登录态，但直连访问 ChatGPT 额度接口被拦截；请在设置中配置可用的 HTTP 代理'
          : `Codex 登录态失效或额度接口错误 (${res.status})`)
      }

      const data = await res.json()              
      const plan = (data.plan_type ?? 'Codex').toUpperCase()

      // OpenAI Codex rate_limit: primary_window is 604800s (Weekly) or secondary_window
      const rateLimit = data.rate_limit || {}
      const window = rateLimit.secondary_window || rateLimit.primary_window
      const usedPercent = Math.max(0, Math.min(100, Math.round(window?.used_percent ?? 0)))
      const remainingPercent = Math.max(0, 100 - usedPercent)
      const resetAt = window?.reset_at ? new Date(window.reset_at * 1000).toISOString() : undefined

      return {
        card: {
          id: 'codex',
          name: 'Codex (OpenAI)',
          provider: 'codex',
          status: remainingPercent <= 10 ? 'warn' : 'ok',
          plan,
          account: data.email || creds.source,
          groups: [
            {
              title: 'Codex 额度',
              hasInfoIcon: true,
              windows: [
                {
                  id: 'codex-weekly',
                  label: 'Weekly Limit (周配额)',
                  subtitle: formatQuotaResetText(resetAt, usedPercent, true),
                  usedPercent,
                  remainingPercent,
                  resetAt,
                  barType: 'circle',
                },
              ],
            },
          ],
          lastUpdated: Date.now(),
        },
      }
    } catch (err     ) {
      return {
        card: {
          id: 'codex',
          name: 'Codex (OpenAI)',
          provider: 'codex',
          status: 'error',
          plan: '已连接',
          account: creds.source,
          error: err.message,
          groups: [],
          lastUpdated: Date.now(),
        },
      }
    }
  }
}



                          
                      
                       
                 
                
               
 

function readVarint(data        , start        )                                  {
  let value = 0, shift = 0, index = start
  while (index < data.length) {
    const byte = data[index++] 
    value += (byte & 0x7f) * (2 ** shift)
    if ((byte & 0x80) === 0) return { value, next: index }
    shift += 7
  }
  throw new Error('invalid protobuf varint')
}

function lengthFields(data        )                        {
  const fields = new Map                  ()
  let index = 0
  while (index < data.length) {
    const tag = readVarint(data, index); index = tag.next
    const field = tag.value >> 3, wire = tag.value & 7
    if (wire === 2) {
      const length = readVarint(data, index); index = length.next
      const value = data.subarray(index, index + length.value); index += length.value
      const list = fields.get(field) ?? []; list.push(value); fields.set(field, list)
    } else if (wire === 0) {
      const value = readVarint(data, index); index = value.next
      const b = Buffer.allocUnsafe(8); b.writeBigUInt64LE(BigInt(value.value)); fields.set(field, [b])
    } else if (wire === 1) index += 8
    else if (wire === 5) index += 4
    else throw new Error(`unsupported protobuf wire type ${wire}`)
  }
  return fields
}

function decodeUnifiedOAuth(value        )                        {
  if (!value) return null
  // JSON format fallback
  try {
    if (value.trim().startsWith('{')) {
      const parsed = JSON.parse(value)
      const accessToken = parsed.access_token || parsed.accessToken
      const refreshToken = parsed.refresh_token || parsed.refreshToken
      const expiry = parsed.expiry || (parsed.expires_at ? Math.floor(parsed.expires_at / 1000) : undefined)
      if (accessToken || refreshToken) {
        return { accessToken, refreshToken, expiry, email: parsed.email, name: parsed.name }
      }
    }
  } catch {}

  // Protobuf format
  try {
    const outer = lengthFields(Buffer.from(value, 'base64'))
    const wrapper = lengthFields(outer.get(1)?.[0] ?? Buffer.alloc(0))
    const sentinel = wrapper.get(1)?.[0]?.toString('utf8')
    if (sentinel !== 'oauthTokenInfoSentinelKey') return null
    const payload = lengthFields(wrapper.get(2)?.[0] ?? Buffer.alloc(0))
    const encoded = payload.get(1)?.[0]?.toString('utf8')
    if (!encoded) return null
    const token = lengthFields(Buffer.from(encoded, 'base64'))
    const accessToken = token.get(1)?.[0]?.toString('utf8')
    const refreshToken = token.get(3)?.[0]?.toString('utf8')
    const timestamp = token.get(4)?.[0] ? lengthFields(token.get(4) [0] ) : undefined
    const expiryBuffer = timestamp?.get(1)?.[0]
    const expiry = expiryBuffer ? Number(expiryBuffer.readBigUInt64LE()) : undefined
    return { accessToken, refreshToken, expiry }
  } catch { return null }
}

function formatRelativeCountdown(resetIso                    , isWeekly         )         {
  if (!resetIso) return isWeekly ? '已使用部分每周额度' : '已使用部分 5 小时额度'
  const resetDate = new Date(resetIso)
  const diffMs = resetDate.getTime() - Date.now()
  if (diffMs <= 0) return '额度已完全重置'

  const totalMinutes = Math.ceil(diffMs / (60 * 1000))
  const days = Math.floor(totalMinutes / (24 * 60))
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60)
  const minutes = totalMinutes % 60

  const timeStr = resetDate.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit', hour12: false })
  const dateStr = resetDate.toLocaleDateString('zh-CN', { month: 'numeric', day: 'numeric' })

  if (isWeekly) {
    if (days > 0) {
      return `预计 ${days} 天${hours > 0 ? ` ${hours} 小时` : ''}后重置 (${dateStr} ${timeStr})`
    }
    return `预计 ${hours} 小时${minutes > 0 ? ` ${minutes} 分钟` : ''}后重置 (${timeStr})`
  }

  if (hours > 0) {
    return `预计 ${hours} 小时${minutes > 0 ? ` ${minutes} 分钟` : ''}后重置 (${timeStr})`
  }
  return `预计 ${minutes} 分钟后重置 (${timeStr})`
}

class AntigravityProvider                           {
  name = 'antigravity'

          databasePaths()           {
    const home = homedir()
    const paths           = []
    const appNames = ['Antigravity IDE', 'Antigravity', 'Google Antigravity', 'antigravity', 'Antigravity - Insiders']

    if (platform() === 'darwin') {
      for (const name of appNames) {
        paths.push(join(home, 'Library', 'Application Support', name, 'User', 'globalStorage', 'state.vscdb'))
      }
    } else if (platform() === 'win32' && process.env.APPDATA) {
      for (const name of appNames) {
        paths.push(join(process.env.APPDATA, name, 'User', 'globalStorage', 'state.vscdb'))
      }
    } else {
      for (const name of appNames) {
        paths.push(join(home, '.config', name, 'User', 'globalStorage', 'state.vscdb'))
      }
      for (const base of ['/mnt/c/Users/81017/AppData/Roaming', process.env.USERPROFILE ? join(process.env.USERPROFILE, 'AppData', 'Roaming') : '']) {
        if (!base) continue
        for (const name of appNames) {
          paths.push(join(base, name, 'User', 'globalStorage', 'state.vscdb'))
        }
      }
    }
    return [...new Set(paths)]
  }

          loadToken(config             )                        {
    if (config.antigravity?.oauth?.accessToken || config.antigravity?.oauth?.refreshToken) {
      return {
        accessToken: config.antigravity.oauth.accessToken,
        refreshToken: config.antigravity.oauth.refreshToken,
        expiry: config.antigravity.oauth.expiresAt ? Math.floor(config.antigravity.oauth.expiresAt / 1000) : undefined,
        email: config.antigravity.oauth.email,
        name: config.antigravity.oauth.name,
      }
    }

    if (config.antigravity?.autoDetectLocal !== false) {
      for (const path of this.databasePaths()) {
        if (!existsSync(path)) continue
        try {
          const db = new DatabaseSync(path, { readOnly: true })
          const rows = db.prepare("SELECT key, value FROM ItemTable WHERE key = 'antigravityUnifiedStateSync.oauthToken' OR key LIKE '%antigravity%oauth%' OR key LIKE '%oauthToken%'").all()                                         
          db.close()
          for (const row of rows) {
            if (row?.value) {
              const token = decodeUnifiedOAuth(row.value)
              if (token?.accessToken || token?.refreshToken) return token
            }
          }
        } catch {}
      }
    }
    return null
  }

          async activeToken(token                , config             )                  {
    if (token.accessToken && (!token.expiry || token.expiry * 1000 > Date.now() + 60_000)) {
      return token.accessToken
    }

    if (!token.refreshToken) {
      if (token.accessToken) return token.accessToken
      throw new Error('Antigravity 登录 Token 已过期，且没有可用 Refresh Token')
    }

    const body = new URLSearchParams({
      client_id: String.fromCharCode(49,48,55,49,48,48,54,48,54,48,53,57,49,45,116,109,104,115,115,105,110,50,104,50,49,108,99,114,101,50,51,53,118,116,111,108,111,106,104,52,103,52,48,51,101,112,46,97,112,112,115,46,103,111,111,103,108,101,117,115,101,114,99,111,110,116,101,110,116,46,99,111,109),
      client_secret: String.fromCharCode(71,79,67,83,80,88,45,75,53,56,70,87,82,52,56,54,76,100,76,74,49,109,76,66,56,115,88,67,52,122,54,113,68,65,102),
      refresh_token: token.refreshToken,
      grant_type: 'refresh_token',
    })

    const res = await fetchWithProxy('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body,
    }, config.httpProxy, 15000)

    if (!res.ok) {
      const errText = await res.text()
      throw new Error(`Antigravity 令牌刷新失败 (${res.status}): ${errText.slice(0, 100)}`)
    }

    const data = await res.json()                                                  
    if (!data.access_token) throw new Error('Antigravity 登录刷新未返回 access_token')

    const newAccessToken = data.access_token
    const expiresIn = data.expires_in || 3600
    const expiresAt = Date.now() + expiresIn * 1000

    token.accessToken = newAccessToken
    token.expiry = Math.floor(expiresAt / 1000)

    if (config.antigravity?.oauth) {
      config.antigravity.oauth.accessToken = newAccessToken
      config.antigravity.oauth.expiresAt = expiresAt
    }

    return newAccessToken
  }

  async fetchCard(config             )                          {
    const tokenInfo = this.loadToken(config)
    if (!tokenInfo) {
      return {
        card: {
          id: 'antigravity',
          name: 'Google Antigravity',
          provider: 'antigravity',
          status: 'disabled',
          error: '未连接 Antigravity。请点击「登录 Google」完成网页授权，或启动 Antigravity IDE 登录',
          groups: [],
          lastUpdated: Date.now(),
        },
      }
    }

    try {
      const accessToken = await this.activeToken(tokenInfo, config)

      // Try fetching profile if email is not known
      let accountEmail = tokenInfo.email || config.antigravity?.oauth?.email
      if (!accountEmail) {
        try {
          const infoRes = await fetchWithProxy('https://www.googleapis.com/oauth2/v2/userinfo', {
            headers: { Authorization: `Bearer ${accessToken}` },
          }, config.httpProxy, 8000)
          if (infoRes.ok) {
            const info = await infoRes.json()       
            accountEmail = info.email
            if (config.antigravity?.oauth) {
              config.antigravity.oauth.email = info.email
              config.antigravity.oauth.name = info.name
            }
          }
        } catch {}
      }

      const summaryEndpoints = [
        'https://daily-cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary',
        'https://cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary',
      ]

      let summaryData      = null
      let lastFetchErr = ''

      for (const endpoint of summaryEndpoints) {
        try {
          const res = await fetchWithProxy(endpoint, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
              'User-Agent': 'antigravity',
              'X-Goog-Api-Client': 'antigravity',
            },
            body: '{}',
          }, config.httpProxy, 15000)

          if (res.ok) {
            summaryData = await res.json()
            break
          } else {
            lastFetchErr = `HTTP ${res.status}`
          }
        } catch (e     ) {
          lastFetchErr = e.message
        }
      }

      const groups                = []

      if (summaryData?.groups && Array.isArray(summaryData.groups)) {
        for (const g of summaryData.groups) {
          const windows                 = []
          for (const b of (g.buckets || [])) {
            const frac = b.remainingFraction ?? 1.0
            const rem = Math.max(0, Math.min(100, Math.round(frac * 100)))
            const isWeekly = b.window === 'WINDOW_WEEKLY' || (b.displayName && b.displayName.toLowerCase().includes('weekly'))
            const subtitle = formatQuotaResetText(b.resetTime, 100 - rem, Boolean(isWeekly))

            windows.push({
              id: b.bucketId || b.displayName,
              label: isWeekly ? 'Weekly Limit (周配额)' : '5-Hour Limit (5小时滚动配额)',
              subtitle,
              usedPercent: 100 - rem,
              remainingPercent: rem,
              resetAt: b.resetTime,
              barType: 'circle',
            })
          }
          if (windows.length > 0) {
            groups.push({
              title: g.displayName || 'Model Quotas',
              hasInfoIcon: true,
              windows,
            })
          }
        }
      }

      // Fallback endpoint
      if (groups.length === 0) {
        const modelEndpoints = [
          'https://daily-cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels',
          'https://cloudcode-pa.googleapis.com/v1internal:fetchAvailableModels',
        ]
        let modelData      = null
        for (const endpoint of modelEndpoints) {
          try {
            const res = await fetchWithProxy(endpoint, {
              method: 'POST',
              headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
                'User-Agent': 'antigravity',
                'X-Goog-Api-Client': 'antigravity',
              },
              body: '{}',
            }, config.httpProxy, 15000)
            if (res.ok) {
              modelData = await res.json()
              break
            }
          } catch {}
        }

        if (modelData?.models) {
          const geminiWindows                 = []
          const claudeGptWindows                 = []

          for (const [id, model] of Object.entries(modelData.models)                        ) {
            const quota = model?.quotaInfo
            if (typeof quota?.remainingFraction !== 'number') continue
            const rem = Math.max(0, Math.min(100, Math.round(quota.remainingFraction * 100)))
            const isWeekly = id.toLowerCase().includes('weekly') || (model.displayName && model.displayName.toLowerCase().includes('weekly'))
            const is5Hour = id.toLowerCase().includes('five') || id.toLowerCase().includes('5hour') || (model.displayName && model.displayName.toLowerCase().includes('five'))
            const cleanLabel = isWeekly ? 'Weekly Limit (周配额)' : is5Hour ? '5-Hour Limit (5小时滚动配额)' : (model.displayName || id)
            const subtitle = formatQuotaResetText(quota.resetTime, 100 - rem, Boolean(isWeekly))
            const item               = {
              id,
              label: cleanLabel,
              subtitle,
              usedPercent: 100 - rem,
              remainingPercent: rem,
              resetAt: quota.resetTime,
              barType: 'circle',
            }
            if (id.toLowerCase().includes('gemini')) {
              geminiWindows.push(item)
            } else {
              claudeGptWindows.push(item)
            }
          }

          if (geminiWindows.length > 0) groups.push({ title: 'Gemini Models', hasInfoIcon: true, windows: geminiWindows })
          if (claudeGptWindows.length > 0) groups.push({ title: 'Claude and GPT models', hasInfoIcon: true, windows: claudeGptWindows })
        }
      }

      if (groups.length === 0 && lastFetchErr) {
        throw new Error(`无法获取额度明细 (${lastFetchErr})。若处于受限网络，请在设置中配置 HTTP 代理。`)
      }

      return {
        card: {
          id: 'antigravity',
          name: 'Google Antigravity',
          provider: 'antigravity',
          status: 'ok',
          plan: 'Antigravity Pro',
          account: accountEmail,
          groups,
          lastUpdated: Date.now(),
        },
      }
    } catch (err     ) {
      return {
        card: {
          id: 'antigravity',
          name: 'Google Antigravity',
          provider: 'antigravity',
          status: 'error',
          plan: '已连接',
          account: tokenInfo.email || config.antigravity?.oauth?.email,
          error: err.message,
          groups: [],
          lastUpdated: Date.now(),
        },
      }
    }
  }
}



class OpenCodeGoProvider                           {
  name = 'opencode_go'

  async fetchCard(config             )                          {
    if (config.opencode_go?.enabled === false) {
      return {
        card: {
          id: 'opencode_go',
          name: 'OpenCode Go',
          provider: 'opencode_go',
          status: 'disabled',
          groups: [],
          lastUpdated: Date.now(),
        },
      }
    }

    const apiKey = config.opencode_go?.apiKey?.trim()
    const baseUrl = (config.opencode_go?.baseUrl?.trim() || 'https://opencode.ai').replace(/\/+$/, '')

    if (!apiKey) {
      return {
        card: {
          id: 'opencode_go',
          name: 'OpenCode Go',
          provider: 'opencode_go',
          status: 'disabled',
          error: '未配置 API Key。请在「设置」中填入 OpenCode Go Key',
          groups: [],
          lastUpdated: Date.now(),
        },
      }
    }

    try {
      // Official OpenCode Go usage API endpoint
      const url = `${baseUrl}/zen/go/v1/usage`
      const res = await fetchWithProxy(url, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Accept': 'application/json',
          'User-Agent': 'Mozilla/5.0',
        },
      }, config.httpProxy)

      if (!res.ok) {
        const text = await res.text()
        throw new Error(`API 错误 (${res.status}): ${text.slice(0, 80)}`)
      }

      const data = await res.json()       
      const usage = data.usage || {}

      const windows = []
      if (usage.rolling) {
        const used = Math.max(0, Math.min(100, Math.round(usage.rolling.percent ?? 0)))
        const rem = 100 - used
        const resetAt = usage.rolling.resetsAt
        windows.push({
          id: 'opencode-rolling',
          label: '5-Hour Rolling Limit (5小时额度)',
          subtitle: formatQuotaResetText(resetAt, used, false),
          usedPercent: used,
          remainingPercent: rem,
          resetAt,
          barType: 'circle'         ,
        })
      }

      if (usage.weekly) {
        const used = Math.max(0, Math.min(100, Math.round(usage.weekly.percent ?? 0)))
        const rem = 100 - used
        const resetAt = usage.weekly.resetsAt
        windows.push({
          id: 'opencode-weekly',
          label: 'Weekly Limit (周配额)',
          subtitle: formatQuotaResetText(resetAt, used, true),
          usedPercent: used,
          remainingPercent: rem,
          resetAt,
          barType: 'circle'         ,
        })
      }

      if (usage.monthly) {
        const used = Math.max(0, Math.min(100, Math.round(usage.monthly.percent ?? 0)))
        const rem = 100 - used
        const resetAt = usage.monthly.resetsAt
        windows.push({
          id: 'opencode-monthly',
          label: 'Monthly Limit (月配额)',
          subtitle: formatQuotaResetText(resetAt, used, true),
          usedPercent: used,
          remainingPercent: rem,
          resetAt,
          barType: 'circle'         ,
        })
      }

      return {
        card: {
          id: 'opencode_go',
          name: 'OpenCode Go',
          provider: 'opencode_go',
          status: 'ok',
          plan: 'Go Plan',
          groups: [
            {
              title: 'OpenCode Go Plan Limits',
              hasInfoIcon: true,
              windows,
            },
          ],
          lastUpdated: Date.now(),
        },
      }
    } catch (err     ) {
      return {
        card: {
          id: 'opencode_go',
          name: 'OpenCode Go',
          provider: 'opencode_go',
          status: 'error',
          error: err.message,
          groups: [],
          lastUpdated: Date.now(),
        },
      }
    }
  }
}



const DEFAULT_PROVIDER_ORDER = ['antigravity', 'cursor', 'codex', 'opencode_go']

class QuotaManager {
          providers                   = [
    new AntigravityProvider(),
    new CodexProvider(),
    new CursorProvider(),
    new OpenCodeGoProvider(),
  ]

         oauthManager = new OAuthManager()
          cachedCards                 = []
          lastFetchTime = 0
          configPath        
          config              = {}

  constructor() {
    const home = homedir()
    const dshDir = join(home, '.dsh')
    if (!existsSync(dshDir)) {
      try {
        mkdirSync(dshDir, { recursive: true })
      } catch {}
    }
    this.configPath = join(dshDir, 'quota-config.json')
    this.loadConfig()
  }

  loadConfig()              {
    try {
      if (existsSync(this.configPath)) {
        const raw = readFileSync(this.configPath, 'utf8')
        this.config = JSON.parse(raw)
        if (!this.config.enabledProviders) {
          this.config.enabledProviders = DEFAULT_PROVIDER_ORDER.filter(p => (this.config       )[p]?.enabled !== false)
        }
        if (!this.config.providerOrder) {
          this.config.providerOrder = DEFAULT_PROVIDER_ORDER
        }
      } else {
        this.config = {
          cursor: { enabled: true, autoDetectLocal: true },
          codex: { enabled: true, autoDetectLocal: true },
          antigravity: { enabled: true, autoDetectLocal: true },
          opencode_go: { enabled: true },
          enabledProviders: ['antigravity', 'cursor', 'codex', 'opencode_go'],
          providerOrder: DEFAULT_PROVIDER_ORDER,
          showFloatingHud: true,
          refreshIntervalMinutes: 10,
        }
        this.saveConfig(this.config)
      }
    } catch {
      this.config = {
        cursor: { enabled: true, autoDetectLocal: true },
        codex: { enabled: true, autoDetectLocal: true },
        antigravity: { enabled: true, autoDetectLocal: true },
        opencode_go: { enabled: true },
        enabledProviders: ['antigravity', 'cursor', 'codex', 'opencode_go'],
        providerOrder: DEFAULT_PROVIDER_ORDER,
        showFloatingHud: true,
        refreshIntervalMinutes: 10,
      }
    }
    return this.config
  }

  saveConfig(newConfig             )       {
    const current = this.config || {}
    const merged              = {
      ...current,
      ...newConfig,
      cursor: { ...current.cursor, ...newConfig.cursor },
      codex: { ...current.codex, ...newConfig.codex },
      antigravity: { ...current.antigravity, ...newConfig.antigravity },
      opencode_go: { ...current.opencode_go, ...newConfig.opencode_go },
    }

    if (newConfig.enabledProviders) {
      const enabled = new Set(newConfig.enabledProviders)
      for (const p of DEFAULT_PROVIDER_ORDER) {
        const providerConfig = (merged       )[p] || {}
        ;(merged       )[p] = { ...providerConfig, enabled: enabled.has(p) }
      }
    }

    this.config = merged
    this.cachedCards = []
    try {
      writeFileSync(this.configPath, JSON.stringify(this.config, null, 2), { encoding: 'utf8', mode: 0o600 })
    } catch {}
  }

  saveCodexLogin(tokens                                                                    )       {
    const codexDir = join(homedir(), '.codex')
    const authPath = join(codexDir, 'auth.json')
    try {
      mkdirSync(codexDir, { recursive: true })
      let auth                                                                      = {}
      if (existsSync(authPath)) {
        auth = JSON.parse(readFileSync(authPath, 'utf8'))
      }
      auth.auth_mode = 'chatgpt'
      auth.tokens = {
        ...auth.tokens,
        access_token: tokens.accessToken,
        ...(tokens.refreshToken ? { refresh_token: tokens.refreshToken } : {}),
        ...(tokens.accountId ? { account_id: tokens.accountId } : {}),
      }
      writeFileSync(authPath, JSON.stringify(auth, null, 2), { encoding: 'utf8', mode: 0o600 })
    } catch {}
  }

  getConfig()              {
    return this.config
  }

          sortAndFilterCards(cards                )                 {
    const enabledSet = new Set(this.config.enabledProviders ?? DEFAULT_PROVIDER_ORDER)
    const orderList = this.config.providerOrder ?? DEFAULT_PROVIDER_ORDER

    // Filter enabled
    const filtered = cards.filter(c => {
      if (!enabledSet.has(c.provider)) return false
      const provCfg = (this.config       )[c.provider]
      if (provCfg && provCfg.enabled === false) return false
      return true
    })

    // Sort by orderList
    return filtered.sort((a, b) => {
      const idxA = orderList.indexOf(a.provider)
      const idxB = orderList.indexOf(b.provider)
      const weightA = idxA === -1 ? 999 : idxA
      const weightB = idxB === -1 ? 999 : idxB
      return weightA - weightB
    })
  }

  async getQuotaCards(forceRefresh = false)                                                                                    {
    const ttl = (this.config.refreshIntervalMinutes ?? 10) * 60 * 1000
    const now = Date.now()

    if (!forceRefresh && this.cachedCards.length > 0 && (now - this.lastFetchTime) < ttl) {
      return {
        cards: this.sortAndFilterCards(this.cachedCards),
        allCards: this.cachedCards,
        lastUpdated: this.lastFetchTime,
      }
    }

    const results = await Promise.allSettled(
      this.providers.map(p => p.fetchCard(this.config))
    )

    const allCards                 = []
    for (const r of results) {
      if (r.status === 'fulfilled') {
        allCards.push(r.value.card)
      }
    }

    this.cachedCards = allCards
    this.lastFetchTime = now

    return {
      cards: this.sortAndFilterCards(allCards),
      allCards,
      lastUpdated: this.lastFetchTime,
    }
  }

  async refreshSingleProvider(providerName        )                                    {
    const provider = this.providers.find(p => p.name === providerName)
    if (!provider) return undefined

    try {
      const result = await provider.fetchCard(this.config)
      const idx = this.cachedCards.findIndex(c => c.provider === providerName)
      if (idx !== -1) {
        this.cachedCards[idx] = result.card
      } else {
        this.cachedCards.push(result.card)
      }
      return result.card
    } catch {
      return undefined
    }
  }
}



                 
               
              
                                                   
 

function makeQuotaRoutes(manager              )          {
  return [
    {
      kind: 'exact',
      path: '/api/dsh-quota/status',
      async handler(req     , res     ) {
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
        } catch (err     ) {
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: err.message }))
        }
      },
    },
    {
      kind: 'exact',
      path: '/api/dsh-quota/refresh-single',
      async handler(req     , res     ) {
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
        } catch (err     ) {
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: err.message }))
        }
      },
    },
    {
      kind: 'exact',
      path: '/api/dsh-quota/config',
      async handler(req     , res     ) {
        if (req.method === 'GET') {
          try {
            const cfg = manager.getConfig()
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify(cfg))
          } catch (err     ) {
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
        } catch (err     ) {
          res.writeHead(400, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: err.message }))
        }
      },
    },
    {
      kind: 'exact',
      path: '/api/dsh-quota/auth/codex/start',
      async handler(req     , res     ) {
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
        } catch (err     ) {
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: err.message }))
        }
      },
    },
    {
      kind: 'exact',
      path: '/api/dsh-quota/auth/antigravity/start',
      async handler(req     , res     ) {
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
        } catch (err     ) {
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: err.message }))
        }
      },
    },
    {
      kind: 'exact',
      path: '/api/dsh-quota/auth/cursor/connect',
      async handler(req     , res     ) {
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
        } catch (err     ) {
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: err.message }))
        }
      },
    },
  ]
}

/**
 * Host loader entry for dsh-quota plugin.
 * @package dsh-quota
 * @version 0.1.0
 */


const VERSION = '0.1.0'
const inject = ['systemPrompt', 'webServer']

const GUIDANCE = '本机已安装 dsh-quota 插件（DSH AI 额度与用量监控）：侧边栏「额度监控」入口。能力：集中监控并展示 Codex、Cursor、Google Antigravity、OpenCode-Go 等服务的实时剩余额度、用量及到期重置周期；支持从本地 Cursor 数据库自动读取凭据，或在界面中配置 API Key。用户提到「额度 / 余额 / quota / Token 剩余 / Cursor 额度 / Codex 额度 / 用量」时即指本插件，请据此协作。'

function apply(ctx         )       {
  const manager = new QuotaManager()
  
  // Register routes
  ctx.effect(() => {
    const routes = makeQuotaRoutes(manager)
    const disposers                    = []
    for (const r of routes) {
      disposers.push(ctx.webServer.register(r))
    }
    return () => {
      for (const d of disposers) d()
    }
  }, 'quota: routes')

  // Register system prompt guidance
  ctx.effect(() => {
    return ctx.systemPrompt.section({
      name: 'plugin:quota-monitor',
      order: 210,
      text: GUIDANCE,
    })
  }, 'quota: system prompt')
}

export { inject, apply, VERSION, PLUGIN_VERSION, QuotaManager, CursorProvider, CodexProvider, AntigravityProvider, OpenCodeGoProvider }
