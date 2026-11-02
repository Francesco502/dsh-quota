export type ProviderCategory = 'ide' | 'domestic_llm' | 'official_cloud' | 'custom_api'
export type ProxyMode = 'direct' | 'proxy-required' | 'proxy-preferred'

export interface MetricWindow {
  id: string
  label: string
  subtitle?: string
  usedPercent: number
  remainingPercent: number
  resetAt?: string
  barType?: 'circle' | 'line' | 'balance'
  status?: 'active' | 'disabled' | 'unknown' | 'exhausted'
  rawFraction?: number
  windowKind?: '5h' | 'weekly' | 'monthly' | 'sliding' | 'unknown'
  bucketId?: string
  modelFamily?: string
}

export function makeHudMetricKey(provider: string, groupTitle: string, windowId: string): string {
  return `${provider}::${encodeURIComponent(groupTitle)}::${encodeURIComponent(windowId)}`
}

export interface MetricGroup {
  id?: string
  title: string
  hasInfoIcon?: boolean
  poolType?: 'gemini' | 'argon' | 'claude_gpt' | 'custom' | 'general'
  windows: MetricWindow[]
}

export interface QuotaBalanceInfo {
  currency: 'CNY' | 'USD' | 'TOKEN' | 'COUNT'
  total?: number
  used?: number
  remaining?: number
  grantedBalance?: number
  toppedUpBalance?: number
  expireTime?: string
  isEstimate?: boolean
}

export interface QuotaSparklinePoint {
  t: number
  r: number
}

export interface SourceProvenance {
  endpoint?: string
  method?: 'official-summary' | 'model-fallback' | 'local-state' | 'oauth-api' | 'user-balance'
  timestamp: number
  partial?: boolean
  host?: string
}

export interface AuthCardItem {
  id: string
  name: string
  provider: string
  category: ProviderCategory
  status: 'ok' | 'warn' | 'error' | 'disabled'
  plan?: string
  account?: string
  error?: string
  groups: MetricGroup[]
  balance?: QuotaBalanceInfo
  burnRatePerHour?: number
  estimatedHoursLeft?: number
  sparkline?: QuotaSparklinePoint[]
  lastUpdated: number
  stale?: boolean
  sourceProvenance?: SourceProvenance
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
  enabledProviders?: string[]
  floatingHudProviders?: string[]
  providerOrder?: string[]
  customNames?: Record<string, string>
  showFloatingHud?: boolean
  floatingHudMetrics?: string[]
  refreshIntervalMinutes?: number
  refreshIntervalSeconds?: number
  alarmThresholdPercent?: number
  enableNotification?: boolean
  accounts?: AccountConfigItem[]
  custom_compatible?: CustomCompatibleEndpoint[]
  deepseek?: { enabled?: boolean; apiKey?: string; baseUrl?: string; name?: string }
  cursor?: { enabled?: boolean; autoDetectLocal?: boolean; sessionToken?: string; name?: string }
  codex?: { enabled?: boolean; autoDetectLocal?: boolean; oauth?: any; name?: string }
  antigravity?: { enabled?: boolean; autoDetectLocal?: boolean; oauth?: any; name?: string }
  opencode_go?: { enabled?: boolean; apiKey?: string; baseUrl?: string; name?: string }
  github_copilot?: { enabled?: boolean; token?: string; autoDetectLocal?: boolean; name?: string }
  openai_billing?: { enabled?: boolean; apiKey?: string; baseUrl?: string; name?: string }
  claude?: { enabled?: boolean; apiKey?: string; baseUrl?: string; name?: string }
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

export class QuotaClientApi {
  async getCards(force = false): Promise<{
    cards: AuthCardItem[]
    allCards?: AuthCardItem[]
    alarms?: QuotaAlarm[]
    lastUpdated: number
  }> {
    const res = await fetch(`/api/dsh-quota/status?force=${force}`)
    if (!res.ok) throw new Error(`获取额度失败 (${res.status})`)
    return res.json()
  }

  async refreshSingle(providerOrId: string): Promise<AuthCardItem> {
    const res = await fetch(`/api/dsh-quota/status?provider=${encodeURIComponent(providerOrId)}&force=true`)
    if (!res.ok) throw new Error(`刷新服务失败 (${res.status})`)
    const data = await res.json()
    if (data.card) return data.card
    if (data.cards && Array.isArray(data.cards)) {
      const found = data.cards.find((c: any) => c.id === providerOrId || c.provider === providerOrId)
      if (found) return found
    }
    return data
  }

  async testConnection(provider: string, accountConfig?: AccountConfigItem): Promise<TestConnectionResult> {
    const res = await fetch('/api/dsh-quota/test-connection', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider, accountConfig }),
    })
    if (!res.ok) throw new Error(`测活请求失败 (${res.status})`)
    return res.json()
  }

  async testAllConnections(): Promise<Record<string, TestConnectionResult>> {
    const res = await fetch('/api/dsh-quota/test-all', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
    if (!res.ok) throw new Error(`一键测活失败 (${res.status})`)
    const data = await res.json()
    return data.results || {}
  }

  async getHistory(instanceId: string, days = 7): Promise<QuotaHistoryPoint[]> {
    const res = await fetch(`/api/dsh-quota/history?instanceId=${encodeURIComponent(instanceId)}&days=${days}`)
    if (!res.ok) return []
    const data = await res.json()
    return data.points || []
  }

  async getConfig(): Promise<QuotaConfig> {
    const res = await fetch('/api/dsh-quota/config')
    if (!res.ok) throw new Error(`获取配置失败 (${res.status})`)
    return res.json()
  }

  async saveConfig(cfg: QuotaConfig): Promise<void> {
    const res = await fetch('/api/dsh-quota/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cfg),
    })
    if (!res.ok) throw new Error(`保存配置失败 (${res.status})`)
  }

  async startCodexLogin(): Promise<string> {
    const res = await fetch('/api/dsh-quota/auth/codex/start')
    if (!res.ok) throw new Error(`启动 Codex 登录失败 (${res.status})`)
    const data = await res.json()
    return data.authUrl
  }

  async startAntigravityLogin(): Promise<string> {
    const res = await fetch('/api/dsh-quota/auth/antigravity/start')
    if (!res.ok) throw new Error(`启动 Antigravity 登录失败 (${res.status})`)
    const data = await res.json()
    return data.authUrl
  }

  async connectCursor(): Promise<AuthCardItem | undefined> {
    const res = await fetch('/api/dsh-quota/auth/cursor/connect', { method: 'POST' })
    if (!res.ok) throw new Error(`连接 Cursor 失败 (${res.status})`)
    const data = await res.json()
    return data.card
  }
}
