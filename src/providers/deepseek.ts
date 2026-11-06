import { PLUGIN_VERSION } from '../core/types.ts'
import type { IQuotaProvider, QuotaConfig, ProviderResult, TestConnectionResult, AccountConfigItem } from '../core/types.ts'
import { fetchWithProxy } from '../core/fetch.ts'

const USER_AGENT = `dsh-quota/${PLUGIN_VERSION}`

interface DeepSeekBalanceInfo {
  currency?: string
  total_balance?: string | number
  granted_balance?: string | number
  topped_up_balance?: string | number
}

interface DeepSeekBalanceResponse {
  is_available?: boolean
  balance_infos?: DeepSeekBalanceInfo[]
}

/** `null` means "the upstream did not give us a usable number" — never zero. */
function parseAmount(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
}

function currencySymbol(currency: string): string {
  if (currency === 'USD') return '$'
  if (currency === 'CNY') return '¥'
  return `${currency} `
}

function retryAfterText(res: Response): string {
  const retryAfter = res.headers.get('retry-after')
  return retryAfter ? `, Retry-After: ${retryAfter}` : ''
}

function httpErrorText(res: Response): string {
  if (res.status === 429) return `上游接口限流 (HTTP 429${retryAfterText(res)})`
  if (res.status === 401) return 'API Key 无效或未授权 (HTTP 401)'
  if (res.status === 403) return '无访问权限或 IP 受限 (HTTP 403)'
  return `HTTP ${res.status}`
}

interface ParsedBalance {
  currency: string
  amount: number
  granted: number | null
  toppedUp: number | null
}

export class DeepSeekProvider implements IQuotaProvider {
  name = 'deepseek'
  category = 'domestic_llm' as const

  private resolveKey(config: QuotaConfig, accountConfig?: AccountConfigItem): { apiKey: string; baseUrl: string } {
    let apiKey = (accountConfig && accountConfig.apiKey !== undefined
      ? accountConfig.apiKey
      : (config.deepseek?.apiKey || process.env.DEEPSEEK_API_KEY || '')).trim()
    apiKey = apiKey.replace(/^Bearer\s+/i, '')
    const baseUrl = (accountConfig?.baseUrl || config.deepseek?.baseUrl || 'https://api.deepseek.com').replace(/\/+$/, '')
    return { apiKey, baseUrl }
  }

  private parseBalances(data: DeepSeekBalanceResponse): ParsedBalance[] {
    const infos = Array.isArray(data.balance_infos) ? data.balance_infos : []
    const parsed: ParsedBalance[] = []
    for (const info of infos) {
      const amount = parseAmount(info?.total_balance)
      if (amount === null) continue
      const currency = (info?.currency || 'CNY').toUpperCase()
      parsed.push({
        currency,
        amount,
        granted: parseAmount(info?.granted_balance),
        toppedUp: parseAmount(info?.topped_up_balance),
      })
    }
    return parsed
  }

  async testConnection(config: QuotaConfig, accountConfig?: AccountConfigItem, signal?: AbortSignal): Promise<TestConnectionResult> {
    const start = Date.now()
    const { apiKey, baseUrl } = this.resolveKey(config, accountConfig)
    if (!apiKey) {
      return {
        ok: false,
        provider: 'deepseek',
        message: '未配置 DeepSeek API Key。请在「设置」中填入 Key',
      }
    }

    try {
      const url = `${baseUrl}/user/balance`
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
          provider: 'deepseek',
          latencyMs,
          message: `验证失败: ${httpErrorText(res)}`,
        }
      }

      const data = await res.json() as DeepSeekBalanceResponse
      const balances = this.parseBalances(data)
      const summary = balances.length > 0
        ? balances.map(b => `${currencySymbol(b.currency)}${b.amount.toFixed(2)} ${b.currency}`).join(' / ')
        : '余额字段缺失'
      return {
        ok: true,
        provider: 'deepseek',
        latencyMs,
        account: `余额: ${summary}`,
        message: `连接成功 (延迟: ${latencyMs}ms, 余额: ${summary})`,
      }
    } catch (err: any) {
      return {
        ok: false,
        provider: 'deepseek',
        latencyMs: Date.now() - start,
        message: `网络请求异常: ${err.message}`,
      }
    }
  }

  async fetchCard(config: QuotaConfig, accountConfig?: AccountConfigItem, signal?: AbortSignal): Promise<ProviderResult> {
    const cardId = accountConfig?.id || 'deepseek'
    const cardName = accountConfig?.name || config.customNames?.deepseek || config.deepseek?.name || 'DeepSeek'
    const { apiKey, baseUrl } = this.resolveKey(config, accountConfig)

    if (!apiKey) {
      return {
        card: {
          id: cardId,
          name: cardName,
          provider: 'deepseek',
          category: this.category,
          status: 'disabled',
          error: '未配置 API Key。请在「设置」中填入 DeepSeek API Key',
          groups: [],
          lastUpdated: Date.now(),
        },
      }
    }

    try {
      const url = `${baseUrl}/user/balance`
      const res = await fetchWithProxy(url, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: 'application/json',
          'User-Agent': USER_AGENT,
        },
        signal,
      }, config.httpProxy, 15000, config.proxyMode)

      if (!res.ok) {
        throw new Error(`DeepSeek 余额接口异常: ${httpErrorText(res)}`)
      }

      const data = await res.json() as DeepSeekBalanceResponse
      const balances = this.parseBalances(data)
      // Pick CNY as the primary currency when available; otherwise the first
      // entry the upstream listed. No exchange-rate conversion is performed.
      const primary = balances.find(b => b.currency === 'CNY') || balances[0]

      const windows = balances.length > 0
        ? balances.map((b) => {
            const symbol = currencySymbol(b.currency)
            const subtitleParts: string[] = []
            if (b.toppedUp !== null) subtitleParts.push(`充值: ${symbol}${b.toppedUp.toFixed(2)}`)
            if (b.granted !== null) subtitleParts.push(`赠送: ${symbol}${b.granted.toFixed(2)}`)
            return {
              id: `deepseek-balance-${b.currency.toLowerCase()}`,
              label: `可用余额 (${b.currency})`,
              subtitle: subtitleParts.join(' · '),
              quotaKind: 'balance' as const,
              barType: 'balance' as const,
              amountText: `${symbol}${b.amount.toFixed(2)}`,
              status: b.amount <= 0 ? ('exhausted' as const) : ('active' as const),
            }
          })
        : [{
            id: 'deepseek-balance',
            label: '可用余额',
            subtitle: '上游未返回可解析的余额条目',
            quotaKind: 'unknown' as const,
            barType: 'balance' as const,
            status: 'unknown' as const,
          }]

      // `error` is reserved for an unavailable account (401/403/network), never for a
      // zero balance — that is a warning the alarm layer reports as "余额不足".
      let status: 'ok' | 'warn' = 'ok'
      if (data.is_available === false) status = 'warn'
      else if (!primary) status = 'warn'
      else if (primary.amount <= 5) status = 'warn'

      const accountSummary = balances.length > 0
        ? balances.map(b => `${currencySymbol(b.currency)}${b.amount.toFixed(2)} ${b.currency}`).join(' · ')
        : undefined

      return {
        card: {
          id: cardId,
          name: cardName,
          provider: 'deepseek',
          category: this.category,
          status,
          plan: balances.length > 1 ? 'DeepSeek 官方平台 (多币种)' : 'DeepSeek 官方平台',
          account: accountSummary,
          balance: primary
            ? {
                currency: primary.currency === 'USD' ? 'USD' : 'CNY',
                total: primary.amount,
                remaining: primary.amount,
                grantedBalance: primary.granted ?? undefined,
                toppedUpBalance: primary.toppedUp ?? undefined,
              }
            : undefined,
          groups: [
            {
              id: 'deepseek-balance-group',
              title: '账户余额',
              hasInfoIcon: true,
              poolType: 'general',
              windows,
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
          provider: 'deepseek',
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
      return 'api.deepseek.com'
    }
  }
}
