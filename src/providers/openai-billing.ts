import type { IQuotaProvider, QuotaConfig, ProviderResult, TestConnectionResult, AccountConfigItem } from '../core/types.ts'
import { fetchWithProxy } from '../core/fetch.ts'

export class OpenAIBillingProvider implements IQuotaProvider {
  name = 'openai_billing'
  category = 'official_cloud' as const

  private resolveKey(config: QuotaConfig, accountConfig?: AccountConfigItem): { apiKey: string; baseUrl: string } {
    const apiKey = (accountConfig?.apiKey || config.openai_billing?.apiKey || process.env.OPENAI_API_KEY || '').trim()
    const baseUrl = (accountConfig?.baseUrl || config.openai_billing?.baseUrl || 'https://api.openai.com').replace(/\/+$/, '')
    return { apiKey, baseUrl }
  }

  async testConnection(config: QuotaConfig, accountConfig?: AccountConfigItem): Promise<TestConnectionResult> {
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
    } catch (err: any) {
      return {
        ok: false,
        provider: 'openai_billing',
        latencyMs: Date.now() - start,
        message: `请求异常: ${err.message}`,
      }
    }
  }

  async fetchCard(config: QuotaConfig, accountConfig?: AccountConfigItem): Promise<ProviderResult> {
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
        const err = modelsRes.status === 'fulfilled' ? `HTTP ${modelsRes.value.status}` : (modelsRes as any).reason?.message
        throw new Error(`OpenAI Key 验证失败: ${err}`)
      }

      let hardLimit = 0
      let totalUsage = 0
      let hasBilling = false

      if (subRes.status === 'fulfilled' && subRes.value.ok) {
        const subData = await subRes.value.json() as any
        hardLimit = subData.hard_limit_usd ?? subData.system_hard_limit_usd ?? 0
        hasBilling = true
      }

      const remPercent = hasBilling && hardLimit > 0 ? Math.max(0, Math.min(100, Math.round(((hardLimit - totalUsage) / hardLimit) * 100))) : 100
      const usedPercent = 100 - remPercent

      const subtitle = hasBilling && hardLimit > 0
        ? `总限额: $${hardLimit.toFixed(2)} USD`
        : 'API Key 有效 · 额度正常'

      return {
        card: {
          id: cardId,
          name: cardName,
          provider: 'openai_billing',
          category: this.category,
          status: remPercent <= 15 ? 'warn' : 'ok',
          plan: 'OpenAI API',
          balance: hasBilling ? { currency: 'USD', total: hardLimit, remaining: hardLimit - totalUsage } : undefined,
          groups: [
            {
              title: 'OpenAI 额度监控',
              windows: [
                {
                  id: 'openai-api-limit',
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
    } catch (err: any) {
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
