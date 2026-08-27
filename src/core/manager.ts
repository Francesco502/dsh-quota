import type { QuotaConfig, AuthCardItem, IQuotaProvider, AccountConfigItem, TestConnectionResult, QuotaAlarm, ModelRouteRecommendation, QuotaSparklinePoint } from './types.ts'
import { getRefreshIntervalSeconds } from './types.ts'
import { CursorProvider } from '../providers/cursor.ts'
import { CodexProvider } from '../providers/codex.ts'
import { AntigravityProvider } from '../providers/antigravity.ts'
import { OpenCodeGoProvider } from '../providers/opencode-go.ts'
import { DeepSeekProvider } from '../providers/deepseek.ts'
import { GitHubCopilotProvider } from '../providers/copilot.ts'
import { OpenAIBillingProvider } from '../providers/openai-billing.ts'
import { ClaudeProvider } from '../providers/claude.ts'
import { KimiProvider } from '../providers/kimi.ts'
import { GLMProvider } from '../providers/glm.ts'
import { MiniMaxProvider } from '../providers/minimax.ts'
import { QwenProvider } from '../providers/qwen.ts'
import { VolcengineProvider } from '../providers/volcengine.ts'
import { CustomApiProvider } from '../providers/custom-api.ts'
import { OAuthManager } from './oauth.ts'
import { QuotaHistoryManager } from './history.ts'
import { QuotaAlarmDetector } from './alarm.ts'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'

export const DEFAULT_PROVIDER_ORDER = [
  'deepseek',
  'antigravity',
  'cursor',
  'codex',
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

interface CacheEntry {
  card: AuthCardItem
  fetchedAt: number
}

export class QuotaManager {
  private providers: Map<string, IQuotaProvider> = new Map()
  public oauthManager = new OAuthManager()
  public historyManager = new QuotaHistoryManager()
  public alarmDetector = new QuotaAlarmDetector()

  private cardCache: Map<string, CacheEntry> = new Map()
  private configPath: string
  private config: QuotaConfig = {}

  constructor() {
    this.registerDefaultProviders()
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

  private registerDefaultProviders(): void {
    const list: IQuotaProvider[] = [
      new DeepSeekProvider(),
      new AntigravityProvider(),
      new CursorProvider(),
      new CodexProvider(),
      new GitHubCopilotProvider(),
      new OpenAIBillingProvider(),
      new ClaudeProvider(),
      new KimiProvider(),
      new GLMProvider(),
      new MiniMaxProvider(),
      new QwenProvider(),
      new VolcengineProvider(),
      new OpenCodeGoProvider(),
      new CustomApiProvider(),
    ]
    for (const p of list) {
      this.providers.set(p.name, p)
    }
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
        if (typeof this.config.refreshIntervalSeconds !== 'number' || this.config.refreshIntervalSeconds <= 0) {
          this.config.refreshIntervalSeconds = 60
        }
        if (typeof this.config.alarmThresholdPercent !== 'number') {
          this.config.alarmThresholdPercent = 15
        }
      } else {
        this.config = {
          deepseek: { enabled: true },
          cursor: { enabled: true, autoDetectLocal: true },
          antigravity: { enabled: true, autoDetectLocal: true },
          codex: { enabled: true, autoDetectLocal: true },
          github_copilot: { enabled: true, autoDetectLocal: true },
          openai_billing: { enabled: false },
          claude: { enabled: false },
          kimi: { enabled: false },
          glm: { enabled: false },
          minimax: { enabled: false },
          qwen: { enabled: false },
          volcengine: { enabled: false },
          opencode_go: { enabled: true },
          enabledProviders: ['deepseek', 'antigravity', 'cursor', 'codex', 'github_copilot', 'opencode_go'],
          providerOrder: DEFAULT_PROVIDER_ORDER,
          showFloatingHud: true,
          refreshIntervalSeconds: 60,
          alarmThresholdPercent: 15,
          enableNotification: true,
        }
        this.saveConfig(this.config)
      }
    } catch {
      this.config = {
        deepseek: { enabled: true },
        cursor: { enabled: true, autoDetectLocal: true },
        antigravity: { enabled: true, autoDetectLocal: true },
        codex: { enabled: true, autoDetectLocal: true },
        github_copilot: { enabled: true, autoDetectLocal: true },
        opencode_go: { enabled: true },
        enabledProviders: ['deepseek', 'antigravity', 'cursor', 'codex', 'github_copilot', 'opencode_go'],
        providerOrder: DEFAULT_PROVIDER_ORDER,
        showFloatingHud: true,
        refreshIntervalSeconds: 60,
        alarmThresholdPercent: 15,
        enableNotification: true,
      }
    }
    return this.config
  }

  saveConfig(newConfig: QuotaConfig): void {
    const current = this.config || {}
    const merged: QuotaConfig = {
      ...current,
      ...newConfig,
      deepseek: { ...current.deepseek, ...newConfig.deepseek },
      cursor: { ...current.cursor, ...newConfig.cursor },
      codex: { ...current.codex, ...newConfig.codex },
      antigravity: { ...current.antigravity, ...newConfig.antigravity },
      github_copilot: { ...current.github_copilot, ...newConfig.github_copilot },
      openai_billing: { ...current.openai_billing, ...newConfig.openai_billing },
      claude: { ...current.claude, ...newConfig.claude },
      kimi: { ...current.kimi, ...newConfig.kimi },
      glm: { ...current.glm, ...newConfig.glm },
      minimax: { ...current.minimax, ...newConfig.minimax },
      qwen: { ...current.qwen, ...newConfig.qwen },
      volcengine: { ...current.volcengine, ...newConfig.volcengine },
      opencode_go: { ...current.opencode_go, ...newConfig.opencode_go },
      custom_compatible: newConfig.custom_compatible || current.custom_compatible,
      accounts: newConfig.accounts || current.accounts,
    }

    if (newConfig.enabledProviders) {
      const enabled = new Set(newConfig.enabledProviders)
      for (const p of DEFAULT_PROVIDER_ORDER) {
        const providerConfig = (merged as any)[p] || {}
        ;(merged as any)[p] = { ...providerConfig, enabled: enabled.has(p) }
      }
    }

    this.config = merged
    this.cardCache.clear()
    try {
      writeFileSync(this.configPath, JSON.stringify(this.config, null, 2), { encoding: 'utf8', mode: 0o600 })
    } catch {}
  }

  getConfig(): QuotaConfig {
    return this.config
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

  public buildInstanceTasks(): Array<{ id: string; providerName: string; accountConfig?: AccountConfigItem }> {
    const tasks: Array<{ id: string; providerName: string; accountConfig?: AccountConfigItem }> = []

    // 1. Explicit multi-accounts list
    if (this.config.accounts && this.config.accounts.length > 0) {
      for (const acc of this.config.accounts) {
        if (acc.enabled !== false) {
          tasks.push({
            id: acc.id,
            providerName: acc.provider,
            accountConfig: acc,
          })
        }
      }
    }

    // 2. Custom compatible APIs (OneAPI / NewAPI)
    if (this.config.custom_compatible && Array.isArray(this.config.custom_compatible)) {
      for (const cust of this.config.custom_compatible) {
        if (cust.enabled !== false && cust.apiKey) {
          tasks.push({
            id: cust.id,
            providerName: 'custom_api',
            accountConfig: {
              id: cust.id,
              provider: 'custom_api',
              name: cust.name,
              apiKey: cust.apiKey,
              baseUrl: cust.baseUrl,
            },
          })
        }
      }
    }

    // 3. Default single instances from standard config
    for (const [pName] of this.providers.entries()) {
      if (pName === 'custom_api') continue
      // Only add if not already covered in accounts
      const existsInAccounts = tasks.some(t => t.id === pName)
      if (!existsInAccounts) {
        const provCfg = (this.config as any)[pName]
        if (provCfg && provCfg.enabled !== false) {
          tasks.push({
            id: pName,
            providerName: pName,
          })
        }
      }
    }

    return tasks
  }

  private generateSparkline(instanceId: string, currentRem: number): QuotaSparklinePoint[] {
    const trend = this.historyManager.getTrendPoints(instanceId, 7)
    if (trend.length === 0) {
      const now = Date.now()
      return [
        { t: now - 3 * 86400000, r: currentRem },
        { t: now - 86400000, r: currentRem },
        { t: now, r: currentRem },
      ]
    }

    // Sample to max 12 points
    const step = Math.max(1, Math.floor(trend.length / 12))
    const points: QuotaSparklinePoint[] = []
    for (let i = 0; i < trend.length; i += step) {
      const pt = trend[i]!
      points.push({ t: pt.timestamp, r: pt.remainingPercent })
    }
    const last = trend[trend.length - 1]!
    if (!points.some(p => p.t === last.timestamp)) {
      points.push({ t: last.timestamp, r: currentRem })
    }
    return points
  }

  async getQuotaCards(forceRefresh = false): Promise<{
    cards: AuthCardItem[]
    allCards: AuthCardItem[]
    alarms: QuotaAlarm[]
    lastUpdated: number
  }> {
    const intervalSec = getRefreshIntervalSeconds(this.config)
    const ttl = Math.max(5000, intervalSec * 1000)
    const now = Date.now()

    const tasks = this.buildInstanceTasks()
    const fetchPromises = tasks.map(async ({ id, providerName, accountConfig }) => {
      const cached = this.cardCache.get(id)
      if (!forceRefresh && cached && (now - cached.fetchedAt) < ttl) {
        return cached.card
      }

      const provider = this.providers.get(providerName)
      if (!provider) return null

      try {
        const result = await provider.fetchCard(this.config, accountConfig)
        const card = result.card
        // Calculate burn rate & estimated hours
        const remPercent = card.groups[0]?.windows[0]?.remainingPercent ?? 100
        const { burnRatePerHour, estimatedHoursLeft } = this.historyManager.calculateBurnRate(id, remPercent)
        card.burnRatePerHour = burnRatePerHour
        card.estimatedHoursLeft = estimatedHoursLeft
        card.sparkline = this.generateSparkline(id, remPercent)

        this.cardCache.set(id, { card, fetchedAt: now })
        return card
      } catch (err: any) {
        const errCard: AuthCardItem = {
          id,
          name: accountConfig?.name || provider.name,
          provider: providerName,
          category: provider.category,
          status: 'error',
          error: err.message,
          groups: [],
          lastUpdated: now,
        }
        this.cardCache.set(id, { card: errCard, fetchedAt: now })
        return errCard
      }
    })

    const settled = await Promise.allSettled(fetchPromises)
    const allCards: AuthCardItem[] = []
    for (const r of settled) {
      if (r.status === 'fulfilled' && r.value) {
        allCards.push(r.value)
      }
    }

    // Save history snapshots
    this.historyManager.recordSnapshots(allCards)

    // Detect alarms
    const alarms = this.alarmDetector.detectAlarms(allCards, this.config.alarmThresholdPercent ?? 15)

    // Sort & filter according to order
    const orderList = this.config.providerOrder ?? DEFAULT_PROVIDER_ORDER
    const enabledSet = new Set(this.config.enabledProviders ?? DEFAULT_PROVIDER_ORDER)

    const visibleCards = allCards.filter(c => {
      if (enabledSet.has(c.provider) && (this.config as any)[c.provider]?.enabled !== false) return true
      if (c.provider === 'custom_api') return true
      return false
    })

    visibleCards.sort((a, b) => {
      const idxA = orderList.indexOf(a.provider)
      const idxB = orderList.indexOf(b.provider)
      return (idxA === -1 ? 999 : idxA) - (idxB === -1 ? 999 : idxB)
    })

    return {
      cards: visibleCards,
      allCards,
      alarms,
      lastUpdated: now,
    }
  }

  async refreshSingleProvider(instanceOrProvider: string): Promise<AuthCardItem | undefined> {
    const tasks = this.buildInstanceTasks()
    const task = tasks.find(t => t.id === instanceOrProvider || t.providerName === instanceOrProvider)
    if (!task) return undefined

    const provider = this.providers.get(task.providerName)
    if (!provider) return undefined

    try {
      const res = await provider.fetchCard(this.config, task.accountConfig)
      const card = res.card
      const remPercent = card.groups[0]?.windows[0]?.remainingPercent ?? 100
      const { burnRatePerHour, estimatedHoursLeft } = this.historyManager.calculateBurnRate(task.id, remPercent)
      card.burnRatePerHour = burnRatePerHour
      card.estimatedHoursLeft = estimatedHoursLeft
      card.sparkline = this.generateSparkline(task.id, remPercent)

      this.cardCache.set(task.id, { card, fetchedAt: Date.now() })
      this.historyManager.recordSnapshots([card])
      return card
    } catch {
      return undefined
    }
  }

  async testConnection(providerName: string, accountConfig?: AccountConfigItem): Promise<TestConnectionResult> {
    const provider = this.providers.get(providerName)
    if (!provider) {
      return {
        ok: false,
        provider: providerName,
        message: `未知服务提供商: ${providerName}`,
      }
    }

    if (typeof provider.testConnection === 'function') {
      return provider.testConnection(this.config, accountConfig)
    }

    // Default test via fetchCard
    try {
      const start = Date.now()
      const res = await provider.fetchCard(this.config, accountConfig)
      const latencyMs = Date.now() - start
      if (res.card.status === 'ok' || res.card.status === 'warn') {
        return {
          ok: true,
          provider: providerName,
          latencyMs,
          account: res.card.account,
          message: `连接成功 (延迟: ${latencyMs}ms)`,
        }
      }
      return {
        ok: false,
        provider: providerName,
        latencyMs,
        message: res.card.error || '连接失败',
      }
    } catch (err: any) {
      return {
        ok: false,
        provider: providerName,
        message: `测试异常: ${err.message}`,
      }
    }
  }

  async testAllConnections(): Promise<Record<string, TestConnectionResult>> {
    const tasks = this.buildInstanceTasks()
    for (const pName of this.providers.keys()) {
      if (!tasks.some(t => t.id === pName || t.providerName === pName)) {
        tasks.push({ id: pName, providerName: pName })
      }
    }
    const results: Record<string, TestConnectionResult> = {}

    const promises = tasks.map(async (t) => {
      const res = await this.testConnection(t.providerName, t.accountConfig)
      results[t.id] = res
    })

    await Promise.allSettled(promises)
    return results
  }

  /**
   * Structured summary and intelligent model routing recommendations for DSH Agent Tool calls
   */
  async getAgentQuotaSummary(providerName?: string, forceRefresh = false): Promise<any> {
    const { cards, alarms, lastUpdated } = await this.getQuotaCards(forceRefresh)
    const targetCards = providerName
      ? cards.filter(c => c.provider.toLowerCase().includes(providerName.toLowerCase()) || c.id.toLowerCase().includes(providerName.toLowerCase()))
      : cards

    // Build intelligent routing recommendation
    const healthyServices = cards.filter(c => c.status === 'ok')
    const warningServices = cards.filter(c => c.status === 'warn')

    let recommendation: ModelRouteRecommendation
    if (healthyServices.length > 0) {
      const primary = healthyServices.find(c => c.provider === 'deepseek') || healthyServices[0]!
      const fallbacks = healthyServices.filter(c => c.id !== primary.id).slice(0, 3).map(c => ({
        provider: c.provider,
        name: c.name,
        reason: '健康在线，可用额度充足',
      }))
      recommendation = {
        primaryModel: primary.name,
        primaryProvider: primary.provider,
        status: 'healthy',
        reason: `首选 ${primary.name}（额度正常 · 可用）`,
        fallbackRoutes: fallbacks,
      }
    } else if (warningServices.length > 0) {
      const primary = warningServices[0]!
      recommendation = {
        primaryModel: primary.name,
        primaryProvider: primary.provider,
        status: 'warning',
        reason: `首选 ${primary.name} 额度已低于警戒线，建议谨慎执行高消耗长任务`,
        fallbackRoutes: [],
      }
    } else {
      recommendation = {
        primaryModel: 'none',
        primaryProvider: 'none',
        status: 'exhausted',
        reason: '当前所有已配置 AI 服务均处于未连接或异常状态，请在额度监控中配置有效凭据',
        fallbackRoutes: [],
      }
    }

    return {
      success: true,
      lastUpdated: new Date(lastUpdated).toLocaleString('zh-CN'),
      alarmCount: alarms.length,
      alarms: alarms.map(a => ({ level: a.level, name: a.name, message: a.message })),
      recommendation,
      services: targetCards.map(c => ({
        id: c.id,
        name: c.name,
        provider: c.provider,
        category: c.category,
        status: c.status,
        plan: c.plan,
        account: c.account,
        error: c.error,
        balance: c.balance,
        burnRatePerHour: c.burnRatePerHour ? `${c.burnRatePerHour}%/h` : undefined,
        estimatedHoursLeft: c.estimatedHoursLeft ? `${c.estimatedHoursLeft} 小时` : undefined,
        quotas: c.groups.map(g => ({
          group: g.title,
          windows: g.windows.map(w => ({
            label: w.label,
            remaining: `${w.remainingPercent}%`,
            used: `${w.usedPercent}%`,
            subtitle: w.subtitle,
          })),
        })),
      })),
    }
  }
}
