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

export class KimiProvider implements IQuotaProvider {
  name = 'kimi'
  category = 'domestic_llm' as const

  private resolveKey(config: QuotaConfig, accountConfig?: AccountConfigItem): { apiKey: string; baseUrl: string } {
    let apiKey = ''
    if (accountConfig && accountConfig.apiKey !== undefined) apiKey = accountConfig.apiKey
    else if (config.kimi && config.kimi.apiKey !== undefined) apiKey = config.kimi.apiKey
    apiKey = apiKey.trim().replace(/^Bearer\s+/i, '')
    const baseUrl = (accountConfig?.baseUrl || config.kimi?.baseUrl || 'https://api.moonshot.cn').replace(/\/+$/, '')
    return { apiKey, baseUrl }
  }

  async testConnection(config: QuotaConfig, accountConfig?: AccountConfigItem, signal?: AbortSignal): Promise<TestConnectionResult> {
    const start = Date.now()
    const { apiKey, baseUrl } = this.resolveKey(config, accountConfig)
    if (!apiKey) {
      return {
        ok: false,
        provider: 'kimi',
        message: '未配置 Kimi / Moonshot API Key',
      }
    }

    try {
      const url = `${baseUrl}/v1/users/me/balance`
      const res = await fetchWithProxy(url, {
        headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json', 'User-Agent': USER_AGENT },
        signal,
      }, config.httpProxy, 10000, config.proxyMode)

      const latencyMs = Date.now() - start
      if (!res.ok) {
        return {
          ok: false,
          provider: 'kimi',
          latencyMs,
          message: `验证失败: ${httpErrorText(res)}`,
        }
      }

      const json = await res.json() as any
      const available = parseAmount(json?.data?.available_balance)
      const summary = available !== null ? `¥${available.toFixed(2)} CNY` : '余额字段缺失'
      return {
        ok: true,
        provider: 'kimi',
        latencyMs,
        account: `可用余额: ${summary}`,
        message: `连接成功 (延迟: ${latencyMs}ms, 余额: ${summary})`,
      }
    } catch (err: any) {
      return {
        ok: false,
        provider: 'kimi',
        latencyMs: Date.now() - start,
        message: `请求异常: ${err.message}`,
      }
    }
  }

  async fetchCard(config: QuotaConfig, accountConfig?: AccountConfigItem, signal?: AbortSignal): Promise<ProviderResult> {
    const cardId = accountConfig?.id || 'kimi'
    const cardName = accountConfig?.name || 'Moonshot Kimi'
    const { apiKey, baseUrl } = this.resolveKey(config, accountConfig)

    if (!apiKey) {
      return {
        card: {
          id: cardId,
          name: cardName,
          provider: 'kimi',
          category: this.category,
          status: 'disabled',
          error: '未配置 API Key。请在设置中填入 Kimi (Moonshot) Key',
          groups: [],
          lastUpdated: Date.now(),
        },
      }
    }

    try {
      const url = `${baseUrl}/v1/users/me/balance`
      const res = await fetchWithProxy(url, {
        headers: { Authorization: `Bearer ${apiKey}`, Accept: 'application/json', 'User-Agent': USER_AGENT },
        signal,
      }, config.httpProxy, 15000, config.proxyMode)

      if (!res.ok) {
        throw new Error(`Kimi 余额接口异常: ${httpErrorText(res)}`)
      }

      const json = await res.json() as any
      const data = json?.data || {}
      const available = parseAmount(data.available_balance)
      const cash = parseAmount(data.cash_balance)
      const voucher = parseAmount(data.voucher_balance)

      const subtitleParts: string[] = []
      if (cash !== null) subtitleParts.push(`充值: ¥${cash.toFixed(2)}`)
      if (voucher !== null) subtitleParts.push(`赠金: ¥${voucher.toFixed(2)}`)
      const subtitle = subtitleParts.length > 0 ? subtitleParts.join(' · ') : '上游未返回余额明细'

      // Balance is an amount, not a ratio: no percentage is ever derived from it.
      const window = available !== null
        ? {
            id: 'kimi-balance',
            label: '账户总可用余额 (CNY)',
            subtitle,
            quotaKind: 'balance' as const,
            barType: 'balance' as const,
            amountText: `¥${available.toFixed(2)}`,
            status: available <= 0 ? ('exhausted' as const) : ('active' as const),
          }
        : {
            id: 'kimi-balance',
            label: '账户总可用余额 (CNY)',
            subtitle: `余额字段缺失或无法解析${subtitleParts.length > 0 ? ` · ${subtitle}` : ''}`,
            quotaKind: 'unknown' as const,
            barType: 'balance' as const,
            status: 'unknown' as const,
          }

      // 0 balance is a warning, never a connection error.
      let status: 'ok' | 'warn' = 'ok'
      if (available === null) status = 'warn'
      else if (available <= 0) status = 'warn'
      else if (available <= 5) status = 'warn'

      return {
        card: {
          id: cardId,
          name: cardName,
          provider: 'kimi',
          category: this.category,
          status,
          plan: 'Moonshot API',
          account: available !== null ? `¥${available.toFixed(2)} CNY` : undefined,
          balance: available !== null
            ? {
                currency: 'CNY',
                total: available,
                remaining: available,
                grantedBalance: voucher ?? undefined,
                toppedUpBalance: cash ?? undefined,
              }
            : undefined,
          groups: [
            {
              title: 'Kimi 账户余额',
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
          provider: 'kimi',
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
      return 'api.moonshot.cn'
    }
  }
}
