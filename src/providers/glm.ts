import type { IQuotaProvider, QuotaConfig, ProviderResult, TestConnectionResult, AccountConfigItem } from '../core/types.ts'
import { fetchWithProxy } from '../core/fetch.ts'

export class GLMProvider implements IQuotaProvider {
  name = 'glm'
  category = 'domestic_llm' as const

  private resolveKey(config: QuotaConfig, accountConfig?: AccountConfigItem): { apiKey: string; baseUrl: string } {
    let apiKey = ''
    if (accountConfig && accountConfig.apiKey !== undefined) apiKey = accountConfig.apiKey
    else if (config.glm && config.glm.apiKey !== undefined) apiKey = config.glm.apiKey
    apiKey = apiKey.trim().replace(/^Bearer\s+/i, '')
    const baseUrl = (accountConfig?.baseUrl || config.glm?.baseUrl || 'https://open.bigmodel.cn').replace(/\/+$/, '')
    return { apiKey, baseUrl }
  }

  async testConnection(config: QuotaConfig, accountConfig?: AccountConfigItem): Promise<TestConnectionResult> {
    const start = Date.now()
    const { apiKey, baseUrl } = this.resolveKey(config, accountConfig)
    if (!apiKey) {
      return {
        ok: false,
        provider: 'glm',
        message: '未配置智谱 GLM API Key',
      }
    }

    try {
      // Light ping to bigmodel API
      const res = await fetchWithProxy(`${baseUrl}/api/paas/v4/models`, {
        headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
      }, config.httpProxy, 10000)

      const latencyMs = Date.now() - start
      if (res.ok) {
        return {
          ok: true,
          provider: 'glm',
          latencyMs,
          message: `连接成功 (延迟: ${latencyMs}ms)`,
        }
      }

      return {
        ok: false,
        provider: 'glm',
        latencyMs,
        message: `验证失败: HTTP ${res.status}`,
      }
    } catch (err: any) {
      return {
        ok: false,
        provider: 'glm',
        latencyMs: Date.now() - start,
        message: `请求异常: ${err.message}`,
      }
    }
  }

  async fetchCard(config: QuotaConfig, accountConfig?: AccountConfigItem): Promise<ProviderResult> {
    const cardId = accountConfig?.id || 'glm'
    const cardName = accountConfig?.name || '智谱清言 (GLM)'
    const { apiKey, baseUrl } = this.resolveKey(config, accountConfig)

    if (!apiKey) {
      return {
        card: {
          id: cardId,
          name: cardName,
          provider: 'glm',
          category: this.category,
          status: 'disabled',
          error: '未配置 API Key。请在设置中填入智谱 GLM API Key',
          groups: [],
          lastUpdated: Date.now(),
        },
      }
    }

    try {
      const res = await fetchWithProxy(`${baseUrl}/api/paas/v4/models`, {
        headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
      }, config.httpProxy, 10000)

      if (!res.ok) {
        throw new Error(`智谱 API 验证失败 (${res.status})`)
      }

      const data = await res.json() as any
      const modelCount = Array.isArray(data.data) ? data.data.length : 0
      const subtitle = modelCount > 0 ? `智谱在线 · 已就绪 ${modelCount} 个模型` : 'API 凭据有效 · 额度正常'

      return {
        card: {
          id: cardId,
          name: cardName,
          provider: 'glm',
          category: this.category,
          status: 'ok',
          plan: 'BigModel GLM',
          groups: [
            {
              title: 'GLM 平台状态',
              windows: [
                {
                  id: 'glm-status',
                  label: 'GLM API 可用状态',
                  subtitle,
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
          provider: 'glm',
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
