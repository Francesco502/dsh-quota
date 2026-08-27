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

  private async activeToken(token: OAuthTokenInfo, config: QuotaConfig): Promise<string> {
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

    const data = await res.json() as { access_token?: string; expires_in?: number }
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
      const accessToken = await this.activeToken(tokenInfo, config)
      const res = await fetchWithProxy('https://daily-cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
          'User-Agent': 'antigravity',
        },
        body: '{}',
      }, config.httpProxy, 10000)

      const latencyMs = Date.now() - start
      if (res.ok || res.status === 200) {
        return {
          ok: true,
          provider: 'antigravity',
          latencyMs,
          account: tokenInfo.email || 'Google Account',
          message: `连接成功 (延迟: ${latencyMs}ms)`,
        }
      }

      return {
        ok: false,
        provider: 'antigravity',
        latencyMs,
        message: `接口响应异常: HTTP ${res.status}`,
      }
    } catch (err: any) {
      return {
        ok: false,
        provider: 'antigravity',
        latencyMs: Date.now() - start,
        message: `连接失败: ${err.message}`,
      }
    }
  }

  async fetchCard(config: QuotaConfig, accountConfig?: AccountConfigItem): Promise<ProviderResult> {
    const cardId = accountConfig?.id || 'antigravity'
    const cardName = accountConfig?.name || 'Google Antigravity'
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
      const accessToken = await this.activeToken(tokenInfo, config)

      // Try fetching profile if email is not known
      let accountEmail = tokenInfo.email || config.antigravity?.oauth?.email
      if (!accountEmail) {
        try {
          const infoRes = await fetchWithProxy('https://www.googleapis.com/oauth2/v2/userinfo', {
            headers: { Authorization: `Bearer ${accessToken}` },
          }, config.httpProxy, 8000)
          if (infoRes.ok) {
            const info = await infoRes.json() as any
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

      let summaryData: any = null
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
        } catch (e: any) {
          lastFetchErr = e.message
        }
      }

      const groups: MetricGroup[] = []

      if (summaryData?.groups && Array.isArray(summaryData.groups)) {
        for (const g of summaryData.groups) {
          const windows: MetricWindow[] = []
          for (const b of (g.buckets || [])) {
            const frac = b.remainingFraction ?? 1.0
            const rem = Math.max(0, Math.min(100, Math.round(frac * 100)))
            const isWeekly = b.window === 'WINDOW_WEEKLY' || (b.displayName && b.displayName.toLowerCase().includes('weekly'))
            const subtitle = formatQuotaResetText(b.resetTime, 100 - rem, Boolean(isWeekly))

            windows.push({
              id: b.bucketId || b.displayName,
              label: isWeekly ? 'Weekly Limit' : '5-Hour Limit',
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
            }, config.httpProxy, 15000)
            if (res.ok) {
              modelData = await res.json()
              break
            }
          } catch {}
        }

        if (modelData?.models) {
          const geminiWindows: MetricWindow[] = []
          const claudeGptWindows: MetricWindow[] = []

          for (const [id, model] of Object.entries(modelData.models) as Array<[string, any]>) {
            const quota = model?.quotaInfo
            if (typeof quota?.remainingFraction !== 'number') continue
            const rem = Math.max(0, Math.min(100, Math.round(quota.remainingFraction * 100)))
            const isWeekly = id.toLowerCase().includes('weekly') || (model.displayName && model.displayName.toLowerCase().includes('weekly'))
            const is5Hour = id.toLowerCase().includes('five') || id.toLowerCase().includes('5hour') || (model.displayName && model.displayName.toLowerCase().includes('five'))
            const cleanLabel = isWeekly ? 'Weekly Limit' : is5Hour ? '5-Hour Limit' : (model.displayName || id)
            const subtitle = formatQuotaResetText(quota.resetTime, 100 - rem, Boolean(isWeekly))
            const item: MetricWindow = {
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
          id: cardId,
          name: cardName,
          provider: 'antigravity',
          category: this.category,
          status: 'ok',
          plan: 'Antigravity Pro',
          account: accountEmail,
          groups,
          lastUpdated: Date.now(),
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
