import type { IQuotaProvider, QuotaConfig, ProviderResult, TestConnectionResult, AccountConfigItem } from '../core/types.ts'
import { formatQuotaResetText } from '../core/types.ts'
import { getHomeConfigPaths, atomicWriteJsonSync } from '../core/paths.ts'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { fetchWithProxy } from '../core/fetch.ts'
import { join } from 'node:path'

interface CodexAuth {
  auth_mode?: string
  tokens?: {
    access_token?: string
    refresh_token?: string
    account_id?: string
  }
}

interface LoadedCodexAuth {
  accessToken: string
  refreshToken?: string
  accountId?: string
  source: string
  filePath?: string
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
  category = 'official_cloud' as const

  private authPaths(): string[] {
    const paths: string[] = []
    if (process.env.CODEX_HOME) {
      paths.push(join(process.env.CODEX_HOME, 'auth.json'))
    }
    paths.push(...getHomeConfigPaths('codex', 'auth.json'))
    return [...new Set(paths)]
  }

  private loadAuth(config: QuotaConfig, accountConfig?: AccountConfigItem): LoadedCodexAuth | null {
    if (accountConfig?.oauth?.accessToken) {
      return {
        accessToken: accountConfig.oauth.accessToken,
        refreshToken: accountConfig.oauth.refreshToken,
        accountId: accountConfig.oauth.accountId,
        source: accountConfig.name || 'Codex 账号',
      }
    }

    const localCandidates: Array<LoadedCodexAuth & { modifiedAt: number }> = []

    if (config.codex?.autoDetectLocal !== false && accountConfig?.autoDetectLocal !== false) {
      for (const path of this.authPaths()) {
        if (!existsSync(path)) continue
        try {
          const auth = JSON.parse(readFileSync(path, 'utf8')) as CodexAuth
          if (auth.tokens?.access_token) {
            localCandidates.push({
              accessToken: auth.tokens.access_token,
              refreshToken: auth.tokens.refresh_token,
              accountId: auth.tokens.account_id,
              source: path,
              filePath: path,
              modifiedAt: statSync(path).mtimeMs,
            })
          }
        } catch {}
      }
    }

    if (localCandidates.length > 0) {
      localCandidates.sort((a, b) => b.modifiedAt - a.modifiedAt)
      const { modifiedAt: _modifiedAt, ...auth } = localCandidates[0]!
      return auth
    }

    if (config.codex?.oauth?.accessToken) {
      return {
        accessToken: config.codex.oauth.accessToken,
        refreshToken: config.codex.oauth.refreshToken,
        accountId: config.codex.oauth.accountId,
        source: 'Codex OAuth 凭据',
      }
    }

    return null
  }

  private async refreshAccessToken(
    creds: LoadedCodexAuth,
    proxyUrl?: string
  ): Promise<string | null> {
    if (!creds.refreshToken) return null
    try {
      const clientId = 'app_EMoamEEZ73f0CkXaXp7hrann'
      const tokenRes = await fetchWithProxy('https://auth.openai.com/oauth/token', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/x-www-form-urlencoded',
          'User-Agent': 'codex-cli',
          'Accept': 'application/json',
        },
        body: new URLSearchParams({
          grant_type: 'refresh_token',
          client_id: clientId,
          refresh_token: creds.refreshToken,
        }),
      }, proxyUrl, 12000)

      if (!tokenRes.ok) return null
      const data = await tokenRes.json() as any
      const newAccessToken = data.access_token
      const newRefreshToken = data.refresh_token || creds.refreshToken
      if (!newAccessToken) return null

      creds.accessToken = newAccessToken
      creds.refreshToken = newRefreshToken

      if (creds.filePath && existsSync(creds.filePath)) {
        try {
          const raw = readFileSync(creds.filePath, 'utf8')
          const auth = JSON.parse(raw) as CodexAuth
          if (!auth.tokens) auth.tokens = {}
          auth.tokens.access_token = newAccessToken
          auth.tokens.refresh_token = newRefreshToken
          atomicWriteJsonSync(creds.filePath, auth, 0o600)
        } catch {}
      }

      return newAccessToken
    } catch {
      return null
    }
  }

  async testConnection(config: QuotaConfig, accountConfig?: AccountConfigItem): Promise<TestConnectionResult> {
    const start = Date.now()
    const creds = this.loadAuth(config, accountConfig)
    if (!creds) {
      return {
        ok: false,
        provider: 'codex',
        message: '未找到 Codex 凭据。请点击「登录 OpenAI」或配置 access_token',
      }
    }

    try {
      const headers: Record<string, string> = {
        Authorization: `Bearer ${creds.accessToken}`,
        Accept: 'application/json',
        'User-Agent': 'codex-cli',
      }
      if (creds.accountId) headers['ChatGPT-Account-Id'] = creds.accountId

      let res = await fetchWithProxy('https://chatgpt.com/backend-api/wham/usage', { headers }, config.httpProxy, 10000)
      if (res.status === 401 && creds.refreshToken) {
        const refreshed = await this.refreshAccessToken(creds, config.httpProxy)
        if (refreshed) {
          headers.Authorization = `Bearer ${refreshed}`
          res = await fetchWithProxy('https://chatgpt.com/backend-api/wham/usage', { headers }, config.httpProxy, 10000)
        }
      }
      const latencyMs = Date.now() - start

      if (res.ok) {
        const data = await res.json() as any
        return {
          ok: true,
          provider: 'codex',
          latencyMs,
          account: data.email || 'ChatGPT Account',
          message: `连接成功 (延迟: ${latencyMs}ms)`,
        }
      }

      return {
        ok: false,
        provider: 'codex',
        latencyMs,
        message: `接口响应异常: HTTP ${res.status}`,
      }
    } catch (err: any) {
      return {
        ok: false,
        provider: 'codex',
        latencyMs: Date.now() - start,
        message: `请求异常: ${err.message}`,
      }
    }
  }

  async fetchCard(config: QuotaConfig, accountConfig?: AccountConfigItem): Promise<ProviderResult> {
    const cardId = accountConfig?.id || 'codex'
    const cardName = accountConfig?.name || 'Codex (OpenAI)'
    const creds = this.loadAuth(config, accountConfig)

    if (!creds) {
      return {
        card: {
          id: cardId,
          name: cardName,
          provider: 'codex',
          category: this.category,
          status: 'disabled',
          error: '未连接 Codex。请点击「登录 OpenAI」通过网页登录，或在「设置」中配置代理/Token',
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

      let res = await fetchWithProxy('https://chatgpt.com/backend-api/wham/usage', { headers }, config.httpProxy, 15000)
      if (res.status === 401 && creds.refreshToken) {
        const refreshed = await this.refreshAccessToken(creds, config.httpProxy)
        if (refreshed) {
          headers.Authorization = `Bearer ${refreshed}`
          res = await fetchWithProxy('https://chatgpt.com/backend-api/wham/usage', { headers }, config.httpProxy, 15000)
        }
      }
      if (!res.ok) {
        const cloudflare = res.status === 403 && (res.headers.get('content-type') ?? '').includes('text/html')
        throw new Error(cloudflare
          ? '已读取 Codex 登录态，但直连访问 ChatGPT 额度接口被拦截；请在设置中配置可用的 HTTP 代理'
          : `Codex 登录态失效或额度接口错误 (${res.status})`)
      }

      const data = await res.json() as CodexUsage
      const plan = (data.plan_type ?? 'Codex').toUpperCase()

      const rateLimit = data.rate_limit || {}
      const window = rateLimit.secondary_window || rateLimit.primary_window
      const usedPercent = Math.max(0, Math.min(100, Math.round(window?.used_percent ?? 0)))
      const remainingPercent = Math.max(0, 100 - usedPercent)
      const resetAt = window?.reset_at ? new Date(window.reset_at * 1000).toISOString() : undefined

      return {
        card: {
          id: cardId,
          name: cardName,
          provider: 'codex',
          category: this.category,
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
                  label: 'Weekly Limit',
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
          id: cardId,
          name: cardName,
          provider: 'codex',
          category: this.category,
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
