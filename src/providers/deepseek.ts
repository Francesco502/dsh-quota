import type { IQuotaProvider, QuotaConfig, ProviderResult, TestConnectionResult, AccountConfigItem } from '../core/types.ts'
import { fetchWithProxy } from '../core/fetch.ts'

interface DeepSeekBalanceResponse {
  is_available?: boolean
  balance_infos?: Array<{
    currency?: string
    total_balance?: string | number
    granted_balance?: string | number
    topped_up_balance?: string | number
  }>
}

export class DeepSeekProvider implements IQuotaProvider {
  name = 'deepseek'
  category = 'domestic_llm' as const

  private resolveKey(config: QuotaConfig, accountConfig?: AccountConfigItem): { apiKey: string; baseUrl: string } {
    const apiKey = (accountConfig?.apiKey || config.deepseek?.apiKey || process.env.DEEPSEEK_API_KEY || '').trim()
    const baseUrl = (accountConfig?.baseUrl || config.deepseek?.baseUrl || 'https://api.deepseek.com').replace(/\/+$/, '')
    return { apiKey, baseUrl }
  }

  async testConnection(config: QuotaConfig, accountConfig?: AccountConfigItem): Promise<TestConnectionResult> {
    const start = Date.now()
    const { apiKey, baseUrl } = this.resolveKey(config, accountConfig)
    if (!apiKey) {
      return {
        ok: false,
        provider: 'deepseek',
        message: '未配置 DeepSeek API Key。请在「设置」中填入 Key',
      }
    }

    try {
      const url = `${baseUrl}/user/balance`
      const res = await fetchWithProxy(url, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: 'application/json',
        },
      }, config.httpProxy, 10000)

      const latencyMs = Date.now() - start
      if (!res.ok) {
        return {
          ok: false,
          provider: 'deepseek',
          latencyMs,
          message: `连接失败: HTTP ${res.status}`,
        }
      }

      const data = await res.json() as DeepSeekBalanceResponse
      const info = data.balance_infos?.[0]
      const total = info?.total_balance ?? '0.00'
      const currency = info?.currency || 'CNY'
      return {
        ok: true,
        provider: 'deepseek',
        latencyMs,
        account: `余额: ¥${total} ${currency}`,
        message: `连接成功 (延迟: ${latencyMs}ms, 余额: ¥${total})`,
      }
    } catch (err: any) {
      return {
        ok: false,
        provider: 'deepseek',
        latencyMs: Date.now() - start,
        message: `请求异常: ${err.message}`,
      }
    }
  }

  async fetchCard(config: QuotaConfig, accountConfig?: AccountConfigItem): Promise<ProviderResult> {
    const cardId = accountConfig?.id || 'deepseek'
    const cardName = accountConfig?.name || 'DeepSeek 官方 API'
    const { apiKey, baseUrl } = this.resolveKey(config, accountConfig)

    if (!apiKey) {
      return {
        card: {
          id: cardId,
          name: cardName,
          provider: 'deepseek',
          category: this.category,
          status: 'disabled',
          error: '未配置 API Key。请在「设置」中填入 DeepSeek API Key',
          groups: [],
          lastUpdated: Date.now(),
        },
      }
    }

    try {
      const url = `${baseUrl}/user/balance`
      const res = await fetchWithProxy(url, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: 'application/json',
        },
      }, config.httpProxy, 15000)

      if (!res.ok) {
        throw new Error(`API 错误 (${res.status})`)
      }

      const data = await res.json() as DeepSeekBalanceResponse
      const info = data.balance_infos?.[0]
      const isAvailable = data.is_available !== false

      const totalBalance = typeof info?.total_balance === 'string' ? parseFloat(info.total_balance) : (info?.total_balance ?? 0)
      const grantedBalance = typeof info?.granted_balance === 'string' ? parseFloat(info.granted_balance) : (info?.granted_balance ?? 0)
      const toppedUpBalance = typeof info?.topped_up_balance === 'string' ? parseFloat(info.topped_up_balance) : (info?.topped_up_balance ?? 0)

      // Balance metric display
      const totalAmount = Math.max(0, totalBalance)
      const remPercent = totalAmount > 0 ? (totalAmount < 5 ? 15 : totalAmount < 20 ? 40 : 100) : 0
      const usedPercent = 100 - remPercent

      const subtitle = `总额: ¥${totalAmount.toFixed(2)} (充值 ¥${toppedUpBalance.toFixed(2)} + 赠送 ¥${grantedBalance.toFixed(2)})`

      return {
        card: {
          id: cardId,
          name: cardName,
          provider: 'deepseek',
          category: this.category,
          status: !isAvailable || totalAmount <= 0 ? 'error' : (totalAmount < 5 ? 'warn' : 'ok'),
          plan: 'DeepSeek Platform',
          account: `¥${totalAmount.toFixed(2)} CNY`,
          balance: {
            currency: 'CNY',
            total: totalAmount,
            remaining: totalAmount,
            grantedBalance,
            toppedUpBalance,
          },
          groups: [
            {
              title: 'DeepSeek 账户余额',
              windows: [
                {
                  id: 'deepseek-balance',
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
          provider: 'deepseek',
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
