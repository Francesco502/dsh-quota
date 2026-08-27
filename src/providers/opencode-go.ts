import type { IQuotaProvider, QuotaConfig, ProviderResult, TestConnectionResult, AccountConfigItem } from '../core/types.ts'
import { formatQuotaResetText } from '../core/types.ts'
import { fetchWithProxy } from '../core/fetch.ts'

export class OpenCodeGoProvider implements IQuotaProvider {
  name = 'opencode_go'
  category = 'official_cloud' as const

  async testConnection(config: QuotaConfig, accountConfig?: AccountConfigItem): Promise<TestConnectionResult> {
    const start = Date.now()
    const apiKey = (accountConfig?.apiKey || config.opencode_go?.apiKey)?.trim()
    const baseUrl = (accountConfig?.baseUrl || config.opencode_go?.baseUrl?.trim() || 'https://opencode.ai').replace(/\/+$/, '')

    if (!apiKey) {
      return {
        ok: false,
        provider: 'opencode_go',
        message: '未配置 API Key。请在「设置」中填入 OpenCode Go Key',
      }
    }

    try {
      const url = `${baseUrl}/zen/go/v1/usage`
      const res = await fetchWithProxy(url, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: 'application/json',
          'User-Agent': 'Mozilla/5.0',
        },
      }, config.httpProxy, 10000)

      const latencyMs = Date.now() - start
      if (res.ok) {
        return {
          ok: true,
          provider: 'opencode_go',
          latencyMs,
          message: `连接成功 (延迟: ${latencyMs}ms)`,
        }
      }

      return {
        ok: false,
        provider: 'opencode_go',
        latencyMs,
        message: `API 响应异常: HTTP ${res.status}`,
      }
    } catch (err: any) {
      return {
        ok: false,
        provider: 'opencode_go',
        latencyMs: Date.now() - start,
        message: `连接失败: ${err.message}`,
      }
    }
  }

  async fetchCard(config: QuotaConfig, accountConfig?: AccountConfigItem): Promise<ProviderResult> {
    const cardId = accountConfig?.id || 'opencode_go'
    const cardName = accountConfig?.name || 'OpenCode Go'

    if (config.opencode_go?.enabled === false && accountConfig?.enabled === false) {
      return {
        card: {
          id: cardId,
          name: cardName,
          provider: 'opencode_go',
          category: this.category,
          status: 'disabled',
          groups: [],
          lastUpdated: Date.now(),
        },
      }
    }

    const apiKey = (accountConfig?.apiKey || config.opencode_go?.apiKey)?.trim()
    const baseUrl = (accountConfig?.baseUrl || config.opencode_go?.baseUrl?.trim() || 'https://opencode.ai').replace(/\/+$/, '')

    if (!apiKey) {
      return {
        card: {
          id: cardId,
          name: cardName,
          provider: 'opencode_go',
          category: this.category,
          status: 'disabled',
          error: '未配置 API Key。请在「设置」中填入 OpenCode Go Key',
          groups: [],
          lastUpdated: Date.now(),
        },
      }
    }

    try {
      const url = `${baseUrl}/zen/go/v1/usage`
      const res = await fetchWithProxy(url, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: 'application/json',
          'User-Agent': 'Mozilla/5.0',
        },
      }, config.httpProxy)

      if (!res.ok) {
        const text = await res.text()
        throw new Error(`API 错误 (${res.status}): ${text.slice(0, 80)}`)
      }

      const data = await res.json() as any
      const usage = data.usage || {}

      const windows = []
      if (usage.rolling) {
        const used = Math.max(0, Math.min(100, Math.round(usage.rolling.percent ?? 0)))
        const rem = 100 - used
        const resetAt = usage.rolling.resetsAt
        windows.push({
          id: 'opencode-rolling',
          label: '5-Hour Rolling Limit',
          subtitle: formatQuotaResetText(resetAt, used, false),
          usedPercent: used,
          remainingPercent: rem,
          resetAt,
          barType: 'circle' as const,
        })
      }

      if (usage.weekly) {
        const used = Math.max(0, Math.min(100, Math.round(usage.weekly.percent ?? 0)))
        const rem = 100 - used
        const resetAt = usage.weekly.resetsAt
        windows.push({
          id: 'opencode-weekly',
          label: 'Weekly Limit',
          subtitle: formatQuotaResetText(resetAt, used, true),
          usedPercent: used,
          remainingPercent: rem,
          resetAt,
          barType: 'circle' as const,
        })
      }

      if (usage.monthly) {
        const used = Math.max(0, Math.min(100, Math.round(usage.monthly.percent ?? 0)))
        const rem = 100 - used
        const resetAt = usage.monthly.resetsAt
        windows.push({
          id: 'opencode-monthly',
          label: 'Monthly Limit',
          subtitle: formatQuotaResetText(resetAt, used, true),
          usedPercent: used,
          remainingPercent: rem,
          resetAt,
          barType: 'circle' as const,
        })
      }

      return {
        card: {
          id: cardId,
          name: cardName,
          provider: 'opencode_go',
          category: this.category,
          status: 'ok',
          plan: 'Go Plan',
          groups: [
            {
              title: 'OpenCode Go Plan Limits',
              hasInfoIcon: true,
              windows,
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
          provider: 'opencode_go',
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
