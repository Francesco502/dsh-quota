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

function clampPercent(value: number): number {
  return Math.max(0, Math.min(100, Math.round(value)))
}

function parseReset(value: unknown): string | undefined {
  if (typeof value !== 'string' || value.trim() === '') return undefined
  const date = new Date(value)
  return Number.isNaN(date.getTime()) ? undefined : date.toISOString()
}

export class OpenRouterProvider implements IQuotaProvider {
  name = 'openrouter'
  category = 'official_cloud' as const

  private resolveTarget(config: QuotaConfig, accountConfig?: AccountConfigItem): { apiKey: string; baseUrl: string } {
    let apiKey = (accountConfig?.apiKey !== undefined
      ? accountConfig.apiKey
      : (config.openrouter?.apiKey || process.env.OPENROUTER_API_KEY || '')).trim()
    apiKey = apiKey.replace(/^Bearer\s+/i, '')
    const baseUrl = (accountConfig?.baseUrl || config.openrouter?.baseUrl || 'https://openrouter.ai/api').replace(/\/+$/, '')
    return { apiKey, baseUrl }
  }

  async testConnection(config: QuotaConfig, accountConfig?: AccountConfigItem, signal?: AbortSignal): Promise<TestConnectionResult> {
    const start = Date.now()
    const { apiKey, baseUrl } = this.resolveTarget(config, accountConfig)
    if (!apiKey) {
      return {
        ok: false,
        provider: 'openrouter',
        message: '未配置 OpenRouter API Key。请在「设置」中填入 Key',
      }
    }

    try {
      const url = `${baseUrl}/v1/auth/key`
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
          provider: 'openrouter',
          latencyMs,
          message: `验证失败: ${httpErrorText(res)}`,
        }
      }

      const json = await res.json() as any
      const data = json.data || {}
      const label = data.label || 'OpenRouter Key'
      const usage = parseAmount(data.usage)
      const limit = typeof data.limit === 'number' && Number.isFinite(data.limit) ? data.limit : null
      const limitRemaining = parseAmount(data.limit_remaining)
      const remaining = limit === null
        ? null
        : limitRemaining !== null
          ? Math.max(0, Math.min(limit, limitRemaining))
          : usage !== null
            ? Math.max(0, limit - usage)
            : null
      const limitStr = limit === null
        ? `已用: ${usage !== null ? `$${usage.toFixed(2)}` : '未知'} (无硬限额)`
        : `限额: $${limit.toFixed(2)}${remaining !== null ? ` (剩余 $${remaining.toFixed(2)})` : ' (余量未知)'}`
      return {
        ok: true,
        provider: 'openrouter',
        latencyMs,
        account: `${label} · ${limitStr}`,
        message: `连接成功 (延迟: ${latencyMs}ms, ${limitStr})`,
      }
    } catch (err: any) {
      return {
        ok: false,
        provider: 'openrouter',
        latencyMs: Date.now() - start,
        message: `网络请求异常: ${err.message}`,
      }
    }
  }

  async fetchCard(config: QuotaConfig, accountConfig?: AccountConfigItem, signal?: AbortSignal): Promise<ProviderResult> {
    const cardId = accountConfig?.id || 'openrouter'
    const cardName = accountConfig?.name || config.customNames?.openrouter || config.openrouter?.name || 'OpenRouter'
    const { apiKey, baseUrl } = this.resolveTarget(config, accountConfig)

    if (!apiKey) {
      return {
        card: {
          id: cardId,
          name: cardName,
          provider: 'openrouter',
          category: this.category,
          status: 'disabled',
          error: '未配置 API Key。请在「设置」中填入 OpenRouter Key',
          groups: [],
          lastUpdated: Date.now(),
        },
      }
    }

    try {
      const url = `${baseUrl}/v1/auth/key`
      const res = await fetchWithProxy(url, {
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: 'application/json',
          'User-Agent': USER_AGENT,
        },
        signal,
      }, config.httpProxy, 12000, config.proxyMode)

      if (!res.ok) {
        throw new Error(`OpenRouter 鉴权接口异常: ${httpErrorText(res)}`)
      }

      const json = await res.json() as any
      const data = json.data || {}
      const usage = parseAmount(data.usage)
      const rawLimit = data.limit
      const limit: number | null | undefined =
        typeof rawLimit === 'number' && Number.isFinite(rawLimit)
          ? rawLimit
          : rawLimit === null
            ? null
            : undefined
      const limitRemaining = parseAmount(data.limit_remaining)
      const resetAt = parseReset(data.limit_reset)
      const usageText = usage !== null ? `$${usage.toFixed(2)}` : '未知'

      let window: ProviderResult['card']['groups'][number]['windows'][number]
      let status: 'ok' | 'warn' = 'ok'
      let balance: ProviderResult['card']['balance']

      if (limit === null) {
        // `limit: null` means the key has no hard limit. Usage is still shown as an
        // amount, but there is nothing to compute a percentage against.
        window = {
          id: 'openrouter-limit',
          label: 'API 用量 (无硬限额)',
          subtitle: `无硬限额 · 已消耗 ${usageText} USD`,
          quotaKind: 'balance',
          barType: 'balance',
          amountText: usage !== null ? `已用 $${usage.toFixed(2)} USD` : undefined,
          status: 'active',
        }
        balance = { currency: 'USD', used: usage ?? undefined }
      } else if (limit === 0) {
        window = {
          id: 'openrouter-limit',
          label: 'API 额度状态',
          subtitle: `密钥限额为 $0 · 配额状态未知${resetAt ? ` · 重置 ${resetAt}` : ''}`,
          quotaKind: 'unknown',
          barType: 'balance',
          status: 'unknown',
        }
        status = 'warn'
        balance = { currency: 'USD', total: 0, used: usage ?? undefined }
      } else if (limit === undefined) {
        window = {
          id: 'openrouter-limit',
          label: 'API 额度状态',
          subtitle: `上游未返回 limit 字段 · 额度状态未知 (已消耗 ${usageText})`,
          quotaKind: 'unknown',
          barType: 'balance',
          status: 'unknown',
        }
        balance = { currency: 'USD', used: usage ?? undefined }
      } else {
        const remainingAmount = limitRemaining !== null
          ? Math.max(0, Math.min(limit, limitRemaining))
          : usage !== null
            ? Math.max(0, limit - usage)
            : null

        if (remainingAmount === null) {
          window = {
            id: 'openrouter-limit',
            label: 'API 额度状态',
            subtitle: `限额 $${limit.toFixed(2)} 已确认，但用量/余量字段缺失`,
            quotaKind: 'unknown',
            barType: 'balance',
            status: 'unknown',
          }
          balance = { currency: 'USD', total: limit }
        } else {
          const remainingPercent = clampPercent((remainingAmount / limit) * 100)
          const usedPercent = 100 - remainingPercent
          window = {
            id: 'openrouter-limit',
            label: 'API 额度限制',
            subtitle: `限额 $${limit.toFixed(2)} · 剩余 $${remainingAmount.toFixed(2)}`,
            quotaKind: 'usage',
            usedPercent,
            remainingPercent,
            resetAt,
            barType: 'circle',
            status: remainingAmount <= 0 ? 'exhausted' : 'active',
            amountText: `剩余 $${remainingAmount.toFixed(2)} / 限额 $${limit.toFixed(2)}`,
          }
          balance = { currency: 'USD', total: limit, used: usage ?? undefined, remaining: remainingAmount }
          // Exhausted keys are a warning for the account, not a connection error.
          if (remainingPercent <= 15) status = 'warn'
        }
      }

      return {
        card: {
          id: cardId,
          name: cardName,
          provider: 'openrouter',
          category: this.category,
          status,
          plan: data.is_free_tier ? 'OpenRouter Free' : 'OpenRouter Paid',
          account: data.label || undefined,
          balance,
          groups: [
            {
              title: 'OpenRouter 配额状态',
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
          provider: 'openrouter',
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
      return 'openrouter.ai'
    }
  }
}
