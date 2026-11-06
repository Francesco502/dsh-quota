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

export class QwenProvider implements IQuotaProvider {
  name = 'qwen'
  category = 'domestic_llm' as const

  private resolveKey(config: QuotaConfig, accountConfig?: AccountConfigItem): { apiKey: string; baseUrl: string } {
    let apiKey = ''
    if (accountConfig && accountConfig.apiKey !== undefined) apiKey = accountConfig.apiKey
    else if (config.qwen && config.qwen.apiKey !== undefined) apiKey = config.qwen.apiKey
    apiKey = apiKey.trim().replace(/^Bearer\s+/i, '')
    const baseUrl = (accountConfig?.baseUrl || config.qwen?.baseUrl || 'https://dashscope.aliyuncs.com').replace(/\/+$/, '')
    return { apiKey, baseUrl }
  }

  async testConnection(config: QuotaConfig, accountConfig?: AccountConfigItem, signal?: AbortSignal): Promise<TestConnectionResult> {
    const start = Date.now()
    const { apiKey, baseUrl } = this.resolveKey(config, accountConfig)
    if (!apiKey) {
      return {
        ok: false,
        provider: 'qwen',
        message: '未配置通义千问 (DashScope) API Key',
      }
    }

    try {
      const res = await fetchWithProxy(`${baseUrl}/compatible-mode/v1/models`, {
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
          provider: 'qwen',
          latencyMs,
          account: `阿里云 DashScope (${count} 个模型在线)`,
          message: `连接成功 (延迟: ${latencyMs}ms, 在线模型: ${count}, 仅连通性检查 · 未提供额度接口)`,
        }
      }

      return {
        ok: false,
        provider: 'qwen',
        latencyMs,
        message: `验证失败: ${httpErrorText(res)}`,
      }
    } catch (err: any) {
      return {
        ok: false,
        provider: 'qwen',
        latencyMs: Date.now() - start,
        message: `请求异常: ${err.message}`,
      }
    }
  }

  async fetchCard(config: QuotaConfig, accountConfig?: AccountConfigItem, signal?: AbortSignal): Promise<ProviderResult> {
    const cardId = accountConfig?.id || 'qwen'
    const cardName = accountConfig?.name || '阿里通义千问 (百炼)'
    const { apiKey, baseUrl } = this.resolveKey(config, accountConfig)

    if (!apiKey) {
      return {
        card: {
          id: cardId,
          name: cardName,
          provider: 'qwen',
          category: this.category,
          status: 'disabled',
          error: '未配置 API Key。请在设置中填入 DashScope API Key',
          groups: [],
          lastUpdated: Date.now(),
        },
      }
    }

    try {
      const url = `${baseUrl}/compatible-mode/v1/models`
      const res = await fetchWithProxy(url, {
        headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json', 'User-Agent': USER_AGENT },
        signal,
      }, config.httpProxy, 12000, config.proxyMode)

      if (!res.ok) {
        throw new Error(`百炼 API 验证失败: ${httpErrorText(res)}`)
      }

      let modelList: string[] = []
      try {
        const data = await res.json() as any
        modelList = Array.isArray(data?.data) ? data.data.map((m: any) => String(m?.id ?? '')) : []
      } catch {
        modelList = []
      }
      const hasQwenMax = modelList.some((m) => m.includes('qwen-max'))
      const hasQwenPlus = modelList.some((m) => m.includes('qwen-plus'))
      const hasQwenCoder = modelList.some((m) => m.includes('qwen-coder') || m.includes('qwen-2.5-coder'))

      const families = [hasQwenMax ? 'Max' : '', hasQwenPlus ? 'Plus' : '', hasQwenCoder ? 'Coder' : ''].filter(Boolean)
      const connectivity = families.length > 0
        ? `百炼在线 · 支持 ${families.join(' ')}`
        : `百炼在线 · 已就绪 ${modelList.length} 个模型`

      return {
        card: {
          id: cardId,
          name: cardName,
          provider: 'qwen',
          category: this.category,
          status: 'ok',
          plan: 'DashScope 百炼',
          account: 'DashScope Active',
          groups: [
            {
              title: '通义千问服务连通性',
              hasInfoIcon: true,
              windows: [
                {
                  id: 'qwen-active',
                  label: 'Qwen 全系模型连通性',
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
          provider: 'qwen',
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
      return 'dashscope.aliyuncs.com'
    }
  }
}
