import { windowQuotaKind, isQuantified } from '../core/types.ts'
import type { QuotaKind } from '../core/types.ts'

export { windowQuotaKind, isQuantified }
export type { QuotaKind }

export type ProviderCategory = 'ide' | 'domestic_llm' | 'official_cloud' | 'custom_api'
export type ProxyMode = 'direct' | 'proxy-required' | 'proxy-preferred'

export interface MetricWindow {
  id: string
  label: string
  subtitle?: string
  /** Absent unless the upstream reports a real quota ratio — never synthesize 0/100. */
  usedPercent?: number
  /** Absent under the same rule as `usedPercent`. */
  remainingPercent?: number
  /** What this window measures; resolve legacy windows with `windowQuotaKind()`. */
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
  codex?: { enabled?: boolean; autoDetectLocal?: boolean; oauth?: any; name?: string; syncLocalAuth?: boolean }
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

/** Header the host requires on every `/api/dsh-quota/*` request. */
export const QUOTA_REQUEST_HEADER = 'X-DSH-Quota'
/** Hard timeout for every client request so a half-open connection cannot hang the UI. */
export const REQUEST_TIMEOUT_MS = 8000

export interface ResolveApiBaseInput {
  /** Injectable global for DOM-free tests. Defaults to `globalThis`. */
  global?: { __DSH_TRANSPORT__?: { streamBaseUrl?: unknown } } | undefined
  /** Injectable document base URI for DOM-free tests. Defaults to `document.baseURI`. */
  baseURI?: string | undefined
}

/**
 * Resolve the base all quota requests are relative to.
 *
 * Desktop injects `globalThis.__DSH_TRANSPORT__.streamBaseUrl`; the web shell
 * serves the plugin from the document origin. Keeping this single sourced keeps
 * absolute `/api/dsh-quota/*` paths from 404-ing when the two differ.
 */
export function resolveApiBase(input: ResolveApiBaseInput = {}): string {
  const hasOwn = (key: string): boolean => Object.prototype.hasOwnProperty.call(input, key)
  const g = hasOwn('global')
    ? input.global
    : (typeof globalThis === 'undefined' ? undefined : (globalThis as any))
  const transportBase = g?.__DSH_TRANSPORT__?.streamBaseUrl
  if (typeof transportBase === 'string' && transportBase.trim() !== '') return transportBase.trim()

  const baseURI = hasOwn('baseURI')
    ? input.baseURI
    : (typeof document === 'undefined' ? undefined : document.baseURI)
  if (typeof baseURI === 'string' && baseURI.trim() !== '') return baseURI.trim()
  return '/'
}

/** Resolve a relative quota path (e.g. `api/dsh-quota/status`) against the base. */
export function resolveApiUrl(path: string, input: ResolveApiBaseInput = {}): string {
  const relative = path.replace(/^\/+/, '')
  const base = resolveApiBase(input)
  try {
    const normalized = base.endsWith('/') ? base : `${base}/`
    return new URL(relative, normalized).href
  } catch {
    return `/${relative}`
  }
}

/** Encode text for safe interpolation into view markup. */
export function escapeHtmlText(value: unknown): string {
  if (value === undefined || value === null) return ''
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

/**
 * Escape server- and response-derived card text once, at the boundary.
 *
 * The panel composes long-lived markup with these strings; escaping here keeps
 * remote values (account e-mail, upstream error bodies, upstream group labels)
 * from reaching innerHTML unescaped, without touching user-owned labels twice.
 */
export function escapeCardText(card: AuthCardItem): AuthCardItem {
  return {
    ...card,
    name: escapeHtmlText(card.name),
    plan: card.plan === undefined ? undefined : escapeHtmlText(card.plan),
    account: card.account === undefined ? undefined : escapeHtmlText(card.account),
    error: card.error === undefined ? undefined : escapeHtmlText(card.error),
    groups: (card.groups || []).map(group => ({
      ...group,
      title: escapeHtmlText(group.title),
      windows: (group.windows || []).map(win => ({
        ...win,
        label: escapeHtmlText(win.label),
        subtitle: win.subtitle === undefined ? undefined : escapeHtmlText(win.subtitle),
        amountText: win.amountText === undefined ? undefined : escapeHtmlText(win.amountText),
      })),
    })),
  }
}

/**
 * Single request entry point: transport base, no-store, hard timeout and the
 * host's CSRF header applied exactly once for every client call.
 */
async function quotaFetch(path: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers)
  headers.set(QUOTA_REQUEST_HEADER, '1')
  const requestInit: RequestInit = {
    ...init,
    headers,
    cache: 'no-store',
  }
  if (init.signal === undefined) {
    requestInit.signal = AbortSignal.timeout(REQUEST_TIMEOUT_MS)
  } else {
    requestInit.signal = init.signal
  }
  try {
    return await fetch(resolveApiUrl(path), requestInit)
  } catch (err: any) {
    if (init.signal === undefined && (err?.name === 'TimeoutError' || err?.name === 'AbortError')) {
      throw new Error(`额度接口请求超时（${Math.round(REQUEST_TIMEOUT_MS / 1000)} 秒未响应）`)
    }
    throw new Error(`无法连接额度接口：${err?.message || String(err)}`)
  }
}

export class QuotaClientApi {
  async getCards(force = false): Promise<{
    cards: AuthCardItem[]
    allCards?: AuthCardItem[]
    alarms?: QuotaAlarm[]
    lastUpdated: number
  }> {
    const res = await quotaFetch(`api/dsh-quota/status?force=${force}`)
    if (!res.ok) throw new Error(`获取额度失败 (${res.status})`)
    return res.json()
  }

  async refreshSingle(providerOrId: string): Promise<AuthCardItem> {
    const res = await quotaFetch(`api/dsh-quota/status?provider=${encodeURIComponent(providerOrId)}&force=true`)
    if (!res.ok) throw new Error(`刷新服务失败 (${res.status})`)
    const data = await res.json()
    if (data && data.card) return data.card
    if (data && Array.isArray(data.cards)) {
      const found = data.cards.find((c: any) => c.id === providerOrId || c.provider === providerOrId)
      if (found) return found
    }
    // A missing card is an error, never a fallback value: writing `{ok:true}` into
    // the card list used to break the next render tick.
    throw new Error(`未找到服务「${providerOrId}」的额度数据，可能已被删除、改名或禁用`)
  }

  async testConnection(provider: string, accountConfig?: AccountConfigItem): Promise<TestConnectionResult> {
    const res = await quotaFetch('api/dsh-quota/test-connection', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider, accountConfig }),
    })
    if (!res.ok) throw new Error(`测活请求失败 (${res.status})`)
    return res.json()
  }

  async testAllConnections(): Promise<Record<string, TestConnectionResult>> {
    const res = await quotaFetch('api/dsh-quota/test-all', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
    if (!res.ok) throw new Error(`一键测活失败 (${res.status})`)
    const data = await res.json()
    return data.results || {}
  }

  async getHistory(instanceId: string, days = 7): Promise<QuotaHistoryPoint[]> {
    const res = await quotaFetch(`api/dsh-quota/history?instanceId=${encodeURIComponent(instanceId)}&days=${days}`)
    if (!res.ok) return []
    const data = await res.json()
    return data.points || []
  }

  async getConfig(): Promise<QuotaConfig> {
    const res = await quotaFetch('api/dsh-quota/config')
    if (!res.ok) throw new Error(`获取配置失败 (${res.status})`)
    return res.json()
  }

  async saveConfig(cfg: QuotaConfig): Promise<void> {
    const res = await quotaFetch('api/dsh-quota/config', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(cfg),
    })
    if (!res.ok) throw new Error(`保存配置失败 (${res.status})`)
  }

  async startCodexLogin(): Promise<string> {
    const res = await quotaFetch('api/dsh-quota/auth/codex/start')
    if (!res.ok) throw new Error(`启动 Codex 登录失败 (${res.status})`)
    const data = await res.json()
    return data.authUrl
  }

  async startAntigravityLogin(): Promise<string> {
    const res = await quotaFetch('api/dsh-quota/auth/antigravity/start')
    if (!res.ok) throw new Error(`启动 Antigravity 登录失败 (${res.status})`)
    const data = await res.json()
    return data.authUrl
  }

  async connectCursor(): Promise<AuthCardItem | undefined> {
    // POST routes require an application/json content type (anti-CSRF preflight).
    const res = await quotaFetch('api/dsh-quota/auth/cursor/connect', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
    })
    if (!res.ok) throw new Error(`连接 Cursor 失败 (${res.status})`)
    const data = await res.json()
    return data.card
  }
}
