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
import { SiliconFlowProvider } from '../providers/siliconflow.ts'
import { OpenRouterProvider } from '../providers/openrouter.ts'
import { CustomApiProvider } from '../providers/custom-api.ts'
import { OAuthManager } from './oauth.ts'
import { QuotaHistoryManager } from './history.ts'
import { QuotaAlarmDetector } from './alarm.ts'
import { sanitizeProxyUrl } from './fetch.ts'
import { existsSync, readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { homedir } from 'node:os'
import { atomicWriteJsonSync } from './paths.ts'

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

export const PROVIDER_DEFAULT_MODELS: Record<string, { primaryId: string; available: string[]; role: string }> = {
  deepseek: {
    primaryId: 'deepseek-chat',
    available: ['deepseek-chat', 'deepseek-reasoner'],
    role: '长文本理解、通用代码生成与逻辑推理',
  },
  siliconflow: {
    primaryId: 'deepseek-ai/DeepSeek-V3',
    available: ['deepseek-ai/DeepSeek-V3', 'deepseek-ai/DeepSeek-R1', 'Qwen/Qwen2.5-Coder-32B-Instruct'],
    role: '国内高并发大模型推理中转',
  },
  openrouter: {
    primaryId: 'anthropic/claude-3.5-sonnet',
    available: ['anthropic/claude-3.5-sonnet', 'openai/gpt-4o', 'deepseek/deepseek-r1'],
    role: '海外顶尖全模型智能聚合路由',
  },
  antigravity: {
    primaryId: 'gemini-3.8-flash',
    available: ['gemini-3.8-flash', 'gemini-3.1-pro', 'gemini-4-argon', 'claude-sonnet-5-5', 'claude-opus-5-5'],
    role: '超长上下文、快速响应与高阶多模态分析',
  },
  cursor: {
    primaryId: 'claude-3.5-sonnet',
    available: ['claude-3.5-sonnet', 'cursor-small', 'gpt-4o'],
    role: 'IDE 本地编程补全与编辑',
  },
  codex: {
    primaryId: 'gpt-6.1-sol',
    available: ['gpt-6.1-sol', 'gpt-6-astra', 'gpt-6.1-terra', 'gpt-6-luna'],
    role: '深度复杂推理、代码架构与多轮长任务',
  },
  github_copilot: {
    primaryId: 'gpt-4o',
    available: ['gpt-4o', 'claude-3.5-sonnet'],
    role: '代码生成与上下文审查',
  },
  openai_billing: {
    primaryId: 'gpt-4o',
    available: ['gpt-4o', 'gpt-4o-mini', 'o3-mini'],
    role: 'OpenAI 官方 API 全量能力',
  },
  claude: {
    primaryId: 'claude-sonnet-5-5',
    available: ['claude-sonnet-5-5', 'claude-opus-5-5', 'claude-3-5-sonnet'],
    role: '高精度代码架构、深度逻辑推理与工程交付',
  },
  kimi: {
    primaryId: 'moonshot-v1-auto',
    available: ['moonshot-v1-auto', 'moonshot-v1-32k', 'moonshot-v1-128k'],
    role: '超长中文文档研读与知识检索',
  },
  glm: {
    primaryId: 'glm-4-flash',
    available: ['glm-4-flash', 'glm-4-plus', 'glm-4-air'],
    role: '中文高响应推理与轻量任务',
  },
  qwen: {
    primaryId: 'qwen-plus',
    available: ['qwen-plus', 'qwen-max', 'qwen-2.5-coder-32b-instruct'],
    role: '阿里云百炼中文大模型与代码基座',
  },
  minimax: {
    primaryId: 'MiniMax-Text-01',
    available: ['MiniMax-Text-01'],
    role: '通用中文对话与文本创作',
  },
  volcengine: {
    primaryId: 'doubao-pro-32k',
    available: ['doubao-pro-32k', 'doubao-lite-32k'],
    role: '火山方舟豆包高性价比推理',
  },
  opencode_go: {
    primaryId: 'opencode-go-default',
    available: ['opencode-go-default'],
    role: '算力共享与开源模型托管',
  },
  custom_api: {
    primaryId: 'gpt-4o',
    available: ['gpt-4o'],
    role: '自定义 OneAPI / NewAPI 渠道',
  },
}

/**
 * Executes async tasks with bounded concurrency to prevent socket exhaustion and rate limiting.
 */
export async function runWithConcurrency<T, R>(
  items: T[],
  fn: (item: T) => Promise<R>,
  limit = 5
): Promise<PromiseSettledResult<R>[]> {
  const results: PromiseSettledResult<R>[] = new Array(items.length)
  let nextIndex = 0

  async function worker(): Promise<void> {
    while (nextIndex < items.length) {
      const idx = nextIndex++
      const item = items[idx]!
      try {
        const val = await fn(item)
        results[idx] = { status: 'fulfilled', value: val }
      } catch (err) {
        results[idx] = { status: 'rejected', reason: err }
      }
    }
  }

  const workerCount = Math.min(Math.max(1, limit), items.length)
  const workers: Promise<void>[] = []
  for (let i = 0; i < workerCount; i++) {
    workers.push(worker())
  }
  await Promise.all(workers)
  return results
}

interface CacheEntry {
  card: AuthCardItem
  fetchedAt: number
}

function maskSecret(val?: string): string {
  if (!val) return ''
  const trimmed = String(val).trim()
  if (trimmed.length <= 8) return '••••••••'
  return `${trimmed.slice(0, 4)}••••${trimmed.slice(-4)}`
}

function restoreMaskedSecrets(incoming: any, existing: any): any {
  if (!incoming || typeof incoming !== 'object') return incoming
  if (!existing || typeof existing !== 'object') return incoming
  const res = Array.isArray(incoming) ? [...incoming] : { ...incoming }
  // Arrays of records (accounts / custom endpoints) are matched by `id`, never by index:
  // index matching would hand account B the masked secret of account A after a reorder.
  if (Array.isArray(incoming) && Array.isArray(existing)) {
    const byId = new Map<string, any>()
    for (const item of existing) {
      if (item && typeof item === 'object' && typeof item.id === 'string') byId.set(item.id, item)
    }
    return incoming.map((item: any) => {
      if (!item || typeof item !== 'object') return item
      const prev = typeof item.id === 'string' ? byId.get(item.id) : undefined
      return prev ? restoreMaskedSecrets(item, prev) : item
    })
  }
  for (const k of Object.keys(res)) {
    if (typeof res[k] === 'string' && (res[k] === '***' || res[k] === '••••••••' || res[k].includes('••••'))) {
      if (existing[k] !== undefined) {
        res[k] = existing[k]
      }
    } else if (typeof res[k] === 'object' && res[k] !== null) {
      res[k] = restoreMaskedSecrets(res[k], existing[k])
    }
  }
  return res
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
    const dshDir = process.env.DSH_HOME || join(homedir(), '.dsh')
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
      new SiliconFlowProvider(),
      new OpenRouterProvider(),
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
    const unmasked = restoreMaskedSecrets(newConfig, current)
    const merged: QuotaConfig = {
      ...current,
      ...unmasked,
      proxyMode: unmasked.proxyMode !== undefined ? unmasked.proxyMode : current.proxyMode,
      httpProxy: unmasked.httpProxy !== undefined ? unmasked.httpProxy : current.httpProxy,
      deepseek: { ...current.deepseek, ...unmasked.deepseek },
      cursor: { ...current.cursor, ...unmasked.cursor },
      codex: { ...current.codex, ...unmasked.codex },
      antigravity: { ...current.antigravity, ...unmasked.antigravity },
      github_copilot: { ...current.github_copilot, ...unmasked.github_copilot },
      openai_billing: { ...current.openai_billing, ...unmasked.openai_billing },
      claude: { ...current.claude, ...unmasked.claude },
      kimi: { ...current.kimi, ...unmasked.kimi },
      glm: { ...current.glm, ...unmasked.glm },
      minimax: { ...current.minimax, ...unmasked.minimax },
      qwen: { ...current.qwen, ...unmasked.qwen },
      volcengine: { ...current.volcengine, ...unmasked.volcengine },
      siliconflow: { ...current.siliconflow, ...unmasked.siliconflow },
      openrouter: { ...current.openrouter, ...unmasked.openrouter },
      opencode_go: { ...current.opencode_go, ...unmasked.opencode_go },
      custom_compatible: unmasked.custom_compatible !== undefined ? unmasked.custom_compatible : current.custom_compatible,
      accounts: unmasked.accounts !== undefined ? unmasked.accounts : current.accounts,
      enabledProviders: unmasked.enabledProviders !== undefined ? unmasked.enabledProviders : current.enabledProviders,
      floatingHudProviders: unmasked.floatingHudProviders !== undefined ? unmasked.floatingHudProviders : current.floatingHudProviders,
      floatingHudMetrics: unmasked.floatingHudMetrics !== undefined ? unmasked.floatingHudMetrics : current.floatingHudMetrics,
      providerOrder: unmasked.providerOrder !== undefined ? unmasked.providerOrder : current.providerOrder,
      customNames: (() => {
        if (unmasked.customNames === undefined) return current.customNames
        const combined = { ...(current.customNames || {}), ...unmasked.customNames }
        for (const [k, v] of Object.entries(combined)) {
          if (!v || !v.trim()) delete (combined as any)[k]
        }
        return combined
      })(),
    }

    this.config = merged
    this.cardCache.clear()
    atomicWriteJsonSync(this.configPath, this.config, 0o600)
  }

  getSafeConfig(): QuotaConfig {
    const copy: any = JSON.parse(JSON.stringify(this.config || {}))
    const keyProps = ['apiKey', 'sessionToken', 'token']
    if (typeof copy.httpProxy === 'string' && copy.httpProxy) {
      copy.httpProxy = sanitizeProxyUrl(copy.httpProxy)
    }
    for (const [k, v] of Object.entries(copy)) {
      if (v && typeof v === 'object' && !Array.isArray(v)) {
        for (const kp of keyProps) {
          if ((v as any)[kp]) (v as any)[kp] = maskSecret((v as any)[kp])
        }
        if ((v as any).oauth?.accessToken) (v as any).oauth.accessToken = maskSecret((v as any).oauth.accessToken)
        if ((v as any).oauth?.refreshToken) (v as any).oauth.refreshToken = maskSecret((v as any).oauth.refreshToken)
      }
    }
    if (Array.isArray(copy.custom_compatible)) {
      copy.custom_compatible = copy.custom_compatible.map((item: any) => ({
        ...item,
        apiKey: item.apiKey ? maskSecret(item.apiKey) : '',
      }))
    }
    if (Array.isArray(copy.accounts)) {
      copy.accounts = copy.accounts.map((item: any) => ({
        ...item,
        apiKey: item.apiKey ? maskSecret(item.apiKey) : undefined,
        sessionToken: item.sessionToken ? maskSecret(item.sessionToken) : undefined,
        oauth: item.oauth ? {
          ...item.oauth,
          accessToken: item.oauth.accessToken ? maskSecret(item.oauth.accessToken) : undefined,
          refreshToken: item.oauth.refreshToken ? maskSecret(item.oauth.refreshToken) : undefined,
        } : undefined,
      }))
    }
    return copy
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
      atomicWriteJsonSync(authPath, auth, 0o600)
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
              extra: { balancePath: cust.balancePath },
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

  private generateSparkline(instanceId: string, _currentRem: number): QuotaSparklinePoint[] {
    return this.historyManager.getUsageTrendPoints(instanceId, 7)
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
    const settled = await runWithConcurrency(tasks, async ({ id, providerName, accountConfig }) => {
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
        const rep = this.representativeWindow(card)
        const { burnRatePerHour, estimatedHoursLeft } = this.historyManager.calculateBurnRate(id, rep.remainingPercent)
        card.burnRatePerHour = burnRatePerHour
        card.estimatedHoursLeft = estimatedHoursLeft
        card.sparkline = this.generateSparkline(id, rep.remainingPercent)

        const customName = (this.config as any)[providerName]?.name || this.config.customNames?.[id] || this.config.customNames?.[providerName]
        if (customName) {
          card.name = customName
        }

        this.cardCache.set(id, { card, fetchedAt: now })
        return card
      } catch (err: any) {
        const customName = (this.config as any)[providerName]?.name || this.config.customNames?.[id] || this.config.customNames?.[providerName]
        const errCard: AuthCardItem = {
          id,
          name: customName || accountConfig?.name || provider.name,
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
    }, 5)

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
      if (c.status === 'disabled') return false
      const isEnabled = enabledSet.has(c.id) || enabledSet.has(c.provider)
      if (c.provider === 'custom_api') return isEnabled
      return isEnabled && (this.config as any)[c.provider]?.enabled !== false
    })

    visibleCards.sort((a, b) => {
      const idxA = orderList.indexOf(a.id) !== -1 ? orderList.indexOf(a.id) : orderList.indexOf(a.provider)
      const idxB = orderList.indexOf(b.id) !== -1 ? orderList.indexOf(b.id) : orderList.indexOf(b.provider)
      return (idxA === -1 ? 999 : idxA) - (idxB === -1 ? 999 : idxB)
    })

    return {
      cards: visibleCards,
      allCards,
      alarms,
      lastUpdated: now,
    }
  }

  /**
   * Pick one window to represent a card's short-cycle trend.
   *
   * Index 0 is server order, which changes when a new pool (e.g. Gemini 4 Argon)
   * appears; keeping a series on whatever happened to be first would splice two
   * incomparable pools into one burn-rate sample. Prefer an active, non-unknown
   * window and fall back to the first window that exists.
   */
  private representativeWindow(card: AuthCardItem): { remainingPercent: number; windowId?: string } {
    const all = card.groups.flatMap(g => g.windows)
    const preferred = all.find(w => w.status !== 'unknown' && w.status !== 'disabled' && w.remainingPercent > 0)
      ?? all.find(w => w.status !== 'unknown' && w.status !== 'disabled')
      ?? all[0]
    if (!preferred) return { remainingPercent: 100 }
    return { remainingPercent: preferred.remainingPercent, windowId: preferred.id }
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
      const rep = this.representativeWindow(card)
      const { burnRatePerHour, estimatedHoursLeft } = this.historyManager.calculateBurnRate(task.id, rep.remainingPercent)
      card.burnRatePerHour = burnRatePerHour
      card.estimatedHoursLeft = estimatedHoursLeft
      card.sparkline = this.generateSparkline(task.id, rep.remainingPercent)

      const customName = (this.config as any)[task.providerName]?.name || this.config.customNames?.[task.id] || this.config.customNames?.[task.providerName]
      if (customName) {
        card.name = customName
      }

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
    // Only instance tasks the user actually configured (provider enabled or account listed).
    // Never append disabled providers here: probing them can read local IDE/CLI credentials
    // the user explicitly switched off.
    const tasks = this.buildInstanceTasks()
    const results: Record<string, TestConnectionResult> = {}

    await runWithConcurrency(tasks, async (t) => {
      const res = await this.testConnection(t.providerName, t.accountConfig)
      results[t.id] = res
      return res
    }, 5)

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
      const primary = healthyServices.find(c => c.provider === 'deepseek')
        || healthyServices.find(c => c.provider === 'siliconflow')
        || healthyServices[0]!
      const meta = PROVIDER_DEFAULT_MODELS[primary.provider] || { primaryId: primary.provider, available: [primary.provider], role: '通用大模型' }
      const fallbacks = healthyServices.filter(c => c.id !== primary.id).slice(0, 4).map(c => {
        const fMeta = PROVIDER_DEFAULT_MODELS[c.provider] || { primaryId: c.provider, available: [c.provider], role: '备用模型' }
        return {
          provider: c.provider,
          modelId: fMeta.primaryId,
          name: `${c.name} (${fMeta.primaryId})`,
          reason: `${fMeta.role} · 额度充足健康在线`,
        }
      })
      recommendation = {
        primaryModel: `${primary.name} (${meta.primaryId})`,
        primaryModelId: meta.primaryId,
        primaryProvider: primary.provider,
        status: 'healthy',
        reason: `首选 ${primary.name} · 调用模型 ${meta.primaryId}（${meta.role} · 额度正常可用）`,
        availableModels: meta.available,
        fallbackRoutes: fallbacks,
      }
    } else if (warningServices.length > 0) {
      const primary = warningServices[0]!
      const meta = PROVIDER_DEFAULT_MODELS[primary.provider] || { primaryId: primary.provider, available: [primary.provider], role: '告警备用' }
      recommendation = {
        primaryModel: `${primary.name} (${meta.primaryId})`,
        primaryModelId: meta.primaryId,
        primaryProvider: primary.provider,
        status: 'warning',
        reason: `首选 ${primary.name} · 模型 ${meta.primaryId} 额度已低于警戒线，建议谨慎执行高消耗长任务`,
        availableModels: meta.available,
        fallbackRoutes: [],
      }
    } else {
      recommendation = {
        primaryModel: 'none',
        primaryModelId: 'none',
        primaryProvider: 'none',
        status: 'exhausted',
        reason: '当前所有已配置 AI 服务均处于未连接或异常状态，请在额度监控中配置有效凭据',
        availableModels: [],
        fallbackRoutes: [],
      }
    }

    return {
      success: true,
      lastUpdated: new Date(lastUpdated).toLocaleString('zh-CN'),
      alarmCount: alarms.length,
      alarms: alarms.map(a => ({ level: a.level, name: a.name, message: a.message })),
      recommendation,
      services: targetCards.map(c => {
        const modelMeta = PROVIDER_DEFAULT_MODELS[c.provider]
        return {
          id: c.id,
          name: c.name,
          provider: c.provider,
          modelId: modelMeta?.primaryId,
          availableModels: modelMeta?.available,
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
        }
      }),
    }
  }
}
