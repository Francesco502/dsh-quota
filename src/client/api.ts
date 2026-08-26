export interface MetricWindow {
  id: string
  label: string
  subtitle?: string
  usedPercent: number
  remainingPercent: number
  resetAt?: string
  barType?: 'circle' | 'line'
}

export function makeHudMetricKey(provider: string, groupTitle: string, windowId: string): string {
  return `${provider}::${encodeURIComponent(groupTitle)}::${encodeURIComponent(windowId)}`
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
  httpProxy?: string
  enabledProviders?: string[]
  providerOrder?: string[]
  showFloatingHud?: boolean
  floatingHudMetrics?: string[]
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

export class QuotaClientApi {
  async getCards(force = false): Promise<{ cards: AuthCardItem[]; allCards?: AuthCardItem[]; lastUpdated: number }> {
    const res = await fetch(`/api/dsh-quota/status?force=${force}`)
    if (!res.ok) throw new Error(`获取额度失败 (${res.status})`)
    return res.json()
  }

  async refreshSingle(provider: string): Promise<AuthCardItem> {
    const res = await fetch(`/api/dsh-quota/status?provider=${encodeURIComponent(provider)}&force=true`)
    if (!res.ok) throw new Error(`刷新服务失败 (${res.status})`)
    const data = await res.json()
    if (data.card) return data.card
    if (data.cards && Array.isArray(data.cards)) {
      const found = data.cards.find((c: any) => c.provider === provider)
      if (found) return found
    }
    return data
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
