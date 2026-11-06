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

/**
 * `/v1/organization/costs` sums bucket results in USD (dollars, not cents).
 * A paginated response (`has_more: true`) is only a partial window, so it must
 * not be treated as the account's consumed total.
 */
function sumOrganizationCosts(payload: any): number | undefined {
  if (!payload || !Array.isArray(payload.data)) return undefined
  if (payload.has_more === true) return undefined
  let total = 0
  let sawAmount = false
  for (const bucket of payload.data) {
    const results = Array.isArray(bucket?.results) ? bucket.results : []
    for (const result of results) {
      const value = parseFinite(result?.amount?.value)
      if (value !== undefined) {
        total += value
        sawAmount = true
      }
    }
  }
  return sawAmount ? round2(total) : undefined
}

/** `/v1/dashboard/billing/usage` reports `total_usage` in cents (legacy relay API). */
function dashboardUsageUsd(payload: any): number | undefined {
  const cents = parseFinite(payload?.total_usage)
  return cents !== undefined ? round2(cents / 100) : undefined
}

export class OpenAIBillingProvider implements IQuotaProvider {
  name = 'openai_billing'
  category = 'official_cloud' as const

  private resolveKey(config: QuotaConfig, accountConfig?: AccountConfigItem): { apiKey: string; baseUrl: string } {
    let apiKey = ''
    if (accountConfig && accountConfig.apiKey !== undefined) apiKey = accountConfig.apiKey
    else if (config.openai_billing && config.openai_billing.apiKey !== undefined) apiKey = config.openai_billing.apiKey
    apiKey = apiKey.trim().replace(/^Bearer\s+/i, '')
    const baseUrl = (accountConfig?.baseUrl || config.openai_billing?.baseUrl || 'https://api.openai.com').replace(/\/+$/, '')
    return { apiKey, baseUrl }
  }

  private hostOf(baseUrl: string): string | undefined {
    try {
      return new URL(baseUrl).hostname
    } catch {
      return undefined
    }
  }

  async testConnection(config: QuotaConfig, accountConfig?: AccountConfigItem, signal?: AbortSignal): Promise<TestConnectionResult> {
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
      await assertSafeRemoteUrl(baseUrl)
      const res = await fetchWithProxy(`${baseUrl}/v1/models`, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal,
      }, config.httpProxy, 10000, config.proxyMode)

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
    } catch (err: any) {
      const unsafe = err instanceof UnsafeRemoteUrlError
      return {
        ok: false,
        provider: 'openai_billing',
        latencyMs: Date.now() - start,
        message: unsafe ? `Base URL 校验失败: ${err.message}` : `请求异常: ${err.message}`,
      }
    }
  }

  async fetchCard(config: QuotaConfig, accountConfig?: AccountConfigItem, signal?: AbortSignal): Promise<ProviderResult> {
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
      await assertSafeRemoteUrl(baseUrl)

      const headers = { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' }
      const now = Date.now()
      const startTime = Math.floor((now - 30 * 24 * 60 * 60 * 1000) / 1000)
      const endDate = new Date(now).toISOString().slice(0, 10)
      const startDate = new Date(now - 30 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10)

      const modelsUrl = `${baseUrl}/v1/models`
      const costsUrl = `${baseUrl}/v1/organization/costs?start_time=${startTime}&bucket_width=1d&limit=31`
      const usageUrl = `${baseUrl}/v1/dashboard/billing/usage?start_date=${startDate}&end_date=${endDate}`

      const [modelsRes, subRes, costsRes, usageRes] = await Promise.allSettled([
        fetchWithProxy(modelsUrl, { headers, signal }, config.httpProxy, 10000, config.proxyMode),
        fetchWithProxy(`${baseUrl}/v1/dashboard/billing/subscription`, { headers, signal }, config.httpProxy, 10000, config.proxyMode),
        fetchWithProxy(costsUrl, { headers, signal }, config.httpProxy, 10000, config.proxyMode),
        fetchWithProxy(usageUrl, { headers, signal }, config.httpProxy, 10000, config.proxyMode),
      ])

      if (modelsRes.status === 'rejected' || (modelsRes.status === 'fulfilled' && !modelsRes.value.ok)) {
        const err = modelsRes.status === 'fulfilled' ? `HTTP ${modelsRes.value.status}` : (modelsRes as any).reason?.message
        throw new Error(`OpenAI Key 验证失败: ${err}`)
      }

      // The granted total is the denominator; it is never derived from usage.
      let hardLimit: number | undefined
      if (subRes.status === 'fulfilled' && subRes.value.ok) {
        try {
          const subData = await subRes.value.json() as any
          hardLimit = parseFinite(subData.hard_limit_usd) ?? parseFinite(subData.system_hard_limit_usd)
        } catch {}
      }

      // Real usage: organization costs (USD) first, then the legacy dashboard usage
      // (cents). If neither is readable (plain project key), the ratio is unknown —
      // it must never default to "100% remaining".
      let usedUsd: number | undefined
      let usageSource: string | undefined
      if (costsRes.status === 'fulfilled' && costsRes.value.ok) {
        try {
          const costsData = await costsRes.value.json()
          usedUsd = sumOrganizationCosts(costsData)
          if (usedUsd !== undefined) usageSource = costsUrl
        } catch {}
      }
      if (usedUsd === undefined && usageRes.status === 'fulfilled' && usageRes.value.ok) {
        try {
          const usageData = await usageRes.value.json()
          usedUsd = dashboardUsageUsd(usageData)
          if (usedUsd !== undefined) usageSource = usageUrl
        } catch {}
      }

      const ratioKnown = hardLimit !== undefined && hardLimit > 0 && usedUsd !== undefined
      let usedPercent: number | undefined
      let remainingPercent: number | undefined
      let remainingUsd: number | undefined
      if (ratioKnown) {
        remainingUsd = round2(Math.max(0, hardLimit! - usedUsd!))
        usedPercent = clampPercent((usedUsd! / hardLimit!) * 100)
        remainingPercent = 100 - usedPercent
      }

      const threshold = config.alarmThresholdPercent ?? 15

      let subtitle: string
      if (ratioKnown) {
        subtitle = `总限额 ${money(hardLimit!)} · 已用 ${money(usedUsd!)} · 剩余 ${money(remainingUsd!)}`
      } else if (hardLimit !== undefined && hardLimit > 0) {
        subtitle = `总限额 ${money(hardLimit)} · 无法获取用量（需 Admin Key 或计费权限）`
      } else if (usedUsd !== undefined) {
        subtitle = `已用 ${money(usedUsd)} · 未获取到有效限额`
      } else if (hardLimit !== undefined) {
        subtitle = 'API Key 有效 · 上游返回的限额为 0，无法量化'
      } else {
        subtitle = 'API Key 有效 · 官方未开放余额查询'
      }

      const window: MetricWindow = ratioKnown
        ? {
            id: 'openai-api-limit',
            label: 'API Key 可用状态',
            subtitle,
            usedPercent,
            remainingPercent,
            quotaKind: 'usage',
            barType: 'circle',
            status: remainingPercent! <= 0 ? 'exhausted' : 'active',
          }
        : {
            id: 'openai-api-limit',
            label: 'API Key 可用状态',
            subtitle,
            quotaKind: 'unknown',
            barType: 'circle',
            status: 'unknown',
          }

      const balance: QuotaBalanceInfo | undefined = ratioKnown
        ? { currency: 'USD', total: hardLimit, used: usedUsd, remaining: remainingUsd }
        : (hardLimit !== undefined
            ? { currency: 'USD', total: hardLimit }
            : (usedUsd !== undefined ? { currency: 'USD', used: usedUsd } : undefined))

      return {
        card: {
          id: cardId,
          name: cardName,
          provider: 'openai_billing',
          category: this.category,
          status: ratioKnown && remainingPercent! <= threshold ? 'warn' : 'ok',
          plan: 'OpenAI API',
          balance,
          groups: [
            {
              id: 'openai-billing-group',
              title: 'OpenAI 额度监控',
              hasInfoIcon: true,
              poolType: 'general',
              windows: [window],
            },
          ],
          lastUpdated: Date.now(),
          sourceProvenance: {
            endpoint: usageSource ?? modelsUrl,
            method: 'oauth-api',
            timestamp: Date.now(),
            partial: !ratioKnown,
            host: this.hostOf(baseUrl),
          },
        },
      }
    } catch (err: any) {
      const unsafe = err instanceof UnsafeRemoteUrlError
      return {
        card: {
          id: cardId,
          name: cardName,
          provider: 'openai_billing',
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
