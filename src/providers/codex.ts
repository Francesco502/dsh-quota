import type { IQuotaProvider, QuotaConfig, ProviderResult, AuthCardItem } from '../core/types.ts'
import { formatQuotaResetText } from '../core/types.ts'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { createRequire } from 'node:module'
import { homedir } from 'node:os'
import { join } from 'node:path'

interface CodexAuth {
  auth_mode?: string
  tokens?: {
    access_token?: string
    refresh_token?: string
    account_id?: string
  }
}

interface UsageWindow {
  used_percent?: number
  reset_at?: number
  limit_window_seconds?: number
}

interface CodexUsage {
  plan_type?: string
  email?: string
  rate_limit?: { primary_window?: UsageWindow; secondary_window?: UsageWindow }
  code_review_rate_limit?: { primary_window?: UsageWindow }
  credits?: { has_credits?: boolean; unlimited?: boolean; balance?: number }
}

export class CodexProvider implements IQuotaProvider {
  name = 'codex'

  private authPaths(): string[] {
    const home = homedir()
    const paths = [
      process.env.CODEX_HOME ? join(process.env.CODEX_HOME, 'auth.json') : '',
      join(home, '.config', 'codex', 'auth.json'),
      join(home, '.codex', 'auth.json'),
    ].filter(Boolean)
    for (const user of ['/mnt/c/Users/81017', process.env.USERPROFILE ?? '']) {
      if (user) paths.push(join(user, '.codex', 'auth.json'))
    }
    return [...new Set(paths)]
  }

  private loadAuth(config: QuotaConfig): { accessToken: string; accountId?: string; source: string } | null {
    const localCandidates: Array<{ accessToken: string; accountId?: string; source: string; modifiedAt: number }> = []

    if (config.codex?.autoDetectLocal !== false) {
      for (const path of this.authPaths()) {
        if (!existsSync(path)) continue
        try {
          const auth = JSON.parse(readFileSync(path, 'utf8')) as CodexAuth
          if (auth.tokens?.access_token) {
            localCandidates.push({
              accessToken: auth.tokens.access_token,
              accountId: auth.tokens.account_id,
              source: path,
              modifiedAt: statSync(path).mtimeMs,
            })
          }
        } catch {}
      }
    }

    if (localCandidates.length > 0) {
      localCandidates.sort((a, b) => b.modifiedAt - a.modifiedAt)
      const { modifiedAt: _modifiedAt, ...auth } = localCandidates[0]
      return auth
    }

    if (config.codex?.oauth?.accessToken) {
      return {
        accessToken: config.codex.oauth.accessToken,
        accountId: config.codex.oauth.accountId,
        source: '旧版 DSH OAuth 登录',
      }
    }

    return null
  }

  private async fetchCodexUsage(url: string, headers: any, proxyUrl?: string): Promise<Response> {
    const proxy = proxyUrl || process.env.HTTPS_PROXY || process.env.HTTP_PROXY || process.env.https_proxy || process.env.http_proxy
    if (!proxy) return fetch(url, { headers })

    const dshHome = process.env.DSH_HOME || join(homedir(), '.dsh')
    const requireFromProfile = createRequire(join(dshHome, 'profiles', 'web', 'package.json'))
    const { ProxyAgent } = requireFromProfile('undici')
    const dispatcher = new ProxyAgent(proxy)
    return fetch(url, { headers, dispatcher } as any)
  }

  async fetchCard(config: QuotaConfig): Promise<ProviderResult> {
    const creds = this.loadAuth(config)
    if (!creds) {
      return {
        card: {
          id: 'codex',
          name: 'Codex (OpenAI)',
          provider: 'codex',
          status: 'disabled',
          error: '未连接 Codex。请点击「登录 Codex」通过网页登录，或在「设置」中配置代理/Token',
          groups: [],
          lastUpdated: Date.now(),
        },
      }
    }

    try {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${creds.accessToken}`,
        Accept: 'application/json',
        'User-Agent': 'codex-cli',
      }
      if (creds.accountId) headers['ChatGPT-Account-Id'] = creds.accountId
      const res = await this.fetchCodexUsage('https://chatgpt.com/backend-api/wham/usage', headers, config.httpProxy)
      if (!res.ok) {
        const cloudflare = res.status === 403 && (res.headers.get('content-type') ?? '').includes('text/html')
        throw new Error(cloudflare
          ? '已读取 Codex 登录态，但直连访问 ChatGPT 额度接口被拦截；请在设置中配置可用的 HTTP 代理'
          : `Codex 登录态失效或额度接口错误 (${res.status})`)
      }

      const data = await res.json() as CodexUsage
      const plan = (data.plan_type ?? 'Codex').toUpperCase()

      // OpenAI Codex rate_limit: primary_window is 604800s (Weekly) or secondary_window
      const rateLimit = data.rate_limit || {}
      const window = rateLimit.secondary_window || rateLimit.primary_window
      const usedPercent = Math.max(0, Math.min(100, Math.round(window?.used_percent ?? 0)))
      const remainingPercent = Math.max(0, 100 - usedPercent)
      const resetAt = window?.reset_at ? new Date(window.reset_at * 1000).toISOString() : undefined

      return {
        card: {
          id: 'codex',
          name: 'Codex (OpenAI)',
          provider: 'codex',
          status: remainingPercent <= 10 ? 'warn' : 'ok',
          plan,
          account: data.email || creds.source,
          groups: [
            {
              title: 'Codex 额度',
              hasInfoIcon: true,
              windows: [
                {
                  id: 'codex-weekly',
                  label: 'Weekly Limit (周配额)',
                  subtitle: formatQuotaResetText(resetAt, usedPercent, true),
                  usedPercent,
                  remainingPercent,
                  resetAt,
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
          id: 'codex',
          name: 'Codex (OpenAI)',
          provider: 'codex',
          status: 'error',
          plan: '已连接',
          account: creds.source,
          error: err.message,
          groups: [],
          lastUpdated: Date.now(),
        },
      }
    }
  }
}
