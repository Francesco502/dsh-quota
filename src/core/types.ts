/**
 * Data structures for Quota tracking & Single Long Card UI
 * @version 0.2.2
 */

export const PLUGIN_VERSION = '0.2.2'

export type ProviderCategory = 'ide' | 'domestic_llm' | 'official_cloud' | 'custom_api'

export interface MetricWindow {
  id: string
  label: string
  subtitle?: string
  usedPercent: number
  remainingPercent: number
  resetAt?: string
  barType?: 'circle' | 'line'
}

export interface MetricGroup {
  title: string
  hasInfoIcon?: boolean
  windows: MetricWindow[]
}

export interface QuotaBalanceInfo {
  currency: 'CNY' | 'USD' | 'TOKEN' | 'COUNT'
  total?: number
  used?: number
  remaining?: number
  grantedBalance?: number    // 赠送金/赠送额度
  toppedUpBalance?: number   // 充值金额
  expireTime?: string
}

export interface QuotaSparklinePoint {
  t: number // timestamp
  r: number // remaining percent (0-100)
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
}

export interface QuotaHistoryPoint {
  timestamp: number
  instanceId: string
  remainingPercent: number
  usedPercent: number
  remainingBalance?: number
}

export interface QuotaAlarm {
  instanceId: string
  provider: string
  name: string
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
  httpProxy?: string
  enabledProviders?: string[]
  providerOrder?: string[]
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
  deepseek?: { enabled?: boolean; apiKey?: string; baseUrl?: string }
  cursor?: { enabled?: boolean; autoDetectLocal?: boolean; sessionToken?: string }
  codex?: {
    enabled?: boolean
    autoDetectLocal?: boolean
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
    oauth?: {
      accessToken?: string
      refreshToken?: string
      expiresAt?: number
      email?: string
      name?: string
    }
  }
  opencode_go?: { enabled?: boolean; apiKey?: string; baseUrl?: string }
  github_copilot?: { enabled?: boolean; autoDetectLocal?: boolean; token?: string }
  openai_billing?: { enabled?: boolean; apiKey?: string; baseUrl?: string }
  claude?: { enabled?: boolean; apiKey?: string; sessionKey?: string }
  kimi?: { enabled?: boolean; apiKey?: string; baseUrl?: string }
  glm?: { enabled?: boolean; apiKey?: string; baseUrl?: string }
  minimax?: { enabled?: boolean; apiKey?: string; groupId?: string; baseUrl?: string }
  qwen?: { enabled?: boolean; apiKey?: string; baseUrl?: string }
  volcengine?: { enabled?: boolean; apiKey?: string; baseUrl?: string }
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
  fetchCard(config: QuotaConfig, accountConfig?: AccountConfigItem): Promise<ProviderResult>
  testConnection?(config: QuotaConfig, accountConfig?: AccountConfigItem): Promise<TestConnectionResult>
}

export interface ModelRouteRecommendation {
  primaryModel: string
  primaryProvider: string
  status: 'healthy' | 'warning' | 'exhausted'
  reason: string
  fallbackRoutes: Array<{
    provider: string
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
