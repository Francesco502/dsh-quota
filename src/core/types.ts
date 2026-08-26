/**
 * Data structures for Quota tracking & Single Long Card UI
 * @version 0.1.0
 */

export const PLUGIN_VERSION = '0.1.0'

export interface MetricWindow {
  id: string
  label: string
  subtitle?: string
  usedPercent: number
  remainingPercent: number
  resetAt?: string
  barType?: 'circle' | 'line' // 'circle' for Antigravity, 'line' for Cursor/OpenCode
}

export interface MetricGroup {
  title: string
  hasInfoIcon?: boolean
  windows: MetricWindow[]
}

export interface AuthCardItem {
  id: string
  name: string
  provider: 'cursor' | 'codex' | 'antigravity' | 'opencode_go' | string
  status: 'ok' | 'warn' | 'error' | 'disabled'
  plan?: string
  account?: string
  error?: string
  groups: MetricGroup[]
  lastUpdated: number
}

export interface QuotaConfig {
  httpProxy?: string // Optional proxy URL e.g. http://127.0.0.1:7890 or http://172.30.64.1:7890
  enabledProviders?: string[] // e.g. ['antigravity', 'cursor', 'codex', 'opencode_go']
  providerOrder?: string[]   // custom sorting order
  showFloatingHud?: boolean  // whether to display floating circular HUD (default true)
  floatingHudMetrics?: string[] // selected provider/window ids shown in the HUD
  cursor?: {
    enabled?: boolean
    autoDetectLocal?: boolean
    sessionToken?: string
  }
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
  opencode_go?: {
    enabled?: boolean
    apiKey?: string
    baseUrl?: string
  }
  refreshIntervalMinutes?: number
}

export interface ProviderResult {
  card: AuthCardItem
}

export interface IQuotaProvider {
  name: string
  fetchCard(config: QuotaConfig): Promise<ProviderResult>
}

/**
 * Standardized reset text formatter across all providers:
 * - 100% remaining / 0% used: "已用 0% · 额度充足"
 * - Used > 0%: "已用 X% · 预计 5天3小时后重置 (8/31 15:36)"
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
