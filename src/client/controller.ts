import type { AuthCardItem, QuotaConfig, QuotaClientApi } from './api.ts'

export type Listener = () => void

export const DEFAULT_PROVIDER_ORDER = ['antigravity', 'cursor', 'codex', 'opencode_go']

export interface PanelSnapshot {
  panelOpen: boolean
  loading: boolean
  error?: string
  cards: AuthCardItem[]
  allCards: AuthCardItem[]
  refreshingProviders: Set<string>
  lastUpdated: number
  activeTab: 'overview' | 'settings'
  config?: QuotaConfig
}

export class QuotaController {
  private api: QuotaClientApi
  private panelOpen = false
  private loading = false
  private error?: string
  private cards: AuthCardItem[] = []
  private allCards: AuthCardItem[] = []
  private refreshingProviders = new Set<string>()
  private lastUpdated = 0
  private activeTab: 'overview' | 'settings' = 'overview'
  private config?: QuotaConfig
  private listeners = new Set<Listener>()

  constructor(api: QuotaClientApi) {
    this.api = api
  }

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit(): void {
    for (const l of this.listeners) l()
  }

  getSnapshot(): PanelSnapshot {
    const cfg = this.config
    const orderList = cfg?.providerOrder && cfg.providerOrder.length > 0 ? cfg.providerOrder : DEFAULT_PROVIDER_ORDER
    const enabledSet = cfg?.enabledProviders ? new Set(cfg.enabledProviders) : null

    // Filter cards to display
    let visibleCards = this.cards
    if (enabledSet) {
      visibleCards = visibleCards.filter(c => enabledSet.has(c.provider) && (cfg as any)?.[c.provider]?.enabled !== false)
    } else if (cfg) {
      visibleCards = visibleCards.filter(c => (cfg as any)?.[c.provider]?.enabled !== false)
    }

    // Sort cards according to orderList
    visibleCards.sort((a, b) => {
      const idxA = orderList.indexOf(a.provider)
      const idxB = orderList.indexOf(b.provider)
      return (idxA === -1 ? 999 : idxA) - (idxB === -1 ? 999 : idxB)
    })

    return {
      panelOpen: this.panelOpen,
      loading: this.loading,
      error: this.error,
      cards: visibleCards,
      allCards: this.allCards.length > 0 ? this.allCards : this.cards,
      refreshingProviders: new Set(this.refreshingProviders),
      lastUpdated: this.lastUpdated,
      activeTab: this.activeTab,
      config: this.config,
    }
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

  async refresh(force = false): Promise<void> {
    this.loading = true
    this.error = undefined
    this.emit()
    try {
      const data = await this.api.getCards(force)
      this.cards = data.cards
      this.allCards = data.allCards || data.cards
      this.lastUpdated = data.lastUpdated
    } catch (err: any) {
      this.error = err.message
    } finally {
      this.loading = false
      this.emit()
    }
  }

  async refreshSingle(provider: string): Promise<void> {
    this.refreshingProviders.add(provider)
    this.emit()
    try {
      const updatedCard = await this.api.refreshSingle(provider)
      if (updatedCard) {
        const idx = this.cards.findIndex(c => c.provider === provider)
        if (idx !== -1) this.cards[idx] = updatedCard
        const allIdx = this.allCards.findIndex(c => c.provider === provider)
        if (allIdx !== -1) this.allCards[allIdx] = updatedCard
        this.lastUpdated = Date.now()
      }
    } catch (err: any) {
      this.error = err.message
    } finally {
      this.refreshingProviders.delete(provider)
      this.emit()
    }
  }

  async loadConfig(): Promise<void> {
    try {
      this.config = await this.api.getConfig()
      this.emit()
    } catch {}
  }

  async saveConfig(cfg: QuotaConfig): Promise<void> {
    const previousConfig = this.config
    this.config = cfg
    this.loading = true
    this.emit()
    try {
      await this.api.saveConfig(cfg)
      await this.refresh(true)
    } catch (err: any) {
      this.config = previousConfig
      this.error = err.message
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
