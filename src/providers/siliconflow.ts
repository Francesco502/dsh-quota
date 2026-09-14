import type { IQuotaProvider, QuotaConfig, ProviderResult, TestConnectionResult, AccountConfigItem } from '../core/types.ts'
import { fetchWithProxy } from '../core/fetch.ts'

export class SiliconFlowProvider implements IQuotaProvider {
  name = 'siliconflow'
  category = 'domestic_llm' as const

  private resolveTarget(config: QuotaConfig, accountConfig?: AccountConfigItem): { apiKey: string; baseUrl: string } {
    let apiKey = (accountConfig?.apiKey !== undefined
      ? accountConfig.apiKey
      : (config.siliconflow?.apiKey || process.env.SILICONFLOW_API_KEY || '')).trim()
    apiKey = apiKey.replace(/^Bearer\s+/i, '')
    const baseUrl = (accountConfig?.baseUrl || config.siliconflow?.baseUrl || 'https://api.siliconflow.cn').replace(/\/+$/, '')
    return { apiKey, baseUrl }
  }

  async testConnection(config: QuotaConfig, accountConfig?: AccountConfigItem): Promise<TestConnectionResult> {
    const start = Date.now()
    const { apiKey, baseUrl } = this.resolveTarget(config, accountConfig)
    if (!apiKey) {
      return {
        ok: false,
        provider: 'siliconflow',
        message: '未配置 SiliconFlow API Key。请在「设置」中填入 Key',
      }
    }

    try {
      const url = `${baseUrl}/v1/user/info`
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
          if (errData?.message) detail = errData.message
        } catch {}
        return {
          ok: false,
          provider: 'siliconflow',
          latencyMs,
          message: `验证失败: ${detail}`,
        }
      }

      const json = await res.json() as any
      const data = json.data || {}
      const bal = parseFloat(data.balance || '0')
      const name = data.name || data.email || 'SiliconFlow User'

      return {
        ok: true,
        provider: 'siliconflow',
        latencyMs,
        account: `余额: ¥${bal.toFixed(2)} CNY (${name})`,
        message: `连接成功 (延迟: ${latencyMs}ms, 余额: ¥${bal.toFixed(2)})`,
      }
    } catch (err: any) {
      return {
        ok: false,
        provider: 'siliconflow',
        latencyMs: Date.now() - start,
        message: `网络请求异常: ${err.message}`,
      }
    }
  }

  async fetchCard(config: QuotaConfig, accountConfig?: AccountConfigItem): Promise<ProviderResult> {
    const cardId = accountConfig?.id || 'siliconflow'
    const cardName = accountConfig?.name || config.customNames?.siliconflow || config.siliconflow?.name || '硅基流动 (SiliconFlow)'
    const { apiKey, baseUrl } = this.resolveTarget(config, accountConfig)

    if (!apiKey) {
      return {
        card: {
          id: cardId,
          name: cardName,
          provider: 'siliconflow',
          category: this.category,
          status: 'disabled',
          error: '未配置 API Key。请在「设置」中填入 SiliconFlow Key',
          groups: [],
          lastUpdated: Date.now(),
        },
      }
    }

    try {
      const url = `${baseUrl}/v1/user/info`
      const res = await fetchWithProxy(url, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: 'application/json',
        },
      }, config.httpProxy, 12000)

      if (!res.ok) {
        throw new Error(`硅基流动接口返回异常 (HTTP ${res.status})`)
      }

      const json = await res.json() as any
      const data = json.data || {}
      const available = parseFloat(data.balance || '0')
      const charge = parseFloat(data.chargeBalance || '0')
      const total = parseFloat(data.totalBalance || String(available))

      const isLow = available <= 2
      const status = isLow ? 'warn' : 'ok'
      const remPercent = available > 0 ? (available < 5 ? 20 : available < 20 ? 50 : 100) : 0
      const usedPercent = 100 - remPercent

      const subtitle = `可用额度: ¥${available.toFixed(2)} CNY${charge > 0 ? ` (充值金 ¥${charge.toFixed(2)})` : ''}`

      return {
        card: {
          id: cardId,
          name: cardName,
          provider: 'siliconflow',
          category: this.category,
          status,
          plan: 'SiliconFlow Cloud',
          account: data.name || data.email || undefined,
          balance: {
            currency: 'CNY',
            total: total > available ? total : available,
            remaining: available,
            toppedUpBalance: charge,
          },
          groups: [
            {
              title: '硅基流动账户配额',
              windows: [
                {
                  id: 'siliconflow-balance',
                  label: '账户可用余额',
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
          provider: 'siliconflow',
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
