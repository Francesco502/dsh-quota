import type { IQuotaProvider, QuotaConfig, ProviderResult, TestConnectionResult, AccountConfigItem } from '../core/types.ts'
import { fetchWithProxy } from '../core/fetch.ts'

export class QwenProvider implements IQuotaProvider {
  name = 'qwen'
  category = 'domestic_llm' as const

  private resolveKey(config: QuotaConfig, accountConfig?: AccountConfigItem): { apiKey: string; baseUrl: string } {
    const apiKey = (accountConfig?.apiKey || config.qwen?.apiKey || process.env.DASHSCOPE_API_KEY || '').trim()
    const baseUrl = (accountConfig?.baseUrl || config.qwen?.baseUrl || 'https://dashscope.aliyuncs.com').replace(/\/+$/, '')
    return { apiKey, baseUrl }
  }

  async testConnection(config: QuotaConfig, accountConfig?: AccountConfigItem): Promise<TestConnectionResult> {
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
        headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
      }, config.httpProxy, 10000)

      const latencyMs = Date.now() - start
      if (res.ok) {
        const data = await res.json() as any
        const count = Array.isArray(data.data) ? data.data.length : 0
        return {
          ok: true,
          provider: 'qwen',
          latencyMs,
          account: `阿里云 DashScope (${count} 个模型在线)`,
          message: `连接成功 (延迟: ${latencyMs}ms, 在线模型: ${count})`,
        }
      }

      const errText = await res.text()
      return {
        ok: false,
        provider: 'qwen',
        latencyMs,
        message: `验证失败 (HTTP ${res.status}): ${errText.slice(0, 50)}`,
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

  async fetchCard(config: QuotaConfig, accountConfig?: AccountConfigItem): Promise<ProviderResult> {
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
      const res = await fetchWithProxy(`${baseUrl}/compatible-mode/v1/models`, {
        headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json' },
      }, config.httpProxy, 12000)

      if (!res.ok) {
        throw new Error(`百炼 API 验证失败 (${res.status})`)
      }

      const data = await res.json() as any
      const modelList = Array.isArray(data.data) ? data.data.map((m: any) => m.id) : []
      const hasQwenMax = modelList.some((m: string) => m.includes('qwen-max'))
      const hasQwenPlus = modelList.some((m: string) => m.includes('qwen-plus'))
      const hasQwenCoder = modelList.some((m: string) => m.includes('qwen-coder') || m.includes('qwen-2.5-coder'))

      const subStatus = `百炼在线 · 支持 ${hasQwenMax ? 'Max ' : ''}${hasQwenPlus ? 'Plus ' : ''}${hasQwenCoder ? 'Coder' : ''}`.trim()

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
              title: '通义千问服务状态',
              hasInfoIcon: true,
              windows: [
                {
                  id: 'qwen-active',
                  label: 'Qwen 全系模型连通性',
                  subtitle: subStatus || 'API 凭据有效 · 额度正常',
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
}
