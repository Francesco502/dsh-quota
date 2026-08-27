import type { IQuotaProvider, QuotaConfig, ProviderResult, TestConnectionResult, AccountConfigItem } from '../core/types.ts'
import { getHomeConfigPaths } from '../core/paths.ts'
import { fetchWithProxy } from '../core/fetch.ts'
import { existsSync, readFileSync } from 'node:fs'

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

  async testConnection(config: QuotaConfig, accountConfig?: AccountConfigItem): Promise<TestConnectionResult> {
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
      const res = await fetchWithProxy('https://api.github.com/user', {
        headers: {
          Authorization: `token ${token}`,
          Accept: 'application/vnd.github.v3+json',
          'User-Agent': 'dsh-quota',
        },
      }, config.httpProxy, 10000)

      const latencyMs = Date.now() - start
      if (res.ok) {
        const user = await res.json() as any
        return {
          ok: true,
          provider: 'github_copilot',
          latencyMs,
          account: user.login || 'GitHub User',
          message: `连接成功 (延迟: ${latencyMs}ms, 用户: ${user.login})`,
        }
      }

      return {
        ok: false,
        provider: 'github_copilot',
        latencyMs,
        message: `验证失败: HTTP ${res.status}`,
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

  async fetchCard(config: QuotaConfig, accountConfig?: AccountConfigItem): Promise<ProviderResult> {
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
      const headers = {
        Authorization: `token ${token}`,
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'dsh-quota',
      }

      const [userRes, copilotTokenRes] = await Promise.all([
        fetchWithProxy('https://api.github.com/user', { headers }, config.httpProxy, 10000),
        fetchWithProxy('https://api.github.com/copilot_internal/v2/token', { headers }, config.httpProxy, 10000),
      ])

      const user = userRes.ok ? await userRes.json() as any : {}
      const copilotInfo = copilotTokenRes.ok ? await copilotTokenRes.json() as any : {}

      const hasAccess = copilotTokenRes.ok || userRes.ok
      const plan = copilotInfo.sku ? `Copilot ${copilotInfo.sku}` : 'Copilot Active'

      return {
        card: {
          id: cardId,
          name: cardName,
          provider: 'github_copilot',
          category: this.category,
          status: hasAccess ? 'ok' : 'error',
          plan,
          account: user.login || user.email,
          groups: [
            {
              title: 'Copilot 订阅与状态',
              windows: [
                {
                  id: 'copilot-status',
                  label: 'Copilot 订阅状态',
                  subtitle: hasAccess ? '订阅正常 · 额度充足' : '订阅未激活或已过期',
                  usedPercent: hasAccess ? 0 : 100,
                  remainingPercent: hasAccess ? 100 : 0,
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
