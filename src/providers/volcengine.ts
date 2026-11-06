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

export class VolcengineProvider implements IQuotaProvider {
  name = 'volcengine'
  category = 'domestic_llm' as const

  private resolveKey(config: QuotaConfig, accountConfig?: AccountConfigItem): { apiKey: string; baseUrl: string } {
    let apiKey = ''
    if (accountConfig && accountConfig.apiKey !== undefined) apiKey = accountConfig.apiKey
    else if (config.volcengine && config.volcengine.apiKey !== undefined) apiKey = config.volcengine.apiKey
    apiKey = apiKey.trim().replace(/^Bearer\s+/i, '')
    const baseUrl = (accountConfig?.baseUrl || config.volcengine?.baseUrl || 'https://ark.cn-beijing.volces.com').replace(/\/+$/, '')
    return { apiKey, baseUrl }
  }

  async testConnection(config: QuotaConfig, accountConfig?: AccountConfigItem, signal?: AbortSignal): Promise<TestConnectionResult> {
    const start = Date.now()
    const { apiKey, baseUrl } = this.resolveKey(config, accountConfig)
    if (!apiKey) {
      return {
        ok: false,
        provider: 'volcengine',
        message: '未配置火山方舟 API Key',
      }
    }

    try {
      const res = await fetchWithProxy(`${baseUrl}/api/v3/models`, {
        headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json', 'User-Agent': USER_AGENT },
        signal,
      }, config.httpProxy, 10000, config.proxyMode)

      const latencyMs = Date.now() - start
      if (res.ok) {
        let count = 0
        try {
          const data = await res.json() as any
          count = Array.isArray(data?.data) ? data.data.length : 0
        } catch {
          count = 0
        }
        return {
          ok: true,
          provider: 'volcengine',
          latencyMs,
          account: `火山方舟 (${count} 个接入点在线)`,
          message: `连接成功 (延迟: ${latencyMs}ms, 接入点: ${count}, 仅连通性检查 · 未提供额度接口)`,
        }
      }

      return {
        ok: false,
        provider: 'volcengine',
        latencyMs,
        message: `验证失败: ${httpErrorText(res)}`,
      }
    } catch (err: any) {
      return {
        ok: false,
        provider: 'volcengine',
        latencyMs: Date.now() - start,
        message: `请求异常: ${err.message}`,
      }
    }
  }

  async fetchCard(config: QuotaConfig, accountConfig?: AccountConfigItem, signal?: AbortSignal): Promise<ProviderResult> {
    const cardId = accountConfig?.id || 'volcengine'
    const cardName = accountConfig?.name || '火山方舟 (豆包)'
    const { apiKey, baseUrl } = this.resolveKey(config, accountConfig)

    if (!apiKey) {
      return {
        card: {
          id: cardId,
          name: cardName,
          provider: 'volcengine',
          category: this.category,
          status: 'disabled',
          error: '未配置 API Key。请在设置中填入火山方舟 API Key',
          groups: [],
          lastUpdated: Date.now(),
        },
      }
    }

    try {
      const url = `${baseUrl}/api/v3/models`
      const res = await fetchWithProxy(url, {
        headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json', 'User-Agent': USER_AGENT },
        signal,
      }, config.httpProxy, 12000, config.proxyMode)

      if (!res.ok) {
        throw new Error(`火山方舟 API 验证失败: ${httpErrorText(res)}`)
      }

      let endpoints = 0
      try {
        const data = await res.json() as any
        endpoints = Array.isArray(data?.data) ? data.data.length : 0
      } catch {
        endpoints = 0
      }
      const connectivity = endpoints > 0
        ? `方舟在线 · 已授权 ${endpoints} 个推理接入点 (Endpoint)`
        : '火山方舟在线'

      return {
        card: {
          id: cardId,
          name: cardName,
          provider: 'volcengine',
          category: this.category,
          status: 'ok',
          plan: 'Volcengine Ark',
          account: `${endpoints} Endpoints Active`,
          groups: [
            {
              title: '火山方舟服务连通性',
              hasInfoIcon: true,
              windows: [
                {
                  id: 'volc-active',
                  label: '豆包与方舟推理接入点',
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
          provider: 'volcengine',
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
      return 'ark.cn-beijing.volces.com'
    }
  }
}
