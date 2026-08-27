import type { IQuotaProvider, QuotaConfig, ProviderResult, TestConnectionResult, AccountConfigItem } from '../core/types.ts'
import { fetchWithProxy } from '../core/fetch.ts'

export class CustomApiProvider implements IQuotaProvider {
  name = 'custom_api'
  category = 'custom_api' as const

  private resolveTarget(accountConfig?: AccountConfigItem): { id: string; name: string; apiKey: string; baseUrl: string } {
    const id = accountConfig?.id || 'custom_api'
    const name = accountConfig?.name || '自定义 / OneAPI 中转'
    const apiKey = (accountConfig?.apiKey || '').trim()
    const baseUrl = (accountConfig?.baseUrl || 'https://api.openai.com').replace(/\/+$/, '')
    return { id, name, apiKey, baseUrl }
  }

  async testConnection(config: QuotaConfig, accountConfig?: AccountConfigItem): Promise<TestConnectionResult> {
    const start = Date.now()
    const { apiKey, baseUrl } = this.resolveTarget(accountConfig)
    if (!apiKey) {
      return {
        ok: false,
        provider: 'custom_api',
        message: '未配置 API Key',
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
      return {
        ok: false,
        provider: 'custom_api',
        latencyMs: Date.now() - start,
        message: `请求异常: ${err.message}`,
      }
    }
  }

  async fetchCard(config: QuotaConfig, accountConfig?: AccountConfigItem): Promise<ProviderResult> {
    const { id, name, apiKey, baseUrl } = this.resolveTarget(accountConfig)

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
      // Try OneAPI / NewAPI usage endpoint first
      const headers = { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' }
      const [modelsRes, subRes] = await Promise.allSettled([
        fetchWithProxy(`${baseUrl}/v1/models`, { headers }, config.httpProxy, 10000),
        fetchWithProxy(`${baseUrl}/v1/dashboard/billing/subscription`, { headers }, config.httpProxy, 8000),
      ])

      if (modelsRes.status === 'rejected' || (modelsRes.status === 'fulfilled' && !modelsRes.value.ok)) {
        const err = modelsRes.status === 'fulfilled' ? `HTTP ${modelsRes.value.status}` : (modelsRes as any).reason?.message
        throw new Error(`API 验证失败: ${err}`)
      }

      let hardLimit = 0
      let totalUsage = 0
      let hasBilling = false

      if (subRes.status === 'fulfilled' && subRes.value.ok) {
        try {
          const subData = await subRes.value.json() as any
          hardLimit = subData.hard_limit_usd ?? subData.total_granted ?? 0
          totalUsage = subData.total_usage ?? 0
          hasBilling = hardLimit > 0
        } catch {}
      }

      const remPercent = hasBilling && hardLimit > 0
        ? Math.max(0, Math.min(100, Math.round(((hardLimit - totalUsage) / hardLimit) * 100)))
        : 100
      const usedPercent = 100 - remPercent

      const subtitle = hasBilling
        ? `总限额: $${hardLimit.toFixed(2)} (已用 $${totalUsage.toFixed(2)})`
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
          balance: hasBilling ? { currency: 'USD', total: hardLimit, used: totalUsage, remaining: hardLimit - totalUsage } : undefined,
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
    } catch (err: any) {
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
