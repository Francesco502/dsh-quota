import type { IQuotaProvider, QuotaConfig, ProviderResult, AuthCardItem } from '../core/types.ts'
import { formatQuotaResetText } from '../core/types.ts'
import { fetchWithProxy } from '../core/fetch.ts'

export class OpenCodeGoProvider implements IQuotaProvider {
  name = 'opencode_go'

  async fetchCard(config: QuotaConfig): Promise<ProviderResult> {
    if (config.opencode_go?.enabled === false) {
      return {
        card: {
          id: 'opencode_go',
          name: 'OpenCode Go',
          provider: 'opencode_go',
          status: 'disabled',
          groups: [],
          lastUpdated: Date.now(),
        },
      }
    }

    const apiKey = config.opencode_go?.apiKey?.trim()
    const baseUrl = (config.opencode_go?.baseUrl?.trim() || 'https://opencode.ai').replace(/\/+$/, '')

    if (!apiKey) {
      return {
        card: {
          id: 'opencode_go',
          name: 'OpenCode Go',
          provider: 'opencode_go',
          status: 'disabled',
          error: '未配置 API Key。请在「设置」中填入 OpenCode Go Key',
          groups: [],
          lastUpdated: Date.now(),
        },
      }
    }

    try {
      // Official OpenCode Go usage API endpoint
      const url = `${baseUrl}/zen/go/v1/usage`
      const res = await fetchWithProxy(url, {
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Accept': 'application/json',
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
          label: '5-Hour Rolling Limit (5小时额度)',
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
          label: 'Weekly Limit (周配额)',
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
          label: 'Monthly Limit (月配额)',
          subtitle: formatQuotaResetText(resetAt, used, true),
          usedPercent: used,
          remainingPercent: rem,
          resetAt,
          barType: 'circle' as const,
        })
      }

      return {
        card: {
          id: 'opencode_go',
          name: 'OpenCode Go',
          provider: 'opencode_go',
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
          id: 'opencode_go',
          name: 'OpenCode Go',
          provider: 'opencode_go',
          status: 'error',
          error: err.message,
          groups: [],
          lastUpdated: Date.now(),
        },
      }
    }
  }
}
