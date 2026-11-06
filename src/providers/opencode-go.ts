import type { IQuotaProvider, QuotaConfig, ProviderResult, TestConnectionResult, AccountConfigItem, MetricWindow } from '../core/types.ts'
import { formatQuotaResetText, isQuantified } from '../core/types.ts'
import { fetchWithProxy } from '../core/fetch.ts'

/** Parse an upstream numeric field without ever turning null/undefined into 0. */
function parseFinite(value: unknown): number | undefined {
  if (typeof value === 'number') return Number.isFinite(value) ? value : undefined
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : undefined
  }
  return undefined
}

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)))
}

/**
 * `resetsAt` can arrive as epoch seconds, epoch milliseconds or ISO text. Seconds
 * are ~1e9 and milliseconds ~1e12, so values below 1e11 must be multiplied.
 */
function normalizeResetAt(value: unknown): string | undefined {
  if (value === undefined || value === null || value === '') return undefined
  if (typeof value === 'number' && Number.isFinite(value)) {
    if (value <= 0) return undefined
    const ms = value < 1e11 ? value * 1000 : value
    const date = new Date(ms)
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
  }
  if (typeof value === 'string') {
    const parsed = parseFinite(value)
    if (parsed !== undefined) return normalizeResetAt(parsed)
    const date = new Date(value)
    return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
  }
  return undefined
}

export class OpenCodeGoProvider implements IQuotaProvider {
  name = 'opencode_go'
  category = 'official_cloud' as const

  async testConnection(config: QuotaConfig, accountConfig?: AccountConfigItem, signal?: AbortSignal): Promise<TestConnectionResult> {
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
        signal,
      }, config.httpProxy, 10000, config.proxyMode)

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
        message: res.status === 429 ? '请求被限流 (HTTP 429)，请稍后重试' : `API 响应异常: HTTP ${res.status}`,
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

  async fetchCard(config: QuotaConfig, accountConfig?: AccountConfigItem, signal?: AbortSignal): Promise<ProviderResult> {
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
        signal,
      }, config.httpProxy, 12000, config.proxyMode)

      if (!res.ok) {
        const text = await res.text().catch(() => '')
        throw new Error(res.status === 429
          ? 'OpenCode Go 接口限流 (HTTP 429)，请稍后重试'
          : `API 错误 (${res.status}): ${text.slice(0, 80)}`)
      }

      const data = await res.json() as any
      const usage = data?.usage && typeof data.usage === 'object' ? data.usage : undefined

      const buildWindow = (
        key: string,
        label: string,
        win: any,
        windowKind: '5h' | 'weekly' | 'monthly' | 'sliding' | 'unknown',
        isWeekly: boolean,
      ): MetricWindow | null => {
        if (!win || typeof win !== 'object') return null
        const resetAt = normalizeResetAt(win.resetsAt)
        const rawPercent = parseFinite(win.percent)
        if (rawPercent === undefined) {
          // Missing/non-numeric percent is unknown — never a synthesized 0% used.
          return {
            id: `opencode-${key}`,
            label,
            subtitle: '额度字段缺失 · 状态未知',
            quotaKind: 'unknown',
            status: 'unknown',
            resetAt,
            barType: 'circle',
            windowKind,
          }
        }
        const used = clampPercent(rawPercent)
        const remaining = 100 - used
        return {
          id: `opencode-${key}`,
          label,
          subtitle: formatQuotaResetText(resetAt, used, isWeekly),
          usedPercent: used,
          remainingPercent: remaining,
          quotaKind: 'usage',
          resetAt,
          barType: 'circle',
          status: remaining <= 0 ? 'exhausted' : 'active',
          windowKind,
        }
      }

      const windows: MetricWindow[] = []
      const rolling = buildWindow('rolling', '5-Hour Rolling Limit', usage?.rolling, 'sliding', false)
      if (rolling) windows.push(rolling)
      const weekly = buildWindow('weekly', 'Weekly Limit', usage?.weekly, 'weekly', true)
      if (weekly) windows.push(weekly)
      const monthly = buildWindow('monthly', 'Monthly Limit', usage?.monthly, 'monthly', true)
      if (monthly) windows.push(monthly)

      if (windows.length === 0) {
        windows.push({
          id: 'opencode-usage',
          label: 'OpenCode Go 用量',
          subtitle: '上游未返回用量字段，无法量化',
          quotaKind: 'unknown',
          status: 'unknown',
          barType: 'circle',
          windowKind: 'unknown',
        })
      }

      // Only quantified windows can push the card into warn.
      const quantified = windows.filter(isQuantified)
      const lowestRemaining = quantified.length > 0 ? Math.min(...quantified.map(w => w.remainingPercent)) : undefined

      return {
        card: {
          id: cardId,
          name: cardName,
          provider: 'opencode_go',
          category: this.category,
          status: lowestRemaining !== undefined && lowestRemaining <= (config.alarmThresholdPercent ?? 15) ? 'warn' : 'ok',
          plan: 'Go Plan',
          groups: [
            {
              title: 'OpenCode Go Plan Limits',
              hasInfoIcon: true,
              windows,
            },
          ],
          lastUpdated: Date.now(),
          sourceProvenance: {
            endpoint: url,
            method: 'official-summary',
            timestamp: Date.now(),
            partial: quantified.length < windows.length,
          },
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
