import { PLUGIN_VERSION } from '../core/types.ts'
import type { IQuotaProvider, QuotaConfig, ProviderResult, TestConnectionResult, AccountConfigItem } from '../core/types.ts'
import { fetchWithProxy } from '../core/fetch.ts'

const USER_AGENT = `dsh-quota/${PLUGIN_VERSION}`

function retryAfterText(res: Response): string {
  const retryAfter = res.headers.get('retry-after')
  return retryAfter ? `, Retry-After: ${retryAfter}` : ''
}

function httpErrorText(res: Response): string {
  if (res.status === 429) return `上游接口限流 (HTTP 429${retryAfterText(res)})`
  if (res.status === 401) return 'API Key 无效或未授权 (HTTP 401)'
  if (res.status === 403) return '无访问权限 (HTTP 403)'
  return `HTTP ${res.status}`
}

export class MiniMaxProvider implements IQuotaProvider {
  name = 'minimax'
  category = 'domestic_llm' as const

  private resolveKey(config: QuotaConfig, accountConfig?: AccountConfigItem): { apiKey: string; baseUrl: string; groupId?: string } {
    let apiKey = ''
    if (accountConfig && accountConfig.apiKey !== undefined) apiKey = accountConfig.apiKey
    else if (config.minimax && config.minimax.apiKey !== undefined) apiKey = config.minimax.apiKey
    apiKey = apiKey.trim().replace(/^Bearer\s+/i, '')
    const baseUrl = (accountConfig?.baseUrl || config.minimax?.baseUrl || 'https://api.minimax.chat').replace(/\/+$/, '')
    const groupId = accountConfig?.extra?.groupId || config.minimax?.groupId
    return { apiKey, baseUrl, groupId }
  }

  async testConnection(config: QuotaConfig, accountConfig?: AccountConfigItem, signal?: AbortSignal): Promise<TestConnectionResult> {
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
        headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json', 'User-Agent': USER_AGENT },
        signal,
      }, config.httpProxy, 10000, config.proxyMode)

      const latencyMs = Date.now() - start
      if (res.ok) {
        return {
          ok: true,
          provider: 'minimax',
          latencyMs,
          message: `连接成功 (延迟: ${latencyMs}ms, 仅连通性检查 · 未提供额度接口)`,
        }
      }

      return {
        ok: false,
        provider: 'minimax',
        latencyMs,
        message: `验证失败: ${httpErrorText(res)}`,
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

  async fetchCard(config: QuotaConfig, accountConfig?: AccountConfigItem, signal?: AbortSignal): Promise<ProviderResult> {
    const cardId = accountConfig?.id || 'minimax'
    const cardName = accountConfig?.name || 'MiniMax (海螺)'
    const { apiKey, baseUrl } = this.resolveKey(config, accountConfig)

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
      const url = `${baseUrl}/v1/models`
      const res = await fetchWithProxy(url, {
        headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json', 'User-Agent': USER_AGENT },
        signal,
      }, config.httpProxy, 10000, config.proxyMode)

      if (!res.ok) {
        throw new Error(`MiniMax API 验证失败: ${httpErrorText(res)}`)
      }

      let modelCount = 0
      try {
        const data = await res.json() as any
        modelCount = Array.isArray(data?.data) ? data.data.length : 0
      } catch {
        modelCount = 0
      }
      const connectivity = modelCount > 0 ? `MiniMax 在线 · 已就绪 ${modelCount} 个模型` : 'MiniMax 在线'

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
              title: 'MiniMax 账户连通性',
              windows: [
                {
                  id: 'minimax-active',
                  label: 'API Key 连通性',
                  subtitle: `${connectivity} · 仅连通性检查 (未提供额度接口)`,
                  // No quota endpoint: never invent a 0%/100% ratio.
                  quotaKind: 'liveness',
                  barType: 'circle',
                  status: 'unknown',
                },
              ],
            },
          ],
          lastUpdated: Date.now(),
          sourceProvenance: {
            endpoint: url,
            method: 'model-fallback',
            timestamp: Date.now(),
            host: this.hostOf(baseUrl),
            partial: true,
          },
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

  private hostOf(baseUrl: string): string {
    try {
      return new URL(baseUrl).host
    } catch {
      return 'api.minimax.chat'
    }
  }
}
