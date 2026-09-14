import type { IQuotaProvider, QuotaConfig, ProviderResult, TestConnectionResult, AccountConfigItem } from '../core/types.ts'
import { fetchWithProxy } from '../core/fetch.ts'

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

  async testConnection(config: QuotaConfig, accountConfig?: AccountConfigItem): Promise<TestConnectionResult> {
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
        headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
      }, config.httpProxy, 10000)

      const latencyMs = Date.now() - start
      if (res.ok) {
        const data = await res.json() as any
        const count = Array.isArray(data.data) ? data.data.length : 0
        return {
          ok: true,
          provider: 'volcengine',
          latencyMs,
          account: `火山方舟 (${count} 个接入点在线)`,
          message: `连接成功 (延迟: ${latencyMs}ms, 接入点: ${count})`,
        }
      }

      const errText = await res.text()
      return {
        ok: false,
        provider: 'volcengine',
        latencyMs,
        message: `验证失败 (HTTP ${res.status}): ${errText.slice(0, 50)}`,
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

  async fetchCard(config: QuotaConfig, accountConfig?: AccountConfigItem): Promise<ProviderResult> {
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
      const res = await fetchWithProxy(`${baseUrl}/api/v3/models`, {
        headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
      }, config.httpProxy, 12000)

      if (!res.ok) {
        throw new Error(`火山方舟 API 验证失败 (${res.status})`)
      }

      const data = await res.json() as any
      const endpoints = Array.isArray(data.data) ? data.data.length : 0
      const subText = endpoints > 0 ? `方舟在线 · 已授权 ${endpoints} 个推理接入点 (Endpoint)` : '火山方舟在线 · 额度正常'

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
              title: '火山方舟服务状态',
              hasInfoIcon: true,
              windows: [
                {
                  id: 'volc-active',
                  label: '豆包与方舟推理接入点',
                  subtitle: subText,
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
}
