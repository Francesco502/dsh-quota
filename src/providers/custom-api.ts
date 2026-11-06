import type {
  IQuotaProvider,
  QuotaConfig,
  ProviderResult,
  TestConnectionResult,
  AccountConfigItem,
  MetricWindow,
  QuotaBalanceInfo,
} from '../core/types.ts'
import { fetchWithProxy } from '../core/fetch.ts'
import { assertSafeRemoteUrl, UnsafeRemoteUrlError } from '../core/net-guard.ts'

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

function round2(value: number): number {
  return Math.round(value * 100) / 100
}

function money(value: number): string {
  return `$${value.toFixed(2)}`
}

interface BillingSnapshot {
  source: 'billing' | 'oneapi-quota' | 'balance'
  currency: 'USD'
  /** Original granted/total amount in USD — the only valid denominator. */
  total?: number
  used?: number
  remaining?: number
}

export class CustomApiProvider implements IQuotaProvider {
  name = 'custom_api'
  category = 'custom_api' as const

  private resolveTarget(accountConfig?: AccountConfigItem): { id: string; name: string; apiKey: string; baseUrl: string; balancePath?: string } {
    const id = accountConfig?.id || 'custom_api'
    const name = accountConfig?.name || '自定义 / OneAPI 中转'
    const apiKey = (accountConfig?.apiKey || '').trim()
    const baseUrl = (accountConfig?.baseUrl || 'https://api.openai.com').replace(/\/+$/, '')
    const balancePath = (accountConfig?.extra?.balancePath || (accountConfig as any)?.balancePath || '').trim()
    return { id, name, apiKey, baseUrl, balancePath }
  }

  /**
   * Interpret the balance/billing payloads that relays expose. Returns `null` when
   * the endpoint did not describe the account's quota at all.
   */
  private parseBillingPayload(payload: any): BillingSnapshot | null {
    if (!payload || typeof payload !== 'object') return null

    // OpenAI-compatible billing subscription: the granted total is the denominator
    // and `total_usage` is consumed in the same currency unit. Never derive the
    // denominator from the remaining amount (that is what made 0/100% fake).
    const total =
      parseFinite(payload.hard_limit_usd) ??
      parseFinite(payload.system_hard_limit_usd) ??
      parseFinite(payload.total_granted)
    if (total !== undefined) {
      const directRemaining = parseFinite(payload.total_available)
      const rawUsed = parseFinite(payload.total_usage) ?? parseFinite(payload.total_used)
      // A negative remainder (over-consumed limit) is shown as 0, never as a
      // negative money string.
      const remaining = directRemaining !== undefined
        ? Math.max(0, round2(directRemaining))
        : (rawUsed !== undefined ? Math.max(0, round2(total - rawUsed)) : undefined)
      const used = rawUsed ?? (remaining !== undefined ? round2(total - remaining) : undefined)
      return { source: 'billing', currency: 'USD', total, used, remaining }
    }

    // OneAPI / NewAPI `/api/user/self`: `data.quota` is the REMAINING quota in the
    // upstream's internal unit (500000 units = $1); it is NOT the granted total. A
    // ratio only exists when `data.used_quota` is also present, so the granted
    // total is reconstructed as remaining + used instead of reusing remaining as
    // the denominator (the old bug that always produced 100%).
    const data = payload.data
    const rawRemainingQuota = parseFinite(data?.quota)
    if (rawRemainingQuota !== undefined) {
      const remaining = round2(rawRemainingQuota / 500000)
      const rawUsedQuota = parseFinite(data?.used_quota)
      const used = rawUsedQuota !== undefined ? round2(rawUsedQuota / 500000) : undefined
      const quotaTotal = used !== undefined ? round2(remaining + used) : undefined
      return { source: 'oneapi-quota', currency: 'USD', total: quotaTotal, used, remaining }
    }

    // Amount-only endpoints: an amount is never a ratio.
    const balance =
      parseFinite(data?.balance) ??
      parseFinite(data?.total_balance) ??
      parseFinite(payload.balance) ??
      parseFinite(payload.total_balance)
    if (balance !== undefined) {
      return { source: 'balance', currency: 'USD', remaining: balance }
    }
    return null
  }

  async testConnection(config: QuotaConfig, accountConfig?: AccountConfigItem, signal?: AbortSignal): Promise<TestConnectionResult> {
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
      // Reject non-http(s) / metadata / link-local targets before any request.
      await assertSafeRemoteUrl(baseUrl)
      const headers = { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' }
      const testUrl = balancePath
        ? `${baseUrl}${balancePath.startsWith('/') ? balancePath : '/' + balancePath}`
        : `${baseUrl}/v1/models`
      const res = await fetchWithProxy(testUrl, { headers, signal }, config.httpProxy, 10000, config.proxyMode)

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
    } catch (err: any) {
      const unsafe = err instanceof UnsafeRemoteUrlError
      return {
        ok: false,
        provider: 'custom_api',
        latencyMs: Date.now() - start,
        message: unsafe ? `Base URL 校验失败: ${err.message}` : `请求异常: ${err.message}`,
      }
    }
  }

  async fetchCard(config: QuotaConfig, accountConfig?: AccountConfigItem, signal?: AbortSignal): Promise<ProviderResult> {
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
      // The base URL is user-supplied: validate it before any outbound request.
      await assertSafeRemoteUrl(baseUrl)

      // Try OneAPI / NewAPI usage endpoints
      const headers = { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' }
      const endpointsToFetch = [
        fetchWithProxy(`${baseUrl}/v1/models`, { headers, signal }, config.httpProxy, 10000, config.proxyMode),
      ]
      if (balancePath) {
        endpointsToFetch.push(
          fetchWithProxy(`${baseUrl}${balancePath.startsWith('/') ? balancePath : '/' + balancePath}`, { headers, signal }, config.httpProxy, 8000, config.proxyMode)
        )
      } else {
        endpointsToFetch.push(
          fetchWithProxy(`${baseUrl}/v1/dashboard/billing/subscription`, { headers, signal }, config.httpProxy, 8000, config.proxyMode),
          fetchWithProxy(`${baseUrl}/api/user/self`, { headers, signal }, config.httpProxy, 8000, config.proxyMode)
        )
      }

      const settled = await Promise.allSettled(endpointsToFetch)
      const modelsRes = settled[0]

      if (!modelsRes || modelsRes.status === 'rejected' || (modelsRes.status === 'fulfilled' && !modelsRes.value.ok)) {
        const err = modelsRes && modelsRes.status === 'fulfilled' ? `HTTP ${modelsRes.value.status}` : ((modelsRes as any)?.reason?.message || '网络异常')
        throw new Error(`API 验证失败: ${err}`)
      }

      let snapshot: BillingSnapshot | null = null
      for (let i = 1; i < settled.length; i++) {
        const subRes = settled[i]
        if (subRes && subRes.status === 'fulfilled' && subRes.value.ok) {
          try {
            const subData = await subRes.value.json()
            const parsed = this.parseBillingPayload(subData)
            if (parsed) {
              snapshot = parsed
              break
            }
          } catch {}
        }
      }

      // The percentage is only meaningful when BOTH sides of the ratio are known
      // and the denominator is the upstream's original granted total.
      let ratio: { usedPercent: number; remainingPercent: number } | undefined
      if (snapshot?.total !== undefined && snapshot.total > 0) {
        if (snapshot.used !== undefined) {
          const usedPercent = clampPercent((snapshot.used / snapshot.total) * 100)
          ratio = { usedPercent, remainingPercent: 100 - usedPercent }
        } else if (snapshot.remaining !== undefined) {
          const remainingPercent = clampPercent((snapshot.remaining / snapshot.total) * 100)
          ratio = { usedPercent: 100 - remainingPercent, remainingPercent }
        }
      }

      const windows: MetricWindow[] = []
      if (ratio && snapshot) {
        const parts = [`总额 ${money(snapshot.total!)}`]
        if (snapshot.used !== undefined) parts.push(`已用 ${money(snapshot.used)}`)
        if (snapshot.remaining !== undefined) parts.push(`剩余 ${money(snapshot.remaining)}`)
        windows.push({
          id: `${id}-quota`,
          label: '中转额度',
          subtitle: parts.join(' · '),
          usedPercent: ratio.usedPercent,
          remainingPercent: ratio.remainingPercent,
          quotaKind: 'usage',
          barType: 'circle',
          status: ratio.remainingPercent <= 0 ? 'exhausted' : 'active',
        })
      } else if (snapshot?.remaining !== undefined) {
        // Amount only: show the money, never a synthesized percentage.
        windows.push({
          id: `${id}-balance`,
          label: '中转余额',
          subtitle: snapshot.total !== undefined
            ? `总额 ${money(snapshot.total)} · 剩余 ${money(snapshot.remaining)} · 用量未知`
            : `剩余 ${money(snapshot.remaining)} · 总额未知`,
          quotaKind: 'balance',
          amountText: money(snapshot.remaining),
          barType: 'balance',
          status: snapshot.remaining <= 0 ? 'exhausted' : 'active',
        })
      } else if (snapshot?.total !== undefined) {
        windows.push({
          id: `${id}-quota`,
          label: '中转额度',
          subtitle: `总限额 ${money(snapshot.total)} · 用量未知`,
          quotaKind: 'unknown',
          status: 'unknown',
          barType: 'circle',
        })
      } else {
        // Connectivity only: there is no quota interface on this relay.
        windows.push({
          id: `${id}-liveness`,
          label: '中转接口连通性',
          subtitle: '接口在线 · 未提供额度接口',
          quotaKind: 'liveness',
          status: 'unknown',
          barType: 'circle',
        })
      }

      const threshold = config.alarmThresholdPercent ?? 15
      const lowRatio = ratio !== undefined && ratio.remainingPercent <= threshold
      const emptyBalance = snapshot?.remaining !== undefined && snapshot.remaining <= 0
      const balance: QuotaBalanceInfo | undefined = snapshot
        ? { currency: snapshot.currency, total: snapshot.total, used: snapshot.used, remaining: snapshot.remaining }
        : undefined

      return {
        card: {
          id,
          name,
          provider: 'custom_api',
          category: this.category,
          status: lowRatio || emptyBalance ? 'warn' : 'ok',
          plan: 'Custom / OneAPI',
          account: baseUrl.replace(/^https?:\/\//, ''),
          balance,
          groups: [
            {
              title: 'API 中转站状态',
              windows,
            },
          ],
          lastUpdated: Date.now(),
        },
      }
    } catch (err: any) {
      const unsafe = err instanceof UnsafeRemoteUrlError
      return {
        card: {
          id,
          name,
          provider: 'custom_api',
          category: this.category,
          status: 'error',
          error: unsafe ? `Base URL 被安全策略拒绝: ${err.message}` : err.message,
          groups: [],
          lastUpdated: Date.now(),
        },
      }
    }
  }
}
