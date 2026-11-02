import http from 'node:http'
import net from 'node:net'
import { randomBytes, createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { existsSync, readFileSync, writeFileSync, mkdirSync, statSync, renameSync, unlinkSync } from 'node:fs'
import { join } from 'node:path'
import { homedir, platform } from 'node:os'

/**
 * Data structures for Quota tracking & Single Long Card UI
 * @version 0.4.0
 */

const PLUGIN_VERSION = '0.4.0'

                                                                                
                                                                

                        
            
               
                   
                     
                          
                  
                                         
                                                          
                      
                                                                  
                   
                      
 

                       
             
               
                       
                                                                     
                         
 

                            
                                             
                
               
                    
                                        
                                    
                     
                                               
 

                               
                        
                                        
 

                            
                   
                                                                                               
                   
                   
               
 

                        
                                                                                               
              
                                                                                               
                            
                                              
               
                  
                
                       
                            
                                                                    
                                                                 
                                                                                          
                     
                 
                                     
 

                             
                   
                    
                 
                   
                     
                          
                     
                           
                  
 

                      
                    
                  
              
                 
                   
                            
                 
                   
 

                                
             
                  
                    
                  
                 
           
 

                             
            
                  
               
                   
                 
                  
                       
                           
             
                             
 

                                    
            
              
                 
                
                      
                   
 

                       
                        
                    
                       
                                         
                                              
                          
                                                     
                           
                               
                                 
                                 
                                                  
                                                
  
                        
                                
                                                         
                                                

                                                                            
                                                                                    
                                                                                                 
           
                     
                             
                 
             
                          
                           
                        
                        
     
   
                 
                     
                             
                 
             
                          
                           
                        
                    
                   
     
   
                                                                                       
                                                                                                  
                                                                                          
                                                                                                       
                                                                                
                                                                               
                                                                                                     
                                                                                
                                                                                      
                                                                                       
                                                                                      
                                                   
 

function getRefreshIntervalSeconds(config              )         {
  if (typeof config?.refreshIntervalSeconds === 'number' && config.refreshIntervalSeconds > 0) {
    return Math.max(5, config.refreshIntervalSeconds)
  }
  if (typeof config?.refreshIntervalMinutes === 'number' && config.refreshIntervalMinutes > 0) {
    return Math.max(5, Math.round(config.refreshIntervalMinutes * 60))
  }
  return 60
}

                          
                    
 

                          
              
                            
                                                                                            
                                                                                                        
 

                                    
                      
                        
                         
                                             
                
                            
                         
                    
                   
                
                  
    
 

/**
 * Standardized reset text formatter across all providers
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
 * Cross-platform path resolver for user application data directories.
 * Strictly avoids any hardcoded machine paths.
 */
function getAppStoragePaths(appName        , relativeFile        )           {
  const home = homedir()
  const paths           = []
  const currentPlatform = platform()

  if (currentPlatform === 'win32') {
    if (process.env.APPDATA) {
      paths.push(join(process.env.APPDATA, appName, relativeFile))
    }
    if (process.env.LOCALAPPDATA) {
      paths.push(join(process.env.LOCALAPPDATA, appName, relativeFile))
    }
    if (process.env.USERPROFILE) {
      paths.push(join(process.env.USERPROFILE, 'AppData', 'Roaming', appName, relativeFile))
      paths.push(join(process.env.USERPROFILE, 'AppData', 'Local', appName, relativeFile))
    }
  } else if (currentPlatform === 'darwin') {
    paths.push(join(home, 'Library', 'Application Support', appName, relativeFile))
  } else {
    // Linux / Unix / WSL
    if (process.env.XDG_CONFIG_HOME) {
      paths.push(join(process.env.XDG_CONFIG_HOME, appName, relativeFile))
    }
    paths.push(join(home, '.config', appName, relativeFile))

    // If running in WSL, check mounted Windows user directories dynamically
    if (process.env.WSL_DISTRO_NAME || existsSync('/mnt/c/Users')) {
      const wslUsersDir = '/mnt/c/Users'
      try {
        // Look for candidate username from environment
        const candidateUsers = [process.env.USER, process.env.USERNAME, process.env.LOGNAME].filter(Boolean)            
        for (const u of candidateUsers) {
          paths.push(join(wslUsersDir, u, 'AppData', 'Roaming', appName, relativeFile))
          paths.push(join(wslUsersDir, u, 'AppData', 'Local', appName, relativeFile))
        }
      } catch {}
    }
  }

  return [...new Set(paths.filter(Boolean))]
}

/**
 * Resolves standard home-relative config paths (e.g. ~/.codex/auth.json)
 */
function getHomeConfigPaths(folderName        , fileName        )           {
  const home = homedir()
  const paths           = [
    join(home, `.${folderName}`, fileName),
    join(home, '.config', folderName, fileName),
  ]

  if (process.env.USERPROFILE && process.env.USERPROFILE !== home) {
    paths.push(join(process.env.USERPROFILE, `.${folderName}`, fileName))
  }

  return [...new Set(paths.filter(Boolean))]
}

/**
 * Atomically writes JSON to a file via temporary file replacement.
 * Prevents 0-byte corrupted files if application crashes or power cuts during write.
 */
function atomicWriteJsonSync(filePath        , data     , mode = 0o600)       {
  const tmpPath = `${filePath}.${process.pid}.${Date.now()}.${Math.random().toString(36).slice(2, 6)}.tmp`
  try {
    writeFileSync(tmpPath, JSON.stringify(data, null, 2), { encoding: 'utf8', mode })
    renameSync(tmpPath, filePath)
  } catch {
    try {
      if (existsSync(tmpPath)) unlinkSync(tmpPath)
    } catch {}
    // Fallback direct write
    writeFileSync(filePath, JSON.stringify(data, null, 2), { encoding: 'utf8', mode })
  }
}






let cachedUndici      = null
const proxyAgentCache = new Map             ()

function getUndici()      {
  if (cachedUndici) return cachedUndici
  const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh')
  const candidates = [
    join(dshHome, 'profiles', 'web', 'package.json'),
    join(homedir(), '.dsh', 'profiles', 'web', 'package.json'),
  ]
  for (const c of candidates) {
    try {
      const req = createRequire(c)
      const u = req('undici')
      if (u && (u.ProxyAgent || u.fetch)) {
        cachedUndici = u
        return u
      }
    } catch {}
  }
  return null
}

function makeTimeoutSignal(timeoutMs        )                          {
  if (typeof AbortSignal !== 'undefined' && 'timeout' in AbortSignal) {
    return (AbortSignal       ).timeout(timeoutMs)
  }
  return undefined
}

function combineSignals(timeoutMs        , explicitSignal              )              {
  const timeoutSig = makeTimeoutSignal(timeoutMs)
  if (!explicitSignal) {
    return timeoutSig || new AbortController().signal
  }
  if (!timeoutSig) return explicitSignal

  if (typeof AbortSignal !== 'undefined' && typeof (AbortSignal       ).any === 'function') {
    return (AbortSignal       ).any([explicitSignal, timeoutSig])
  }

  const ctrl = new AbortController()
  const onAbort = () => ctrl.abort()
  explicitSignal.addEventListener('abort', onAbort, { once: true })
  timeoutSig.addEventListener('abort', onAbort, { once: true })
  if (explicitSignal.aborted || timeoutSig.aborted) ctrl.abort()
  return ctrl.signal
}

function extractErrorCode(err     )         {
  if (!err) return 'UNKNOWN'
  return err.cause?.code || err.code || err.cause?.message || err.message || 'UNKNOWN'
}

/**
 * Strips sensitive username/password from proxy URLs before logging or error messages.
 */
function sanitizeProxyUrl(rawUrl         )         {
  if (!rawUrl) return ''
  try {
    const u = new URL(rawUrl)
    if (u.username || u.password) {
      u.username = '***'
      u.password = '***'
    }
    return u.toString()
  } catch {
    return rawUrl.replace(/\/\/[^@]+@/, '//***:***@')
  }
}

/**
 * Universal fetch with proxy support, timeout, combined signal cancellation,
 * proxy fail-closed security, and error sanitization.
 */
async function fetchWithProxy(
  url        ,
  init                                     = {},
  proxyUrl         ,
  timeoutMs = 20000,
  proxyMode            = 'proxy-preferred'
)                    {
  if (proxyMode === 'direct') {
    proxyUrl = undefined
  }

  const proxy = proxyUrl || (proxyMode !== 'direct' ? (process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.https_proxy || process.env.http_proxy) : undefined)
  const explicitSignal = init.signal
  const safeProxyStr = sanitizeProxyUrl(proxy)

  // 1. Direct fetch if no proxy is configured or mode is 'direct'
  if (!proxy) {
    const signal = combineSignals(timeoutMs, explicitSignal)
    try {
      const { dispatcher: _ignored, ...directInit } = init       
      return await fetch(url, { ...directInit, signal })
    } catch (err     ) {
      const code = extractErrorCode(err)
      throw new Error(`fetch failed (${code}): ${err.message}`)
    }
  }

  // 2. Attempt proxy fetch using undici.fetch + cached ProxyAgent
  let proxyErr      = null
  const undici = getUndici()
  if (undici && undici.ProxyAgent && typeof undici.fetch === 'function') {
    try {
      let dispatcher = proxyAgentCache.get(proxy)
      if (!dispatcher) {
        dispatcher = new undici.ProxyAgent(proxy)
        proxyAgentCache.set(proxy, dispatcher)
      }
      const signal = combineSignals(timeoutMs, explicitSignal)
      return await undici.fetch(url, { ...init, signal, dispatcher })
    } catch (err     ) {
      proxyErr = err
    }
  } else {
    proxyErr = new Error('undici ProxyAgent unavailable')
  }

  // If explicit signal was already aborted, do not fallback
  if (explicitSignal?.aborted) {
    throw proxyErr || new Error('Request aborted')
  }

  // 3. If proxyMode is 'proxy-required', fail-closed immediately without falling back to direct
  if (proxyMode === 'proxy-required') {
    const proxyCode = extractErrorCode(proxyErr)
    throw new Error(`proxy connection required but failed (${proxyCode} @ ${safeProxyStr}): ${proxyErr?.message || 'proxy unreachable'}`)
  }

  // 4. Fallback to direct fetch in 'proxy-preferred' mode
  try {
    const { dispatcher: _ignored, ...directInit } = init       
    const directSignal = combineSignals(timeoutMs, explicitSignal)
    return await fetch(url, { ...directInit, signal: directSignal })
  } catch (directErr     ) {
    const directCode = extractErrorCode(directErr)
    const proxyCode = extractErrorCode(proxyErr)
    throw new Error(`fetch failed: proxy (${proxyCode} @ ${safeProxyStr}) & direct (${directCode})`)
  }
}






function base64UrlEncode(buffer        )         {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

function sha256(str        )         {
  return createHash('sha256').update(str).digest()
}

function escapeHtml(str         )         {
  if (!str) return ''
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
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
          codexAutoCloseTimer      = null
          antigravityAutoCloseTimer      = null

          codexVerifier                = null
          codexState                = null

          antigravityState                = null

         dispose()       {
    if (this.codexAutoCloseTimer) {
      clearTimeout(this.codexAutoCloseTimer)
      this.codexAutoCloseTimer = null
    }
    if (this.antigravityAutoCloseTimer) {
      clearTimeout(this.antigravityAutoCloseTimer)
      this.antigravityAutoCloseTimer = null
    }
    if (this.activeCodexServer) {
      try {
        this.activeCodexServer.removeAllListeners()
        this.activeCodexServer.close()
      } catch {}
      this.activeCodexServer = null
    }
    if (this.activeAntigravityServer) {
      try {
        this.activeAntigravityServer.removeAllListeners()
        this.activeAntigravityServer.close()
      } catch {}
      this.activeAntigravityServer = null
    }
  }

  // --- CODEX (ChatGPT OAuth) ---
  async startCodexLogin(
    onSuccess                                                                                                          ,
    proxyUrl         ,
    proxyMode      
  )                               {
    if (this.codexAutoCloseTimer) {
      clearTimeout(this.codexAutoCloseTimer)
      this.codexAutoCloseTimer = null
    }
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
            }, proxyUrl, 20000, proxyMode)

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
            res.end(`<!DOCTYPE html><html><body style="font-family:sans-serif;padding:30px;line-height:1.6;"><h2>❌ 授权换取令牌失败</h2><p style="color:#d32f2f;font-weight:600;">${escapeHtml(err.message)}</p><p style="font-size:13px;color:#666;">原因说明：OpenAI 官方授权接口严格检测 IP 地区。若当前宿主直连被拦截，请在「额度监控 -> 设置」中填写代理地址（如 http://127.0.0.1:7890），或直接粘贴 ~/.codex/auth.json 中的 access_token。</p></body></html>`)
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
        }, 2000)
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

    // Auto close server after 5 minutes if user abandons
    this.codexAutoCloseTimer = setTimeout(() => {
      if (this.activeCodexServer) {
        try {
          this.activeCodexServer.removeAllListeners()
          this.activeCodexServer.close()
        } catch {}
        this.activeCodexServer = null
      }
    }, 300_000)

    return { authUrl }
  }

  // --- ANTIGRAVITY (Google OAuth) ---
  async startAntigravityLogin(
    onSuccess                                                                                                                     ,
    proxyUrl         ,
    proxyMode      
  )                               {
    if (this.antigravityAutoCloseTimer) {
      clearTimeout(this.antigravityAutoCloseTimer)
      this.antigravityAutoCloseTimer = null
    }
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

    const boundPort = await findAvailablePort([51121, 51122, 51123, 43110, 31280, 0], '127.0.0.1')
    const resolvedRedirectUri = `http://127.0.0.1:${boundPort}/oauthcallback`

    const server = http.createServer(async (req, res) => {
      const url = new URL(req.url || '/', `http://127.0.0.1:${boundPort}`)
      if (url.pathname === '/oauthcallback' || url.pathname === '/oauth2callback') {
        const error = url.searchParams.get('error')
        if (error) {
          res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' })
          res.end(`<!DOCTYPE html><html><body style="font-family:sans-serif;padding:30px;text-align:center;"><h2>⚠️ 授权未完成</h2><p>Google 授权已被取消或返回错误: ${escapeHtml(error)}</p></body></html>`)
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
            }, proxyUrl, 20000, proxyMode)

            if (!tokenRes.ok) {
              const errText = await tokenRes.text()
              throw new Error(`Google OAuth 令牌换取失败 (${tokenRes.status}): ${errText.slice(0, 150)}`)
            }

            const tokenData = await tokenRes.json()       
            const accessToken = tokenData.access_token
            const refreshToken = tokenData.refresh_token
            const expiresIn = tokenData.expires_in || 3600
            const expiresAt = Date.now() + expiresIn * 1000

            let userEmail                    
            let userName                    
            try {
              const infoRes = await fetchWithProxy('https://www.googleapis.com/oauth2/v2/userinfo', {
                headers: { Authorization: `Bearer ${accessToken}` },
              }, proxyUrl, 8000, proxyMode)
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
    <p style="color:#444;font-size:15px;margin:16px 0;">${userEmail ? `已关联账号：<strong>${escapeHtml(userEmail)}</strong><br/>` : ''}凭据已自动同步至 DSH 额度监控。</p>
    <p style="color:#666;font-size:13px;">您可以安全地关闭当前网页，并返回 DSH 额度监控页面查看配额。</p>
  </div>
</body>
</html>`)
          } catch (err     ) {
            res.writeHead(500, { 'Content-Type': 'text/html; charset=utf-8' })
            res.end(`<!DOCTYPE html><html><body style="font-family:sans-serif;padding:30px;"><h2>❌ Google 登录失败</h2><p style="color:#d32f2f;">${escapeHtml(err.message)}</p><p style="color:#666;font-size:13px;">提示：若网络处于受限地区，请在 DSH 额度监控「设置」中配置 HTTP 代理后重试。</p></body></html>`)
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
        }, 2000)
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

    // Auto close server after 5 minutes if user abandons
    this.antigravityAutoCloseTimer = setTimeout(() => {
      if (this.activeAntigravityServer) {
        try {
          this.activeAntigravityServer.removeAllListeners()
          this.activeAntigravityServer.close()
        } catch {}
        this.activeAntigravityServer = null
      }
    }, 300_000)

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



                            
                 
                                                                                   
 

class QuotaHistoryManager {
          historyPath        
          records                                   = new Map()
          maxDays = 30
          lastSaveTime = 0

  constructor() {
    const dshDir = process.env.DSH_HOME || join(homedir(), '.dsh')
    if (!existsSync(dshDir)) {
      try {
        mkdirSync(dshDir, { recursive: true })
      } catch {}
    }
    this.historyPath = join(dshDir, 'quota-history.json')
    this.load()
  }

  load()       {
    try {
      if (existsSync(this.historyPath)) {
        const raw = readFileSync(this.historyPath, 'utf8')
        const data = JSON.parse(raw)                    
        this.records.clear()
        if (data && data.records) {
          for (const [key, list] of Object.entries(data.records)) {
            if (Array.isArray(list)) {
              this.records.set(key, list)
            }
          }
        }
      }
    } catch {}
  }

  save()       {
    try {
      const obj                   = {
        version: 2,
        records: Object.fromEntries(this.records.entries()),
      }
      atomicWriteJsonSync(this.historyPath, obj, 0o600)
      this.lastSaveTime = Date.now()
    } catch {}
  }

          appendPoint(key        , point                   , cutoff        , isBalanceChanged = false)       {
    let list = this.records.get(key)
    if (!list) {
      list = []
      this.records.set(key, list)
    }

    const lastPoint = list[list.length - 1]
    if (
      lastPoint &&
      point.timestamp - lastPoint.timestamp < 5 * 60 * 1000 &&
      lastPoint.remainingPercent === point.remainingPercent &&
      !isBalanceChanged
    ) {
      return
    }

    list.push(point)

    if (list.length > 2000 || (list[0] && list[0].timestamp < cutoff)) {
      const filtered = list.filter((p) => p.timestamp >= cutoff)
      this.records.set(key, filtered)
    }
  }

  recordSnapshots(cards                )       {
    const now = Date.now()
    const cutoff = now - this.maxDays * 24 * 3600 * 1000

    for (const card of cards) {
      if (card.status === 'disabled' || card.status === 'error') continue

      // 1. Record individual window-level points
      for (const group of card.groups) {
        for (const win of group.windows) {
          if (win.status === 'disabled' || win.status === 'unknown') continue
          const winKey = `${card.id}::${group.id || group.title}::${win.id}`
          const winPoint                    = {
            timestamp: now,
            instanceId: card.id,
            poolId: group.id || group.poolType,
            windowId: win.id,
            windowKind: win.windowKind,
            remainingPercent: win.remainingPercent,
            usedPercent: win.usedPercent,
            resetAt: win.resetAt,
          }
          this.appendPoint(winKey, winPoint, cutoff)
        }
      }

      // 2. Record card-level representative point for backward compatibility and overview
      let remPercent = 100
      let usedPercent = 0
      let representativeResetAt                    

      if (card.groups.length > 0 && card.groups[0]?.windows.length) {
        const win = card.groups[0].windows[0]
        if (win) {
          remPercent = win.remainingPercent
          usedPercent = win.usedPercent
          representativeResetAt = win.resetAt
        }
      } else if (card.balance?.remaining !== undefined && card.balance?.total) {
        remPercent = Math.max(0, Math.min(100, Math.round((card.balance.remaining / card.balance.total) * 100)))
        usedPercent = 100 - remPercent
      }

      const point                    = {
        timestamp: now,
        instanceId: card.id,
        remainingPercent: remPercent,
        usedPercent,
        remainingBalance: card.balance?.remaining,
        resetAt: representativeResetAt,
      }

      const isBalanceChanged =
        card.balance?.remaining !== undefined &&
        (() => {
          const l = this.records.get(card.id)
          const lp = l ? l[l.length - 1] : undefined
          return lp ? lp.remainingBalance !== card.balance.remaining : false
        })()

      this.appendPoint(card.id, point, cutoff, isBalanceChanged)
    }

    // Debounced disk write every 2 minutes
    if (now - this.lastSaveTime > 2 * 60 * 1000) {
      this.save()
    }
  }

  getTrendPoints(instanceIdOrKey        , days = 7)                      {
    const list = this.records.get(instanceIdOrKey) || []
    const cutoff = Date.now() - days * 24 * 3600 * 1000
    return list.filter((p) => p.timestamp >= cutoff)
  }

  getUsageTrendPoints(instanceIdOrKey        , days = 7)                                  {
    const list = this.records.get(instanceIdOrKey) || []
    const now = Date.now()
    const startTime = now - days * 24 * 3600 * 1000
    const recentPoints = list.filter((p) => p.timestamp >= startTime).sort((a, b) => a.timestamp - b.timestamp)

    const numBins = 7
    const binDuration = (days * 24 * 3600 * 1000) / numBins
    const usageBins           = new Array(numBins).fill(0)

    if (recentPoints.length >= 2) {
      for (let i = 1; i < recentPoints.length; i++) {
        const prev = recentPoints[i - 1] 
        const curr = recentPoints[i] 
        const binIndex = Math.min(numBins - 1, Math.max(0, Math.floor((curr.timestamp - startTime) / binDuration)))

        if (prev.remainingBalance !== undefined && curr.remainingBalance !== undefined) {
          const deltaBal = prev.remainingBalance - curr.remainingBalance
          if (deltaBal > 0) {
            usageBins[binIndex] += deltaBal
          }
        } else {
          // If reset occurred (remaining increased), don't count delta as usage
          if (curr.remainingPercent > prev.remainingPercent) {
            continue
          }
          const prevUsed = prev.usedPercent ?? (100 - prev.remainingPercent)
          const currUsed = curr.usedPercent ?? (100 - curr.remainingPercent)
          const deltaUsed = currUsed - prevUsed
          if (deltaUsed > 0) {
            usageBins[binIndex] += deltaUsed
          }
        }
      }
    }

    const maxUsage = Math.max(...usageBins)
    const points                                  = []

    for (let i = 0; i < numBins; i++) {
      const binTime = startTime + i * binDuration + binDuration / 2
      if (maxUsage <= 0) {
        points.push({ t: binTime, r: 0 })
      } else {
        const val = usageBins[i] 
        const normalized = val > 0 ? Math.min(100, Math.round((val / maxUsage) * 85 + 10)) : 0
        points.push({ t: binTime, r: normalized })
      }
    }

    return points
  }

  calculateBurnRate(
    instanceIdOrKey        ,
    currentRemainingPercent        
  )                                                            {
    const list = this.records.get(instanceIdOrKey) || []
    if (list.length < 2) return {}

    const now = Date.now()
    const oneDayAgo = now - 24 * 3600 * 1000
    const recentPoints = list.filter((p) => p.timestamp >= oneDayAgo)

    if (recentPoints.length < 2) return {}

    const firstPoint = recentPoints[0] 
    const lastPoint = recentPoints[recentPoints.length - 1] 
    const timeDiffHours = (lastPoint.timestamp - firstPoint.timestamp) / (3600 * 1000)

    if (timeDiffHours < 0.25) return {} // Need at least 15 min of sample

    // Check if reset occurred between first and last sample
    if (lastPoint.remainingPercent > firstPoint.remainingPercent) {
      return {} // Quota was reset or topped up during this period, cannot calculate single linear burn
    }

    const deltaUsed = Math.max(0, firstPoint.remainingPercent - lastPoint.remainingPercent)
    const burnRatePerHour = Math.round((deltaUsed / timeDiffHours) * 100) / 100

    let estimatedHoursLeft                    
    if (burnRatePerHour > 0.01 && currentRemainingPercent > 0) {
      estimatedHoursLeft = Math.round((currentRemainingPercent / burnRatePerHour) * 10) / 10
    }

    return { burnRatePerHour, estimatedHoursLeft }
  }
}



class QuotaAlarmDetector {
          activeAlarms                          = new Map()

  detectAlarms(cards                , thresholdPercent = 15)               {
    const alarms               = []
    const now = Date.now()

    for (const card of cards) {
      if (card.status === 'disabled') continue

      if (card.status === 'error') {
        const alarm             = {
          instanceId: card.id,
          provider: card.provider,
          name: card.name,
          level: 'critical',
          message: `${card.name}: 连接异常 (${card.error || '凭据失效'})`,
          timestamp: now,
        }
        alarms.push(alarm)
        this.activeAlarms.set(card.id, alarm)
        continue
      }

      // Check min remaining percentage across groups & windows
      let lowestRemaining = 100
      let lowestLabel = ''
      let lowestPoolId                    
      let lowestWinId                    

      for (const group of card.groups) {
        for (const win of group.windows) {
          if (win.status === 'disabled' || win.status === 'unknown') continue
          if (win.remainingPercent < lowestRemaining) {
            lowestRemaining = win.remainingPercent
            lowestLabel = `${group.title} · ${win.label}`
            lowestPoolId = group.id || group.poolType
            lowestWinId = win.id
          }
        }
      }

      if (card.balance?.remaining !== undefined && card.balance?.total && card.balance.total > 0) {
        const balPercent = (card.balance.remaining / card.balance.total) * 100
        if (balPercent < lowestRemaining) {
          lowestRemaining = balPercent
          lowestLabel = '账户可用余额'
          lowestPoolId = 'balance'
          lowestWinId = 'account-balance'
        }
      }

      if (lowestRemaining <= thresholdPercent) {
        const isCritical = lowestRemaining <= 5
        const alarm             = {
          instanceId: card.id,
          provider: card.provider,
          name: card.name,
          poolId: lowestPoolId,
          windowId: lowestWinId,
          level: isCritical ? 'critical' : 'warn',
          message: `${card.name}: ${lowestLabel} 剩余 ${Math.round(lowestRemaining)}%${isCritical ? ' (即将用尽)' : ' (低于阈值)'}`,
          timestamp: now,
        }
        alarms.push(alarm)
        this.activeAlarms.set(card.id, alarm)
      } else {
        this.activeAlarms.delete(card.id)
      }
    }

    return alarms
  }

  getActiveAlarms()               {
    return Array.from(this.activeAlarms.values())
  }
}



                                   
                        
                         
                     
                                   
                                     
                                       
    
 

class DeepSeekProvider                           {
  name = 'deepseek'
  category = 'domestic_llm'         

          resolveKey(config             , accountConfig                    )                                      {
    let apiKey = (accountConfig && accountConfig.apiKey !== undefined
      ? accountConfig.apiKey
      : (config.deepseek?.apiKey || process.env.DEEPSEEK_API_KEY || '')).trim()
    apiKey = apiKey.replace(/^Bearer\s+/i, '')
    const baseUrl = (accountConfig?.baseUrl || config.deepseek?.baseUrl || 'https://api.deepseek.com').replace(/\/+$/, '')
    return { apiKey, baseUrl }
  }

  async testConnection(config             , accountConfig                    )                                {
    const start = Date.now()
    const { apiKey, baseUrl } = this.resolveKey(config, accountConfig)
    if (!apiKey) {
      return {
        ok: false,
        provider: 'deepseek',
        message: '未配置 DeepSeek API Key。请在「设置」中填入 Key',
      }
    }

    try {
      const url = `${baseUrl}/user/balance`
      const res = await fetchWithProxy(url, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: 'application/json',
        },
      }, config.httpProxy, 10000, config.proxyMode)

      const latencyMs = Date.now() - start
      if (!res.ok) {
        let detail = `HTTP ${res.status}`
        try {
          const errData = await res.json()       
          if (errData?.error?.message) {
            detail = errData.error.message
          } else if (res.status === 401) {
            detail = 'API Key 无效或未授权 (HTTP 401)'
          } else if (res.status === 403) {
            detail = '无访问权限或 IP 受限 (HTTP 403)'
          }
        } catch {
          if (res.status === 401) detail = 'API Key 无效或已过期 (HTTP 401)'
        }
        return {
          ok: false,
          provider: 'deepseek',
          latencyMs,
          message: `验证失败: ${detail}`,
        }
      }

      const data = await res.json()                           
      const info = data.balance_infos?.[0]
      const total = info?.total_balance ?? '0.00'
      const currency = info?.currency || 'CNY'
      return {
        ok: true,
        provider: 'deepseek',
        latencyMs,
        account: `余额: ¥${total} ${currency}`,
        message: `连接成功 (延迟: ${latencyMs}ms, 余额: ¥${total})`,
      }
    } catch (err     ) {
      return {
        ok: false,
        provider: 'deepseek',
        latencyMs: Date.now() - start,
        message: `网络请求异常: ${err.message}`,
      }
    }
  }

  async fetchCard(config             , accountConfig                    )                          {
    const cardId = accountConfig?.id || 'deepseek'
    const cardName = accountConfig?.name || config.customNames?.deepseek || config.deepseek?.name || 'DeepSeek'
    const { apiKey, baseUrl } = this.resolveKey(config, accountConfig)

    if (!apiKey) {
      return {
        card: {
          id: cardId,
          name: cardName,
          provider: 'deepseek',
          category: this.category,
          status: 'disabled',
          error: '未配置 API Key。请在「设置」中填入 DeepSeek API Key',
          groups: [],
          lastUpdated: Date.now(),
        },
      }
    }

    try {
      const url = `${baseUrl}/user/balance`
      const res = await fetchWithProxy(url, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: 'application/json',
        },
      }, config.httpProxy, 15000, config.proxyMode)

      if (!res.ok) {
        throw new Error(`API 错误 (${res.status})`)
      }

      const data = await res.json()                           
      const info = data.balance_infos?.[0]
      const isAvailable = data.is_available !== false

      const totalBalance = typeof info?.total_balance === 'string' ? parseFloat(info.total_balance) : (info?.total_balance ?? 0)
      const grantedBalance = typeof info?.granted_balance === 'string' ? parseFloat(info.granted_balance) : (info?.granted_balance ?? 0)
      const toppedUpBalance = typeof info?.topped_up_balance === 'string' ? parseFloat(info.topped_up_balance) : (info?.topped_up_balance ?? 0)
      const currency = (info?.currency || 'CNY').toUpperCase()                 

      const totalAmount = Math.max(0, totalBalance)
      const isLow = totalAmount <= 5
      const status = !isAvailable || totalAmount <= 0 ? 'error' : (isLow ? 'warn' : 'ok')
      const remPercent = totalAmount <= 0 ? 0 : (totalAmount < 5 ? 15 : (totalAmount < 20 ? 40 : 100))
      const usedPercent = 100 - remPercent

      const subtitle = `总额: ¥${totalAmount.toFixed(2)} (充值 ¥${toppedUpBalance.toFixed(2)} + 赠送 ¥${grantedBalance.toFixed(2)})`

      return {
        card: {
          id: cardId,
          name: cardName,
          provider: 'deepseek',
          category: this.category,
          status,
          plan: 'DeepSeek 官方平台',
          account: `¥${totalAmount.toFixed(2)} ${currency}`,
          balance: {
            currency,
            total: totalAmount,
            remaining: totalAmount,
            grantedBalance,
            toppedUpBalance,
          },
          groups: [
            {
              id: 'deepseek-balance-group',
              title: '账户余额',
              hasInfoIcon: true,
              poolType: 'general',
              windows: [
                {
                  id: 'deepseek-balance',
                  label: '可用余额',
                  subtitle: `充值: ¥${toppedUpBalance.toFixed(2)} · 赠送: ¥${grantedBalance.toFixed(2)}`,
                  usedPercent,
                  remainingPercent: remPercent,
                  barType: 'balance',
                  status: totalAmount <= 0 ? 'exhausted' : 'active',
                },
              ],
            },
          ],
          lastUpdated: Date.now(),
          sourceProvenance: {
            endpoint: url,
            method: 'user-balance',
            timestamp: Date.now(),
            host: 'api.deepseek.com',
          },
        },
      }
    } catch (err     ) {
      return {
        card: {
          id: cardId,
          name: cardName,
          provider: 'deepseek',
          category: this.category,
          status: 'error',
          error: err.message,
          groups: [],
          lastUpdated: Date.now(),
        },
      }
    }
  }
}



                       
                     
                
                
                         
 

class CursorProvider                           {
  name = 'cursor'
  category = 'ide'         

          databasePaths()           {
    const paths           = []
    for (const name of ['Cursor', 'cursor', 'Cursor - Insiders']) {
      paths.push(...getAppStoragePaths(name, 'User/globalStorage/state.vscdb'))
      paths.push(...getAppStoragePaths(name, 'User\\globalStorage\\state.vscdb'))
    }
    return [...new Set(paths)]
  }

          findLocalLogin()                     {
    let DatabaseSync     
    try {
      const requireFromHere = createRequire(import.meta.url)
      DatabaseSync = requireFromHere('node:sqlite')?.DatabaseSync
    } catch {}

    for (const path of this.databasePaths()) {
      if (!existsSync(path)) continue
      try {
        if (!DatabaseSync) {
          // If SQLite native binding isn't available, skip local sqlite read gracefully
          break
        }
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

          resolveCookie(config             , accountConfig                    )                                                              {
    const tokenInput = (accountConfig?.sessionToken || config.cursor?.sessionToken)?.trim()
    if (tokenInput) {
      return {
        cookie: tokenInput.startsWith('WorkosCursorSessionToken=') ? tokenInput : `WorkosCursorSessionToken=${tokenInput}`,
      }
    }

    if (config.cursor?.autoDetectLocal !== false && accountConfig?.autoDetectLocal !== false) {
      const login = this.findLocalLogin()
      if (login) {
        return {
          cookie: `WorkosCursorSessionToken=${login.userId}::${login.accessToken}`,
          email: login.email,
          membershipType: login.membershipType,
        }
      }
    }

    return { cookie: '' }
  }

  async testConnection(config             , accountConfig                    )                                {
    const start = Date.now()
    const { cookie, email } = this.resolveCookie(config, accountConfig)
    if (!cookie) {
      return {
        ok: false,
        provider: 'cursor',
        message: '未找到 Cursor 凭据。请在设置中配置 WorkosCursorSessionToken，或确保本地 Cursor 已登录',
      }
    }

    try {
      const headers = { Cookie: cookie, Accept: 'application/json', 'User-Agent': 'Mozilla/5.0' }
      const res = await fetchWithProxy('https://cursor.com/api/usage-summary', { headers }, config.httpProxy, 12000)
      const latencyMs = Date.now() - start
      if (!res.ok) {
        return {
          ok: false,
          provider: 'cursor',
          latencyMs,
          message: `连接失败: 接口返回 HTTP ${res.status}`,
        }
      }
      const data = await res.json()       
      return {
        ok: true,
        provider: 'cursor',
        latencyMs,
        account: email || data.membershipType || 'Cursor 已连接',
        message: `连接成功 (延迟: ${latencyMs}ms)`,
      }
    } catch (err     ) {
      return {
        ok: false,
        provider: 'cursor',
        latencyMs: Date.now() - start,
        message: `请求异常: ${err.message}`,
      }
    }
  }

  async fetchCard(config             , accountConfig                    )                          {
    const cardId = accountConfig?.id || 'cursor'
    const cardName = accountConfig?.name || 'Cursor'
    const { cookie, email, membershipType } = this.resolveCookie(config, accountConfig)

    if (!cookie) {
      return {
        card: {
          id: cardId,
          name: cardName,
          provider: 'cursor',
          category: this.category,
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
        fetchWithProxy('https://cursor.com/api/usage-summary', { headers }, config.httpProxy, 12000),
        fetchWithProxy('https://cursor.com/api/auth/stripe', { headers }, config.httpProxy, 12000),
      ])

      if (!usageRes.ok) throw new Error(`Cursor 登录态失效或接口错误 (${usageRes.status})`)
      const data = await usageRes.json()       
      const stripe = stripeRes.ok ? await stripeRes.json()        : {}
      const plan = data.individualUsage?.plan
      if (!plan?.enabled) throw new Error('Cursor 当前账户未返回可用订阅额度')

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
          id: cardId,
          name: cardName,
          provider: 'cursor',
          category: this.category,
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
                  resetAt: resetTimestamp ? new Date(resetTimestamp).toISOString() : undefined,
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
          id: cardId,
          name: cardName,
          provider: 'cursor',
          category: this.category,
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
  category = 'official_cloud'         

          authPaths()           {
    const paths           = []
    if (process.env.CODEX_HOME) {
      paths.push(join(process.env.CODEX_HOME, 'auth.json'))
    }
    paths.push(...getHomeConfigPaths('codex', 'auth.json'))
    return [...new Set(paths)]
  }

          loadAuth(config             , accountConfig                    )                         {
    if (accountConfig?.oauth?.accessToken) {
      return {
        accessToken: accountConfig.oauth.accessToken,
        refreshToken: accountConfig.oauth.refreshToken,
        accountId: accountConfig.oauth.accountId,
        source: accountConfig.name || 'Codex 账号',
      }
    }

    const localCandidates                                                  = []

    if (config.codex?.autoDetectLocal !== false && accountConfig?.autoDetectLocal !== false) {
      for (const path of this.authPaths()) {
        if (!existsSync(path)) continue
        try {
          const auth = JSON.parse(readFileSync(path, 'utf8'))             
          if (auth.tokens?.access_token) {
            localCandidates.push({
              accessToken: auth.tokens.access_token,
              refreshToken: auth.tokens.refresh_token,
              accountId: auth.tokens.account_id,
              source: path,
              filePath: path,
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
        refreshToken: config.codex.oauth.refreshToken,
        accountId: config.codex.oauth.accountId,
        source: 'Codex OAuth 凭据',
      }
    }

    return null
  }

          async refreshAccessToken(
    creds                 ,
    proxyUrl         ,
    config              ,
    accountConfig                    
  )                         {
    if (!creds.refreshToken) return null
    try {
      const clientId = 'app_EMoamEEZ73f0CkXaXp7hrann'
      const tokenRes = await fetchWithProxy('https://auth.openai.com/oauth/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'codex-cli',
          'Accept': 'application/json',
        },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          client_id: clientId,
          refresh_token: creds.refreshToken,
        }),
      }, proxyUrl, 12000, config?.proxyMode)

      if (!tokenRes.ok) return null
      const data = await tokenRes.json()       
      const newAccessToken = data.access_token
      const newRefreshToken = data.refresh_token || creds.refreshToken
      if (!newAccessToken) return null

      creds.accessToken = newAccessToken
      creds.refreshToken = newRefreshToken

      // Update in memory config without polluting default config
      if (accountConfig?.oauth) {
        accountConfig.oauth.accessToken = newAccessToken
        accountConfig.oauth.refreshToken = newRefreshToken
      } else if (config?.codex?.oauth) {
        config.codex.oauth.accessToken = newAccessToken
        config.codex.oauth.refreshToken = newRefreshToken
      }

      if (creds.filePath && existsSync(creds.filePath)) {
        try {
          const raw = readFileSync(creds.filePath, 'utf8')
          const auth = JSON.parse(raw)             
          if (!auth.tokens) auth.tokens = {}
          auth.tokens.access_token = newAccessToken
          auth.tokens.refresh_token = newRefreshToken
          atomicWriteJsonSync(creds.filePath, auth, 0o600)
        } catch {}
      }

      return newAccessToken
    } catch {
      return null
    }
  }

  async testConnection(config             , accountConfig                    )                                {
    const start = Date.now()
    const creds = this.loadAuth(config, accountConfig)
    if (!creds) {
      return {
        ok: false,
        provider: 'codex',
        message: '未找到 Codex 凭据。请点击「登录 OpenAI」或配置 access_token',
      }
    }

    try {
      const headers                         = {
        Authorization: `Bearer ${creds.accessToken}`,
        Accept: 'application/json',
        'User-Agent': 'codex-cli',
      }
      if (creds.accountId) headers['ChatGPT-Account-Id'] = creds.accountId

      let res = await fetchWithProxy('https://chatgpt.com/backend-api/wham/usage', { headers }, config.httpProxy, 10000, config.proxyMode)
      if (res.status === 401 && creds.refreshToken) {
        const refreshed = await this.refreshAccessToken(creds, config.httpProxy, config, accountConfig)
        if (refreshed) {
          headers.Authorization = `Bearer ${refreshed}`
          res = await fetchWithProxy('https://chatgpt.com/backend-api/wham/usage', { headers }, config.httpProxy, 10000, config.proxyMode)
        }
      }
      const latencyMs = Date.now() - start

      if (res.ok) {
        const data = await res.json()       
        const plan = (data.plan_type ?? 'Codex').toUpperCase()
        return {
          ok: true,
          provider: 'codex',
          latencyMs,
          account: `${data.email || creds.source} (${plan})`,
          message: `连接成功 (延迟: ${latencyMs}ms, 方案: ${plan})`,
        }
      }

      return {
        ok: false,
        provider: 'codex',
        latencyMs,
        message: `接口响应异常: HTTP ${res.status}`,
      }
    } catch (err     ) {
      return {
        ok: false,
        provider: 'codex',
        latencyMs: Date.now() - start,
        message: `请求异常: ${err.message}`,
      }
    }
  }

  async fetchCard(config             , accountConfig                    )                          {
    const cardId = accountConfig?.id || 'codex'
    const cardName = accountConfig?.name || config.customNames?.codex || config.codex?.name || 'Codex (OpenAI)'
    const creds = this.loadAuth(config, accountConfig)

    if (!creds) {
      return {
        card: {
          id: cardId,
          name: cardName,
          provider: 'codex',
          category: this.category,
          status: 'disabled',
          error: '未连接 Codex。请点击「登录 OpenAI」通过网页登录，或在「设置」中配置代理/Token',
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

      let res = await fetchWithProxy('https://chatgpt.com/backend-api/wham/usage', { headers }, config.httpProxy, 15000, config.proxyMode)
      if (res.status === 401 && creds.refreshToken) {
        const refreshed = await this.refreshAccessToken(creds, config.httpProxy, config, accountConfig)
        if (refreshed) {
          headers.Authorization = `Bearer ${refreshed}`
          res = await fetchWithProxy('https://chatgpt.com/backend-api/wham/usage', { headers }, config.httpProxy, 15000, config.proxyMode)
        }
      }
      if (!res.ok) {
        const cloudflare = res.status === 403 && (res.headers.get('content-type') ?? '').includes('text/html')
        throw new Error(cloudflare
          ? '已读取 Codex 登录态，但直连访问 ChatGPT 额度接口被拦截；请在设置中配置可用的 HTTP 代理'
          : `Codex 登录态失效或额度接口错误 (${res.status})`)
      }

      const data = await res.json()              
      const plan = (data.plan_type ?? 'Codex').toUpperCase()

      const rateLimit = data.rate_limit || {}
      const windows                 = []

      const buildWindow = (win                         , winId        , defaultLabel        , isWeeklyFallback = false)                      => {
        if (!win) return null
        const used = Math.max(0, Math.min(100, Math.round(win.used_percent ?? 0)))
        const rem = Math.max(0, 100 - used)
        const resetAt = win.reset_at ? new Date(win.reset_at * 1000).toISOString() : undefined
        const isWeekly = win.limit_window_seconds ? win.limit_window_seconds >= 86400 * 3 : isWeeklyFallback
        const label = isWeekly ? 'Weekly Limit' : (win.limit_window_seconds && win.limit_window_seconds <= 18000 ? '5-Hour Limit' : defaultLabel)
        const subtitle = formatQuotaResetText(resetAt, used, isWeekly)
        return {
          id: winId,
          label,
          subtitle,
          usedPercent: used,
          remainingPercent: rem,
          resetAt,
          barType: 'circle',
          windowKind: isWeekly ? 'weekly' : '5h',
          rawFraction: win.used_percent !== undefined ? (100 - win.used_percent) / 100 : undefined,
          status: rem <= 0 ? 'exhausted' : 'active',
        }
      }

      const primWin = buildWindow(rateLimit.primary_window, 'codex-5h', '5-Hour Limit', false)
      const secWin = buildWindow(rateLimit.secondary_window, 'codex-weekly', 'Weekly Limit', true)
      if (primWin) windows.push(primWin)
      if (secWin) windows.push(secWin)

      if (windows.length === 0) {
        const fallback = buildWindow(rateLimit.secondary_window || rateLimit.primary_window, 'codex-weekly', 'Weekly Limit', true)
        if (fallback) windows.push(fallback)
      }

      if (data.code_review_rate_limit?.primary_window) {
        const crWin = buildWindow(data.code_review_rate_limit.primary_window, 'codex-review', 'Code Review Limit', false)
        if (crWin) windows.push(crWin)
      }

      const lowestRem = windows.length > 0 ? Math.min(...windows.map(w => w.remainingPercent)) : 100
      const cardStatus = windows.length === 0 ? 'ok' : (lowestRem <= 0 ? 'error' : (lowestRem <= (config.alarmThresholdPercent ?? 15) ? 'warn' : 'ok'))

      return {
        card: {
          id: cardId,
          name: cardName,
          provider: 'codex',
          category: this.category,
          status: cardStatus,
          plan,
          account: data.email || creds.source,
          groups: [
            {
              id: 'codex-rate-limits',
              title: 'Codex 额度',
              hasInfoIcon: true,
              poolType: 'claude_gpt',
              windows,
            },
          ],
          lastUpdated: Date.now(),
          sourceProvenance: {
            endpoint: 'https://chatgpt.com/backend-api/wham/usage',
            method: 'oauth-api',
            timestamp: Date.now(),
            host: 'chatgpt.com',
          },
        },
      }
    } catch (err     ) {
      return {
        card: {
          id: cardId,
          name: cardName,
          provider: 'codex',
          category: this.category,
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



                          
                      
                       
                 
                
               
 

function getPlatformTag()         {
  switch (process.platform) {
    case 'win32': return 'windows'
    case 'darwin': return 'darwin'
    default: return 'linux'
  }
}

function getArchTag()         {
  if (process.arch === 'x64') return 'amd64'
  if (process.arch === 'arm64') return 'arm64'
  return process.arch
}

const HUB_CLIENT_MIN_VERSION = '2.26.0'

function buildHubUserAgent(version = HUB_CLIENT_MIN_VERSION)         {
  return `antigravity/hub/${version} (aidev_client; os_type=${getPlatformTag()}; arch=${getArchTag()})`
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

class AntigravityProvider                           {
  name = 'antigravity'
  category = 'ide'         

          databasePaths()           {
    const paths           = []
    const appNames = ['Antigravity IDE', 'Antigravity', 'Google Antigravity', 'antigravity', 'Antigravity - Insiders']
    for (const name of appNames) {
      paths.push(...getAppStoragePaths(name, 'User/globalStorage/state.vscdb'))
      paths.push(...getAppStoragePaths(name, 'User\\globalStorage\\state.vscdb'))
    }
    return [...new Set(paths)]
  }

          loadToken(config             , accountConfig                    )                        {
    const customOauth = accountConfig?.oauth || config.antigravity?.oauth
    if (customOauth?.accessToken || customOauth?.refreshToken) {
      return {
        accessToken: customOauth.accessToken,
        refreshToken: customOauth.refreshToken,
        expiry: customOauth.expiresAt ? Math.floor(customOauth.expiresAt / 1000) : undefined,
        email: customOauth.email,
        name: customOauth.name,
      }
    }

    if (config.antigravity?.autoDetectLocal !== false && accountConfig?.autoDetectLocal !== false) {
      let DatabaseSync     
      try {
        const requireFromHere = createRequire(import.meta.url)
        DatabaseSync = requireFromHere('node:sqlite')?.DatabaseSync
      } catch {}

      if (!DatabaseSync) return null

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

          async activeToken(token                , config             , accountConfig                    )                  {
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
    }, config.httpProxy, 15000, config.proxyMode)

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

    if (accountConfig?.oauth) {
      accountConfig.oauth.accessToken = newAccessToken
      accountConfig.oauth.expiresAt = expiresAt
    } else if (config.antigravity?.oauth) {
      config.antigravity.oauth.accessToken = newAccessToken
      config.antigravity.oauth.expiresAt = expiresAt
    }

    return newAccessToken
  }

  async testConnection(config             , accountConfig                    )                                {
    const start = Date.now()
    const tokenInfo = this.loadToken(config, accountConfig)
    if (!tokenInfo) {
      return {
        ok: false,
        provider: 'antigravity',
        message: '未找到 Antigravity 登录态。请点击登录 Google 或启动 Antigravity IDE 登录',
      }
    }

    try {
      const accessToken = await this.activeToken(tokenInfo, config, accountConfig)
      const hubUa = buildHubUserAgent()
      const res = await fetchWithProxy('https://daily-cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'User-Agent': hubUa,
          'X-Goog-Api-Client': 'antigravity',
        },
        body: '{}',
      }, config.httpProxy, 10000, config.proxyMode)

      const latencyMs = Date.now() - start
      if (res.ok) {
        const data = await res.json()       
        const groupCount = Array.isArray(data?.groups) ? data.groups.length : 0
        const hasArgon = (data?.groups || []).some((g     ) =>
          (g.displayName || '').toLowerCase().includes('argon') || (g.displayName || '').toLowerCase().includes('gemini 4')
        )
        const accountDesc = tokenInfo.email || config.antigravity?.oauth?.email || '已连接'
        const poolSummary = hasArgon ? '已获取全部额度池 (包含 Gemini 4 Argon)' : `已连接 (${groupCount} 个额度分组)`
        return {
          ok: true,
          provider: 'antigravity',
          latencyMs,
          account: accountDesc,
          message: `连接成功 (延迟: ${latencyMs}ms, ${poolSummary})`,
        }
      }

      return {
        ok: false,
        provider: 'antigravity',
        latencyMs,
        message: `HTTP 响应状态码异常 (${res.status})`,
      }
    } catch (err     ) {
      return {
        ok: false,
        provider: 'antigravity',
        latencyMs: Date.now() - start,
        message: `网络连接异常: ${err.message}`,
      }
    }
  }

  async fetchCard(config             , accountConfig                    )                          {
    const cardId = accountConfig?.id || 'antigravity'
    const cardName = accountConfig?.name || config.customNames?.antigravity || config.antigravity?.name || 'Google Antigravity'
    const tokenInfo = this.loadToken(config, accountConfig)

    if (!tokenInfo) {
      return {
        card: {
          id: cardId,
          name: cardName,
          provider: 'antigravity',
          category: this.category,
          status: 'disabled',
          error: '未连接 Antigravity。请点击「登录 Google」完成网页授权，或启动 Antigravity IDE 登录',
          groups: [],
          lastUpdated: Date.now(),
        },
      }
    }

    try {
      const accessToken = await this.activeToken(tokenInfo, config, accountConfig)

      // Try fetching profile if email is not known
      let accountEmail = tokenInfo.email || config.antigravity?.oauth?.email
      if (!accountEmail) {
        try {
          const infoRes = await fetchWithProxy('https://www.googleapis.com/oauth2/v2/userinfo', {
            headers: { Authorization: `Bearer ${accessToken}` },
          }, config.httpProxy, 8000, config.proxyMode)
          if (infoRes.ok) {
            const info = await infoRes.json()       
            accountEmail = info.email
            if (accountConfig?.oauth) {
              accountConfig.oauth.email = info.email
              accountConfig.oauth.name = info.name
            } else if (config.antigravity?.oauth) {
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
      let successfulEndpoint = ''
      const hubUa = buildHubUserAgent()

      for (const endpoint of summaryEndpoints) {
        try {
          const res = await fetchWithProxy(endpoint, {
            method: 'POST',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
              'User-Agent': hubUa,
              'X-Goog-Api-Client': 'antigravity',
            },
            body: '{}',
          }, config.httpProxy, 15000, config.proxyMode)

          if (res.ok) {
            summaryData = await res.json()
            successfulEndpoint = endpoint
            break
          } else {
            lastFetchErr = `HTTP ${res.status}`
          }
        } catch (e     ) {
          lastFetchErr = e.message
        }
      }

      const groups                = []
      let hasArgonPool = false

      if (summaryData?.groups && Array.isArray(summaryData.groups)) {
        for (const g of summaryData.groups) {
          const windows                 = []
          const nameLower = (g.displayName || '').toLowerCase()
          const isArgon = nameLower.includes('argon') || nameLower.includes('gemini 4')
          const isGemini = !isArgon && nameLower.includes('gemini')
          const isClaude = nameLower.includes('claude') || nameLower.includes('gpt')
          const poolType = isArgon ? 'argon' : (isGemini ? 'gemini' : (isClaude ? 'claude_gpt' : 'general'))
          if (isArgon) hasArgonPool = true

          for (const b of (g.buckets || [])) {
            const frac = typeof b.remainingFraction === 'number' ? b.remainingFraction : (b.remainingFraction !== undefined ? Number(b.remainingFraction) : undefined)
            const hasFrac = frac !== undefined && !isNaN(frac)
            const rem = hasFrac ? Math.max(0, Math.min(100, Math.round(frac * 100))) : 0
            const isWeekly = b.window === 'WINDOW_WEEKLY' || (b.displayName && b.displayName.toLowerCase().includes('weekly')) || (b.bucketId && b.bucketId.toLowerCase().includes('weekly'))
            const is5Hour = b.window === 'WINDOW_5_HOUR' || b.window === 'WINDOW_5H' || (b.displayName && (b.displayName.toLowerCase().includes('5h') || b.displayName.toLowerCase().includes('five')))
            const windowKind = isWeekly ? 'weekly' : (is5Hour ? '5h' : 'unknown')

            let winId = b.bucketId || (isArgon ? 'argon-weekly' : (isGemini ? (isWeekly ? 'gemini-weekly' : 'gemini-5h') : (isClaude ? (isWeekly ? 'claude-weekly' : 'claude-5h') : (isWeekly ? 'weekly' : '5h'))))

            const status = !hasFrac ? 'unknown' : (rem <= 0 ? 'exhausted' : 'active')
            const label = isWeekly ? (isArgon ? 'Weekly Limit (Argon)' : 'Weekly Limit') : (is5Hour ? '5-Hour Limit' : (b.displayName || 'Quota Limit'))
            const subtitle = hasFrac ? formatQuotaResetText(b.resetTime, 100 - rem, Boolean(isWeekly)) : '额度状态未知'

            if (!windows.some(w => w.id === winId)) {
              windows.push({
                id: winId,
                label,
                subtitle,
                usedPercent: 100 - rem,
                remainingPercent: rem,
                resetAt: b.resetTime,
                barType: 'circle',
                status,
                rawFraction: frac,
                windowKind,
                bucketId: b.bucketId,
                modelFamily: isArgon ? 'gemini-4-argon' : (isGemini ? 'gemini' : (isClaude ? 'claude' : undefined)),
              })
            }
          }

          if (windows.length > 0) {
            const title = isArgon ? 'Gemini 4 Argon' : (g.displayName || (isGemini ? 'Gemini Models' : (isClaude ? 'Claude and GPT models' : 'Model Quotas')))
            groups.push({
              id: `antigravity-pool-${poolType}`,
              title,
              hasInfoIcon: true,
              poolType,
              windows,
            })
          }
        }
      }

      // Fallback endpoint if retrieveUserQuotaSummary is empty
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
            }, config.httpProxy, 15000, config.proxyMode)
            if (res.ok) {
              modelData = await res.json()
              successfulEndpoint = endpoint
              break
            }
          } catch {}
        }

        if (modelData?.models) {
          const geminiWindows                 = []
          const claudeGptWindows                 = []
          const argonWindows                 = []

          for (const [id, model] of Object.entries(modelData.models)                        ) {
            const quota = model?.quotaInfo
            if (typeof quota?.remainingFraction !== 'number') continue
            const rem = Math.max(0, Math.min(100, Math.round(quota.remainingFraction * 100)))
            const isWeekly = id.toLowerCase().includes('weekly') || (model.displayName && model.displayName.toLowerCase().includes('weekly'))
            const is5Hour = id.toLowerCase().includes('five') || id.toLowerCase().includes('5hour') || (model.displayName && model.displayName.toLowerCase().includes('five'))
            const isArgon = id.toLowerCase().includes('argon') || (model.displayName && model.displayName.toLowerCase().includes('argon'))
            const isGemini = !isArgon && id.toLowerCase().includes('gemini')
            const cleanLabel = isWeekly ? (isArgon ? 'Weekly Limit (Argon)' : 'Weekly Limit') : is5Hour ? '5-Hour Limit' : (model.displayName || id)
            const subtitle = formatQuotaResetText(quota.resetTime, 100 - rem, Boolean(isWeekly))
            
            const winId = isArgon
              ? (isWeekly ? 'argon-weekly' : 'argon-5h')
              : isGemini
                ? (isWeekly ? 'gemini-weekly' : 'gemini-5h')
                : (isWeekly ? 'claude-weekly' : 'claude-5h')

            const targetList = isArgon ? argonWindows : (isGemini ? geminiWindows : claudeGptWindows)
            if (!targetList.some(w => w.id === winId)) {
              targetList.push({
                id: winId,
                label: cleanLabel,
                subtitle,
                usedPercent: 100 - rem,
                remainingPercent: rem,
                resetAt: quota.resetTime,
                barType: 'circle',
                status: rem <= 0 ? 'exhausted' : 'active',
                rawFraction: quota.remainingFraction,
                windowKind: isWeekly ? 'weekly' : (is5Hour ? '5h' : 'unknown'),
                bucketId: id,
                modelFamily: isArgon ? 'gemini-4-argon' : (isGemini ? 'gemini' : 'claude'),
              })
            }
          }

          if (geminiWindows.length > 0) groups.push({ id: 'antigravity-pool-gemini', title: 'Gemini Models', poolType: 'gemini', hasInfoIcon: true, windows: geminiWindows })
          if (claudeGptWindows.length > 0) groups.push({ id: 'antigravity-pool-claude', title: 'Claude and GPT models', poolType: 'claude_gpt', hasInfoIcon: true, windows: claudeGptWindows })
          if (argonWindows.length > 0) {
            groups.push({ id: 'antigravity-pool-argon', title: 'Gemini 4 Argon', poolType: 'argon', hasInfoIcon: true, windows: argonWindows })
            hasArgonPool = true
          }
        }
      }

      if (groups.length === 0 && lastFetchErr) {
        throw new Error(`无法获取额度明细 (${lastFetchErr})。若处于受限网络，请在设置中配置 HTTP 代理。`)
      }

      // Check overall status: if any group has active windows vs exhausted
      const allWindows = groups.flatMap(g => g.windows)
      const hasAnyRemaining = allWindows.some(w => w.remainingPercent > 0)
      const isAnyLow = allWindows.some(w => w.remainingPercent > 0 && w.remainingPercent <= (config.alarmThresholdPercent ?? 15))
      const cardStatus = allWindows.length === 0 ? 'ok' : (!hasAnyRemaining ? 'error' : (isAnyLow ? 'warn' : 'ok'))
      const planName = summaryData?.plan || (hasArgonPool ? 'Antigravity Pro / Ultra' : 'Google Antigravity')

      return {
        card: {
          id: cardId,
          name: cardName,
          provider: 'antigravity',
          category: this.category,
          status: cardStatus,
          plan: planName,
          account: accountEmail,
          groups,
          lastUpdated: Date.now(),
          sourceProvenance: {
            endpoint: successfulEndpoint,
            method: groups.length > 0 && summaryData?.groups ? 'official-summary' : 'model-fallback',
            timestamp: Date.now(),
            partial: groups.length < 3,
            host: successfulEndpoint ? new URL(successfulEndpoint).hostname : undefined,
          },
        },
      }
    } catch (err     ) {
      return {
        card: {
          id: cardId,
          name: cardName,
          provider: 'antigravity',
          category: this.category,
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



class GitHubCopilotProvider                           {
  name = 'github_copilot'
  category = 'ide'         

          findLocalToken()                {
    const paths = getHomeConfigPaths('github-copilot', 'hosts.json')
    for (const p of paths) {
      if (!existsSync(p)) continue
      try {
        const raw = readFileSync(p, 'utf8')
        const data = JSON.parse(raw)                                                           
        for (const val of Object.values(data)) {
          if (val?.oauth_token) return val.oauth_token
        }
      } catch {}
    }
    return null
  }

          resolveToken(config             , accountConfig                    )                {
    const direct = (accountConfig?.apiKey || accountConfig?.sessionToken || config.github_copilot?.token)?.trim()
    if (direct) return direct

    if (config.github_copilot?.autoDetectLocal !== false && accountConfig?.autoDetectLocal !== false) {
      return this.findLocalToken()
    }
    return null
  }

  async testConnection(config             , accountConfig                    )                                {
    const start = Date.now()
    const token = this.resolveToken(config, accountConfig)
    if (!token) {
      return {
        ok: false,
        provider: 'github_copilot',
        message: '未找到 GitHub Copilot 凭据。请在设置中配置 Token 或确保本地 Copilot 已登录',
      }
    }

    try {
      const res = await fetchWithProxy('https://api.github.com/user', {
        headers: {
          Authorization: `token ${token}`,
          Accept: 'application/vnd.github.v3+json',
          'User-Agent': 'dsh-quota',
        },
      }, config.httpProxy, 10000)

      const latencyMs = Date.now() - start
      if (res.ok) {
        const user = await res.json()       
        return {
          ok: true,
          provider: 'github_copilot',
          latencyMs,
          account: user.login || 'GitHub User',
          message: `连接成功 (延迟: ${latencyMs}ms, 用户: ${user.login})`,
        }
      }

      return {
        ok: false,
        provider: 'github_copilot',
        latencyMs,
        message: `验证失败: HTTP ${res.status}`,
      }
    } catch (err     ) {
      return {
        ok: false,
        provider: 'github_copilot',
        latencyMs: Date.now() - start,
        message: `请求异常: ${err.message}`,
      }
    }
  }

  async fetchCard(config             , accountConfig                    )                          {
    const cardId = accountConfig?.id || 'github_copilot'
    const cardName = accountConfig?.name || 'GitHub Copilot'
    const token = this.resolveToken(config, accountConfig)

    if (!token) {
      return {
        card: {
          id: cardId,
          name: cardName,
          provider: 'github_copilot',
          category: this.category,
          status: 'disabled',
          error: '未连接 Copilot。请在设置中配置 GitHub Token 或登录 Copilot 插件',
          groups: [],
          lastUpdated: Date.now(),
        },
      }
    }

    try {
      const headers = {
        Authorization: `token ${token}`,
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'dsh-quota',
      }

      const [userRes, copilotTokenRes] = await Promise.all([
        fetchWithProxy('https://api.github.com/user', { headers }, config.httpProxy, 10000),
        fetchWithProxy('https://api.github.com/copilot_internal/v2/token', { headers }, config.httpProxy, 10000),
      ])

      const user = userRes.ok ? await userRes.json()        : {}
      const copilotInfo = copilotTokenRes.ok ? await copilotTokenRes.json()        : {}

      const hasAccess = copilotTokenRes.ok || userRes.ok
      const plan = copilotInfo.sku ? `Copilot ${copilotInfo.sku}` : 'Copilot Active'

      return {
        card: {
          id: cardId,
          name: cardName,
          provider: 'github_copilot',
          category: this.category,
          status: hasAccess ? 'ok' : 'error',
          plan,
          account: user.login || user.email,
          groups: [
            {
              title: 'Copilot 订阅与状态',
              windows: [
                {
                  id: 'copilot-status',
                  label: 'Copilot 订阅状态',
                  subtitle: hasAccess ? '订阅正常 · 额度充足' : '订阅未激活或已过期',
                  usedPercent: hasAccess ? 0 : 100,
                  remainingPercent: hasAccess ? 100 : 0,
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
          id: cardId,
          name: cardName,
          provider: 'github_copilot',
          category: this.category,
          status: 'error',
          error: err.message,
          groups: [],
          lastUpdated: Date.now(),
        },
      }
    }
  }
}



class OpenAIBillingProvider                           {
  name = 'openai_billing'
  category = 'official_cloud'         

          resolveKey(config             , accountConfig                    )                                      {
    let apiKey = ''
    if (accountConfig && accountConfig.apiKey !== undefined) apiKey = accountConfig.apiKey
    else if (config.openai_billing && config.openai_billing.apiKey !== undefined) apiKey = config.openai_billing.apiKey
    apiKey = apiKey.trim().replace(/^Bearer\s+/i, '')
    const baseUrl = (accountConfig?.baseUrl || config.openai_billing?.baseUrl || 'https://api.openai.com').replace(/\/+$/, '')
    return { apiKey, baseUrl }
  }

  async testConnection(config             , accountConfig                    )                                {
    const start = Date.now()
    const { apiKey, baseUrl } = this.resolveKey(config, accountConfig)
    if (!apiKey) {
      return {
        ok: false,
        provider: 'openai_billing',
        message: '未配置 OpenAI API Key。请在「设置」中填入 Key',
      }
    }

    try {
      const res = await fetchWithProxy(`${baseUrl}/v1/models`, {
        headers: { Authorization: `Bearer ${apiKey}` },
      }, config.httpProxy, 10000)

      const latencyMs = Date.now() - start
      if (res.ok) {
        return {
          ok: true,
          provider: 'openai_billing',
          latencyMs,
          message: `连接成功 (延迟: ${latencyMs}ms)`,
        }
      }
      return {
        ok: false,
        provider: 'openai_billing',
        latencyMs,
        message: `验证失败: HTTP ${res.status}`,
      }
    } catch (err     ) {
      return {
        ok: false,
        provider: 'openai_billing',
        latencyMs: Date.now() - start,
        message: `请求异常: ${err.message}`,
      }
    }
  }

  async fetchCard(config             , accountConfig                    )                          {
    const cardId = accountConfig?.id || 'openai_billing'
    const cardName = accountConfig?.name || 'OpenAI Platform (API)'
    const { apiKey, baseUrl } = this.resolveKey(config, accountConfig)

    if (!apiKey) {
      return {
        card: {
          id: cardId,
          name: cardName,
          provider: 'openai_billing',
          category: this.category,
          status: 'disabled',
          error: '未配置 API Key。请在设置中填入 OpenAI API Key',
          groups: [],
          lastUpdated: Date.now(),
        },
      }
    }

    try {
      // Fetch models or subscription
      const headers = { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' }
      const [modelsRes, subRes] = await Promise.allSettled([
        fetchWithProxy(`${baseUrl}/v1/models`, { headers }, config.httpProxy, 10000),
        fetchWithProxy(`${baseUrl}/v1/dashboard/billing/subscription`, { headers }, config.httpProxy, 10000),
      ])

      if (modelsRes.status === 'rejected' || (modelsRes.status === 'fulfilled' && !modelsRes.value.ok)) {
        const err = modelsRes.status === 'fulfilled' ? `HTTP ${modelsRes.value.status}` : (modelsRes       ).reason?.message
        throw new Error(`OpenAI Key 验证失败: ${err}`)
      }

      let hardLimit = 0
      let totalUsage = 0
      let hasBilling = false

      if (subRes.status === 'fulfilled' && subRes.value.ok) {
        const subData = await subRes.value.json()       
        hardLimit = subData.hard_limit_usd ?? subData.system_hard_limit_usd ?? 0
        hasBilling = true
      }

      const remPercent = hasBilling && hardLimit > 0 ? Math.max(0, Math.min(100, Math.round(((hardLimit - totalUsage) / hardLimit) * 100))) : 100
      const usedPercent = 100 - remPercent

      const subtitle = hasBilling && hardLimit > 0
        ? `总限额: $${hardLimit.toFixed(2)} USD`
        : 'API Key 有效 · 官方未开放余额查询'

      return {
        card: {
          id: cardId,
          name: cardName,
          provider: 'openai_billing',
          category: this.category,
          status: hasBilling && remPercent <= 15 ? 'warn' : 'ok',
          plan: 'OpenAI API',
          balance: hasBilling ? { currency: 'USD', total: hardLimit, remaining: hardLimit - totalUsage } : undefined,
          groups: [
            {
              id: 'openai-billing-group',
              title: 'OpenAI 额度监控',
              hasInfoIcon: true,
              poolType: 'general',
              windows: [
                {
                  id: 'openai-api-limit',
                  label: 'API Key 可用状态',
                  subtitle,
                  usedPercent,
                  remainingPercent: remPercent,
                  barType: 'circle',
                  status: hasBilling ? (remPercent <= 0 ? 'exhausted' : 'active') : 'unknown',
                },
              ],
            },
          ],
          lastUpdated: Date.now(),
          sourceProvenance: {
            endpoint: `${baseUrl}/v1/models`,
            method: 'oauth-api',
            timestamp: Date.now(),
            host: 'api.openai.com',
          },
        },
      }
    } catch (err     ) {
      return {
        card: {
          id: cardId,
          name: cardName,
          provider: 'openai_billing',
          category: this.category,
          status: 'error',
          error: err.message,
          groups: [],
          lastUpdated: Date.now(),
        },
      }
    }
  }
}



class ClaudeProvider                           {
  name = 'claude'
  category = 'official_cloud'         

          resolveTarget(config             , accountConfig                    )                                      {
    let apiKey = (accountConfig?.apiKey !== undefined
      ? accountConfig.apiKey
      : (config.claude?.apiKey || '')).trim()
    const baseUrl = (accountConfig?.baseUrl || config.claude?.baseUrl || 'https://api.anthropic.com').replace(/\/+$/, '')
    return { apiKey, baseUrl }
  }

  async testConnection(config             , accountConfig                    )                                {
    const start = Date.now()
    const { apiKey, baseUrl } = this.resolveTarget(config, accountConfig)
    if (!apiKey) {
      return {
        ok: false,
        provider: 'claude',
        message: '未配置 Anthropic API Key (sk-ant-...)',
      }
    }

    try {
      const res = await fetchWithProxy(`${baseUrl}/v1/models`, {
        method: 'GET',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          Accept: 'application/json',
        },
        redirect: 'error',
      }, config.httpProxy, 10000, config.proxyMode)

      const latencyMs = Date.now() - start
      if (res.ok || res.status === 200) {
        return {
          ok: true,
          provider: 'claude',
          latencyMs,
          message: `连接成功 (延迟: ${latencyMs}ms)`,
        }
      }

      const errText = await res.text()
      return {
        ok: false,
        provider: 'claude',
        latencyMs,
        message: `验证失败 (HTTP ${res.status}): ${errText.slice(0, 60)}`,
      }
    } catch (err     ) {
      return {
        ok: false,
        provider: 'claude',
        latencyMs: Date.now() - start,
        message: `请求异常: ${err.message}`,
      }
    }
  }

  async fetchCard(config             , accountConfig                    )                          {
    const cardId = accountConfig?.id || 'claude'
    const cardName = accountConfig?.name || 'Anthropic Claude'
    const { apiKey, baseUrl } = this.resolveTarget(config, accountConfig)

    if (!apiKey) {
      return {
        card: {
          id: cardId,
          name: cardName,
          provider: 'claude',
          category: this.category,
          status: 'disabled',
          error: '未配置 API Key。请在设置中填入 Anthropic API Key',
          groups: [],
          lastUpdated: Date.now(),
        },
      }
    }

    try {
      const res = await fetchWithProxy(`${baseUrl}/v1/models`, {
        method: 'GET',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          Accept: 'application/json',
        },
        redirect: 'error',
      }, config.httpProxy, 10000, config.proxyMode)

      if (!res.ok) {
        throw new Error(`Claude API 验证失败 (${res.status})`)
      }

      const reqRemaining = res.headers.get('anthropic-ratelimit-requests-remaining')
      const reqLimit = res.headers.get('anthropic-ratelimit-requests-limit')
      let remPercent = 100
      let subtitle = 'API 凭据有效 · 额度正常'

      if (reqRemaining && reqLimit) {
        const rem = parseInt(reqRemaining, 10)
        const lim = parseInt(reqLimit, 10)
        if (lim > 0) {
          remPercent = Math.max(0, Math.min(100, Math.round((rem / lim) * 100)))
          subtitle = `速率余量: ${remPercent}% (${rem}/${lim})`
        }
      }
      const usedPercent = 100 - remPercent

      return {
        card: {
          id: cardId,
          name: cardName,
          provider: 'claude',
          category: this.category,
          status: remPercent <= 15 ? 'warn' : 'ok',
          plan: 'Anthropic Claude',
          groups: [
            {
              title: 'Claude 账户配额',
              windows: [
                {
                  id: 'claude-active',
                  label: 'API Key 可用状态',
                  subtitle,
                  usedPercent,
                  remainingPercent: remPercent,
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
          id: cardId,
          name: cardName,
          provider: 'claude',
          category: this.category,
          status: 'error',
          error: err.message,
          groups: [],
          lastUpdated: Date.now(),
        },
      }
    }
  }
}



class KimiProvider                           {
  name = 'kimi'
  category = 'domestic_llm'         

          resolveKey(config             , accountConfig                    )                                      {
    let apiKey = ''
    if (accountConfig && accountConfig.apiKey !== undefined) apiKey = accountConfig.apiKey
    else if (config.kimi && config.kimi.apiKey !== undefined) apiKey = config.kimi.apiKey
    apiKey = apiKey.trim().replace(/^Bearer\s+/i, '')
    const baseUrl = (accountConfig?.baseUrl || config.kimi?.baseUrl || 'https://api.moonshot.cn').replace(/\/+$/, '')
    return { apiKey, baseUrl }
  }

  async testConnection(config             , accountConfig                    )                                {
    const start = Date.now()
    const { apiKey, baseUrl } = this.resolveKey(config, accountConfig)
    if (!apiKey) {
      return {
        ok: false,
        provider: 'kimi',
        message: '未配置 Kimi / Moonshot API Key',
      }
    }

    try {
      const url = `${baseUrl}/v1/users/me/balance`
      const res = await fetchWithProxy(url, {
        headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
      }, config.httpProxy, 10000)

      const latencyMs = Date.now() - start
      if (res.ok) {
        const json = await res.json()       
        const bal = json.data?.available_balance ?? '0.00'
        return {
          ok: true,
          provider: 'kimi',
          latencyMs,
          account: `可用余额: ¥${bal}`,
          message: `连接成功 (延迟: ${latencyMs}ms, 余额: ¥${bal})`,
        }
      }

      return {
        ok: false,
        provider: 'kimi',
        latencyMs,
        message: `验证失败: HTTP ${res.status}`,
      }
    } catch (err     ) {
      return {
        ok: false,
        provider: 'kimi',
        latencyMs: Date.now() - start,
        message: `请求异常: ${err.message}`,
      }
    }
  }

  async fetchCard(config             , accountConfig                    )                          {
    const cardId = accountConfig?.id || 'kimi'
    const cardName = accountConfig?.name || 'Moonshot Kimi'
    const { apiKey, baseUrl } = this.resolveKey(config, accountConfig)

    if (!apiKey) {
      return {
        card: {
          id: cardId,
          name: cardName,
          provider: 'kimi',
          category: this.category,
          status: 'disabled',
          error: '未配置 API Key。请在设置中填入 Kimi (Moonshot) Key',
          groups: [],
          lastUpdated: Date.now(),
        },
      }
    }

    try {
      const url = `${baseUrl}/v1/users/me/balance`
      const res = await fetchWithProxy(url, {
        headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
      }, config.httpProxy, 15000)

      if (!res.ok) {
        throw new Error(`API 错误 (${res.status})`)
      }

      const json = await res.json()       
      const data = json.data || {}
      const available = typeof data.available_balance === 'number' ? data.available_balance : parseFloat(data.available_balance || '0')
      const cash = typeof data.cash_balance === 'number' ? data.cash_balance : parseFloat(data.cash_balance || '0')
      const voucher = typeof data.voucher_balance === 'number' ? data.voucher_balance : parseFloat(data.voucher_balance || '0')

      const remPercent = available > 0 ? (available < 5 ? 15 : available < 20 ? 40 : 100) : 0
      const usedPercent = 100 - remPercent

      const subtitle = `总额: ¥${available.toFixed(2)} (充值 ¥${cash.toFixed(2)} + 赠金 ¥${voucher.toFixed(2)})`

      return {
        card: {
          id: cardId,
          name: cardName,
          provider: 'kimi',
          category: this.category,
          status: available <= 0 ? 'error' : (available < 5 ? 'warn' : 'ok'),
          plan: 'Moonshot API',
          account: `¥${available.toFixed(2)} CNY`,
          balance: {
            currency: 'CNY',
            total: available,
            remaining: available,
            grantedBalance: voucher,
            toppedUpBalance: cash,
          },
          groups: [
            {
              title: 'Kimi 账户余额',
              windows: [
                {
                  id: 'kimi-balance',
                  label: '账户总可用余额 (CNY)',
                  subtitle,
                  usedPercent,
                  remainingPercent: remPercent,
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
          id: cardId,
          name: cardName,
          provider: 'kimi',
          category: this.category,
          status: 'error',
          error: err.message,
          groups: [],
          lastUpdated: Date.now(),
        },
      }
    }
  }
}



class GLMProvider                           {
  name = 'glm'
  category = 'domestic_llm'         

          resolveKey(config             , accountConfig                    )                                      {
    let apiKey = ''
    if (accountConfig && accountConfig.apiKey !== undefined) apiKey = accountConfig.apiKey
    else if (config.glm && config.glm.apiKey !== undefined) apiKey = config.glm.apiKey
    apiKey = apiKey.trim().replace(/^Bearer\s+/i, '')
    const baseUrl = (accountConfig?.baseUrl || config.glm?.baseUrl || 'https://open.bigmodel.cn').replace(/\/+$/, '')
    return { apiKey, baseUrl }
  }

  async testConnection(config             , accountConfig                    )                                {
    const start = Date.now()
    const { apiKey, baseUrl } = this.resolveKey(config, accountConfig)
    if (!apiKey) {
      return {
        ok: false,
        provider: 'glm',
        message: '未配置智谱 GLM API Key',
      }
    }

    try {
      // Light ping to bigmodel API
      const res = await fetchWithProxy(`${baseUrl}/api/paas/v4/models`, {
        headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
      }, config.httpProxy, 10000)

      const latencyMs = Date.now() - start
      if (res.ok) {
        return {
          ok: true,
          provider: 'glm',
          latencyMs,
          message: `连接成功 (延迟: ${latencyMs}ms)`,
        }
      }

      return {
        ok: false,
        provider: 'glm',
        latencyMs,
        message: `验证失败: HTTP ${res.status}`,
      }
    } catch (err     ) {
      return {
        ok: false,
        provider: 'glm',
        latencyMs: Date.now() - start,
        message: `请求异常: ${err.message}`,
      }
    }
  }

  async fetchCard(config             , accountConfig                    )                          {
    const cardId = accountConfig?.id || 'glm'
    const cardName = accountConfig?.name || '智谱清言 (GLM)'
    const { apiKey, baseUrl } = this.resolveKey(config, accountConfig)

    if (!apiKey) {
      return {
        card: {
          id: cardId,
          name: cardName,
          provider: 'glm',
          category: this.category,
          status: 'disabled',
          error: '未配置 API Key。请在设置中填入智谱 GLM API Key',
          groups: [],
          lastUpdated: Date.now(),
        },
      }
    }

    try {
      const res = await fetchWithProxy(`${baseUrl}/api/paas/v4/models`, {
        headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
      }, config.httpProxy, 10000)

      if (!res.ok) {
        throw new Error(`智谱 API 验证失败 (${res.status})`)
      }

      const data = await res.json()       
      const modelCount = Array.isArray(data.data) ? data.data.length : 0
      const subtitle = modelCount > 0 ? `智谱在线 · 已就绪 ${modelCount} 个模型` : 'API 凭据有效 · 额度正常'

      return {
        card: {
          id: cardId,
          name: cardName,
          provider: 'glm',
          category: this.category,
          status: 'ok',
          plan: 'BigModel GLM',
          groups: [
            {
              title: 'GLM 平台状态',
              windows: [
                {
                  id: 'glm-status',
                  label: 'GLM API 可用状态',
                  subtitle,
                  usedPercent: 0,
                  remainingPercent: 100,
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
          id: cardId,
          name: cardName,
          provider: 'glm',
          category: this.category,
          status: 'error',
          error: err.message,
          groups: [],
          lastUpdated: Date.now(),
        },
      }
    }
  }
}



class MiniMaxProvider                           {
  name = 'minimax'
  category = 'domestic_llm'         

          resolveKey(config             , accountConfig                    )                                                        {
    let apiKey = ''
    if (accountConfig && accountConfig.apiKey !== undefined) apiKey = accountConfig.apiKey
    else if (config.minimax && config.minimax.apiKey !== undefined) apiKey = config.minimax.apiKey
    apiKey = apiKey.trim().replace(/^Bearer\s+/i, '')
    const baseUrl = (accountConfig?.baseUrl || config.minimax?.baseUrl || 'https://api.minimax.chat').replace(/\/+$/, '')
    const groupId = accountConfig?.extra?.groupId || config.minimax?.groupId
    return { apiKey, baseUrl, groupId }
  }

  async testConnection(config             , accountConfig                    )                                {
    const start = Date.now()
    const { apiKey, baseUrl } = this.resolveKey(config, accountConfig)
    if (!apiKey) {
      return {
        ok: false,
        provider: 'minimax',
        message: '未配置 MiniMax API Key',
      }
    }

    try {
      const res = await fetchWithProxy(`${baseUrl}/v1/models`, {
        headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
      }, config.httpProxy, 10000)

      const latencyMs = Date.now() - start
      if (res.ok) {
        return {
          ok: true,
          provider: 'minimax',
          latencyMs,
          message: `连接成功 (延迟: ${latencyMs}ms)`,
        }
      }

      return {
        ok: false,
        provider: 'minimax',
        latencyMs,
        message: `验证失败: HTTP ${res.status}`,
      }
    } catch (err     ) {
      return {
        ok: false,
        provider: 'minimax',
        latencyMs: Date.now() - start,
        message: `请求异常: ${err.message}`,
      }
    }
  }

  async fetchCard(config             , accountConfig                    )                          {
    const cardId = accountConfig?.id || 'minimax'
    const cardName = accountConfig?.name || 'MiniMax (海螺)'
    const { apiKey, baseUrl } = this.resolveKey(config, accountConfig)

    if (!apiKey) {
      return {
        card: {
          id: cardId,
          name: cardName,
          provider: 'minimax',
          category: this.category,
          status: 'disabled',
          error: '未配置 API Key。请在设置中填入 MiniMax API Key',
          groups: [],
          lastUpdated: Date.now(),
        },
      }
    }

    try {
      const res = await fetchWithProxy(`${baseUrl}/v1/models`, {
        headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
      }, config.httpProxy, 10000)

      if (!res.ok) {
        throw new Error(`MiniMax API 验证失败 (${res.status})`)
      }

      return {
        card: {
          id: cardId,
          name: cardName,
          provider: 'minimax',
          category: this.category,
          status: 'ok',
          plan: 'MiniMax OpenPlatform',
          groups: [
            {
              title: 'MiniMax 账户状态',
              windows: [
                {
                  id: 'minimax-active',
                  label: 'API Key 可用状态',
                  subtitle: 'API 凭据有效 · 额度正常',
                  usedPercent: 0,
                  remainingPercent: 100,
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
          id: cardId,
          name: cardName,
          provider: 'minimax',
          category: this.category,
          status: 'error',
          error: err.message,
          groups: [],
          lastUpdated: Date.now(),
        },
      }
    }
  }
}



class QwenProvider                           {
  name = 'qwen'
  category = 'domestic_llm'         

          resolveKey(config             , accountConfig                    )                                      {
    let apiKey = ''
    if (accountConfig && accountConfig.apiKey !== undefined) apiKey = accountConfig.apiKey
    else if (config.qwen && config.qwen.apiKey !== undefined) apiKey = config.qwen.apiKey
    apiKey = apiKey.trim().replace(/^Bearer\s+/i, '')
    const baseUrl = (accountConfig?.baseUrl || config.qwen?.baseUrl || 'https://dashscope.aliyuncs.com').replace(/\/+$/, '')
    return { apiKey, baseUrl }
  }

  async testConnection(config             , accountConfig                    )                                {
    const start = Date.now()
    const { apiKey, baseUrl } = this.resolveKey(config, accountConfig)
    if (!apiKey) {
      return {
        ok: false,
        provider: 'qwen',
        message: '未配置通义千问 (DashScope) API Key',
      }
    }

    try {
      const res = await fetchWithProxy(`${baseUrl}/compatible-mode/v1/models`, {
        headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
      }, config.httpProxy, 10000)

      const latencyMs = Date.now() - start
      if (res.ok) {
        const data = await res.json()       
        const count = Array.isArray(data.data) ? data.data.length : 0
        return {
          ok: true,
          provider: 'qwen',
          latencyMs,
          account: `阿里云 DashScope (${count} 个模型在线)`,
          message: `连接成功 (延迟: ${latencyMs}ms, 在线模型: ${count})`,
        }
      }

      const errText = await res.text()
      return {
        ok: false,
        provider: 'qwen',
        latencyMs,
        message: `验证失败 (HTTP ${res.status}): ${errText.slice(0, 50)}`,
      }
    } catch (err     ) {
      return {
        ok: false,
        provider: 'qwen',
        latencyMs: Date.now() - start,
        message: `请求异常: ${err.message}`,
      }
    }
  }

  async fetchCard(config             , accountConfig                    )                          {
    const cardId = accountConfig?.id || 'qwen'
    const cardName = accountConfig?.name || '阿里通义千问 (百炼)'
    const { apiKey, baseUrl } = this.resolveKey(config, accountConfig)

    if (!apiKey) {
      return {
        card: {
          id: cardId,
          name: cardName,
          provider: 'qwen',
          category: this.category,
          status: 'disabled',
          error: '未配置 API Key。请在设置中填入 DashScope API Key',
          groups: [],
          lastUpdated: Date.now(),
        },
      }
    }

    try {
      const res = await fetchWithProxy(`${baseUrl}/compatible-mode/v1/models`, {
        headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
      }, config.httpProxy, 12000)

      if (!res.ok) {
        throw new Error(`百炼 API 验证失败 (${res.status})`)
      }

      const data = await res.json()       
      const modelList = Array.isArray(data.data) ? data.data.map((m     ) => m.id) : []
      const hasQwenMax = modelList.some((m        ) => m.includes('qwen-max'))
      const hasQwenPlus = modelList.some((m        ) => m.includes('qwen-plus'))
      const hasQwenCoder = modelList.some((m        ) => m.includes('qwen-coder') || m.includes('qwen-2.5-coder'))

      const subStatus = `百炼在线 · 支持 ${hasQwenMax ? 'Max ' : ''}${hasQwenPlus ? 'Plus ' : ''}${hasQwenCoder ? 'Coder' : ''}`.trim()

      return {
        card: {
          id: cardId,
          name: cardName,
          provider: 'qwen',
          category: this.category,
          status: 'ok',
          plan: 'DashScope 百炼',
          account: 'DashScope Active',
          groups: [
            {
              title: '通义千问服务状态',
              hasInfoIcon: true,
              windows: [
                {
                  id: 'qwen-active',
                  label: 'Qwen 全系模型连通性',
                  subtitle: subStatus || 'API 凭据有效 · 额度正常',
                  usedPercent: 0,
                  remainingPercent: 100,
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
          id: cardId,
          name: cardName,
          provider: 'qwen',
          category: this.category,
          status: 'error',
          error: err.message,
          groups: [],
          lastUpdated: Date.now(),
        },
      }
    }
  }
}



class VolcengineProvider                           {
  name = 'volcengine'
  category = 'domestic_llm'         

          resolveKey(config             , accountConfig                    )                                      {
    let apiKey = ''
    if (accountConfig && accountConfig.apiKey !== undefined) apiKey = accountConfig.apiKey
    else if (config.volcengine && config.volcengine.apiKey !== undefined) apiKey = config.volcengine.apiKey
    apiKey = apiKey.trim().replace(/^Bearer\s+/i, '')
    const baseUrl = (accountConfig?.baseUrl || config.volcengine?.baseUrl || 'https://ark.cn-beijing.volces.com').replace(/\/+$/, '')
    return { apiKey, baseUrl }
  }

  async testConnection(config             , accountConfig                    )                                {
    const start = Date.now()
    const { apiKey, baseUrl } = this.resolveKey(config, accountConfig)
    if (!apiKey) {
      return {
        ok: false,
        provider: 'volcengine',
        message: '未配置火山方舟 API Key',
      }
    }

    try {
      const res = await fetchWithProxy(`${baseUrl}/api/v3/models`, {
        headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
      }, config.httpProxy, 10000)

      const latencyMs = Date.now() - start
      if (res.ok) {
        const data = await res.json()       
        const count = Array.isArray(data.data) ? data.data.length : 0
        return {
          ok: true,
          provider: 'volcengine',
          latencyMs,
          account: `火山方舟 (${count} 个接入点在线)`,
          message: `连接成功 (延迟: ${latencyMs}ms, 接入点: ${count})`,
        }
      }

      const errText = await res.text()
      return {
        ok: false,
        provider: 'volcengine',
        latencyMs,
        message: `验证失败 (HTTP ${res.status}): ${errText.slice(0, 50)}`,
      }
    } catch (err     ) {
      return {
        ok: false,
        provider: 'volcengine',
        latencyMs: Date.now() - start,
        message: `请求异常: ${err.message}`,
      }
    }
  }

  async fetchCard(config             , accountConfig                    )                          {
    const cardId = accountConfig?.id || 'volcengine'
    const cardName = accountConfig?.name || '火山方舟 (豆包)'
    const { apiKey, baseUrl } = this.resolveKey(config, accountConfig)

    if (!apiKey) {
      return {
        card: {
          id: cardId,
          name: cardName,
          provider: 'volcengine',
          category: this.category,
          status: 'disabled',
          error: '未配置 API Key。请在设置中填入火山方舟 API Key',
          groups: [],
          lastUpdated: Date.now(),
        },
      }
    }

    try {
      const res = await fetchWithProxy(`${baseUrl}/api/v3/models`, {
        headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
      }, config.httpProxy, 12000)

      if (!res.ok) {
        throw new Error(`火山方舟 API 验证失败 (${res.status})`)
      }

      const data = await res.json()       
      const endpoints = Array.isArray(data.data) ? data.data.length : 0
      const subText = endpoints > 0 ? `方舟在线 · 已授权 ${endpoints} 个推理接入点 (Endpoint)` : '火山方舟在线 · 额度正常'

      return {
        card: {
          id: cardId,
          name: cardName,
          provider: 'volcengine',
          category: this.category,
          status: 'ok',
          plan: 'Volcengine Ark',
          account: `${endpoints} Endpoints Active`,
          groups: [
            {
              title: '火山方舟服务状态',
              hasInfoIcon: true,
              windows: [
                {
                  id: 'volc-active',
                  label: '豆包与方舟推理接入点',
                  subtitle: subText,
                  usedPercent: 0,
                  remainingPercent: 100,
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
          id: cardId,
          name: cardName,
          provider: 'volcengine',
          category: this.category,
          status: 'error',
          error: err.message,
          groups: [],
          lastUpdated: Date.now(),
        },
      }
    }
  }
}



class SiliconFlowProvider                           {
  name = 'siliconflow'
  category = 'domestic_llm'         

          resolveTarget(config             , accountConfig                    )                                      {
    let apiKey = (accountConfig?.apiKey !== undefined
      ? accountConfig.apiKey
      : (config.siliconflow?.apiKey || process.env.SILICONFLOW_API_KEY || '')).trim()
    apiKey = apiKey.replace(/^Bearer\s+/i, '')
    const baseUrl = (accountConfig?.baseUrl || config.siliconflow?.baseUrl || 'https://api.siliconflow.cn').replace(/\/+$/, '')
    return { apiKey, baseUrl }
  }

  async testConnection(config             , accountConfig                    )                                {
    const start = Date.now()
    const { apiKey, baseUrl } = this.resolveTarget(config, accountConfig)
    if (!apiKey) {
      return {
        ok: false,
        provider: 'siliconflow',
        message: '未配置 SiliconFlow API Key。请在「设置」中填入 Key',
      }
    }

    try {
      const url = `${baseUrl}/v1/user/info`
      const res = await fetchWithProxy(url, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: 'application/json',
        },
      }, config.httpProxy, 10000)

      const latencyMs = Date.now() - start
      if (!res.ok) {
        let detail = `HTTP ${res.status}`
        try {
          const errData = await res.json()       
          if (errData?.message) detail = errData.message
        } catch {}
        return {
          ok: false,
          provider: 'siliconflow',
          latencyMs,
          message: `验证失败: ${detail}`,
        }
      }

      const json = await res.json()       
      const data = json.data || {}
      const bal = parseFloat(data.balance || '0')
      const name = data.name || data.email || 'SiliconFlow User'

      return {
        ok: true,
        provider: 'siliconflow',
        latencyMs,
        account: `余额: ¥${bal.toFixed(2)} CNY (${name})`,
        message: `连接成功 (延迟: ${latencyMs}ms, 余额: ¥${bal.toFixed(2)})`,
      }
    } catch (err     ) {
      return {
        ok: false,
        provider: 'siliconflow',
        latencyMs: Date.now() - start,
        message: `网络请求异常: ${err.message}`,
      }
    }
  }

  async fetchCard(config             , accountConfig                    )                          {
    const cardId = accountConfig?.id || 'siliconflow'
    const cardName = accountConfig?.name || config.customNames?.siliconflow || config.siliconflow?.name || '硅基流动 (SiliconFlow)'
    const { apiKey, baseUrl } = this.resolveTarget(config, accountConfig)

    if (!apiKey) {
      return {
        card: {
          id: cardId,
          name: cardName,
          provider: 'siliconflow',
          category: this.category,
          status: 'disabled',
          error: '未配置 API Key。请在「设置」中填入 SiliconFlow Key',
          groups: [],
          lastUpdated: Date.now(),
        },
      }
    }

    try {
      const url = `${baseUrl}/v1/user/info`
      const res = await fetchWithProxy(url, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: 'application/json',
        },
      }, config.httpProxy, 12000)

      if (!res.ok) {
        throw new Error(`硅基流动接口返回异常 (HTTP ${res.status})`)
      }

      const json = await res.json()       
      const data = json.data || {}
      const available = parseFloat(data.balance || '0')
      const charge = parseFloat(data.chargeBalance || '0')
      const total = parseFloat(data.totalBalance || String(available))

      const isLow = available <= 2
      const status = isLow ? 'warn' : 'ok'
      const remPercent = available > 0 ? (available < 5 ? 20 : available < 20 ? 50 : 100) : 0
      const usedPercent = 100 - remPercent

      const subtitle = `可用额度: ¥${available.toFixed(2)} CNY${charge > 0 ? ` (充值金 ¥${charge.toFixed(2)})` : ''}`

      return {
        card: {
          id: cardId,
          name: cardName,
          provider: 'siliconflow',
          category: this.category,
          status,
          plan: 'SiliconFlow Cloud',
          account: data.name || data.email || undefined,
          balance: {
            currency: 'CNY',
            total: total > available ? total : available,
            remaining: available,
            toppedUpBalance: charge,
          },
          groups: [
            {
              title: '硅基流动账户配额',
              windows: [
                {
                  id: 'siliconflow-balance',
                  label: '账户可用余额',
                  subtitle,
                  usedPercent,
                  remainingPercent: remPercent,
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
          id: cardId,
          name: cardName,
          provider: 'siliconflow',
          category: this.category,
          status: 'error',
          error: err.message,
          groups: [],
          lastUpdated: Date.now(),
        },
      }
    }
  }
}



class OpenRouterProvider                           {
  name = 'openrouter'
  category = 'official_cloud'         

          resolveTarget(config             , accountConfig                    )                                      {
    let apiKey = (accountConfig?.apiKey !== undefined
      ? accountConfig.apiKey
      : (config.openrouter?.apiKey || process.env.OPENROUTER_API_KEY || '')).trim()
    apiKey = apiKey.replace(/^Bearer\s+/i, '')
    const baseUrl = (accountConfig?.baseUrl || config.openrouter?.baseUrl || 'https://openrouter.ai/api').replace(/\/+$/, '')
    return { apiKey, baseUrl }
  }

  async testConnection(config             , accountConfig                    )                                {
    const start = Date.now()
    const { apiKey, baseUrl } = this.resolveTarget(config, accountConfig)
    if (!apiKey) {
      return {
        ok: false,
        provider: 'openrouter',
        message: '未配置 OpenRouter API Key。请在「设置」中填入 Key',
      }
    }

    try {
      const url = `${baseUrl}/v1/auth/key`
      const res = await fetchWithProxy(url, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: 'application/json',
        },
      }, config.httpProxy, 10000)

      const latencyMs = Date.now() - start
      if (!res.ok) {
        let detail = `HTTP ${res.status}`
        try {
          const errData = await res.json()       
          if (errData?.error?.message) detail = errData.error.message
        } catch {}
        return {
          ok: false,
          provider: 'openrouter',
          latencyMs,
          message: `验证失败: ${detail}`,
        }
      }

      const json = await res.json()       
      const data = json.data || {}
      const label = data.label || 'OpenRouter Key'
      const usage = typeof data.usage === 'number' ? data.usage : 0
      const limit = typeof data.limit === 'number' ? data.limit : null

      const limitStr = limit !== null ? `限额: $${limit.toFixed(2)} (已用 $${usage.toFixed(2)})` : `已用: $${usage.toFixed(2)} (无限额)`
      return {
        ok: true,
        provider: 'openrouter',
        latencyMs,
        account: `${label} · ${limitStr}`,
        message: `连接成功 (延迟: ${latencyMs}ms, ${limitStr})`,
      }
    } catch (err     ) {
      return {
        ok: false,
        provider: 'openrouter',
        latencyMs: Date.now() - start,
        message: `网络请求异常: ${err.message}`,
      }
    }
  }

  async fetchCard(config             , accountConfig                    )                          {
    const cardId = accountConfig?.id || 'openrouter'
    const cardName = accountConfig?.name || config.customNames?.openrouter || config.openrouter?.name || 'OpenRouter'
    const { apiKey, baseUrl } = this.resolveTarget(config, accountConfig)

    if (!apiKey) {
      return {
        card: {
          id: cardId,
          name: cardName,
          provider: 'openrouter',
          category: this.category,
          status: 'disabled',
          error: '未配置 API Key。请在「设置」中填入 OpenRouter Key',
          groups: [],
          lastUpdated: Date.now(),
        },
      }
    }

    try {
      const url = `${baseUrl}/v1/auth/key`
      const res = await fetchWithProxy(url, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: 'application/json',
        },
      }, config.httpProxy, 12000)

      if (!res.ok) {
        throw new Error(`OpenRouter 鉴权接口异常 (HTTP ${res.status})`)
      }

      const json = await res.json()       
      const data = json.data || {}
      const usage = typeof data.usage === 'number' ? data.usage : 0
      const limit = typeof data.limit === 'number' ? data.limit : null

      let remPercent = 100
      let usedPercent = 0
      let subtitle = `已消耗 $${usage.toFixed(2)} USD (无硬限额)`

      if (limit !== null && limit > 0) {
        usedPercent = Math.min(100, Math.round((usage / limit) * 100))
        remPercent = Math.max(0, 100 - usedPercent)
        const remainingBal = Math.max(0, limit - usage)
        subtitle = `总限额: $${limit.toFixed(2)} (剩余 $${remainingBal.toFixed(2)})`
      }

      const status = remPercent <= 15 ? 'warn' : 'ok'

      return {
        card: {
          id: cardId,
          name: cardName,
          provider: 'openrouter',
          category: this.category,
          status,
          plan: data.is_free_tier ? 'OpenRouter Free' : 'OpenRouter Paid',
          account: data.label || undefined,
          balance: {
            currency: 'USD',
            total: limit ?? undefined,
            used: usage,
            remaining: limit !== null ? Math.max(0, limit - usage) : undefined,
          },
          groups: [
            {
              title: 'OpenRouter 配额状态',
              windows: [
                {
                  id: 'openrouter-limit',
                  label: 'API 额度使用状态',
                  subtitle,
                  usedPercent,
                  remainingPercent: remPercent,
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
          id: cardId,
          name: cardName,
          provider: 'openrouter',
          category: this.category,
          status: 'error',
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
  category = 'official_cloud'         

  async testConnection(config             , accountConfig                    )                                {
    const start = Date.now()
    const apiKey = (accountConfig?.apiKey || config.opencode_go?.apiKey)?.trim()
    const baseUrl = (accountConfig?.baseUrl || config.opencode_go?.baseUrl?.trim() || 'https://opencode.ai').replace(/\/+$/, '')

    if (!apiKey) {
      return {
        ok: false,
        provider: 'opencode_go',
        message: '未配置 API Key。请在「设置」中填入 OpenCode Go Key',
      }
    }

    try {
      const url = `${baseUrl}/zen/go/v1/usage`
      const res = await fetchWithProxy(url, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: 'application/json',
          'User-Agent': 'Mozilla/5.0',
        },
      }, config.httpProxy, 10000)

      const latencyMs = Date.now() - start
      if (res.ok) {
        return {
          ok: true,
          provider: 'opencode_go',
          latencyMs,
          message: `连接成功 (延迟: ${latencyMs}ms)`,
        }
      }

      return {
        ok: false,
        provider: 'opencode_go',
        latencyMs,
        message: `API 响应异常: HTTP ${res.status}`,
      }
    } catch (err     ) {
      return {
        ok: false,
        provider: 'opencode_go',
        latencyMs: Date.now() - start,
        message: `连接失败: ${err.message}`,
      }
    }
  }

  async fetchCard(config             , accountConfig                    )                          {
    const cardId = accountConfig?.id || 'opencode_go'
    const cardName = accountConfig?.name || 'OpenCode Go'

    if (config.opencode_go?.enabled === false && accountConfig?.enabled === false) {
      return {
        card: {
          id: cardId,
          name: cardName,
          provider: 'opencode_go',
          category: this.category,
          status: 'disabled',
          groups: [],
          lastUpdated: Date.now(),
        },
      }
    }

    const apiKey = (accountConfig?.apiKey || config.opencode_go?.apiKey)?.trim()
    const baseUrl = (accountConfig?.baseUrl || config.opencode_go?.baseUrl?.trim() || 'https://opencode.ai').replace(/\/+$/, '')

    if (!apiKey) {
      return {
        card: {
          id: cardId,
          name: cardName,
          provider: 'opencode_go',
          category: this.category,
          status: 'disabled',
          error: '未配置 API Key。请在「设置」中填入 OpenCode Go Key',
          groups: [],
          lastUpdated: Date.now(),
        },
      }
    }

    try {
      const url = `${baseUrl}/zen/go/v1/usage`
      const res = await fetchWithProxy(url, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: 'application/json',
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
          label: '5-Hour Rolling Limit',
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
          label: 'Weekly Limit',
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
          label: 'Monthly Limit',
          subtitle: formatQuotaResetText(resetAt, used, true),
          usedPercent: used,
          remainingPercent: rem,
          resetAt,
          barType: 'circle'         ,
        })
      }

      return {
        card: {
          id: cardId,
          name: cardName,
          provider: 'opencode_go',
          category: this.category,
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
          id: cardId,
          name: cardName,
          provider: 'opencode_go',
          category: this.category,
          status: 'error',
          error: err.message,
          groups: [],
          lastUpdated: Date.now(),
        },
      }
    }
  }
}



class CustomApiProvider                           {
  name = 'custom_api'
  category = 'custom_api'         

          resolveTarget(accountConfig                    )                                                                                      {
    const id = accountConfig?.id || 'custom_api'
    const name = accountConfig?.name || '自定义 / OneAPI 中转'
    const apiKey = (accountConfig?.apiKey || '').trim()
    const baseUrl = (accountConfig?.baseUrl || 'https://api.openai.com').replace(/\/+$/, '')
    const balancePath = (accountConfig?.extra?.balancePath || (accountConfig       )?.balancePath || '').trim()
    return { id, name, apiKey, baseUrl, balancePath }
  }

  async testConnection(config             , accountConfig                    )                                {
    const start = Date.now()
    const { apiKey, baseUrl, balancePath } = this.resolveTarget(accountConfig)
    if (!apiKey) {
      return {
        ok: false,
        provider: 'custom_api',
        message: '未配置 API Key',
      }
    }

    try {
      const headers = { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' }
      const testUrl = balancePath
        ? `${baseUrl}${balancePath.startsWith('/') ? balancePath : '/' + balancePath}`
        : `${baseUrl}/v1/models`
      const res = await fetchWithProxy(testUrl, { headers }, config.httpProxy, 10000)

      const latencyMs = Date.now() - start
      if (res.ok) {
        return {
          ok: true,
          provider: 'custom_api',
          latencyMs,
          message: `连接成功 (延迟: ${latencyMs}ms)`,
        }
      }

      return {
        ok: false,
        provider: 'custom_api',
        latencyMs,
        message: `验证失败: HTTP ${res.status}`,
      }
    } catch (err     ) {
      return {
        ok: false,
        provider: 'custom_api',
        latencyMs: Date.now() - start,
        message: `请求异常: ${err.message}`,
      }
    }
  }

  async fetchCard(config             , accountConfig                    )                          {
    const { id, name, apiKey, baseUrl, balancePath } = this.resolveTarget(accountConfig)

    if (!apiKey) {
      return {
        card: {
          id,
          name,
          provider: 'custom_api',
          category: this.category,
          status: 'disabled',
          error: '未配置 API Key。请填入中转站 Key 与 Base URL',
          groups: [],
          lastUpdated: Date.now(),
        },
      }
    }

    try {
      // Try OneAPI / NewAPI usage endpoints
      const headers = { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' }
      const endpointsToFetch = [
        fetchWithProxy(`${baseUrl}/v1/models`, { headers }, config.httpProxy, 10000),
      ]
      if (balancePath) {
        endpointsToFetch.push(
          fetchWithProxy(`${baseUrl}${balancePath.startsWith('/') ? balancePath : '/' + balancePath}`, { headers }, config.httpProxy, 8000)
        )
      } else {
        endpointsToFetch.push(
          fetchWithProxy(`${baseUrl}/v1/dashboard/billing/subscription`, { headers }, config.httpProxy, 8000),
          fetchWithProxy(`${baseUrl}/api/user/self`, { headers }, config.httpProxy, 8000)
        )
      }

      const settled = await Promise.allSettled(endpointsToFetch)
      const modelsRes = settled[0]

      if (!modelsRes || modelsRes.status === 'rejected' || (modelsRes.status === 'fulfilled' && !modelsRes.value.ok)) {
        const err = modelsRes && modelsRes.status === 'fulfilled' ? `HTTP ${modelsRes.value.status}` : ((modelsRes       )?.reason?.message || '网络异常')
        throw new Error(`API 验证失败: ${err}`)
      }

      let hardLimit = 0
      let totalUsage = 0
      let remainingBal = 0
      let hasBilling = false

      for (let i = 1; i < settled.length; i++) {
        const subRes = settled[i]
        if (subRes && subRes.status === 'fulfilled' && subRes.value.ok) {
          try {
            const subData = await subRes.value.json()       
            if (subData.hard_limit_usd !== undefined || subData.total_granted !== undefined) {
              hardLimit = subData.hard_limit_usd ?? subData.total_granted ?? 0
              totalUsage = subData.total_usage ?? 0
              remainingBal = Math.max(0, hardLimit - totalUsage)
              hasBilling = hardLimit > 0
              break
            }
            if (subData.data && typeof subData.data.quota === 'number') {
              const quota = subData.data.quota
              remainingBal = Math.round((quota / 500000) * 100) / 100
              hardLimit = remainingBal
              hasBilling = true
              break
            }
            if (typeof subData.balance === 'number' || typeof subData.total_balance === 'number') {
              remainingBal = subData.balance ?? subData.total_balance
              hardLimit = remainingBal
              hasBilling = true
              break
            }
          } catch {}
        }
      }

      const remPercent = hasBilling && hardLimit > 0
        ? Math.max(0, Math.min(100, Math.round(((remainingBal || (hardLimit - totalUsage)) / hardLimit) * 100)))
        : 100
      const usedPercent = 100 - remPercent

      const subtitle = hasBilling
        ? `总限额: $${hardLimit.toFixed(2)} (剩余 $${remainingBal.toFixed(2)})`
        : '中转接口在线 · 额度正常'

      return {
        card: {
          id,
          name,
          provider: 'custom_api',
          category: this.category,
          status: remPercent <= 15 ? 'warn' : 'ok',
          plan: 'Custom / OneAPI',
          account: baseUrl.replace(/^https?:\/\//, ''),
          balance: hasBilling ? { currency: 'USD', total: hardLimit, used: totalUsage, remaining: remainingBal || (hardLimit - totalUsage) } : undefined,
          groups: [
            {
              title: 'API 中转站状态',
              windows: [
                {
                  id: `${id}-status`,
                  label: '中转接口可用状态',
                  subtitle,
                  usedPercent,
                  remainingPercent: remPercent,
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
          id,
          name,
          provider: 'custom_api',
          category: this.category,
          status: 'error',
          error: err.message,
          groups: [],
          lastUpdated: Date.now(),
        },
      }
    }
  }
}



const DEFAULT_PROVIDER_ORDER = [
  'deepseek',
  'antigravity',
  'cursor',
  'codex',
  'siliconflow',
  'openrouter',
  'github_copilot',
  'openai_billing',
  'claude',
  'kimi',
  'glm',
  'minimax',
  'qwen',
  'volcengine',
  'opencode_go',
  'custom_api',
]

const PROVIDER_DEFAULT_MODELS                                                                           = {
  deepseek: {
    primaryId: 'deepseek-chat',
    available: ['deepseek-chat', 'deepseek-reasoner'],
    role: '长文本理解、通用代码生成与逻辑推理',
  },
  siliconflow: {
    primaryId: 'deepseek-ai/DeepSeek-V3',
    available: ['deepseek-ai/DeepSeek-V3', 'deepseek-ai/DeepSeek-R1', 'Qwen/Qwen2.5-Coder-32B-Instruct'],
    role: '国内高并发大模型推理中转',
  },
  openrouter: {
    primaryId: 'anthropic/claude-3.5-sonnet',
    available: ['anthropic/claude-3.5-sonnet', 'openai/gpt-4o', 'deepseek/deepseek-r1'],
    role: '海外顶尖全模型智能聚合路由',
  },
  antigravity: {
    primaryId: 'gemini-3.8-flash',
    available: ['gemini-3.8-flash', 'gemini-3.1-pro', 'gemini-4-argon', 'claude-sonnet-5-5', 'claude-opus-5-5'],
    role: '超长上下文、快速响应与高阶多模态分析',
  },
  cursor: {
    primaryId: 'claude-3.5-sonnet',
    available: ['claude-3.5-sonnet', 'cursor-small', 'gpt-4o'],
    role: 'IDE 本地编程补全与编辑',
  },
  codex: {
    primaryId: 'gpt-6.1-sol',
    available: ['gpt-6.1-sol', 'gpt-6-astra', 'gpt-6.1-terra', 'gpt-6-luna'],
    role: '深度复杂推理、代码架构与多轮长任务',
  },
  github_copilot: {
    primaryId: 'gpt-4o',
    available: ['gpt-4o', 'claude-3.5-sonnet'],
    role: '代码生成与上下文审查',
  },
  openai_billing: {
    primaryId: 'gpt-4o',
    available: ['gpt-4o', 'gpt-4o-mini', 'o3-mini'],
    role: 'OpenAI 官方 API 全量能力',
  },
  claude: {
    primaryId: 'claude-sonnet-5-5',
    available: ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-3-5-sonnet'],
    role: '高精度代码架构、深度逻辑推理与工程交付',
  },
  kimi: {
    primaryId: 'moonshot-v1-auto',
    available: ['moonshot-v1-auto', 'moonshot-v1-32k', 'moonshot-v1-128k'],
    role: '超长中文文档研读与知识检索',
  },
  glm: {
    primaryId: 'glm-4-flash',
    available: ['glm-4-flash', 'glm-4-plus', 'glm-4-air'],
    role: '中文高响应推理与轻量任务',
  },
  qwen: {
    primaryId: 'qwen-plus',
    available: ['qwen-plus', 'qwen-max', 'qwen-2.5-coder-32b-instruct'],
    role: '阿里云百炼中文大模型与代码基座',
  },
  minimax: {
    primaryId: 'MiniMax-Text-01',
    available: ['MiniMax-Text-01'],
    role: '通用中文对话与文本创作',
  },
  volcengine: {
    primaryId: 'doubao-pro-32k',
    available: ['doubao-pro-32k', 'doubao-lite-32k'],
    role: '火山方舟豆包高性价比推理',
  },
  opencode_go: {
    primaryId: 'opencode-go-default',
    available: ['opencode-go-default'],
    role: '算力共享与开源模型托管',
  },
  custom_api: {
    primaryId: 'gpt-4o',
    available: ['gpt-4o'],
    role: '自定义 OneAPI / NewAPI 渠道',
  },
}

/**
 * Executes async tasks with bounded concurrency to prevent socket exhaustion and rate limiting.
 */
async function runWithConcurrency      (
  items     ,
  fn                         ,
  limit = 5
)                                     {
  const results                            = new Array(items.length)
  let nextIndex = 0

  async function worker()                {
    while (nextIndex < items.length) {
      const idx = nextIndex++
      const item = items[idx] 
      try {
        const val = await fn(item)
        results[idx] = { status: 'fulfilled', value: val }
      } catch (err) {
        results[idx] = { status: 'rejected', reason: err }
      }
    }
  }

  const workerCount = Math.min(Math.max(1, limit), items.length)
  const workers                  = []
  for (let i = 0; i < workerCount; i++) {
    workers.push(worker())
  }
  await Promise.all(workers)
  return results
}

                      
                    
                   
 

function maskSecret(val         )         {
  if (!val) return ''
  const trimmed = String(val).trim()
  if (trimmed.length <= 8) return '••••••••'
  return `${trimmed.slice(0, 4)}••••${trimmed.slice(-4)}`
}

function restoreMaskedSecrets(incoming     , existing     )      {
  if (!incoming || typeof incoming !== 'object') return incoming
  if (!existing || typeof existing !== 'object') return incoming
  const res = Array.isArray(incoming) ? [...incoming] : { ...incoming }
  for (const k of Object.keys(res)) {
    if (typeof res[k] === 'string' && (res[k] === '***' || res[k] === '••••••••' || res[k].includes('••••'))) {
      if (existing[k] !== undefined) {
        res[k] = existing[k]
      }
    } else if (typeof res[k] === 'object' && res[k] !== null) {
      res[k] = restoreMaskedSecrets(res[k], existing[k])
    }
  }
  return res
}

class QuotaManager {
          providers                              = new Map()
         oauthManager = new OAuthManager()
         historyManager = new QuotaHistoryManager()
         alarmDetector = new QuotaAlarmDetector()

          cardCache                          = new Map()
          configPath        
          config              = {}

  constructor() {
    this.registerDefaultProviders()
    const dshDir = process.env.DSH_HOME || join(homedir(), '.dsh')
    if (!existsSync(dshDir)) {
      try {
        mkdirSync(dshDir, { recursive: true })
      } catch {}
    }
    this.configPath = join(dshDir, 'quota-config.json')
    this.loadConfig()
  }

          registerDefaultProviders()       {
    const list                   = [
      new DeepSeekProvider(),
      new AntigravityProvider(),
      new CursorProvider(),
      new CodexProvider(),
      new GitHubCopilotProvider(),
      new OpenAIBillingProvider(),
      new ClaudeProvider(),
      new KimiProvider(),
      new GLMProvider(),
      new MiniMaxProvider(),
      new QwenProvider(),
      new VolcengineProvider(),
      new SiliconFlowProvider(),
      new OpenRouterProvider(),
      new OpenCodeGoProvider(),
      new CustomApiProvider(),
    ]
    for (const p of list) {
      this.providers.set(p.name, p)
    }
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
        if (typeof this.config.refreshIntervalSeconds !== 'number' || this.config.refreshIntervalSeconds <= 0) {
          this.config.refreshIntervalSeconds = 60
        }
        if (typeof this.config.alarmThresholdPercent !== 'number') {
          this.config.alarmThresholdPercent = 15
        }
      } else {
        this.config = {
          deepseek: { enabled: true },
          cursor: { enabled: true, autoDetectLocal: true },
          antigravity: { enabled: true, autoDetectLocal: true },
          codex: { enabled: true, autoDetectLocal: true },
          github_copilot: { enabled: true, autoDetectLocal: true },
          openai_billing: { enabled: false },
          claude: { enabled: false },
          kimi: { enabled: false },
          glm: { enabled: false },
          minimax: { enabled: false },
          qwen: { enabled: false },
          volcengine: { enabled: false },
          opencode_go: { enabled: true },
          enabledProviders: ['deepseek', 'antigravity', 'cursor', 'codex', 'github_copilot', 'opencode_go'],
          providerOrder: DEFAULT_PROVIDER_ORDER,
          showFloatingHud: true,
          refreshIntervalSeconds: 60,
          alarmThresholdPercent: 15,
          enableNotification: true,
        }
        this.saveConfig(this.config)
      }
    } catch {
      this.config = {
        deepseek: { enabled: true },
        cursor: { enabled: true, autoDetectLocal: true },
        antigravity: { enabled: true, autoDetectLocal: true },
        codex: { enabled: true, autoDetectLocal: true },
        github_copilot: { enabled: true, autoDetectLocal: true },
        opencode_go: { enabled: true },
        enabledProviders: ['deepseek', 'antigravity', 'cursor', 'codex', 'github_copilot', 'opencode_go'],
        providerOrder: DEFAULT_PROVIDER_ORDER,
        showFloatingHud: true,
        refreshIntervalSeconds: 60,
        alarmThresholdPercent: 15,
        enableNotification: true,
      }
    }
    return this.config
  }

  saveConfig(newConfig             )       {
    const current = this.config || {}
    const unmasked = restoreMaskedSecrets(newConfig, current)
    const merged              = {
      ...current,
      ...unmasked,
      proxyMode: unmasked.proxyMode !== undefined ? unmasked.proxyMode : current.proxyMode,
      httpProxy: unmasked.httpProxy !== undefined ? unmasked.httpProxy : current.httpProxy,
      deepseek: { ...current.deepseek, ...unmasked.deepseek },
      cursor: { ...current.cursor, ...unmasked.cursor },
      codex: { ...current.codex, ...unmasked.codex },
      antigravity: { ...current.antigravity, ...unmasked.antigravity },
      github_copilot: { ...current.github_copilot, ...unmasked.github_copilot },
      openai_billing: { ...current.openai_billing, ...unmasked.openai_billing },
      claude: { ...current.claude, ...unmasked.claude },
      kimi: { ...current.kimi, ...unmasked.kimi },
      glm: { ...current.glm, ...unmasked.glm },
      minimax: { ...current.minimax, ...unmasked.minimax },
      qwen: { ...current.qwen, ...unmasked.qwen },
      volcengine: { ...current.volcengine, ...unmasked.volcengine },
      siliconflow: { ...current.siliconflow, ...unmasked.siliconflow },
      openrouter: { ...current.openrouter, ...unmasked.openrouter },
      opencode_go: { ...current.opencode_go, ...unmasked.opencode_go },
      custom_compatible: unmasked.custom_compatible !== undefined ? unmasked.custom_compatible : current.custom_compatible,
      accounts: unmasked.accounts !== undefined ? unmasked.accounts : current.accounts,
      enabledProviders: unmasked.enabledProviders !== undefined ? unmasked.enabledProviders : current.enabledProviders,
      floatingHudProviders: unmasked.floatingHudProviders !== undefined ? unmasked.floatingHudProviders : current.floatingHudProviders,
      floatingHudMetrics: unmasked.floatingHudMetrics !== undefined ? unmasked.floatingHudMetrics : current.floatingHudMetrics,
      providerOrder: unmasked.providerOrder !== undefined ? unmasked.providerOrder : current.providerOrder,
      customNames: (() => {
        if (unmasked.customNames === undefined) return current.customNames
        const combined = { ...(current.customNames || {}), ...unmasked.customNames }
        for (const [k, v] of Object.entries(combined)) {
          if (!v || !v.trim()) delete (combined       )[k]
        }
        return combined
      })(),
    }

    this.config = merged
    this.cardCache.clear()
    atomicWriteJsonSync(this.configPath, this.config, 0o600)
  }

  getSafeConfig()              {
    const copy      = JSON.parse(JSON.stringify(this.config || {}))
    const keyProps = ['apiKey', 'sessionToken', 'token']
    for (const [k, v] of Object.entries(copy)) {
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        for (const kp of keyProps) {
          if ((v       )[kp]) (v       )[kp] = maskSecret((v       )[kp])
        }
        if ((v       ).oauth?.accessToken) (v       ).oauth.accessToken = maskSecret((v       ).oauth.accessToken)
        if ((v       ).oauth?.refreshToken) (v       ).oauth.refreshToken = maskSecret((v       ).oauth.refreshToken)
      }
    }
    if (Array.isArray(copy.custom_compatible)) {
      copy.custom_compatible = copy.custom_compatible.map((item     ) => ({
        ...item,
        apiKey: item.apiKey ? maskSecret(item.apiKey) : '',
      }))
    }
    if (Array.isArray(copy.accounts)) {
      copy.accounts = copy.accounts.map((item     ) => ({
        ...item,
        apiKey: item.apiKey ? maskSecret(item.apiKey) : undefined,
        sessionToken: item.sessionToken ? maskSecret(item.sessionToken) : undefined,
        oauth: item.oauth ? {
          ...item.oauth,
          accessToken: item.oauth.accessToken ? maskSecret(item.oauth.accessToken) : undefined,
          refreshToken: item.oauth.refreshToken ? maskSecret(item.oauth.refreshToken) : undefined,
        } : undefined,
      }))
    }
    return copy
  }

  getConfig()              {
    return this.config
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
      atomicWriteJsonSync(authPath, auth, 0o600)
    } catch {}
  }

         buildInstanceTasks()                                                                                 {
    const tasks                                                                                 = []

    // 1. Explicit multi-accounts list
    if (this.config.accounts && this.config.accounts.length > 0) {
      for (const acc of this.config.accounts) {
        if (acc.enabled !== false) {
          tasks.push({
            id: acc.id,
            providerName: acc.provider,
            accountConfig: acc,
          })
        }
      }
    }

    // 2. Custom compatible APIs (OneAPI / NewAPI)
    if (this.config.custom_compatible && Array.isArray(this.config.custom_compatible)) {
      for (const cust of this.config.custom_compatible) {
        if (cust.enabled !== false && cust.apiKey) {
          tasks.push({
            id: cust.id,
            providerName: 'custom_api',
            accountConfig: {
              id: cust.id,
              provider: 'custom_api',
              name: cust.name,
              apiKey: cust.apiKey,
              baseUrl: cust.baseUrl,
              extra: { balancePath: cust.balancePath },
            },
          })
        }
      }
    }

    // 3. Default single instances from standard config
    for (const [pName] of this.providers.entries()) {
      if (pName === 'custom_api') continue
      // Only add if not already covered in accounts
      const existsInAccounts = tasks.some(t => t.id === pName)
      if (!existsInAccounts) {
        const provCfg = (this.config       )[pName]
        if (provCfg && provCfg.enabled !== false) {
          tasks.push({
            id: pName,
            providerName: pName,
          })
        }
      }
    }

    return tasks
  }

          generateSparkline(instanceId        , _currentRem        )                        {
    return this.historyManager.getUsageTrendPoints(instanceId, 7)
  }

  async getQuotaCards(forceRefresh = false)           
                         
                            
                        
                       
     {
    const intervalSec = getRefreshIntervalSeconds(this.config)
    const ttl = Math.max(5000, intervalSec * 1000)
    const now = Date.now()

    const tasks = this.buildInstanceTasks()
    const settled = await runWithConcurrency(tasks, async ({ id, providerName, accountConfig }) => {
      const cached = this.cardCache.get(id)
      if (!forceRefresh && cached && (now - cached.fetchedAt) < ttl) {
        return cached.card
      }

      const provider = this.providers.get(providerName)
      if (!provider) return null

      try {
        const result = await provider.fetchCard(this.config, accountConfig)
        const card = result.card
        // Calculate burn rate & estimated hours
        const remPercent = card.groups[0]?.windows[0]?.remainingPercent ?? 100
        const { burnRatePerHour, estimatedHoursLeft } = this.historyManager.calculateBurnRate(id, remPercent)
        card.burnRatePerHour = burnRatePerHour
        card.estimatedHoursLeft = estimatedHoursLeft
        card.sparkline = this.generateSparkline(id, remPercent)

        const customName = (this.config       )[providerName]?.name || this.config.customNames?.[id] || this.config.customNames?.[providerName]
        if (customName) {
          card.name = customName
        }

        this.cardCache.set(id, { card, fetchedAt: now })
        return card
      } catch (err     ) {
        const customName = (this.config       )[providerName]?.name || this.config.customNames?.[id] || this.config.customNames?.[providerName]
        const errCard               = {
          id,
          name: customName || accountConfig?.name || provider.name,
          provider: providerName,
          category: provider.category,
          status: 'error',
          error: err.message,
          groups: [],
          lastUpdated: now,
        }
        this.cardCache.set(id, { card: errCard, fetchedAt: now })
        return errCard
      }
    }, 5)

    const allCards                 = []
    for (const r of settled) {
      if (r.status === 'fulfilled' && r.value) {
        allCards.push(r.value)
      }
    }

    // Save history snapshots
    this.historyManager.recordSnapshots(allCards)

    // Detect alarms
    const alarms = this.alarmDetector.detectAlarms(allCards, this.config.alarmThresholdPercent ?? 15)

    // Sort & filter according to order
    const orderList = this.config.providerOrder ?? DEFAULT_PROVIDER_ORDER
    const enabledSet = new Set(this.config.enabledProviders ?? DEFAULT_PROVIDER_ORDER)

    const visibleCards = allCards.filter(c => {
      if (c.status === 'disabled') return false
      const isEnabled = enabledSet.has(c.id) || enabledSet.has(c.provider)
      if (c.provider === 'custom_api') return isEnabled
      return isEnabled && (this.config       )[c.provider]?.enabled !== false
    })

    visibleCards.sort((a, b) => {
      const idxA = orderList.indexOf(a.id) !== -1 ? orderList.indexOf(a.id) : orderList.indexOf(a.provider)
      const idxB = orderList.indexOf(b.id) !== -1 ? orderList.indexOf(b.id) : orderList.indexOf(b.provider)
      return (idxA === -1 ? 999 : idxA) - (idxB === -1 ? 999 : idxB)
    })

    return {
      cards: visibleCards,
      allCards,
      alarms,
      lastUpdated: now,
    }
  }

  async refreshSingleProvider(instanceOrProvider        )                                    {
    const tasks = this.buildInstanceTasks()
    const task = tasks.find(t => t.id === instanceOrProvider || t.providerName === instanceOrProvider)
    if (!task) return undefined

    const provider = this.providers.get(task.providerName)
    if (!provider) return undefined

    try {
      const res = await provider.fetchCard(this.config, task.accountConfig)
      const card = res.card
      const remPercent = card.groups[0]?.windows[0]?.remainingPercent ?? 100
      const { burnRatePerHour, estimatedHoursLeft } = this.historyManager.calculateBurnRate(task.id, remPercent)
      card.burnRatePerHour = burnRatePerHour
      card.estimatedHoursLeft = estimatedHoursLeft
      card.sparkline = this.generateSparkline(task.id, remPercent)

      const customName = (this.config       )[task.providerName]?.name || this.config.customNames?.[task.id] || this.config.customNames?.[task.providerName]
      if (customName) {
        card.name = customName
      }

      this.cardCache.set(task.id, { card, fetchedAt: Date.now() })
      this.historyManager.recordSnapshots([card])
      return card
    } catch {
      return undefined
    }
  }

  async testConnection(providerName        , accountConfig                    )                                {
    const provider = this.providers.get(providerName)
    if (!provider) {
      return {
        ok: false,
        provider: providerName,
        message: `未知服务提供商: ${providerName}`,
      }
    }

    if (typeof provider.testConnection === 'function') {
      return provider.testConnection(this.config, accountConfig)
    }

    // Default test via fetchCard
    try {
      const start = Date.now()
      const res = await provider.fetchCard(this.config, accountConfig)
      const latencyMs = Date.now() - start
      if (res.card.status === 'ok' || res.card.status === 'warn') {
        return {
          ok: true,
          provider: providerName,
          latencyMs,
          account: res.card.account,
          message: `连接成功 (延迟: ${latencyMs}ms)`,
        }
      }
      return {
        ok: false,
        provider: providerName,
        latencyMs,
        message: res.card.error || '连接失败',
      }
    } catch (err     ) {
      return {
        ok: false,
        provider: providerName,
        message: `测试异常: ${err.message}`,
      }
    }
  }

  async testAllConnections()                                                {
    const tasks = this.buildInstanceTasks()
    for (const pName of this.providers.keys()) {
      if (!tasks.some(t => t.id === pName || t.providerName === pName)) {
        tasks.push({ id: pName, providerName: pName })
      }
    }
    const results                                       = {}

    await runWithConcurrency(tasks, async (t) => {
      const res = await this.testConnection(t.providerName, t.accountConfig)
      results[t.id] = res
      return res
    }, 5)

    return results
  }

  /**
   * Structured summary and intelligent model routing recommendations for DSH Agent Tool calls
   */
  async getAgentQuotaSummary(providerName         , forceRefresh = false)               {
    const { cards, alarms, lastUpdated } = await this.getQuotaCards(forceRefresh)
    const targetCards = providerName
      ? cards.filter(c => c.provider.toLowerCase().includes(providerName.toLowerCase()) || c.id.toLowerCase().includes(providerName.toLowerCase()))
      : cards

    // Build intelligent routing recommendation
    const healthyServices = cards.filter(c => c.status === 'ok')
    const warningServices = cards.filter(c => c.status === 'warn')

    let recommendation                          
    if (healthyServices.length > 0) {
      const primary = healthyServices.find(c => c.provider === 'deepseek')
        || healthyServices.find(c => c.provider === 'siliconflow')
        || healthyServices[0] 
      const meta = PROVIDER_DEFAULT_MODELS[primary.provider] || { primaryId: primary.provider, available: [primary.provider], role: '通用大模型' }
      const fallbacks = healthyServices.filter(c => c.id !== primary.id).slice(0, 4).map(c => {
        const fMeta = PROVIDER_DEFAULT_MODELS[c.provider] || { primaryId: c.provider, available: [c.provider], role: '备用模型' }
        return {
          provider: c.provider,
          modelId: fMeta.primaryId,
          name: `${c.name} (${fMeta.primaryId})`,
          reason: `${fMeta.role} · 额度充足健康在线`,
        }
      })
      recommendation = {
        primaryModel: `${primary.name} (${meta.primaryId})`,
        primaryModelId: meta.primaryId,
        primaryProvider: primary.provider,
        status: 'healthy',
        reason: `首选 ${primary.name} · 调用模型 ${meta.primaryId}（${meta.role} · 额度正常可用）`,
        availableModels: meta.available,
        fallbackRoutes: fallbacks,
      }
    } else if (warningServices.length > 0) {
      const primary = warningServices[0] 
      const meta = PROVIDER_DEFAULT_MODELS[primary.provider] || { primaryId: primary.provider, available: [primary.provider], role: '告警备用' }
      recommendation = {
        primaryModel: `${primary.name} (${meta.primaryId})`,
        primaryModelId: meta.primaryId,
        primaryProvider: primary.provider,
        status: 'warning',
        reason: `首选 ${primary.name} · 模型 ${meta.primaryId} 额度已低于警戒线，建议谨慎执行高消耗长任务`,
        availableModels: meta.available,
        fallbackRoutes: [],
      }
    } else {
      recommendation = {
        primaryModel: 'none',
        primaryModelId: 'none',
        primaryProvider: 'none',
        status: 'exhausted',
        reason: '当前所有已配置 AI 服务均处于未连接或异常状态，请在额度监控中配置有效凭据',
        availableModels: [],
        fallbackRoutes: [],
      }
    }

    return {
      success: true,
      lastUpdated: new Date(lastUpdated).toLocaleString('zh-CN'),
      alarmCount: alarms.length,
      alarms: alarms.map(a => ({ level: a.level, name: a.name, message: a.message })),
      recommendation,
      services: targetCards.map(c => {
        const modelMeta = PROVIDER_DEFAULT_MODELS[c.provider]
        return {
          id: c.id,
          name: c.name,
          provider: c.provider,
          modelId: modelMeta?.primaryId,
          availableModels: modelMeta?.available,
          category: c.category,
          status: c.status,
          plan: c.plan,
          account: c.account,
          error: c.error,
          balance: c.balance,
          burnRatePerHour: c.burnRatePerHour ? `${c.burnRatePerHour}%/h` : undefined,
          estimatedHoursLeft: c.estimatedHoursLeft ? `${c.estimatedHoursLeft} 小时` : undefined,
          quotas: c.groups.map(g => ({
            group: g.title,
            windows: g.windows.map(w => ({
              label: w.label,
              remaining: `${w.remainingPercent}%`,
              used: `${w.usedPercent}%`,
              subtitle: w.subtitle,
            })),
          })),
        }
      }),
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
      path: '/api/dsh-quota/test-connection',
      async handler(req     , res     ) {
        if (req.method !== 'POST') {
          res.writeHead(405, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Method not allowed' }))
          return
        }
        try {
          let body = ''
          let size = 0
          for await (const chunk of req) {
            size += chunk.length
            if (size > 256 * 1024) {
              res.writeHead(413, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ ok: false, message: '请求载荷过大 (超过 256KB)' }))
              return
            }
            body += chunk
          }
          const payload = JSON.parse(body || '{}')
          const { provider, accountConfig } = payload
          if (!provider) {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ ok: false, message: '缺少 provider 参数' }))
            return
          }
          const testRes = await manager.testConnection(provider, accountConfig)
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify(testRes))
        } catch (err     ) {
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: false, message: err.message }))
        }
      },
    },
    {
      kind: 'exact',
      path: '/api/dsh-quota/test-all',
      async handler(req     , res     ) {
        if (req.method !== 'POST') {
          res.writeHead(405, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'Method not allowed' }))
          return
        }
        try {
          const results = await manager.testAllConnections()
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: true, results }))
        } catch (err     ) {
          res.writeHead(500, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: false, error: err.message }))
        }
      },
    },
    {
      kind: 'exact',
      path: '/api/dsh-quota/history',
      async handler(req     , res     ) {
        try {
          const url = new URL(req.url, 'http://127.0.0.1')
          const instanceId = url.searchParams.get('instanceId')
          const days = parseInt(url.searchParams.get('days') || '7', 10)
          if (!instanceId) {
            res.writeHead(400, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: 'Missing instanceId' }))
            return
          }
          const points = manager.historyManager.getTrendPoints(instanceId, days)
          res.writeHead(200, { 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ ok: true, points }))
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
            const cfg = manager.getSafeConfig()
            res.writeHead(200, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify(cfg))
          } catch (err     ) {
            res.writeHead(500, { 'Content-Type': 'application/json' })
            res.end(JSON.stringify({ error: err.message }))
          }
          return
        }
        if (req.method !== 'POST') {
          res.writeHead(405, { Allow: 'GET, POST', 'Content-Type': 'application/json' })
          res.end(JSON.stringify({ error: 'method not allowed' }))
          return
        }
        try {
          let body = ''
          let size = 0
          for await (const chunk of req) {
            size += chunk.length
            if (size > 256 * 1024) {
              res.writeHead(413, { 'Content-Type': 'application/json' })
              res.end(JSON.stringify({ error: '配置请求过大 (超过 256KB)' }))
              return
            }
            body += chunk
          }
          const parsed = JSON.parse(body || '{}')
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
          }, cfg.httpProxy, cfg.proxyMode)
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
          }, cfg.httpProxy, cfg.proxyMode)
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
 * @version 0.4.0
 */


const VERSION = '0.4.0'
const inject = ['systemPrompt', 'webServer']

const GUIDANCE = '本机已安装 dsh-quota 插件（DSH AI 额度与用量监控 v0.4.0）：侧边栏「额度监控」入口。能力：集中监控并展示 DeepSeek、Cursor、Codex、Google Antigravity、GitHub Copilot、OpenAI Billing、Claude、Kimi、智谱 GLM、MiniMax、通义千问、火山方舟、硅基流动 (SiliconFlow)、OpenRouter、OpenCode-Go 及 OneAPI 中转服务的实时剩余额度、用量及到期重置周期；支持 Gemini 4 Argon 独立周额度、7 天时序趋势 Sparkline、消耗速率计算、一键全部测活与多账号中转管理。在长程编码任务启动前或用户询问额度/模型选择时，可调用 get_quota_status 自动获取各模型实时余量与智能路由推荐。'

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
      manager.oauthManager.dispose()
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

  // Register Agent Tool get_quota_status (compatible with DSH 0.1.2+ ctx.tools and legacy ctx.agent)
  try {
    const registerTool = (targetTools     ) => {
      if (!targetTools) return
      if (typeof targetTools.register === 'function') {
        return targetTools.register({
          name: 'get_quota_status',
          description: '查询当前配置的所有 AI 服务的实时剩余额度、余额、告警状态以及智能模型推荐路由。',
          parameters: {
            type: 'object',
            properties: {
              provider: {
                type: 'string',
                description: '可选：指定查询的 Provider 名称或实例 ID（如 deepseek, cursor, antigravity, kimi, glm, qwen）',
              },
              forceRefresh: {
                type: 'boolean',
                description: '是否强制从各官方 API 重新拉取最新数据（默认 false 使用缓存）',
              },
            },
          },
          output: {
            schema: { type: 'string' },
            render(_args     , value     ) {
              return [{ type: 'text', text: typeof value === 'string' ? value : JSON.stringify(value) }]
            },
          },
          execute: async (args                                               , exec      ) => {
            if (exec?.signal?.aborted) {
              throw new Error('Tool execution aborted')
            }
            const summary = await manager.getAgentQuotaSummary(args?.provider, args?.forceRefresh)
            return JSON.stringify(summary, null, 2)
          },
        })
      }
      if (typeof targetTools.registerTool === 'function') {
        return targetTools.registerTool({
          name: 'get_quota_status',
          description: '查询当前配置的所有 AI 服务的实时剩余额度、余额、告警状态以及智能模型推荐路由。',
          parameters: {
            type: 'object',
            properties: {
              provider: {
                type: 'string',
                description: '可选：指定查询的 Provider 名称或实例 ID（如 deepseek, cursor, antigravity, kimi, glm, qwen）',
              },
              forceRefresh: {
                type: 'boolean',
                description: '是否强制从各官方 API 重新拉取最新数据（默认 false 使用缓存）',
              },
            },
          },
          handler: async (args                                               , exec      ) => {
            if (exec?.signal?.aborted) {
              throw new Error('Tool execution aborted')
            }
            return manager.getAgentQuotaSummary(args.provider, args.forceRefresh)
          },
        })
      }
    }

    if ((ctx       ).tools) {
      ctx.effect(() => registerTool((ctx       ).tools), 'quota: agent tool')
    } else if (typeof ctx.inject === 'function') {
      ctx.inject(['tools'], (scoped     ) => {
        scoped.effect(() => registerTool(scoped.tools), 'quota: agent tool')
      })
    } else if ((ctx       ).agent) {
      ctx.effect(() => registerTool((ctx       ).agent), 'quota: agent tool')
    }
  } catch {}
}

export { inject, apply, VERSION, PLUGIN_VERSION, QuotaManager, fetchWithProxy, sanitizeProxyUrl, DeepSeekProvider, CursorProvider, CodexProvider, AntigravityProvider, GitHubCopilotProvider, OpenAIBillingProvider, ClaudeProvider, KimiProvider, GLMProvider, MiniMaxProvider, QwenProvider, VolcengineProvider, SiliconFlowProvider, OpenRouterProvider, OpenCodeGoProvider, CustomApiProvider, formatQuotaResetText, getRefreshIntervalSeconds, atomicWriteJsonSync, runWithConcurrency, DEFAULT_PROVIDER_ORDER, PROVIDER_DEFAULT_MODELS }
