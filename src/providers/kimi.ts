import type { IQuotaProvider, QuotaConfig, ProviderResult, TestConnectionResult, AccountConfigItem } from '../core/types.ts'
import { fetchWithProxy } from '../core/fetch.ts'

export class KimiProvider implements IQuotaProvider {
  name = 'kimi'
  category = 'domestic_llm' as const

  private resolveKey(config: QuotaConfig, accountConfig?: AccountConfigItem): { apiKey: string; baseUrl: string } {
    const apiKey = (accountConfig?.apiKey || config.kimi?.apiKey || process.env.MOONSHOT_API_KEY || '').trim()
    const baseUrl = (accountConfig?.baseUrl || config.kimi?.baseUrl || 'https://api.moonshot.cn').replace(/\/+$/, '')
    return { apiKey, baseUrl }
  }

  async testConnection(config: QuotaConfig, accountConfig?: AccountConfigItem): Promise<TestConnectionResult> {
    const start = Date.now()
    const { apiKey, baseUrl } = this.resolveKey(config, accountConfig)
    if (!apiKey) {
      return {
        ok: false,
        provider: 'kimi',
        message: '未配置 Kimi / Moonshot API Key',
      }
    }

    try {
      const url = `${baseUrl}/v1/users/me/balance`
      const res = await fetchWithProxy(url, {
        headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
      }, config.httpProxy, 10000)

      const latencyMs = Date.now() - start
      if (res.ok) {
        const json = await res.json() as any
        const bal = json.data?.available_balance ?? '0.00'
        return {
          ok: true,
          provider: 'kimi',
          latencyMs,
          account: `可用余额: ¥${bal}`,
          message: `连接成功 (延迟: ${latencyMs}ms, 余额: ¥${bal})`,
        }
      }

      return {
        ok: false,
        provider: 'kimi',
        latencyMs,
        message: `验证失败: HTTP ${res.status}`,
      }
    } catch (err: any) {
      return {
        ok: false,
        provider: 'kimi',
        latencyMs: Date.now() - start,
        message: `请求异常: ${err.message}`,
      }
    }
  }

  async fetchCard(config: QuotaConfig, accountConfig?: AccountConfigItem): Promise<ProviderResult> {
    const cardId = accountConfig?.id || 'kimi'
    const cardName = accountConfig?.name || 'Moonshot Kimi'
    const { apiKey, baseUrl } = this.resolveKey(config, accountConfig)

    if (!apiKey) {
      return {
        card: {
          id: cardId,
          name: cardName,
          provider: 'kimi',
          category: this.category,
          status: 'disabled',
          error: '未配置 API Key。请在设置中填入 Kimi (Moonshot) Key',
          groups: [],
          lastUpdated: Date.now(),
        },
      }
    }

    try {
      const url = `${baseUrl}/v1/users/me/balance`
      const res = await fetchWithProxy(url, {
        headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
      }, config.httpProxy, 15000)

      if (!res.ok) {
        throw new Error(`API 错误 (${res.status})`)
      }

      const json = await res.json() as any
      const data = json.data || {}
      const available = typeof data.available_balance === 'number' ? data.available_balance : parseFloat(data.available_balance || '0')
      const cash = typeof data.cash_balance === 'number' ? data.cash_balance : parseFloat(data.cash_balance || '0')
      const voucher = typeof data.voucher_balance === 'number' ? data.voucher_balance : parseFloat(data.voucher_balance || '0')

      const remPercent = available > 0 ? (available < 5 ? 15 : available < 20 ? 40 : 100) : 0
      const usedPercent = 100 - remPercent

      const subtitle = `总额: ¥${available.toFixed(2)} (充值 ¥${cash.toFixed(2)} + 赠金 ¥${voucher.toFixed(2)})`

      return {
        card: {
          id: cardId,
          name: cardName,
          provider: 'kimi',
          category: this.category,
          status: available <= 0 ? 'error' : (available < 5 ? 'warn' : 'ok'),
          plan: 'Moonshot API',
          account: `¥${available.toFixed(2)} CNY`,
          balance: {
            currency: 'CNY',
            total: available,
            remaining: available,
            grantedBalance: voucher,
            toppedUpBalance: cash,
          },
          groups: [
            {
              title: 'Kimi 账户余额',
              windows: [
                {
                  id: 'kimi-balance',
                  label: '账户总可用余额 (CNY)',
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
          provider: 'kimi',
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
