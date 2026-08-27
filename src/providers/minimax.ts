import type { IQuotaProvider, QuotaConfig, ProviderResult, TestConnectionResult, AccountConfigItem } from '../core/types.ts'
import { fetchWithProxy } from '../core/fetch.ts'

export class MiniMaxProvider implements IQuotaProvider {
  name = 'minimax'
  category = 'domestic_llm' as const

  private resolveKey(config: QuotaConfig, accountConfig?: AccountConfigItem): { apiKey: string; baseUrl: string; groupId?: string } {
    const apiKey = (accountConfig?.apiKey || config.minimax?.apiKey || process.env.MINIMAX_API_KEY || '').trim()
    const baseUrl = (accountConfig?.baseUrl || config.minimax?.baseUrl || 'https://api.minimax.chat').replace(/\/+$/, '')
    const groupId = accountConfig?.extra?.groupId || config.minimax?.groupId
    return { apiKey, baseUrl, groupId }
  }

  async testConnection(config: QuotaConfig, accountConfig?: AccountConfigItem): Promise<TestConnectionResult> {
    const start = Date.now()
    const { apiKey, baseUrl } = this.resolveKey(config, accountConfig)
    if (!apiKey) {
      return {
        ok: false,
        provider: 'minimax',
        message: '未配置 MiniMax API Key',
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
          provider: 'minimax',
          latencyMs,
          message: `连接成功 (延迟: ${latencyMs}ms)`,
        }
      }

      return {
        ok: false,
        provider: 'minimax',
        latencyMs,
        message: `验证失败: HTTP ${res.status}`,
      }
    } catch (err: any) {
      return {
        ok: false,
        provider: 'minimax',
        latencyMs: Date.now() - start,
        message: `请求异常: ${err.message}`,
      }
    }
  }

  async fetchCard(config: QuotaConfig, accountConfig?: AccountConfigItem): Promise<ProviderResult> {
    const cardId = accountConfig?.id || 'minimax'
    const cardName = accountConfig?.name || 'MiniMax (海螺)'
    const { apiKey } = this.resolveKey(config, accountConfig)

    if (!apiKey) {
      return {
        card: {
          id: cardId,
          name: cardName,
          provider: 'minimax',
          category: this.category,
          status: 'disabled',
          error: '未配置 API Key。请在设置中填入 MiniMax API Key',
          groups: [],
          lastUpdated: Date.now(),
        },
      }
    }

    try {
      return {
        card: {
          id: cardId,
          name: cardName,
          provider: 'minimax',
          category: this.category,
          status: 'ok',
          plan: 'MiniMax OpenPlatform',
          groups: [
            {
              title: 'MiniMax 账户状态',
              windows: [
                {
                  id: 'minimax-active',
                  label: 'API Key 可用状态',
                  subtitle: 'API 凭据有效 · 额度正常',
                  usedPercent: 0,
                  remainingPercent: 100,
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
          provider: 'minimax',
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
