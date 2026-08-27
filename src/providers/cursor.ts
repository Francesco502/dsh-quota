import type { IQuotaProvider, QuotaConfig, ProviderResult, TestConnectionResult, AccountConfigItem } from '../core/types.ts'
import { formatQuotaResetText } from '../core/types.ts'
import { getAppStoragePaths } from '../core/paths.ts'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'

interface CursorLogin {
  accessToken: string
  userId: string
  email?: string
  membershipType?: string
}

export class CursorProvider implements IQuotaProvider {
  name = 'cursor'
  category = 'ide' as const

  private databasePaths(): string[] {
    const paths: string[] = []
    for (const name of ['Cursor', 'cursor', 'Cursor - Insiders']) {
      paths.push(...getAppStoragePaths(name, 'User/globalStorage/state.vscdb'))
      paths.push(...getAppStoragePaths(name, 'User\\globalStorage\\state.vscdb'))
    }
    return [...new Set(paths)]
  }

  private findLocalLogin(): CursorLogin | null {
    let DatabaseSync: any
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
        const rows = db.prepare("SELECT key, value FROM ItemTable WHERE key LIKE 'cursorAuth/%'").all() as Array<{ key: string; value: string }>
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

  private resolveCookie(config: QuotaConfig, accountConfig?: AccountConfigItem): { cookie: string; email?: string; membershipType?: string } {
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

  async testConnection(config: QuotaConfig, accountConfig?: AccountConfigItem): Promise<TestConnectionResult> {
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
      const res = await fetch('https://cursor.com/api/usage-summary', { headers })
      const latencyMs = Date.now() - start
      if (!res.ok) {
        return {
          ok: false,
          provider: 'cursor',
          latencyMs,
          message: `连接失败: 接口返回 HTTP ${res.status}`,
        }
      }
      const data = await res.json() as any
      return {
        ok: true,
        provider: 'cursor',
        latencyMs,
        account: email || data.membershipType || 'Cursor 已连接',
        message: `连接成功 (延迟: ${latencyMs}ms)`,
      }
    } catch (err: any) {
      return {
        ok: false,
        provider: 'cursor',
        latencyMs: Date.now() - start,
        message: `请求异常: ${err.message}`,
      }
    }
  }

  async fetchCard(config: QuotaConfig, accountConfig?: AccountConfigItem): Promise<ProviderResult> {
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
        fetch('https://cursor.com/api/usage-summary', { headers }),
        fetch('https://cursor.com/api/auth/stripe', { headers }),
      ])

      if (!usageRes.ok) throw new Error(`Cursor 登录态失效或接口错误 (${usageRes.status})`)
      const data = await usageRes.json() as any
      const stripe = stripeRes.ok ? await stripeRes.json() as any : {}
      const plan = data.individualUsage?.plan
      if (!plan?.enabled) throw new Error('Cursor 当前账户未返回可用订阅额度')

      const autoPercent = Math.max(0, Math.min(100, Math.round(plan.autoPercentUsed ?? plan.totalPercentUsed ?? 0)))
      const apiPercent = Math.max(0, Math.min(100, Math.round(plan.apiPercentUsed ?? 0)))
      const autoRemaining = Math.max(0, 100 - autoPercent)
      const apiRemaining = Math.max(0, 100 - apiPercent)

      let resetTimestamp: number | undefined
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
    } catch (err: any) {
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
