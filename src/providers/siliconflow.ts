import { PLUGIN_VERSION } from '../core/types.ts'
import type { IQuotaProvider, QuotaConfig, ProviderResult, TestConnectionResult, AccountConfigItem } from '../core/types.ts'
import { fetchWithProxy } from '../core/fetch.ts'

const USER_AGENT = `dsh-quota/${PLUGIN_VERSION}`

/** `null` means "the upstream did not give us a usable number" — never zero. */
function parseAmount(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

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

export class SiliconFlowProvider implements IQuotaProvider {
  name = 'siliconflow'
  category = 'domestic_llm' as const

  private resolveTarget(config: QuotaConfig, accountConfig?: AccountConfigItem): { apiKey: string; baseUrl: string } {
    let apiKey = (accountConfig?.apiKey !== undefined
      ? accountConfig.apiKey
      : (config.siliconflow?.apiKey || process.env.SILICONFLOW_API_KEY || '')).trim()
    apiKey = apiKey.replace(/^Bearer\s+/i, '')
    const baseUrl = (accountConfig?.baseUrl || config.siliconflow?.baseUrl || 'https://api.siliconflow.cn').replace(/\/+$/, '')
    return { apiKey, baseUrl }
  }

  async testConnection(config: QuotaConfig, accountConfig?: AccountConfigItem, signal?: AbortSignal): Promise<TestConnectionResult> {
    const start = Date.now()
    const { apiKey, baseUrl } = this.resolveTarget(config, accountConfig)
    if (!apiKey) {
      return {
        ok: false,
        provider: 'siliconflow',
        message: '未配置 SiliconFlow API Key。请在「设置」中填入 Key',
      }
    }

    try {
      const url = `${baseUrl}/v1/user/info`
      const res = await fetchWithProxy(url, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: 'application/json',
          'User-Agent': USER_AGENT,
        },
        signal,
      }, config.httpProxy, 10000, config.proxyMode)

      const latencyMs = Date.now() - start
      if (!res.ok) {
        return {
          ok: false,
          provider: 'siliconflow',
          latencyMs,
          message: `验证失败: ${httpErrorText(res)}`,
        }
      }

      const json = await res.json() as any
      const data = json?.data || {}
      const bal = parseAmount(data.balance)
      const name = data.name || data.email || 'SiliconFlow User'
      const summary = bal !== null ? `¥${bal.toFixed(2)} CNY` : '余额字段缺失'

      return {
        ok: true,
        provider: 'siliconflow',
        latencyMs,
        account: `余额: ${summary} (${name})`,
        message: `连接成功 (延迟: ${latencyMs}ms, 余额: ${summary})`,
      }
    } catch (err: any) {
      return {
        ok: false,
        provider: 'siliconflow',
        latencyMs: Date.now() - start,
        message: `网络请求异常: ${err.message}`,
      }
    }
  }

  async fetchCard(config: QuotaConfig, accountConfig?: AccountConfigItem, signal?: AbortSignal): Promise<ProviderResult> {
    const cardId = accountConfig?.id || 'siliconflow'
    const cardName = accountConfig?.name || config.customNames?.siliconflow || config.siliconflow?.name || '硅基流动 (SiliconFlow)'
    const { apiKey, baseUrl } = this.resolveTarget(config, accountConfig)

    if (!apiKey) {
      return {
        card: {
          id: cardId,
          name: cardName,
          provider: 'siliconflow',
          category: this.category,
          status: 'disabled',
          error: '未配置 API Key。请在「设置」中填入 SiliconFlow Key',
          groups: [],
          lastUpdated: Date.now(),
        },
      }
    }

    try {
      const url = `${baseUrl}/v1/user/info`
      const res = await fetchWithProxy(url, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: 'application/json',
          'User-Agent': USER_AGENT,
        },
        signal,
      }, config.httpProxy, 12000, config.proxyMode)

      if (!res.ok) {
        throw new Error(`硅基流动接口异常: ${httpErrorText(res)}`)
      }

      const json = await res.json() as any
      const data = json?.data || {}
      const available = parseAmount(data.balance)
      const charge = parseAmount(data.chargeBalance)
      // Total is only shown when the upstream actually reports it; no fallback to
      // `available` and no `max()` guessing.
      const total = parseAmount(data.totalBalance)

      const subtitleParts: string[] = []
      if (available !== null) subtitleParts.push(`可用额度: ¥${available.toFixed(2)} CNY`)
      if (charge !== null) subtitleParts.push(`充值金: ¥${charge.toFixed(2)}`)
      const subtitle = subtitleParts.length > 0 ? subtitleParts.join(' · ') : '上游未返回余额字段'

      // Balance is an amount, not a ratio: no percentage is ever derived from it.
      const window = available !== null
        ? {
            id: 'siliconflow-balance',
            label: '账户可用余额',
            subtitle,
            quotaKind: 'balance' as const,
            barType: 'balance' as const,
            amountText: `¥${available.toFixed(2)} CNY`,
            status: available <= 0 ? ('exhausted' as const) : ('active' as const),
          }
        : {
            id: 'siliconflow-balance',
            label: '账户可用余额',
            subtitle: `余额字段缺失或无法解析${subtitleParts.length > 0 ? ` · ${subtitle}` : ''}`,
            quotaKind: 'unknown' as const,
            barType: 'balance' as const,
            status: 'unknown' as const,
          }

      // 0 balance is a warning, never a connection error.
      let status: 'ok' | 'warn' = 'ok'
      if (available === null) status = 'warn'
      else if (available <= 2) status = 'warn'

      return {
        card: {
          id: cardId,
          name: cardName,
          provider: 'siliconflow',
          category: this.category,
          status,
          plan: 'SiliconFlow Cloud',
          account: data.name || data.email || undefined,
          balance: available !== null
            ? {
                currency: 'CNY',
                total: total ?? undefined,
                remaining: available,
                toppedUpBalance: charge ?? undefined,
              }
            : undefined,
          groups: [
            {
              title: '硅基流动账户余额',
              windows: [window],
            },
          ],
          lastUpdated: Date.now(),
          sourceProvenance: {
            endpoint: url,
            method: 'user-balance',
            timestamp: Date.now(),
            host: this.hostOf(baseUrl),
          },
        },
      }
    } catch (err: any) {
      return {
        card: {
          id: cardId,
          name: cardName,
          provider: 'siliconflow',
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
      return 'api.siliconflow.cn'
    }
  }
}
