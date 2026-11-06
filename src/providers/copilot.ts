import { PLUGIN_VERSION } from '../core/types.ts'
import type { IQuotaProvider, QuotaConfig, ProviderResult, TestConnectionResult, AccountConfigItem, AuthCardItem } from '../core/types.ts'
import { getHomeConfigPaths } from '../core/paths.ts'
import { fetchWithProxy } from '../core/fetch.ts'
import { existsSync, readFileSync } from 'node:fs'

const USER_AGENT = `dsh-quota/${PLUGIN_VERSION}`

/**
 * `copilot_internal/v2/token` only answers for accounts that actually have a
 * Copilot entitlement. A 200 from /user proves nothing about Copilot, so the SKU
 * must be recognised before the card may claim `ok`.
 */
const COPILOT_SKUS = new Set([
  'free_plan',
  'individual',
  'business',
  'enterprise',
  'pro',
  'pro_plus',
  'copilot_free',
  'copilot_individual',
  'copilot_for_individual',
  'copilot_business',
  'copilot_enterprise',
])

function isCopilotSku(sku: unknown): sku is string {
  if (typeof sku !== 'string') return false
  const normalized = sku.trim().toLowerCase()
  if (normalized === '') return false
  return COPILOT_SKUS.has(normalized) || normalized.includes('copilot')
}

function retryAfterText(res: Response): string {
  const retryAfter = res.headers.get('retry-after')
  return retryAfter ? `, Retry-After: ${retryAfter}` : ''
}

function httpErrorText(res: Response): string {
  if (res.status === 429) return `GitHub 接口限流 (HTTP 429${retryAfterText(res)})`
  if (res.status === 401) return 'GitHub Token 无效或未授权 (HTTP 401)'
  if (res.status === 403) return '无访问权限 (HTTP 403)'
  return `HTTP ${res.status}`
}

export class GitHubCopilotProvider implements IQuotaProvider {
  name = 'github_copilot'
  category = 'ide' as const

  private findLocalToken(): string | null {
    const paths = getHomeConfigPaths('github-copilot', 'hosts.json')
    for (const p of paths) {
      if (!existsSync(p)) continue
      try {
        const raw = readFileSync(p, 'utf8')
        const data = JSON.parse(raw) as Record<string, { oauth_token?: string; user?: string }>
        for (const val of Object.values(data)) {
          if (val?.oauth_token) return val.oauth_token
        }
      } catch {}
    }
    return null
  }

  private resolveToken(config: QuotaConfig, accountConfig?: AccountConfigItem): string | null {
    const direct = (accountConfig?.apiKey || accountConfig?.sessionToken || config.github_copilot?.token)?.trim()
    if (direct) return direct

    if (config.github_copilot?.autoDetectLocal !== false && accountConfig?.autoDetectLocal !== false) {
      return this.findLocalToken()
    }
    return null
  }

  private headers(token: string): Record<string, string> {
    return {
      Authorization: `token ${token}`,
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': USER_AGENT,
      'X-GitHub-Api-Version': '2022-11-28',
      'Editor-Version': 'vscode/1.95.0',
      'Editor-Plugin-Version': 'copilot/1.155.0',
    }
  }

  private livenessCard(
    cardId: string,
    cardName: string,
    status: 'warn',
    message: string,
    account: string | undefined,
    plan: string,
    url: string,
  ): AuthCardItem {
    return {
      id: cardId,
      name: cardName,
      provider: 'github_copilot',
      category: this.category,
      status,
      plan,
      account,
      error: message,
      groups: [
        {
          title: 'Copilot 订阅与连通性',
          windows: [
            {
              id: 'copilot-status',
              label: 'Copilot 订阅连通性',
              subtitle: `${message} · 仅连通性检查 (未提供额度接口)`,
              // No percentages until a Copilot entitlement is actually confirmed.
              quotaKind: 'liveness',
              barType: 'circle',
              status: 'unknown',
            },
          ],
        },
      ],
      lastUpdated: Date.now(),
      sourceProvenance: {
        endpoint: url,
        method: 'model-fallback',
        timestamp: Date.now(),
        host: 'api.github.com',
        partial: true,
      },
    }
  }

  async testConnection(config: QuotaConfig, accountConfig?: AccountConfigItem, signal?: AbortSignal): Promise<TestConnectionResult> {
    const start = Date.now()
    const token = this.resolveToken(config, accountConfig)
    if (!token) {
      return {
        ok: false,
        provider: 'github_copilot',
        message: '未找到 GitHub Copilot 凭据。请在设置中配置 Token 或确保本地 Copilot 已登录',
      }
    }

    try {
      const tokenUrl = 'https://api.github.com/copilot_internal/v2/token'
      const res = await fetchWithProxy(tokenUrl, {
        headers: this.headers(token),
        signal,
      }, config.httpProxy, 10000, config.proxyMode)

      const latencyMs = Date.now() - start
      if (!res.ok) {
        return {
          ok: false,
          provider: 'github_copilot',
          latencyMs,
          message: `验证失败: ${httpErrorText(res)}`,
        }
      }

      let info: any = {}
      try {
        info = await res.json()
      } catch {
        info = {}
      }
      if (!isCopilotSku(info?.sku)) {
        return {
          ok: false,
          provider: 'github_copilot',
          latencyMs,
          message: `GitHub Token 有效，但未检测到 Copilot 订阅 (sku: ${info?.sku || '缺失'})`,
        }
      }
      return {
        ok: true,
        provider: 'github_copilot',
        latencyMs,
        account: `Copilot ${info.sku}`,
        message: `连接成功 (延迟: ${latencyMs}ms, 订阅: ${info.sku}, 仅连通性检查 · 未提供额度接口)`,
      }
    } catch (err: any) {
      return {
        ok: false,
        provider: 'github_copilot',
        latencyMs: Date.now() - start,
        message: `请求异常: ${err.message}`,
      }
    }
  }

  async fetchCard(config: QuotaConfig, accountConfig?: AccountConfigItem, signal?: AbortSignal): Promise<ProviderResult> {
    const cardId = accountConfig?.id || 'github_copilot'
    const cardName = accountConfig?.name || 'GitHub Copilot'
    const token = this.resolveToken(config, accountConfig)

    if (!token) {
      return {
        card: {
          id: cardId,
          name: cardName,
          provider: 'github_copilot',
          category: this.category,
          status: 'disabled',
          error: '未连接 Copilot。请在设置中配置 GitHub Token 或登录 Copilot 插件',
          groups: [],
          lastUpdated: Date.now(),
        },
      }
    }

    try {
      const headers = this.headers(token)
      const userUrl = 'https://api.github.com/user'
      const tokenUrl = 'https://api.github.com/copilot_internal/v2/token'

      const [userRes, copilotRes] = await Promise.all([
        fetchWithProxy(userUrl, { headers, signal }, config.httpProxy, 10000, config.proxyMode),
        fetchWithProxy(tokenUrl, { headers, signal }, config.httpProxy, 10000, config.proxyMode),
      ])

      let user: any = {}
      if (userRes.ok) {
        try {
          user = await userRes.json()
        } catch {
          user = {}
        }
      }
      const account = user.login || user.email

      // A GitHub PAT can be perfectly valid while the account has no Copilot
      // entitlement. `/user` returning 200 must never be reported as "额度正常".
      if (!copilotRes.ok) {
        const message = `未检测到 Copilot 订阅 (${httpErrorText(copilotRes)})`
        if (copilotRes.status === 401 || copilotRes.status === 429) {
          throw new Error(httpErrorText(copilotRes))
        }
        return {
          card: this.livenessCard(cardId, cardName, 'warn', message, account, 'Copilot 未确认', tokenUrl),
        }
      }

      let info: any = {}
      try {
        info = await copilotRes.json()
      } catch {
        info = {}
      }
      const sku = typeof info?.sku === 'string' ? info.sku.trim() : ''
      if (!isCopilotSku(sku)) {
        const message = `已连接 GitHub，但未确认 Copilot 订阅 (sku: ${sku || '缺失'})`
        return {
          card: this.livenessCard(cardId, cardName, 'warn', message, account, 'Copilot 未确认', tokenUrl),
        }
      }

      return {
        card: {
          id: cardId,
          name: cardName,
          provider: 'github_copilot',
          category: this.category,
          status: 'ok',
          plan: `Copilot ${sku}`,
          account,
          groups: [
            {
              title: 'Copilot 订阅与连通性',
              windows: [
                {
                  id: 'copilot-status',
                  label: 'Copilot 订阅连通性',
                  subtitle: `已连接 Copilot (${sku}) · 仅连通性检查 (未提供额度接口)`,
                  // Copilot does not expose an account quota endpoint to this plugin:
                  // connectivity is the only fact we can report.
                  quotaKind: 'liveness',
                  barType: 'circle',
                  status: 'unknown',
                },
              ],
            },
          ],
          lastUpdated: Date.now(),
          sourceProvenance: {
            endpoint: tokenUrl,
            method: 'model-fallback',
            timestamp: Date.now(),
            host: 'api.github.com',
            partial: true,
          },
        },
      }
    } catch (err: any) {
      return {
        card: {
          id: cardId,
          name: cardName,
          provider: 'github_copilot',
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
