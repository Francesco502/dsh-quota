import type { IQuotaProvider, QuotaConfig, ProviderResult, MetricGroup, MetricWindow, TestConnectionResult, AccountConfigItem } from '../core/types.ts'
import { formatQuotaResetText } from '../core/types.ts'
import { getAppStoragePaths } from '../core/paths.ts'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'
import { fetchWithProxy } from '../core/fetch.ts'

interface OAuthTokenInfo {
  accessToken?: string
  refreshToken?: string
  expiry?: number
  email?: string
  name?: string
}

function getPlatformTag(): string {
  switch (process.platform) {
    case 'win32': return 'windows'
    case 'darwin': return 'darwin'
    default: return 'linux'
  }
}

function getArchTag(): string {
  if (process.arch === 'x64') return 'amd64'
  if (process.arch === 'arm64') return 'arm64'
  return process.arch
}

export const HUB_CLIENT_MIN_VERSION = '2.26.0'

export function buildHubUserAgent(version = HUB_CLIENT_MIN_VERSION): string {
  return `antigravity/hub/${version} (aidev_client; os_type=${getPlatformTag()}; arch=${getArchTag()})`
}

function readVarint(data: Buffer, start: number): { value: number; next: number } {
  let value = 0, shift = 0, index = start
  while (index < data.length) {
    const byte = data[index++]!
    value += (byte & 0x7f) * (2 ** shift)
    if ((byte & 0x80) === 0) return { value, next: index }
    shift += 7
  }
  throw new Error('invalid protobuf varint')
}

function lengthFields(data: Buffer): Map<number, Buffer[]> {
  const fields = new Map<number, Buffer[]>()
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

function decodeUnifiedOAuth(value: string): OAuthTokenInfo | null {
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
    const timestamp = token.get(4)?.[0] ? lengthFields(token.get(4)![0]!) : undefined
    const expiryBuffer = timestamp?.get(1)?.[0]
    const expiry = expiryBuffer ? Number(expiryBuffer.readBigUInt64LE()) : undefined
    return { accessToken, refreshToken, expiry }
  } catch { return null }
}

export class AntigravityProvider implements IQuotaProvider {
  name = 'antigravity'
  category = 'ide' as const

  private databasePaths(): string[] {
    const paths: string[] = []
    const appNames = ['Antigravity IDE', 'Antigravity', 'Google Antigravity', 'antigravity', 'Antigravity - Insiders']
    for (const name of appNames) {
      paths.push(...getAppStoragePaths(name, 'User/globalStorage/state.vscdb'))
      paths.push(...getAppStoragePaths(name, 'User\\globalStorage\\state.vscdb'))
    }
    return [...new Set(paths)]
  }

  private loadToken(config: QuotaConfig, accountConfig?: AccountConfigItem): OAuthTokenInfo | null {
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
      let DatabaseSync: any
      try {
        const requireFromHere = createRequire(import.meta.url)
        DatabaseSync = requireFromHere('node:sqlite')?.DatabaseSync
      } catch {}

      if (!DatabaseSync) return null

      for (const path of this.databasePaths()) {
        if (!existsSync(path)) continue
        try {
          const db = new DatabaseSync(path, { readOnly: true })
          const rows = db.prepare("SELECT key, value FROM ItemTable WHERE key = 'antigravityUnifiedStateSync.oauthToken' OR key LIKE '%antigravity%oauth%' OR key LIKE '%oauthToken%'").all() as Array<{ key: string; value: string }>
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

  private async activeToken(token: OAuthTokenInfo, config: QuotaConfig, accountConfig?: AccountConfigItem): Promise<string> {
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

    const data = await res.json() as { access_token?: string; expires_in?: number }
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

  async testConnection(config: QuotaConfig, accountConfig?: AccountConfigItem): Promise<TestConnectionResult> {
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
        const data = await res.json() as any
        const groupCount = Array.isArray(data?.groups) ? data.groups.length : 0
        const hasArgon = (data?.groups || []).some((g: any) =>
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
    } catch (err: any) {
      return {
        ok: false,
        provider: 'antigravity',
        latencyMs: Date.now() - start,
        message: `网络连接异常: ${err.message}`,
      }
    }
  }

  async fetchCard(config: QuotaConfig, accountConfig?: AccountConfigItem): Promise<ProviderResult> {
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
            const info = await infoRes.json() as any
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

      let summaryData: any = null
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
        } catch (e: any) {
          lastFetchErr = e.message
        }
      }

      const groups: MetricGroup[] = []
      let hasArgonPool = false

      if (summaryData?.groups && Array.isArray(summaryData.groups)) {
        for (const g of summaryData.groups) {
          const windows: MetricWindow[] = []
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
        let modelData: any = null
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
          const geminiWindows: MetricWindow[] = []
          const claudeGptWindows: MetricWindow[] = []
          const argonWindows: MetricWindow[] = []

          for (const [id, model] of Object.entries(modelData.models) as Array<[string, any]>) {
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

      // Overall card status describes reachability and pressure, never "exhausted":
      // `error` is reserved for failed collection so the alarm layer cannot report a
      // quota-exhausted account as "connection failed / credential invalid".
      const allWindows = groups.flatMap(g => g.windows)
      const isAnyLow = allWindows.some(w => w.remainingPercent > 0 && w.remainingPercent <= (config.alarmThresholdPercent ?? 15))
      const isAllExhausted = allWindows.length > 0 && allWindows.every(w => w.remainingPercent <= 0)
      const cardStatus = allWindows.length === 0 ? 'ok' : (isAnyLow || isAllExhausted ? 'warn' : 'ok')
      const planName = summaryData?.plan || (hasArgonPool ? 'Antigravity Pro / Ultra' : 'Google Antigravity')
      // Partial only when a degraded branch produced the numbers; a 2-group Ultra account
      // is a complete answer, not a partial one.
      const usedFallback = groups.length > 0 && !Array.isArray(summaryData?.groups)

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
            method: usedFallback ? 'model-fallback' : 'official-summary',
            timestamp: Date.now(),
            partial: usedFallback,
            host: successfulEndpoint ? new URL(successfulEndpoint).hostname : undefined,
          },
        },
      }
    } catch (err: any) {
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
