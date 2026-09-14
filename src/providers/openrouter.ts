import type { IQuotaProvider, QuotaConfig, ProviderResult, TestConnectionResult, AccountConfigItem } from '../core/types.ts'
import { fetchWithProxy } from '../core/fetch.ts'

export class OpenRouterProvider implements IQuotaProvider {
  name = 'openrouter'
  category = 'official_cloud' as const

  private resolveTarget(config: QuotaConfig, accountConfig?: AccountConfigItem): { apiKey: string; baseUrl: string } {
    let apiKey = (accountConfig?.apiKey !== undefined
      ? accountConfig.apiKey
      : (config.openrouter?.apiKey || process.env.OPENROUTER_API_KEY || '')).trim()
    apiKey = apiKey.replace(/^Bearer\s+/i, '')
    const baseUrl = (accountConfig?.baseUrl || config.openrouter?.baseUrl || 'https://openrouter.ai/api').replace(/\/+$/, '')
    return { apiKey, baseUrl }
  }

  async testConnection(config: QuotaConfig, accountConfig?: AccountConfigItem): Promise<TestConnectionResult> {
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
          const errData = await res.json() as any
          if (errData?.error?.message) detail = errData.error.message
        } catch {}
        return {
          ok: false,
          provider: 'openrouter',
          latencyMs,
          message: `验证失败: ${detail}`,
        }
      }

      const json = await res.json() as any
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
    } catch (err: any) {
      return {
        ok: false,
        provider: 'openrouter',
        latencyMs: Date.now() - start,
        message: `网络请求异常: ${err.message}`,
      }
    }
  }

  async fetchCard(config: QuotaConfig, accountConfig?: AccountConfigItem): Promise<ProviderResult> {
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

      const json = await res.json() as any
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
    } catch (err: any) {
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
