import type { IQuotaProvider, QuotaConfig, ProviderResult, TestConnectionResult, AccountConfigItem } from '../core/types.ts'
import { fetchWithProxy } from '../core/fetch.ts'

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

  async testConnection(config: QuotaConfig, accountConfig?: AccountConfigItem): Promise<TestConnectionResult> {
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
        const err = modelsRes && modelsRes.status === 'fulfilled' ? `HTTP ${modelsRes.value.status}` : ((modelsRes as any)?.reason?.message || '网络异常')
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
            const subData = await subRes.value.json() as any
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
