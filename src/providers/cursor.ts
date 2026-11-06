import type { IQuotaProvider, QuotaConfig, ProviderResult, TestConnectionResult, AccountConfigItem, MetricWindow } from '../core/types.ts'
import { formatQuotaResetText, isQuantified } from '../core/types.ts'
import { getAppStoragePaths } from '../core/paths.ts'
import { fetchWithProxy } from '../core/fetch.ts'
import { existsSync } from 'node:fs'
import { createRequire } from 'node:module'

interface CursorLogin {
  accessToken: string
  userId: string
  email?: string
  membershipType?: string
}

/** Parse an upstream numeric field without ever turning null/undefined into 0. */
function parseFinite(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)))
}

/**
 * Cursor's billing endpoints are inconsistent about units: `currentPeriodEnd` is
 * epoch seconds, but relays/older responses sometimes send milliseconds. Values
 * below 1e11 are seconds (1e11 ms is 1973; 1e11 s is year 5138).
 */
function normalizeEpochMs(value: unknown): number | undefined {
  const parsed = parseFinite(value)
  if (parsed === undefined || parsed <= 0) return undefined
  return parsed < 1e11 ? Math.round(parsed * 1000) : Math.round(parsed)
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

  async testConnection(config: QuotaConfig, accountConfig?: AccountConfigItem, signal?: AbortSignal): Promise<TestConnectionResult> {
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
      const res = await fetchWithProxy('https://cursor.com/api/usage-summary', { headers, signal }, config.httpProxy, 12000, config.proxyMode)
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

  async fetchCard(config: QuotaConfig, accountConfig?: AccountConfigItem, signal?: AbortSignal): Promise<ProviderResult> {
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
      // Billing is optional: a failing stripe endpoint must not hide real usage.
      const [usageSettled, stripeSettled] = await Promise.allSettled([
        fetchWithProxy('https://cursor.com/api/usage-summary', { headers, signal }, config.httpProxy, 12000, config.proxyMode),
        fetchWithProxy('https://cursor.com/api/auth/stripe', { headers, signal }, config.httpProxy, 12000, config.proxyMode),
      ])

      if (usageSettled.status === 'rejected') {
        throw new Error(usageSettled.reason?.message || 'Cursor 用量接口请求失败')
      }
      const usageRes = usageSettled.value
      if (!usageRes.ok) throw new Error(`Cursor 登录态失效或接口错误 (${usageRes.status})`)
      const data = await usageRes.json() as any
      const stripe = stripeSettled.status === 'fulfilled' && stripeSettled.value.ok
        ? await stripeSettled.value.json().catch(() => ({}))
        : {}

      const plan = data?.individualUsage?.plan
      // A missing plan means "no subscription data", not "credentials broken".
      if (!plan || plan.enabled === false) {
        return {
          card: {
            id: cardId,
            name: cardName,
            provider: 'cursor',
            category: this.category,
            status: 'disabled',
            plan: (stripe.membershipType ?? data.membershipType ?? membershipType ?? 'Cursor').toUpperCase(),
            account: email || stripe.paymentId,
            error: 'Cursor 当前账户未返回可用订阅额度（Free / 团队套餐可能不开放该接口）',
            groups: [],
            lastUpdated: Date.now(),
          },
        }
      }

      // Percent fields may be null/renamed: those windows stay `unknown` instead of
      // reporting a fabricated "100% remaining".
      const autoUsed = parseFinite(plan.autoPercentUsed) ?? parseFinite(plan.totalPercentUsed)
      const apiUsed = parseFinite(plan.apiPercentUsed)

      // `currentPeriodEnd` may already be milliseconds; normalize both units.
      let resetTimestamp = normalizeEpochMs(stripe?.currentPeriodEnd)
      if (resetTimestamp === undefined && data?.startOfMonth) {
        const d = new Date()
        d.setMonth(d.getMonth() + 1, 1)
        d.setHours(0, 0, 0, 0)
        resetTimestamp = d.getTime()
      }

      const buildWindow = (windowId: string, label: string, usedRaw: number | undefined, resetMs: number | undefined, isWeekly: boolean, detail: string): MetricWindow => {
        if (usedRaw === undefined) {
          return {
            id: windowId,
            label,
            subtitle: '额度字段缺失 · 状态未知',
            quotaKind: 'unknown',
            status: 'unknown',
            barType: 'circle',
          }
        }
        const used = clampPercent(usedRaw)
        const remaining = 100 - used
        return {
          id: windowId,
          label,
          subtitle: `${formatQuotaResetText(resetMs, used, isWeekly)} · ${detail}`,
          usedPercent: used,
          remainingPercent: remaining,
          quotaKind: 'usage',
          resetAt: resetMs !== undefined ? new Date(resetMs).toISOString() : undefined,
          barType: 'circle',
          status: remaining <= 0 ? 'exhausted' : 'active',
        }
      }

      const windows: MetricWindow[] = [
        buildWindow('cursor-auto', 'Fast Requests (Cursor 核心模型)', autoUsed, resetTimestamp, true, '包含 Composer / Grok'),
        // No hardcoded dollar amount: the API window has no fixed $20 allowance.
        buildWindow('cursor-named', 'Other Models (其他通用模型)', apiUsed, undefined, true, '其他通用模型'),
      ]

      // warn tracks the worst quantified window (auto OR api), not just auto.
      const quantified = windows.filter(isQuantified)
      const lowestRemaining = quantified.length > 0 ? Math.min(...quantified.map(w => w.remainingPercent)) : undefined

      return {
        card: {
          id: cardId,
          name: cardName,
          provider: 'cursor',
          category: this.category,
          status: lowestRemaining !== undefined && lowestRemaining <= (config.alarmThresholdPercent ?? 15) ? 'warn' : 'ok',
          plan: (stripe.membershipType ?? data.membershipType ?? membershipType ?? 'Cursor').toUpperCase(),
          account: email || stripe.paymentId,
          groups: [
            {
              title: 'Cursor Plan Usage',
              windows,
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
          account: email,
          error: err.message,
          groups: [],
          lastUpdated: Date.now(),
        },
      }
    }
  }
}
