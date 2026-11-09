/**
 * Data structures for Quota tracking & Single Long Card UI
 * @version 0.4.1
 */

export const PLUGIN_VERSION = '0.4.3'

export type ProviderCategory = 'ide' | 'domestic_llm' | 'official_cloud' | 'custom_api'
export type ProxyMode = 'direct' | 'proxy-required' | 'proxy-preferred'

/**
 * What a window actually measures. This is the single source of truth for whether
 * a percentage is meaningful:
 * - `usage`   the upstream reports a real quota ratio (5h/weekly/monthly/rolling);
 * - `balance` the upstream reports money/credits only; show `amountText`, never a ratio;
 * - `liveness` only authentication/connectivity was checked; there is no quota data;
 * - `unknown`  the upstream answered but the quota fields were missing or unparsable.
 */
export type QuotaKind = 'usage' | 'balance' | 'liveness' | 'unknown'

export interface MetricWindow {
  id: string
  label: string
  subtitle?: string
  /**
   * Percent of the window already consumed. Absent whenever the upstream does not
   * report a real quota ratio — never synthesize 0 or 100 to fill the gap.
   */
  usedPercent?: number
  /** Percent remaining. Absent under the same rule as `usedPercent`. */
  remainingPercent?: number
  /** What this window measures. Omitted on legacy windows; resolve with `windowQuotaKind()`. */
  quotaKind?: QuotaKind
  resetAt?: string
  barType?: 'circle' | 'line' | 'balance'
  status?: 'active' | 'disabled' | 'unknown' | 'exhausted'
  rawFraction?: number
  windowKind?: '5h' | 'weekly' | 'monthly' | 'sliding' | 'unknown'
  bucketId?: string
  modelFamily?: string
  /** Truthful amount for balance-only windows; never derive a percentage from it. */
  amountText?: string
}

export interface MetricGroup {
  id?: string
  title: string
  hasInfoIcon?: boolean
  poolType?: 'gemini' | 'argon' | 'claude_gpt' | 'custom' | 'general'
  windows: MetricWindow[]
}

/** Resolve a window's declared kind; a legacy window carrying a ratio is `usage`. */
export function windowQuotaKind(win: MetricWindow): QuotaKind {
  if (win.quotaKind !== undefined) return win.quotaKind
  return win.remainingPercent !== undefined ? 'usage' : 'unknown'
}

/**
 * True only when the window carries a real quota ratio that may be rendered,
 * recorded in history, compared against alarms or fed into burn-rate math.
 * Liveness/balance/unknown windows are never quantified, even if a provider
 * mistakenly left a percentage on them.
 */
export function isQuantified(
  win: MetricWindow,
): win is MetricWindow & { usedPercent: number; remainingPercent: number } {
  if (windowQuotaKind(win) !== 'usage') return false
  return (
    typeof win.remainingPercent === 'number' &&
    Number.isFinite(win.remainingPercent) &&
    typeof win.usedPercent === 'number' &&
    Number.isFinite(win.usedPercent)
  )
}

export interface QuotaBalanceInfo {
  currency: 'CNY' | 'USD' | 'TOKEN' | 'COUNT'
  total?: number
  used?: number
  remaining?: number
  grantedBalance?: number    // 赠送金/赠送额度
  toppedUpBalance?: number   // 充值金额
  expireTime?: string
  isEstimate?: boolean       // 是否为根据用量估算而非官方直读
}

export interface QuotaSparklinePoint {
  t: number // timestamp
  r: number // remaining percent (0-100)
}

export interface SourceProvenance {
  endpoint?: string
  method?: 'official-summary' | 'model-fallback' | 'local-state' | 'oauth-api' | 'user-balance'
  timestamp: number
  partial?: boolean
  host?: string
}

export interface AuthCardItem {
  id: string                 // Unique card / instance ID (e.g. deepseek_default, cursor_local)
  name: string
  provider: string           // Provider identifier: cursor, codex, antigravity, deepseek, etc.
  category: ProviderCategory
  status: 'ok' | 'warn' | 'error' | 'disabled'
  plan?: string
  account?: string
  error?: string
  groups: MetricGroup[]
  balance?: QuotaBalanceInfo
  burnRatePerHour?: number   // Recent consumption rate per hour (%)
  estimatedHoursLeft?: number // Estimated hours until exhaustion
  sparkline?: QuotaSparklinePoint[] // Recent 7-day trend points for instant SVG rendering
  lastUpdated: number
  stale?: boolean
  sourceProvenance?: SourceProvenance
}

export interface QuotaHistoryPoint {
  timestamp: number
  instanceId: string
  poolId?: string
  windowId?: string
  windowKind?: string
  remainingPercent: number
  usedPercent: number
  remainingBalance?: number
  resetAt?: string
}

export interface QuotaAlarm {
  instanceId: string
  provider: string
  name: string
  poolId?: string
  windowId?: string
  level: 'warn' | 'critical'
  message: string
  timestamp: number
}

export interface TestConnectionResult {
  ok: boolean
  provider: string
  latencyMs?: number
  account?: string
  message: string
  raw?: any
}

export interface AccountConfigItem {
  id: string
  provider: string
  name?: string
  enabled?: boolean
  apiKey?: string
  baseUrl?: string
  sessionToken?: string
  autoDetectLocal?: boolean
  oauth?: any
  extra?: Record<string, any>
}

export interface CustomCompatibleEndpoint {
  id: string
  name: string
  baseUrl: string
  apiKey: string
  balancePath?: string
  enabled?: boolean
}

export interface QuotaConfig {
  schemaVersion?: number
  httpProxy?: string
  proxyMode?: ProxyMode
  enabledProviders?: string[] // 看板展示服务列表
  floatingHudProviders?: string[] // 悬浮球展示服务列表
  providerOrder?: string[]
  customNames?: Record<string, string> // 用户自定义服务显示名称
  showFloatingHud?: boolean
  floatingHudMetrics?: string[]
  refreshIntervalMinutes?: number
  refreshIntervalSeconds?: number
  alarmThresholdPercent?: number // Default 15 (%)
  enableNotification?: boolean   // Default true
  
  // Multi-account store
  accounts?: AccountConfigItem[]
  // Custom OneAPI / NewAPI / OpenAI compatible endpoints
  custom_compatible?: CustomCompatibleEndpoint[]

  // Legacy/Default Provider Single-Account Configs (Backward compatibility)
  deepseek?: { enabled?: boolean; apiKey?: string; baseUrl?: string; name?: string }
  cursor?: { enabled?: boolean; autoDetectLocal?: boolean; sessionToken?: string; name?: string }
  codex?: {
    enabled?: boolean
    autoDetectLocal?: boolean
    name?: string
    /** Opt-in: allow refreshing tokens read from ~/.codex/auth.json and writing them back. */
    syncLocalAuth?: boolean
    oauth?: {
      accessToken?: string
      refreshToken?: string
      accountId?: string
      expiresAt?: number
    }
  }
  antigravity?: {
    enabled?: boolean
    autoDetectLocal?: boolean
    name?: string
    oauth?: {
      accessToken?: string
      refreshToken?: string
      expiresAt?: number
      email?: string
      name?: string
    }
  }
  opencode_go?: { enabled?: boolean; apiKey?: string; baseUrl?: string; name?: string }
  github_copilot?: { enabled?: boolean; autoDetectLocal?: boolean; token?: string; name?: string }
  openai_billing?: { enabled?: boolean; apiKey?: string; baseUrl?: string; name?: string }
  claude?: { enabled?: boolean; apiKey?: string; sessionKey?: string; baseUrl?: string; name?: string }
  kimi?: { enabled?: boolean; apiKey?: string; baseUrl?: string; name?: string }
  glm?: { enabled?: boolean; apiKey?: string; baseUrl?: string; name?: string }
  minimax?: { enabled?: boolean; apiKey?: string; groupId?: string; baseUrl?: string; name?: string }
  qwen?: { enabled?: boolean; apiKey?: string; baseUrl?: string; name?: string }
  volcengine?: { enabled?: boolean; apiKey?: string; baseUrl?: string; name?: string }
  siliconflow?: { enabled?: boolean; apiKey?: string; baseUrl?: string; name?: string }
  openrouter?: { enabled?: boolean; apiKey?: string; baseUrl?: string; name?: string }
  custom_api?: { enabled?: boolean; name?: string }
}

export function getRefreshIntervalSeconds(config?: QuotaConfig): number {
  if (typeof config?.refreshIntervalSeconds === 'number' && config.refreshIntervalSeconds > 0) {
    return Math.max(5, config.refreshIntervalSeconds)
  }
  if (typeof config?.refreshIntervalMinutes === 'number' && config.refreshIntervalMinutes > 0) {
    return Math.max(5, Math.round(config.refreshIntervalMinutes * 60))
  }
  return 60
}

export interface ProviderResult {
  card: AuthCardItem
}

export interface IQuotaProvider {
  name: string
  category: ProviderCategory
  fetchCard(
    config: QuotaConfig,
    accountConfig?: AccountConfigItem,
    signal?: AbortSignal,
  ): Promise<ProviderResult>
  testConnection?(
    config: QuotaConfig,
    accountConfig?: AccountConfigItem,
    signal?: AbortSignal,
  ): Promise<TestConnectionResult>
}

export interface ModelRouteRecommendation {
  primaryModel: string
  primaryModelId: string
  primaryProvider: string
  status: 'healthy' | 'warning' | 'exhausted'
  reason: string
  availableModels?: string[]
  fallbackRoutes: Array<{
    provider: string
    modelId: string
    name: string
    reason: string
  }>
}

/**
 * Standardized reset text formatter across all providers
 */
export function formatQuotaResetText(resetInput?: string | number | Date, usedPercent = 0, isWeekly = false): string {
  if (usedPercent <= 0) return '已用 0% · 额度充足'
  
  const usedPrefix = `已用 ${usedPercent}%`
  if (!resetInput) return `${usedPrefix} · 周期重置`

  const resetDate = new Date(resetInput)
  if (isNaN(resetDate.getTime())) return `${usedPrefix} · 周期重置`

  const diffMs = resetDate.getTime() - Date.now()
  if (diffMs <= 0) return `${usedPrefix} · 即将重置`

  const totalMinutes = Math.ceil(diffMs / (60 * 1000))
  const days = Math.floor(totalMinutes / (24 * 60))
  const hours = Math.floor((totalMinutes % (24 * 60)) / 60)
  const minutes = totalMinutes % 60

  const m = resetDate.getMonth() + 1
  const d = resetDate.getDate()
  const hh = String(resetDate.getHours()).padStart(2, '0')
  const mm = String(resetDate.getMinutes()).padStart(2, '0')
  
  const dateStr = `${m}/${d}`
  const timeStr = `${hh}:${mm}`
  const fullTimeStr = isWeekly || days > 0 ? `${dateStr} ${timeStr}` : timeStr

  let countdownStr = ''
  if (days > 0) {
    countdownStr = `${days} 天${hours > 0 ? ` ${hours} 小时` : ''}后`
  } else if (hours > 0) {
    countdownStr = `${hours} 小时${minutes > 0 ? ` ${minutes} 分钟` : ''}后`
  } else {
    countdownStr = `${minutes} 分钟后`
  }

  return `${usedPrefix} · 预计 ${countdownStr}重置 (${fullTimeStr})`
}
