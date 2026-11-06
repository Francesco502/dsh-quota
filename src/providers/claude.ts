import { PLUGIN_VERSION } from '../core/types.ts'
import type { IQuotaProvider, QuotaConfig, ProviderResult, TestConnectionResult, AccountConfigItem } from '../core/types.ts'
import { fetchWithProxy } from '../core/fetch.ts'

const USER_AGENT = `dsh-quota/${PLUGIN_VERSION}`

function retryAfterText(res: Response): string {
  const retryAfter = res.headers.get('retry-after')
  return retryAfter ? `, Retry-After: ${retryAfter}` : ''
}

function httpErrorText(res: Response): string {
  if (res.status === 429) return `Anthropic 接口限流 (HTTP 429${retryAfterText(res)})`
  if (res.status === 401) return 'API Key 无效或未授权 (HTTP 401)'
  if (res.status === 403) return '无访问权限 (HTTP 403)'
  return `HTTP ${res.status}`
}

/** Parses a positive integer rate-limit header value, or `null` when absent/invalid. */
function parseHeaderCount(raw: string | null): number | null {
  if (raw === null || raw.trim() === '') return null
  const value = Number(raw)
  return Number.isFinite(value) && value >= 0 ? value : null
}

export class ClaudeProvider implements IQuotaProvider {
  name = 'claude'
  category = 'official_cloud' as const

  private resolveTarget(config: QuotaConfig, accountConfig?: AccountConfigItem): { apiKey: string; baseUrl: string } {
    let apiKey = (accountConfig?.apiKey !== undefined
      ? accountConfig.apiKey
      : (config.claude?.apiKey || '')).trim()
    const baseUrl = (accountConfig?.baseUrl || config.claude?.baseUrl || 'https://api.anthropic.com').replace(/\/+$/, '')
    return { apiKey, baseUrl }
  }

  async testConnection(config: QuotaConfig, accountConfig?: AccountConfigItem, signal?: AbortSignal): Promise<TestConnectionResult> {
    const start = Date.now()
    const { apiKey, baseUrl } = this.resolveTarget(config, accountConfig)
    if (!apiKey) {
      return {
        ok: false,
        provider: 'claude',
        message: '未配置 Anthropic API Key (sk-ant-...)',
      }
    }

    try {
      const res = await fetchWithProxy(`${baseUrl}/v1/models`, {
        method: 'GET',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          Accept: 'application/json',
          'User-Agent': USER_AGENT,
        },
        redirect: 'error',
        signal,
      }, config.httpProxy, 10000, config.proxyMode)

      const latencyMs = Date.now() - start
      if (res.ok) {
        return {
          ok: true,
          provider: 'claude',
          latencyMs,
          message: `连接成功 (延迟: ${latencyMs}ms, 仅连通性检查 · 未提供额度接口)`,
        }
      }

      return {
        ok: false,
        provider: 'claude',
        latencyMs,
        message: `验证失败: ${httpErrorText(res)}`,
      }
    } catch (err: any) {
      return {
        ok: false,
        provider: 'claude',
        latencyMs: Date.now() - start,
        message: `请求异常: ${err.message}`,
      }
    }
  }

  async fetchCard(config: QuotaConfig, accountConfig?: AccountConfigItem, signal?: AbortSignal): Promise<ProviderResult> {
    const cardId = accountConfig?.id || 'claude'
    const cardName = accountConfig?.name || 'Anthropic Claude'
    const { apiKey, baseUrl } = this.resolveTarget(config, accountConfig)

    if (!apiKey) {
      return {
        card: {
          id: cardId,
          name: cardName,
          provider: 'claude',
          category: this.category,
          status: 'disabled',
          error: '未配置 API Key。请在设置中填入 Anthropic API Key',
          groups: [],
          lastUpdated: Date.now(),
        },
      }
    }

    try {
      const url = `${baseUrl}/v1/models`
      const res = await fetchWithProxy(url, {
        method: 'GET',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          Accept: 'application/json',
          'User-Agent': USER_AGENT,
        },
        redirect: 'error',
        signal,
      }, config.httpProxy, 10000, config.proxyMode)

      if (!res.ok) {
        throw new Error(`Claude API 验证失败: ${httpErrorText(res)}`)
      }

      // `anthropic-ratelimit-*` describes a per-minute request allowance, not an
      // account quota. It is surfaced as raw numbers only — never as an account
      // quota percentage, and never labelled 「额度充足」.
      const reqRemaining = parseHeaderCount(res.headers.get('anthropic-ratelimit-requests-remaining'))
      const reqLimit = parseHeaderCount(res.headers.get('anthropic-ratelimit-requests-limit'))
      const hasRateHeaders = reqRemaining !== null && reqLimit !== null && reqLimit > 0

      const window = hasRateHeaders
        ? {
            id: 'claude-active',
            label: '速率余量 (非账户额度)',
            subtitle: `速率余量: ${reqRemaining}/${reqLimit} 请求 · 非账户额度 · 仅连通性检查`,
            quotaKind: 'liveness' as const,
            barType: 'circle' as const,
            status: 'unknown' as const,
            windowKind: 'sliding' as const,
          }
        : {
            id: 'claude-active',
            label: 'API Key 连通性',
            subtitle: '仅连通性检查 · 未提供额度接口',
            quotaKind: 'liveness' as const,
            barType: 'circle' as const,
            status: 'unknown' as const,
          }

      return {
        card: {
          id: cardId,
          name: cardName,
          provider: 'claude',
          category: this.category,
          status: 'ok',
          plan: 'Anthropic Claude',
          groups: [
            {
              title: 'Claude 账户连通性',
              hasInfoIcon: true,
              windows: [window],
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
          provider: 'claude',
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
      return 'api.anthropic.com'
    }
  }
}
