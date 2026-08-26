import type { QuotaConfig, AuthCardItem, IQuotaProvider } from './types.ts'
import { CursorProvider } from '../providers/cursor.ts'
import { CodexProvider } from '../providers/codex.ts'
import { AntigravityProvider } from '../providers/antigravity.ts'
import { OpenCodeGoProvider } from '../providers/opencode-go.ts'
import { OAuthManager } from './oauth.ts'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

const DEFAULT_PROVIDER_ORDER = ['antigravity', 'cursor', 'codex', 'opencode_go']

export class QuotaManager {
  private providers: IQuotaProvider[] = [
    new AntigravityProvider(),
    new CodexProvider(),
    new CursorProvider(),
    new OpenCodeGoProvider(),
  ]

  public oauthManager = new OAuthManager()
  private cachedCards: AuthCardItem[] = []
  private lastFetchTime = 0
  private configPath: string
  private config: QuotaConfig = {}

  constructor() {
    const home = homedir()
    const dshDir = join(home, '.dsh')
    if (!existsSync(dshDir)) {
      try {
        mkdirSync(dshDir, { recursive: true })
      } catch {}
    }
    this.configPath = join(dshDir, 'quota-config.json')
    this.loadConfig()
  }

  loadConfig(): QuotaConfig {
    try {
      if (existsSync(this.configPath)) {
        const raw = readFileSync(this.configPath, 'utf8')
        this.config = JSON.parse(raw)
        if (!this.config.enabledProviders) {
          this.config.enabledProviders = DEFAULT_PROVIDER_ORDER.filter(p => (this.config as any)[p]?.enabled !== false)
        }
        if (!this.config.providerOrder) {
          this.config.providerOrder = DEFAULT_PROVIDER_ORDER
        }
      } else {
        this.config = {
          cursor: { enabled: true, autoDetectLocal: true },
          codex: { enabled: true, autoDetectLocal: true },
          antigravity: { enabled: true, autoDetectLocal: true },
          opencode_go: { enabled: true },
          enabledProviders: ['antigravity', 'cursor', 'codex', 'opencode_go'],
          providerOrder: DEFAULT_PROVIDER_ORDER,
          showFloatingHud: true,
          refreshIntervalMinutes: 10,
        }
        this.saveConfig(this.config)
      }
    } catch {
      this.config = {
        cursor: { enabled: true, autoDetectLocal: true },
        codex: { enabled: true, autoDetectLocal: true },
        antigravity: { enabled: true, autoDetectLocal: true },
        opencode_go: { enabled: true },
        enabledProviders: ['antigravity', 'cursor', 'codex', 'opencode_go'],
        providerOrder: DEFAULT_PROVIDER_ORDER,
        showFloatingHud: true,
        refreshIntervalMinutes: 10,
      }
    }
    return this.config
  }

  saveConfig(newConfig: QuotaConfig): void {
    const current = this.config || {}
    const merged: QuotaConfig = {
      ...current,
      ...newConfig,
      cursor: { ...current.cursor, ...newConfig.cursor },
      codex: { ...current.codex, ...newConfig.codex },
      antigravity: { ...current.antigravity, ...newConfig.antigravity },
      opencode_go: { ...current.opencode_go, ...newConfig.opencode_go },
    }

    if (newConfig.enabledProviders) {
      const enabled = new Set(newConfig.enabledProviders)
      for (const p of DEFAULT_PROVIDER_ORDER) {
        const providerConfig = (merged as any)[p] || {}
        ;(merged as any)[p] = { ...providerConfig, enabled: enabled.has(p) }
      }
    }

    this.config = merged
    this.cachedCards = []
    try {
      writeFileSync(this.configPath, JSON.stringify(this.config, null, 2), { encoding: 'utf8', mode: 0o600 })
    } catch {}
  }

  saveCodexLogin(tokens: { accessToken: string; refreshToken?: string; accountId?: string }): void {
    const codexDir = join(homedir(), '.codex')
    const authPath = join(codexDir, 'auth.json')
    try {
      mkdirSync(codexDir, { recursive: true })
      let auth: { auth_mode?: string; tokens?: Record<string, string | undefined> } = {}
      if (existsSync(authPath)) {
        auth = JSON.parse(readFileSync(authPath, 'utf8'))
      }
      auth.auth_mode = 'chatgpt'
      auth.tokens = {
        ...auth.tokens,
        access_token: tokens.accessToken,
        ...(tokens.refreshToken ? { refresh_token: tokens.refreshToken } : {}),
        ...(tokens.accountId ? { account_id: tokens.accountId } : {}),
      }
      writeFileSync(authPath, JSON.stringify(auth, null, 2), { encoding: 'utf8', mode: 0o600 })
    } catch {}
  }

  getConfig(): QuotaConfig {
    return this.config
  }

  private sortAndFilterCards(cards: AuthCardItem[]): AuthCardItem[] {
    const enabledSet = new Set(this.config.enabledProviders ?? DEFAULT_PROVIDER_ORDER)
    const orderList = this.config.providerOrder ?? DEFAULT_PROVIDER_ORDER

    // Filter enabled
    const filtered = cards.filter(c => {
      if (!enabledSet.has(c.provider)) return false
      const provCfg = (this.config as any)[c.provider]
      if (provCfg && provCfg.enabled === false) return false
      return true
    })

    // Sort by orderList
    return filtered.sort((a, b) => {
      const idxA = orderList.indexOf(a.provider)
      const idxB = orderList.indexOf(b.provider)
      const weightA = idxA === -1 ? 999 : idxA
      const weightB = idxB === -1 ? 999 : idxB
      return weightA - weightB
    })
  }

  async getQuotaCards(forceRefresh = false): Promise<{ cards: AuthCardItem[]; allCards: AuthCardItem[]; lastUpdated: number }> {
    const ttl = (this.config.refreshIntervalMinutes ?? 10) * 60 * 1000
    const now = Date.now()

    if (!forceRefresh && this.cachedCards.length > 0 && (now - this.lastFetchTime) < ttl) {
      return {
        cards: this.sortAndFilterCards(this.cachedCards),
        allCards: this.cachedCards,
        lastUpdated: this.lastFetchTime,
      }
    }

    const results = await Promise.allSettled(
      this.providers.map(p => p.fetchCard(this.config))
    )

    const allCards: AuthCardItem[] = []
    for (const r of results) {
      if (r.status === 'fulfilled') {
        allCards.push(r.value.card)
      }
    }

    this.cachedCards = allCards
    this.lastFetchTime = now

    return {
      cards: this.sortAndFilterCards(allCards),
      allCards,
      lastUpdated: this.lastFetchTime,
    }
  }

  async refreshSingleProvider(providerName: string): Promise<AuthCardItem | undefined> {
    const provider = this.providers.find(p => p.name === providerName)
    if (!provider) return undefined

    try {
      const result = await provider.fetchCard(this.config)
      const idx = this.cachedCards.findIndex(c => c.provider === providerName)
      if (idx !== -1) {
        this.cachedCards[idx] = result.card
      } else {
        this.cachedCards.push(result.card)
      }
      return result.card
    } catch {
      return undefined
    }
  }
}
