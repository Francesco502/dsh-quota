import type { IQuotaProvider, QuotaConfig, ProviderResult, TestConnectionResult, AccountConfigItem, MetricWindow } from '../core/types.ts'
import { formatQuotaResetText, isQuantified } from '../core/types.ts'
import { getHomeConfigPaths, atomicWriteJsonSync } from '../core/paths.ts'
import { existsSync, readFileSync, statSync } from 'node:fs'
import { fetchWithProxy } from '../core/fetch.ts'
import { join } from 'node:path'

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

/** Normalize an upstream reset timestamp: epoch seconds, epoch milliseconds or ISO. */
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

interface TokenRefreshInfo {
  accessToken: string
  refreshToken?: string
  expiresAt?: number
}

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

  /**
   * Optional persistence hook (contract A18/B7): the manager can assign this to
   * persist a rotated token instead of losing the new refresh_token on restart.
   */
  onTokenRefreshed?: (info: TokenRefreshInfo) => void | Promise<void>

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
    proxyUrl?: string,
    config?: QuotaConfig,
    accountConfig?: AccountConfigItem
  ): Promise<string | null> {
    if (!creds.refreshToken) return null
    // A credential read from the user's own CLI login (auth.json) is not ours to rotate:
    // refreshing it can invalidate their CLI session. Opt in with codex.syncLocalAuth.
    if (creds.filePath && config?.codex?.syncLocalAuth !== true) return null
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
      }, proxyUrl, 12000, config?.proxyMode)

      if (!tokenRes.ok) return null
      const data = await tokenRes.json() as any
      const newAccessToken = data.access_token
      const newRefreshToken = data.refresh_token || creds.refreshToken
      if (!newAccessToken) return null

      creds.accessToken = newAccessToken
      creds.refreshToken = newRefreshToken

      // Update in memory config without polluting default config
      if (accountConfig?.oauth) {
        accountConfig.oauth.accessToken = newAccessToken
        accountConfig.oauth.refreshToken = newRefreshToken
      } else if (config?.codex?.oauth) {
        config.codex.oauth.accessToken = newAccessToken
        config.codex.oauth.refreshToken = newRefreshToken
      }

      // Persist through the optional manager hook so a rotated refresh_token is
      // not lost on restart (A18). A missing hook is not an error.
      if (this.onTokenRefreshed) {
        try {
          await this.onTokenRefreshed({ accessToken: newAccessToken, refreshToken: newRefreshToken, expiresAt: data.expires_in ? Date.now() + data.expires_in * 1000 : undefined })
        } catch {}
      }

      if (creds.filePath && config?.codex?.syncLocalAuth === true && existsSync(creds.filePath)) {
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

  async testConnection(config: QuotaConfig, accountConfig?: AccountConfigItem, signal?: AbortSignal): Promise<TestConnectionResult> {
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

      let res = await fetchWithProxy('https://chatgpt.com/backend-api/wham/usage', { headers, signal }, config.httpProxy, 10000, config.proxyMode)
      if (res.status === 401 && creds.refreshToken) {
        const refreshed = await this.refreshAccessToken(creds, config.httpProxy, config, accountConfig)
        if (refreshed) {
          headers.Authorization = `Bearer ${refreshed}`
          res = await fetchWithProxy('https://chatgpt.com/backend-api/wham/usage', { headers, signal }, config.httpProxy, 10000, config.proxyMode)
        }
      }
      const latencyMs = Date.now() - start

      if (res.ok) {
        const data = await res.json() as any
        const plan = (data.plan_type ?? 'Codex').toUpperCase()
        return {
          ok: true,
          provider: 'codex',
          latencyMs,
          account: `${data.email || creds.source} (${plan})`,
          message: `连接成功 (延迟: ${latencyMs}ms, 方案: ${plan})`,
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

  async fetchCard(config: QuotaConfig, accountConfig?: AccountConfigItem, signal?: AbortSignal): Promise<ProviderResult> {
    const cardId = accountConfig?.id || 'codex'
    const cardName = accountConfig?.name || config.customNames?.codex || config.codex?.name || 'Codex (OpenAI)'
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

      let res = await fetchWithProxy('https://chatgpt.com/backend-api/wham/usage', { headers, signal }, config.httpProxy, 15000, config.proxyMode)
      if (res.status === 401 && creds.refreshToken) {
        const refreshed = await this.refreshAccessToken(creds, config.httpProxy, config, accountConfig)
        if (refreshed) {
          headers.Authorization = `Bearer ${refreshed}`
          res = await fetchWithProxy('https://chatgpt.com/backend-api/wham/usage', { headers, signal }, config.httpProxy, 15000, config.proxyMode)
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
      const windows: MetricWindow[] = []

      const buildWindow = (win: UsageWindow | undefined, winId: string, defaultLabel: string, isWeeklyFallback = false): MetricWindow | null => {
        if (!win) return null
        // `used_percent` may be renamed or a window may be present without data.
        // Missing/non-numeric values are "unknown" — never a synthesized 0% used.
        const rawUsed = parseFinite(win.used_percent)
        const hasUsed = rawUsed !== undefined
        const used = hasUsed ? clampPercent(rawUsed!) : undefined
        const rem = used !== undefined ? 100 - used : undefined
        const resetAt = normalizeResetAt(win.reset_at)
        const isWeekly = win.limit_window_seconds ? win.limit_window_seconds >= 86400 * 3 : isWeeklyFallback
        const label = isWeekly ? 'Weekly Limit' : (win.limit_window_seconds && win.limit_window_seconds <= 18000 ? '5-Hour Limit' : defaultLabel)
        const subtitle = used !== undefined ? formatQuotaResetText(resetAt, used, isWeekly) : '额度状态未知'
        const window: MetricWindow = {
          id: winId,
          label,
          subtitle,
          ...(hasUsed
            ? { usedPercent: used, remainingPercent: rem, quotaKind: 'usage' as const }
            : { quotaKind: 'unknown' as const }),
          resetAt,
          barType: 'circle',
          windowKind: isWeekly ? 'weekly' : '5h',
          rawFraction: hasUsed ? (100 - used!) / 100 : undefined,
          status: !hasUsed ? 'unknown' : (rem! <= 0 ? 'exhausted' : 'active'),
        }
        return window
      }

      const primWin = buildWindow(rateLimit.primary_window, 'codex-5h', '5-Hour Limit', false)
      const secWin = buildWindow(rateLimit.secondary_window, 'codex-weekly', 'Weekly Limit', true)
      if (primWin) windows.push(primWin)
      if (secWin) windows.push(secWin)

      if (windows.length === 0) {
        const fallback = buildWindow(rateLimit.secondary_window || rateLimit.primary_window, 'codex-weekly', 'Weekly Limit', true)
        if (fallback) windows.push(fallback)
      }

      if (data.code_review_rate_limit?.primary_window) {
        const crWin = buildWindow(data.code_review_rate_limit.primary_window, 'codex-review', 'Code Review Limit', false)
        if (crWin) windows.push(crWin)
      }

      // Paid credits (A19): an amount, so `balance` semantics — no percentage.
      const credits = data.credits
      if (credits && (credits.unlimited === true || credits.has_credits === true || parseFinite(credits.balance) !== undefined)) {
        const creditsBalance = parseFinite(credits.balance)
        const creditsWindow: MetricWindow = {
          id: 'codex-credits',
          label: 'Codex Credits',
          subtitle: credits.unlimited === true
            ? '不限额度（Credits）'
            : (creditsBalance !== undefined ? `剩余 $${creditsBalance.toFixed(2)}` : 'Credits 状态未知'),
          quotaKind: 'balance',
          barType: 'balance',
          ...(credits.unlimited !== true && creditsBalance !== undefined ? { amountText: `$${creditsBalance.toFixed(2)}` } : {}),
          status: credits.unlimited === true ? 'active' : (creditsBalance !== undefined && creditsBalance <= 0 ? 'exhausted' : 'active'),
        }
        windows.push(creditsWindow)
      }

      // Only real quota ratios may drive pressure status.
      const quantified = windows.filter(isQuantified)
      const lowestRem = quantified.length > 0 ? Math.min(...quantified.map(w => w.remainingPercent)) : undefined
      // Exhaustion is a warning, not a transport failure: `error` stays reserved for
      // unreachable endpoints so alarms never read "额度耗尽" as "凭据失效".
      const cardStatus = lowestRem !== undefined && lowestRem <= (config.alarmThresholdPercent ?? 15) ? 'warn' : 'ok'

      return {
        card: {
          id: cardId,
          name: cardName,
          provider: 'codex',
          category: this.category,
          status: cardStatus,
          plan,
          account: data.email || creds.source,
          groups: [
            {
              id: 'codex-rate-limits',
              title: 'Codex 额度',
              hasInfoIcon: true,
              poolType: 'claude_gpt',
              windows,
            },
          ],
          lastUpdated: Date.now(),
          sourceProvenance: {
            endpoint: 'https://chatgpt.com/backend-api/wham/usage',
            method: 'oauth-api',
            timestamp: Date.now(),
            host: 'chatgpt.com',
          },
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
          account: creds.source,
          error: err.message,
          groups: [],
          lastUpdated: Date.now(),
        },
      }
    }
  }
}
