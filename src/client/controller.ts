import type { AuthCardItem, QuotaConfig, QuotaClientApi, QuotaAlarm, ProviderCategory, TestConnectionResult, QuotaHistoryPoint, AccountConfigItem } from './api.ts'
import { getRefreshIntervalSeconds, escapeCardText } from './api.ts'

export type Listener = () => void

/** Turn any thrown value into a sentence the header can display. */
export function formatErrorForUi(err: unknown): string {
  if (err instanceof Error && err.message) return err.message
  if (typeof err === 'string' && err.trim() !== '') return err
  return '未知错误'
}

/**
 * Stable identity of a notified alarm. Includes the window so the same alarm can
 * fire again after it disappeared and came back, and so the key does not grow a
 * new variant every time the message embeds a changing number.
 */
export function alarmNotificationKey(alarm: Pick<QuotaAlarm, 'instanceId' | 'level' | 'windowId'>): string {
  return `${alarm.instanceId}_${alarm.level}_${alarm.windowId ?? ''}`
}

export const DEFAULT_PROVIDER_ORDER = [
  'deepseek',
  'antigravity',
  'cursor',
  'codex',
  'siliconflow',
  'openrouter',
  'github_copilot',
  'openai_billing',
  'claude',
  'kimi',
  'glm',
  'minimax',
  'qwen',
  'volcengine',
  'opencode_go',
  'custom_api',
]

export interface PanelSnapshot {
  panelOpen: boolean
  loading: boolean
  testingAll: boolean
  error?: string
  cards: AuthCardItem[]
  allCards: AuthCardItem[]
  alarms: QuotaAlarm[]
  testResults: Record<string, TestConnectionResult>
  refreshingProviders: Set<string>
  lastUpdated: number
  activeTab: 'overview' | 'settings'
  activeCategory: 'all' | ProviderCategory
  collapsedGroups: Set<string>
  config?: QuotaConfig
}

export class QuotaController {
  private api: QuotaClientApi
  private panelOpen = false
  private loading = false
  private testingAll = false
  private error?: string
  private cards: AuthCardItem[] = []
  private allCards: AuthCardItem[] = []
  private alarms: QuotaAlarm[] = []
  private testResults: Record<string, TestConnectionResult> = {}
  private refreshingProviders = new Set<string>()
  private lastUpdated = 0
  private activeTab: 'overview' | 'settings' = 'overview'
  private activeCategory: 'all' | ProviderCategory = 'all'
  private collapsedGroups = new Set<string>()
  private config?: QuotaConfig
  private listeners = new Set<Listener>()
  private pollingTimer: any = null
  private notifiedAlarmIds = new Set<string>()
  private onVisibilityChangeHandler?: () => void
  private onWindowFocusHandler?: () => void
  private isDestroyed = false
  /** The refresh currently on the wire; concurrent refresh() callers join it. */
  private inflight: Promise<void> | null = null

  constructor(api: QuotaClientApi) {
    this.api = api
  }

  async init(): Promise<void> {
    if (this.isDestroyed) return
    await this.loadConfig()
    if (this.isDestroyed) return
    await this.refresh(false)
    if (this.isDestroyed) return
    this.startPolling()
    this.setupWindowListeners()
  }

  getRefreshIntervalSec(): number {
    return getRefreshIntervalSeconds(this.config)
  }

  private isDocumentHidden(): boolean {
    if (typeof document === 'undefined') return false
    return document.hidden === true || document.visibilityState === 'hidden'
  }

  startPolling(): void {
    if (this.isDestroyed) return
    this.stopPolling()
    // No timer while the tab/window is hidden: the visibilitychange handler
    // restarts it and catches up if the data went stale meanwhile.
    if (this.isDocumentHidden()) return
    const intervalSec = this.getRefreshIntervalSec()
    const intervalMs = Math.max(5 * 1000, intervalSec * 1000)

    this.pollingTimer = setInterval(() => {
      if (this.isDestroyed) {
        this.stopPolling()
        return
      }
      if (this.isDocumentHidden()) return
      void this.refresh(false, true)
    }, intervalMs)
  }

  stopPolling(): void {
    if (this.pollingTimer) {
      clearInterval(this.pollingTimer)
      this.pollingTimer = null
    }
  }

  /** Silent catch-up when data is older than the interval (capped at 60s). */
  private refreshIfStale(): void {
    if (this.isDestroyed) return
    const intervalSec = this.getRefreshIntervalSec()
    const staleThresholdMs = Math.min(60 * 1000, intervalSec * 1000)
    if (Date.now() - this.lastUpdated >= staleThresholdMs) {
      void this.refresh(false, true)
    }
  }

  private setupWindowListeners(): void {
    if (this.isDestroyed) return
    if (typeof document === 'undefined' || typeof window === 'undefined') return
    if (this.onVisibilityChangeHandler) return

    this.onVisibilityChangeHandler = () => {
      if (this.isDestroyed) return
      if (this.isDocumentHidden()) {
        this.stopPolling()
        return
      }
      this.startPolling()
      this.refreshIfStale()
    }

    this.onWindowFocusHandler = () => {
      if (this.isDestroyed) return
      if (this.isDocumentHidden()) return
      this.refreshIfStale()
    }

    document.addEventListener('visibilitychange', this.onVisibilityChangeHandler)
    window.addEventListener('focus', this.onWindowFocusHandler)
  }

  /** Drop remembered alarms that are no longer active so the set stays bounded. */
  private pruneNotifiedAlarms(alarms: QuotaAlarm[]): void {
    const activeKeys = new Set(alarms.map(alarm => alarmNotificationKey(alarm)))
    for (const key of Array.from(this.notifiedAlarmIds)) {
      if (!activeKeys.has(key)) this.notifiedAlarmIds.delete(key)
    }
  }

  private triggerDesktopNotification(alarms: QuotaAlarm[]): void {
    if (this.isDestroyed) return
    if (typeof window === 'undefined' || !('Notification' in window)) return
    if (this.config?.enableNotification === false) return

    const criticalAlarms = alarms.filter(a => a.level === 'critical' && !this.notifiedAlarmIds.has(alarmNotificationKey(a)))
    if (criticalAlarms.length === 0) return

    const send = () => {
      for (const a of criticalAlarms) {
        try {
          new Notification('DSH 额度监控告警', {
            body: a.message,
            icon: '/favicon.ico',
          })
          this.notifiedAlarmIds.add(alarmNotificationKey(a))
        } catch {}
      }
    }

    if (Notification.permission === 'granted') {
      send()
    } else if (Notification.permission !== 'denied') {
      Notification.requestPermission().then(permission => {
        if (permission === 'granted') send()
      }).catch(() => {})
    }
  }

  destroy(): void {
    this.isDestroyed = true
    this.inflight = null
    this.stopPolling()
    if (typeof document !== 'undefined' && this.onVisibilityChangeHandler) {
      document.removeEventListener('visibilitychange', this.onVisibilityChangeHandler)
      this.onVisibilityChangeHandler = undefined
    }
    if (typeof window !== 'undefined' && this.onWindowFocusHandler) {
      window.removeEventListener('focus', this.onWindowFocusHandler)
      this.onWindowFocusHandler = undefined
    }
    this.listeners.clear()
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit(): void {
    for (const listener of Array.from(this.listeners)) {
      try {
        listener()
      } catch (err) {
        // One broken consumer (e.g. a render path hitting an unexpected card)
        // must never stop the remaining listeners or the polling loop.
        console.error('[dsh-quota] listener failed:', err)
      }
    }
  }

  getSnapshot(): PanelSnapshot {
    const cfg = this.config
    const orderList = cfg?.providerOrder && cfg.providerOrder.length > 0 ? cfg.providerOrder : DEFAULT_PROVIDER_ORDER
    const enabledSet = cfg?.enabledProviders ? new Set(cfg.enabledProviders) : null

    // Filter cards to display from allCards pool for instant reactivity
    const pool = this.allCards.length > 0 ? this.allCards : this.cards
    let visibleCards = pool
    if (this.activeCategory !== 'all') {
      visibleCards = visibleCards.filter(c => c.category === this.activeCategory)
    }

    if (enabledSet) {
      visibleCards = visibleCards.filter(c => {
        if (c.provider === 'custom_api') {
          return enabledSet.has(c.id)
        }
        return enabledSet.has(c.id) || enabledSet.has(c.provider)
      })
    }

    // Do not show disabled cards (cards without configured credentials) on dashboard
    visibleCards = visibleCards.filter(c => c.status !== 'disabled')

    visibleCards.sort((a, b) => {
      const idxA = orderList.indexOf(a.id) !== -1 ? orderList.indexOf(a.id) : orderList.indexOf(a.provider)
      const idxB = orderList.indexOf(b.id) !== -1 ? orderList.indexOf(b.id) : orderList.indexOf(b.provider)
      return (idxA === -1 ? 999 : idxA) - (idxB === -1 ? 999 : idxB)
    })

    return {
      panelOpen: this.panelOpen,
      loading: this.loading,
      testingAll: this.testingAll,
      error: this.error,
      cards: visibleCards,
      allCards: this.allCards.length > 0 ? this.allCards : this.cards,
      alarms: this.alarms,
      testResults: this.testResults,
      refreshingProviders: new Set(this.refreshingProviders),
      lastUpdated: this.lastUpdated,
      activeTab: this.activeTab,
      activeCategory: this.activeCategory,
      collapsedGroups: new Set(this.collapsedGroups),
      config: this.config,
    }
  }

  hasAlarms(): boolean {
    return this.alarms.length > 0 || this.cards.some(c => c.status === 'warn' || c.status === 'error')
  }

  open(): void {
    if (this.panelOpen) return
    this.panelOpen = true
    this.emit()
    void this.refresh()
    void this.loadConfig()
  }

  close(): void {
    if (!this.panelOpen) return
    this.panelOpen = false
    this.emit()
  }

  toggle(): void {
    if (this.panelOpen) this.close()
    else this.open()
  }

  setTab(tab: 'overview' | 'settings'): void {
    this.activeTab = tab
    this.emit()
  }

  setCategory(category: 'all' | ProviderCategory): void {
    this.activeCategory = category
    this.emit()
  }

  toggleGroupCollapse(groupId: string): void {
    if (this.collapsedGroups.has(groupId)) {
      this.collapsedGroups.delete(groupId)
    } else {
      this.collapsedGroups.add(groupId)
    }
    this.emit()
  }

  /**
   * Refresh cards, merging concurrent calls (polling + focus + manual refresh)
   * onto one in-flight request. `silent` only hides the loading indicator; a
   * failure is always recorded so the header can show "last updated + failed".
   */
  async refresh(force = false, silent = false): Promise<void> {
    if (this.inflight !== null) return this.inflight
    let tracked: Promise<void>
    tracked = this.performRefresh(force, silent).finally(() => {
      if (this.inflight === tracked) this.inflight = null
    })
    this.inflight = tracked
    return tracked
  }

  private async performRefresh(force: boolean, silent: boolean): Promise<void> {
    if (!silent) {
      this.loading = true
      this.error = undefined
      this.emit()
    }
    try {
      const data = await this.api.getCards(force)
      this.cards = (data.cards || []).map(escapeCardText)
      this.allCards = (data.allCards || data.cards || []).map(escapeCardText)
      // Alarms reach the OS notification body as plain text; escaping here would print
      // entities. Any future HTML surface must escape at its own render site.
      this.alarms = data.alarms || []
      if (typeof data.lastUpdated === 'number' && Number.isFinite(data.lastUpdated)) {
        this.lastUpdated = data.lastUpdated
      }
      this.error = undefined
      this.pruneNotifiedAlarms(this.alarms)
      this.triggerDesktopNotification(this.alarms)
    } catch (err: any) {
      // Silent polling failures must keep `error` and `lastUpdated` so the panel
      // can render "last updated hh:mm · refresh failed" instead of stale-as-fresh.
      this.error = formatErrorForUi(err)
    } finally {
      if (!silent) {
        this.loading = false
      }
      this.emit()
    }
  }

  async refreshSingle(providerOrId: string): Promise<void> {
    this.refreshingProviders.add(providerOrId)
    this.emit()
    try {
      const updatedCard = escapeCardText(await this.api.refreshSingle(providerOrId))
      const idx = this.cards.findIndex(c => c.id === providerOrId || c.provider === providerOrId)
      if (idx !== -1) this.cards[idx] = updatedCard
      const allIdx = this.allCards.findIndex(c => c.id === providerOrId || c.provider === providerOrId)
      if (allIdx !== -1) this.allCards[allIdx] = updatedCard
      this.lastUpdated = Date.now()
      this.error = undefined
    } catch (err: any) {
      this.error = formatErrorForUi(err)
    } finally {
      this.refreshingProviders.delete(providerOrId)
      this.emit()
    }
  }

  async testConnection(provider: string, accountConfig?: AccountConfigItem): Promise<TestConnectionResult> {
    const res = await this.api.testConnection(provider, accountConfig)
    this.testResults[accountConfig?.id || provider] = res
    this.emit()
    return res
  }

  async testAllConnections(): Promise<Record<string, TestConnectionResult>> {
    this.testingAll = true
    this.emit()
    try {
      const results = await this.api.testAllConnections()
      this.testResults = { ...this.testResults, ...results }
      return results
    } finally {
      this.testingAll = false
      this.emit()
    }
  }

  async getHistory(instanceId: string, days = 7): Promise<QuotaHistoryPoint[]> {
    return this.api.getHistory(instanceId, days)
  }

  async loadConfig(): Promise<void> {
    try {
      this.config = await this.api.getConfig()
      this.emit()
      this.startPolling()
    } catch (err: any) {
      this.error = formatErrorForUi(err)
      this.emit()
    }
  }

  async saveConfig(cfg: QuotaConfig): Promise<void> {
    const previousConfig = this.config
    this.config = cfg
    this.loading = true
    this.emit()
    try {
      await this.api.saveConfig(cfg)
      this.startPolling()
      await this.refresh(true)
    } catch (err: any) {
      this.config = previousConfig
      this.error = formatErrorForUi(err)
    } finally {
      this.loading = false
      this.emit()
    }
  }

  async startCodexLogin(): Promise<string> {
    return this.api.startCodexLogin()
  }

  async startAntigravityLogin(): Promise<string> {
    return this.api.startAntigravityLogin()
  }

  async connectCursor(): Promise<AuthCardItem | undefined> {
    return this.api.connectCursor()
  }
}
