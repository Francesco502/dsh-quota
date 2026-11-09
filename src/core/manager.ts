import type { QuotaConfig, AuthCardItem, IQuotaProvider, AccountConfigItem, TestConnectionResult, QuotaAlarm, ModelRouteRecommendation, QuotaSparklinePoint, MetricWindow, QuotaBalanceInfo } from './types.ts'
import { getRefreshIntervalSeconds, isQuantified, windowQuotaKind } from './types.ts'
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
import { existsSync, readFileSync, mkdirSync, renameSync, copyFileSync } from 'node:fs'
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

/**
 * Mask a configured secret for the browser DTO.
 *
 * Fixed-width bullets only: keeping the first/last four characters used to leak
 * eight real key characters through `GET /config`.
 */
function maskSecret(val?: string): string {
  if (!val) return ''
  return '••••••••'
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
  // A masked secret may only be replayed at the endpoint it was configured for.
  // Changing `baseUrl`/`provider` means the user must re-enter the key (audit A3):
  // otherwise an attacker could read a mask from /config, repoint baseUrl at their
  // own host and have the real key attached to the request.
  const identityChanged =
    (res.baseUrl !== undefined && existing.baseUrl !== undefined && res.baseUrl !== existing.baseUrl) ||
    (res.provider !== undefined && existing.provider !== undefined && res.provider !== existing.provider)

  for (const k of Object.keys(res)) {
    if (typeof res[k] === 'string' && (res[k] === '***' || res[k] === '••••••••' || res[k].includes('••••'))) {
      if (identityChanged) res[k] = ''
      else if (existing[k] !== undefined) res[k] = existing[k]
    } else if (typeof res[k] === 'object' && res[k] !== null) {
      res[k] = restoreMaskedSecrets(res[k], existing[k])
    }
  }
  return res
}


const SECRET_STRING_KEYS = ['apiKey', 'sessionToken', 'token', 'sessionKey'] as const

interface SecretBundle {
  providers: Record<string, Record<string, unknown>>
  accounts: Record<string, Record<string, unknown>>
  custom: Record<string, Record<string, unknown>>
  /** Proxy URL, which may embed `user:password@`. */
  proxy?: string
}

function emptyBundle(): SecretBundle {
  return { providers: {}, accounts: {}, custom: {} }
}

/**
 * Move every secret out of a config copy, returning both halves.
 *
 * `quota-config.json` is the file users screenshot, diff and paste into issues;
 * keeping live keys out of it is worth a second 0600 file next to it.
 */
function splitSecrets(config: QuotaConfig): { publicConfig: QuotaConfig; secrets: SecretBundle } {
  const publicConfig: any = JSON.parse(JSON.stringify(config || {}))
  const secrets = emptyBundle()

  const takeFrom = (target: any, store: Record<string, Record<string, unknown>>, bucket: string): void => {
    if (!target || typeof target !== 'object') return
    const found: Record<string, unknown> = {}
    for (const key of SECRET_STRING_KEYS) {
      if (typeof target[key] === 'string' && target[key]) {
        found[key] = target[key]
        delete target[key]
      }
    }
    if (target.oauth && typeof target.oauth === 'object') {
      const oauth: Record<string, unknown> = {}
      for (const key of ['accessToken', 'refreshToken', 'accountId']) {
        if (typeof target.oauth[key] === 'string' && target.oauth[key]) {
          oauth[key] = target.oauth[key]
          delete target.oauth[key]
        }
      }
      if (Object.keys(oauth).length > 0) found.oauth = oauth
    }
    if (Object.keys(found).length > 0) store[bucket] = found
  }

  if (typeof publicConfig.httpProxy === 'string' && publicConfig.httpProxy) {
    secrets.proxy = publicConfig.httpProxy
    delete publicConfig.httpProxy
  }

  for (const [name, value] of Object.entries(publicConfig)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue
    if (name === 'accounts' || name === 'custom_compatible') continue
    takeFrom(value, secrets.providers, name)
  }
  if (Array.isArray(publicConfig.accounts)) {
    for (const acc of publicConfig.accounts) takeFrom(acc, secrets.accounts, String(acc?.id ?? ''))
  }
  if (Array.isArray(publicConfig.custom_compatible)) {
    for (const cust of publicConfig.custom_compatible) takeFrom(cust, secrets.custom, String(cust?.id ?? ''))
  }
  return { publicConfig, secrets }
}

/** Put a secret bundle back into a config copy loaded from disk. */
function mergeSecrets(config: QuotaConfig, secrets: Partial<SecretBundle> | undefined): QuotaConfig {
  if (!secrets || typeof secrets !== 'object') return config
  const target: any = config
  if (typeof secrets.proxy === 'string' && secrets.proxy && !target.httpProxy) target.httpProxy = secrets.proxy
  const restore = (obj: any, store: Record<string, Record<string, unknown>> | undefined, key: string): void => {
    const found = store?.[key]
    if (!found || !obj) return
    for (const field of SECRET_STRING_KEYS) {
      if (typeof found[field] === 'string' && !obj[field]) obj[field] = found[field]
    }
    // The readable half keeps non-secret oauth fields (email, expiresAt), so merge the
    // secret half into whatever object survived instead of requiring it to be absent.
    if (found.oauth && typeof found.oauth === 'object') obj.oauth = { ...(obj.oauth || {}), ...(found.oauth as object) }
  }
  for (const [name, value] of Object.entries(target)) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) continue
    if (name === 'accounts' || name === 'custom_compatible') continue
    restore(value, secrets.providers, name)
  }
  for (const acc of Array.isArray(target.accounts) ? target.accounts : []) restore(acc, secrets.accounts, String(acc?.id ?? ''))
  for (const cust of Array.isArray(target.custom_compatible) ? target.custom_compatible : []) restore(cust, secrets.custom, String(cust?.id ?? ''))
  return target
}

export interface QuotaCardsResult {
  cards: AuthCardItem[]
  allCards: AuthCardItem[]
  alarms: QuotaAlarm[]
  lastUpdated: number
  persistenceDegraded?: boolean
  lastError?: string
}

/** A `force` refresh within this window reuses the cache instead of hitting upstream again. */
const FORCE_MIN_INTERVAL_MS = 5000
/** Error-card exponential backoff: 60s, 120s, ... capped at 10 minutes. */
const ERROR_BACKOFF_BASE_MS = 60_000
const ERROR_BACKOFF_MAX_MS = 600_000
const ERROR_BACKOFF_FACTOR = 2

interface InstanceTask {
  id: string
  providerName: string
  accountConfig?: AccountConfigItem
}

export class QuotaManager {
  private providers: Map<string, IQuotaProvider> = new Map()
  public oauthManager = new OAuthManager()
  public historyManager = new QuotaHistoryManager()
  public alarmDetector = new QuotaAlarmDetector()

  private cardCache: Map<string, CacheEntry> = new Map()
  /** Per-instance single flight: concurrent refreshes of one instance share one provider call. */
  private inflightTasks: Map<string, Promise<{ card: AuthCardItem; fetched: boolean } | null>> = new Map()
  /** Whole-round single flight keyed by provider filter ('' = full sweep). */
  private inflightRounds: Map<string, Promise<QuotaCardsResult>> = new Map()
  /** Last time a real upstream refresh was started, per instance (force throttling). */
  private lastForcedAt: Map<string, number> = new Map()
  /** Failure backoff state per instance. */
  private backoffs: Map<string, { failures: number; retryAt: number }> = new Map()
  /** Bumped on every config save; in-flight results from older generations never reach the cache. */
  private configGeneration = 0
  private lastError: string | undefined
  private lastPersistError: string | undefined

  private configPath: string
  private secretsPath: string
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
    this.secretsPath = join(dshDir, 'quota-secrets.json')
    this.loadConfig()
    this.loadSecrets()
    // Legacy installs kept keys inside quota-config.json; split them on first boot so the
    // readable file stops carrying secrets even before the user saves anything.
    if (!existsSync(this.secretsPath)) {
      try {
        const { secrets } = splitSecrets(this.config)
        const hasAny = Object.keys(secrets.providers).length + Object.keys(secrets.accounts).length + Object.keys(secrets.custom).length > 0
        if (hasAny) this.persistSplit()
      } catch {}
    }
  }

  private loadSecrets(): void {
    try {
      if (!existsSync(this.secretsPath)) return
      const raw = readFileSync(this.secretsPath, 'utf8')
      const parsed = JSON.parse(raw) as { version?: number; secrets?: Partial<SecretBundle> }
      this.config = mergeSecrets(this.config, parsed?.secrets)
    } catch {}
  }

  /** Persist the secret half first, then the secret-free config, both atomically. */
  private persistSplit(): boolean {
    const { publicConfig, secrets } = splitSecrets(this.config)
    const secretsOk = atomicWriteJsonSync(this.secretsPath, { version: 1, secrets }, 0o600)
    const configOk = atomicWriteJsonSync(this.configPath, publicConfig, 0o600)
    const ok = secretsOk && configOk
    this.lastPersistError = ok ? undefined : '配置持久化失败（磁盘只读或空间不足）'
    return ok
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
      // OAuth providers refresh access tokens in memory while fetching. Persist the
      // refreshed pair immediately, otherwise a restart replays a stale token and a
      // rotated refresh token is lost.
      ;(p as any).onTokenRefreshed = (info: { accessToken?: string; refreshToken?: string; expiresAt?: number }) => {
        this.persistRefreshedTokens(p.name, info)
      }
      this.providers.set(p.name, p)
    }
  }

  /** Write refreshed OAuth tokens into the config (secrets are split out on save). */
  private persistRefreshedTokens(
    providerName: string,
    info: { accessToken?: string; refreshToken?: string; expiresAt?: number },
  ): void {
    if (!info || typeof info.accessToken !== 'string' || info.accessToken.length === 0) return
    const current = (this.config as any)[providerName]
    if (!current || typeof current !== 'object') return
    const oauth = { ...(current.oauth || {}) }
    oauth.accessToken = info.accessToken
    if (typeof info.refreshToken === 'string' && info.refreshToken.length > 0) oauth.refreshToken = info.refreshToken
    if (typeof info.expiresAt === 'number' && Number.isFinite(info.expiresAt)) oauth.expiresAt = info.expiresAt
    try {
      this.saveConfig({ [providerName]: { ...current, oauth } } as any)
    } catch (error: any) {
      console.warn('[dsh-quota] failed to persist refreshed tokens:', error?.message ?? error)
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
          cursor: { enabled: true, autoDetectLocal: false },
          antigravity: { enabled: true, autoDetectLocal: false },
          codex: { enabled: true, autoDetectLocal: false },
          github_copilot: { enabled: true, autoDetectLocal: false },
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
        this.persistSplit()
      }
    } catch {
      // Keep the unreadable file instead of silently overwriting it on the next save.
      try {
        const quarantine = `${this.configPath}.corrupt-${Date.now()}`
        renameSync(this.configPath, quarantine)
      } catch {}
      this.config = {
        deepseek: { enabled: true },
        cursor: { enabled: true, autoDetectLocal: false },
        antigravity: { enabled: true, autoDetectLocal: false },
        codex: { enabled: true, autoDetectLocal: false },
        github_copilot: { enabled: true, autoDetectLocal: false },
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
        const combined: Record<string, string> = { ...(current.customNames || {}), ...unmasked.customNames }
        for (const [k, v] of Object.entries(combined)) {
          if (typeof v !== 'string' || v.trim().length === 0) delete combined[k]
        }
        return combined
      })(),
    }

    this.config = merged
    // A new configuration invalidates every cached card and every in-flight result:
    // an old-generation refresh must not write cards derived from the old config back
    // into the new cache (audit Q3), and a stale backoff must not silence a new key.
    this.configGeneration += 1
    this.cardCache.clear()
    this.backoffs.clear()
    this.lastForcedAt.clear()
    this.inflightTasks.clear()
    this.inflightRounds.clear()
    if (!this.persistSplit()) {
      throw new Error(this.lastPersistError ?? '配置写入失败')
    }
  }

  getSafeConfig(): QuotaConfig {
    const copy: any = JSON.parse(JSON.stringify(this.config || {}))
    const maskOauth = (owner: any): void => {
      if (!owner || typeof owner !== 'object' || !owner.oauth || typeof owner.oauth !== 'object') return
      if (owner.oauth.accessToken) owner.oauth.accessToken = maskSecret(owner.oauth.accessToken)
      if (owner.oauth.refreshToken) owner.oauth.refreshToken = maskSecret(owner.oauth.refreshToken)
      // `email` / `accountId` stay readable: the UI shows which account is connected.
    }
    if (typeof copy.httpProxy === 'string' && copy.httpProxy) {
      copy.httpProxy = sanitizeProxyUrl(copy.httpProxy)
    }
    for (const value of Object.values(copy)) {
      if (!value || typeof value !== 'object' || Array.isArray(value)) continue
      for (const key of SECRET_STRING_KEYS) {
        if (typeof (value as any)[key] === 'string' && (value as any)[key]) {
          (value as any)[key] = maskSecret((value as any)[key])
        }
      }
      maskOauth(value)
    }
    if (Array.isArray(copy.custom_compatible)) {
      copy.custom_compatible = copy.custom_compatible.map((item: any) => {
        const out: any = { ...item }
        for (const key of SECRET_STRING_KEYS) {
          if (typeof out[key] === 'string' && out[key]) out[key] = maskSecret(out[key])
        }
        maskOauth(out)
        return out
      })
    }
    if (Array.isArray(copy.accounts)) {
      copy.accounts = copy.accounts.map((item: any) => {
        const out: any = { ...item }
        for (const key of SECRET_STRING_KEYS) {
          if (typeof out[key] === 'string' && out[key]) out[key] = maskSecret(out[key])
        }
        maskOauth(out)
        return out
      })
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
      let auth: { auth_mode?: string; tokens?: Record<string, string | undefined> } & Record<string, any> = {}
      if (existsSync(authPath)) {
        // Keep a copy before touching a file the Codex CLI also owns.
        try {
          copyFileSync(authPath, `${authPath}.dsh-quota-backup-${Date.now()}`)
        } catch {}
        auth = JSON.parse(readFileSync(authPath, 'utf8'))
      }
      // Merge instead of rebuilding: CLIs keep `last_refresh` and future fields here.
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

  public buildInstanceTasks(providerFilter?: string): Array<{ id: string; providerName: string; accountConfig?: AccountConfigItem }> {
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
    // Set membership instead of `tasks.some(...)` keeps this O(n) as account counts grow.
    const seenIds = new Set(tasks.map(t => t.id))
    for (const [pName] of this.providers.entries()) {
      if (pName === 'custom_api') continue
      // Only add if not already covered in accounts
      if (!seenIds.has(pName)) {
        const provCfg = (this.config as any)[pName]
        if (provCfg && provCfg.enabled !== false) {
          tasks.push({
            id: pName,
            providerName: pName,
          })
          seenIds.add(pName)
        }
      }
    }

    if (!providerFilter) return tasks
    const needle = providerFilter.toLowerCase()
    return tasks.filter(t =>
      t.providerName.toLowerCase().includes(needle) || t.id.toLowerCase().includes(needle)
    )
  }

  private generateSparkline(instanceId: string): QuotaSparklinePoint[] {
    return this.historyManager.getUsageTrendPoints(instanceId, 7)
  }

  /**
   * Single-flight quota round.
   *
   * Concurrent callers for the same scope share one upstream sweep (audit A6): a
   * manual refresh racing the poller must not double the provider requests. Each
   * caller still observes its own AbortSignal, so a closed tab cannot cancel the
   * sweep other callers are waiting on.
   */
  async getQuotaCards(
    forceRefresh = false,
    providerFilter?: string,
    signal?: AbortSignal,
  ): Promise<QuotaCardsResult> {
    const flightKey = providerFilter ? `filter:${providerFilter}` : 'all'
    let flight = this.inflightRounds.get(flightKey)
    if (!flight) {
      flight = this.runRound(forceRefresh, providerFilter, signal)
      this.inflightRounds.set(flightKey, flight)
      const clear = () => {
        if (this.inflightRounds.get(flightKey) === flight) this.inflightRounds.delete(flightKey)
      }
      void flight.then(clear, clear)
    }
    return this.raceAbort(flight, signal)
  }

  private async runRound(
    forceRefresh: boolean,
    providerFilter: string | undefined,
    signal?: AbortSignal,
  ): Promise<QuotaCardsResult> {
    try {
      await this.historyManager.ready
    } catch {}
    const generation = this.configGeneration
    const tasks = this.buildInstanceTasks(providerFilter)
    let anyFetched = false

    const settled = await runWithConcurrency(tasks, async (task) => {
      const result = await this.refreshInstance(task, { force: forceRefresh, signal, generation })
      if (result?.fetched) anyFetched = true
      return result?.card ?? null
    }, 5)

    if (signal?.aborted) throw this.abortError()

    const allCards: AuthCardItem[] = []
    for (const entry of settled) {
      if (entry.status === 'fulfilled' && entry.value) allCards.push(entry.value)
    }

    // A fully cached round carries the same values as the previous one: skip the
    // journal work entirely (audit A21). Only rounds that hit upstream append.
    if (anyFetched) {
      try {
        this.historyManager.recordSnapshots(allCards)
      } catch (err: any) {
        this.lastError = `历史写入失败: ${err?.message ?? err}`
      }
    }

    const alarms = this.alarmDetector.detectAlarms(
      allCards,
      this.config.alarmThresholdPercent ?? 15,
      { prune: !providerFilter },
    )

    const orderList = this.config.providerOrder ?? DEFAULT_PROVIDER_ORDER
    const enabledSet = new Set(this.config.enabledProviders ?? DEFAULT_PROVIDER_ORDER)

    const visibleCards = allCards.filter((card) => {
      if (card.status === 'disabled') return false
      const isEnabled = enabledSet.has(card.id) || enabledSet.has(card.provider)
      if (card.provider === 'custom_api') return isEnabled
      return isEnabled && (this.config as any)[card.provider]?.enabled !== false
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
      // Completion time, not request start: TTL counts from when data actually arrived (audit A11).
      lastUpdated: Date.now(),
      persistenceDegraded: this.historyManager.persistenceDegraded || this.lastPersistError !== undefined,
      lastError: this.lastError,
    }
  }

  private abortError(): Error {
    const err: any = new Error('请求已取消')
    err.name = 'AbortError'
    err.code = 'ABORT_ERR'
    return err
  }

  /** Reject a caller as soon as its own signal aborts, without cancelling the shared sweep. */
  private raceAbort<T>(promise: Promise<T>, signal?: AbortSignal): Promise<T> {
    if (!signal) return promise
    if (signal.aborted) return Promise.reject(this.abortError())
    return new Promise<T>((resolve, reject) => {
      const onAbort = (): void => {
        cleanup()
        reject(this.abortError())
      }
      const cleanup = (): void => signal.removeEventListener('abort', onAbort)
      signal.addEventListener('abort', onAbort, { once: true })
      promise.then(
        (value) => {
          cleanup()
          resolve(value)
        },
        (err) => {
          cleanup()
          reject(err)
        },
      )
    })
  }

  /**
   * Cache/single-flight/backoff gate in front of one provider call.
   *
   * Order of precedence: TTL cache → force throttle (5 s) → failure backoff →
   * per-instance single flight → upstream.
   */
  private async refreshInstance(
    task: InstanceTask,
    options: { force: boolean; signal?: AbortSignal; generation: number },
  ): Promise<{ card: AuthCardItem; fetched: boolean } | null> {
    const { id, providerName, accountConfig } = task
    const now = Date.now()
    const cached = this.cardCache.get(id)

    if (cached && !options.force) {
      const intervalSec = getRefreshIntervalSeconds(this.config)
      const ttl = Math.max(5000, intervalSec * 1000)
      if (now - cached.fetchedAt < ttl) return { card: cached.card, fetched: false }
    }

    if (options.force && cached) {
      const lastForced = this.lastForcedAt.get(id) ?? 0
      if (now - lastForced < FORCE_MIN_INTERVAL_MS) return { card: cached.card, fetched: false }
    }

    // A failing upstream is retried on an exponential schedule, not on every poll.
    const backoff = this.backoffs.get(id)
    if (backoff && backoff.retryAt > now) {
      return cached ? { card: cached.card, fetched: false } : null
    }

    const inFlight = this.inflightTasks.get(id)
    if (inFlight) return inFlight

    const flight = (async (): Promise<{ card: AuthCardItem; fetched: boolean } | null> => {
      const provider = this.providers.get(providerName)
      if (!provider) return null
      if (options.signal?.aborted) throw this.abortError()

      this.lastForcedAt.set(id, Date.now())
      const configSnapshot = this.config
      try {
        const result = await provider.fetchCard(configSnapshot, accountConfig, options.signal)
        if (options.signal?.aborted) throw this.abortError()
        const card = result.card
        this.decorateCard(card, id, providerName, configSnapshot)
        if (options.generation === this.configGeneration) {
          // Completion timestamp: a 2 s provider call must not shorten the cache TTL.
          this.cardCache.set(id, { card, fetchedAt: Date.now() })
          this.backoffs.delete(id)
        }
        return { card, fetched: true }
      } catch (err: any) {
        if (options.signal?.aborted) throw this.abortError()
        const failures = (this.backoffs.get(id)?.failures ?? 0) + 1
        const delayMs = Math.min(
          ERROR_BACKOFF_MAX_MS,
          ERROR_BACKOFF_BASE_MS * ERROR_BACKOFF_FACTOR ** (failures - 1),
        )
        const retryAt = Date.now() + delayMs
        const errorCard = this.makeErrorCard(id, providerName, accountConfig, provider, err, retryAt)
        this.lastError = `${providerName}: ${err?.message ?? err}`
        if (options.generation === this.configGeneration) {
          this.backoffs.set(id, { failures, retryAt })
          this.cardCache.set(id, { card: errorCard, fetchedAt: Date.now() })
        }
        return { card: errorCard, fetched: true }
      }
    })()

    this.inflightTasks.set(id, flight)
    try {
      return await flight
    } finally {
      if (this.inflightTasks.get(id) === flight) this.inflightTasks.delete(id)
    }
  }

  private makeErrorCard(
    id: string,
    providerName: string,
    accountConfig: AccountConfigItem | undefined,
    provider: IQuotaProvider,
    err: any,
    retryAt: number,
  ): AuthCardItem {
    const customName =
      (this.config as any)[providerName]?.name ||
      this.config.customNames?.[id] ||
      this.config.customNames?.[providerName]
    const card: AuthCardItem = {
      id,
      name: customName || accountConfig?.name || provider.name,
      provider: providerName,
      category: provider.category,
      status: 'error',
      error: err?.message ?? String(err),
      groups: [],
      lastUpdated: Date.now(),
    }
    // Surfaced to the UI/agent so a failing instance can show when it will retry.
    ;(card as any).retryAfter = retryAt
    ;(card as any).retryAfterMs = Math.max(0, retryAt - Date.now())
    return card
  }

  private decorateCard(card: AuthCardItem, id: string, providerName: string, configSnapshot: QuotaConfig = this.config): void {
    const representative = this.representativeWindow(card)
    if (representative.remainingPercent !== undefined) {
      const { burnRatePerHour, estimatedHoursLeft } = this.historyManager.calculateBurnRate(
        id,
        representative.remainingPercent,
      )
      card.burnRatePerHour = burnRatePerHour
      card.estimatedHoursLeft = estimatedHoursLeft
    }
    card.sparkline = this.generateSparkline(id)

    const customName =
      (configSnapshot as any)[providerName]?.name ||
      this.config.customNames?.[id] ||
      this.config.customNames?.[providerName]
    if (customName) card.name = customName
  }

  /**
   * Pick one window to represent a card's short-cycle trend.
   *
   * Only a quantified window can drive burn rate. Index 0 is server order, which
   * changes when a new pool appears; prefer an active `usage` window and never
   * treat a balance amount as a percentage.
   */
  private representativeWindow(card: AuthCardItem): { remainingPercent?: number; windowId?: string } {
    const windows: MetricWindow[] = (card.groups ?? []).flatMap((group) => group.windows ?? [])
    const quantified = windows.filter(
      (win) => win.status !== 'unknown' && win.status !== 'disabled' && isQuantified(win),
    )
    const preferred = quantified.find((win) => win.status !== 'exhausted') ?? quantified[0]
    if (preferred) return { remainingPercent: preferred.remainingPercent, windowId: preferred.id }
    const balanceWindow = windows.find((win) => windowQuotaKind(win) === 'balance')
    return balanceWindow ? { windowId: balanceWindow.id } : {}
  }

  async refreshSingleProvider(instanceOrProvider: string, signal?: AbortSignal): Promise<AuthCardItem | undefined> {
    try {
      await this.historyManager.ready
    } catch {}
    const tasks = this.buildInstanceTasks()
    const task = tasks.find((t) => t.id === instanceOrProvider || t.providerName === instanceOrProvider)
    if (!task) return undefined

    const result = await this.refreshInstance(task, {
      force: true,
      signal,
      generation: this.configGeneration,
    })
    if (!result) return undefined

    if (result.fetched) {
      try {
        this.historyManager.recordSnapshots([result.card])
      } catch (err: any) {
        this.lastError = `历史写入失败: ${err?.message ?? err}`
      }
    }
    return result.card
  }

  /**
   * Fire-and-forget refresh used by routes and OAuth callbacks: never rejects,
   * records `lastError` for status reporting (audit A7).
   */
  async safeRefresh(providerFilter?: string, signal?: AbortSignal): Promise<boolean> {
    try {
      await this.getQuotaCards(true, providerFilter, signal)
      this.lastError = undefined
      return true
    } catch (err: any) {
      this.lastError = err?.message ?? String(err)
      try {
        console.warn('[dsh-quota] background refresh failed:', this.lastError)
      } catch {}
      return false
    }
  }

  getLastError(): string | undefined {
    return this.lastError
  }

  async testConnection(
    providerName: string,
    accountConfig?: AccountConfigItem,
    signal?: AbortSignal,
  ): Promise<TestConnectionResult> {
    const provider = this.providers.get(providerName)
    if (!provider) {
      return {
        ok: false,
        provider: providerName,
        message: `未知服务提供商: ${providerName}`,
      }
    }

    if (typeof provider.testConnection === 'function') {
      return provider.testConnection(this.config, accountConfig, signal)
    }

    // Default test via fetchCard
    try {
      const start = Date.now()
      const res = await provider.fetchCard(this.config, accountConfig, signal)
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

  async testAllConnections(signal?: AbortSignal): Promise<Record<string, TestConnectionResult>> {
    // Only instance tasks the user actually configured (provider enabled or account listed).
    // Never append disabled providers here: probing them can read local IDE/CLI credentials
    // the user explicitly switched off.
    const tasks = this.buildInstanceTasks()
    const results: Record<string, TestConnectionResult> = {}

    await runWithConcurrency(tasks, async (t) => {
      const res = await this.testConnection(t.providerName, t.accountConfig, signal)
      results[t.id] = res
      return res
    }, 5)

    return results
  }

  /**
   * Structured summary and intelligent model routing recommendations for DSH Agent Tool calls
   */
  async getAgentQuotaSummary(providerName?: string, forceRefresh = false): Promise<any> {
    const { cards, alarms, lastUpdated } = await this.getQuotaCards(forceRefresh, providerName)
    const targetCards = providerName
      ? cards.filter(c => c.provider.toLowerCase().includes(providerName.toLowerCase()) || c.id.toLowerCase().includes(providerName.toLowerCase()))
      : cards

    // Smart routing only trusts real percentages. A `liveness`/`unknown`/`balance`
    // card is connected, but it never contributes a "quota is healthy" claim (0.4.1
    // data-truthfulness contract): the primary is the ok card whose worst quantified
    // window has the most remaining headroom; deepseek only wins exact ties.
    const ranked: Array<{ card: AuthCardItem; remaining: number }> = []
    for (const card of cards) {
      if (card.status === 'error' || card.status === 'disabled') continue
      const remaining = this.worstQuantifiedPercent(card)
      if (remaining !== undefined) ranked.push({ card, remaining })
    }
    ranked.sort((a, b) => {
      if (b.remaining !== a.remaining) return b.remaining - a.remaining
      const aPreferred = a.card.provider === 'deepseek' ? 1 : 0
      const bPreferred = b.card.provider === 'deepseek' ? 1 : 0
      if (bPreferred !== aPreferred) return bPreferred - aPreferred
      return a.card.name.localeCompare(b.card.name)
    })
    const healthyRanked = ranked.filter((entry) => entry.card.status === 'ok')
    const warningRanked = ranked.filter((entry) => entry.card.status === 'warn')

    let recommendation: ModelRouteRecommendation
    if (healthyRanked.length > 0) {
      const { card: primary, remaining } = healthyRanked[0]!
      const meta = PROVIDER_DEFAULT_MODELS[primary.provider] || { primaryId: primary.provider, available: [primary.provider], role: '通用大模型' }
      const fallbacks = healthyRanked
        .filter((entry) => entry.card.id !== primary.id)
        .slice(0, 4)
        .map((entry) => {
          const fMeta = PROVIDER_DEFAULT_MODELS[entry.card.provider] || { primaryId: entry.card.provider, available: [entry.card.provider], role: '备用模型' }
          return {
            provider: entry.card.provider,
            modelId: fMeta.primaryId,
            name: `${entry.card.name} (${fMeta.primaryId})`,
            reason: `${fMeta.role} · 量化剩余 ${Math.round(entry.remaining)}%`,
          }
        })
      recommendation = {
        primaryModel: `${primary.name} (${meta.primaryId})`,
        primaryModelId: meta.primaryId,
        primaryProvider: primary.provider,
        status: 'healthy',
        reason: `首选 ${primary.name} · 调用模型 ${meta.primaryId}（最低窗口剩余 ${Math.round(remaining)}% · ${meta.role}）`,
        availableModels: meta.available,
        fallbackRoutes: fallbacks,
      }
    } else if (warningRanked.length > 0) {
      const { card: primary, remaining } = warningRanked[0]!
      const meta = PROVIDER_DEFAULT_MODELS[primary.provider] || { primaryId: primary.provider, available: [primary.provider], role: '告警备用' }
      recommendation = {
        primaryModel: `${primary.name} (${meta.primaryId})`,
        primaryModelId: meta.primaryId,
        primaryProvider: primary.provider,
        status: 'warning',
        reason: `首选 ${primary.name} · 模型 ${meta.primaryId} 最低窗口剩余 ${Math.round(remaining)}%，已低于警戒线，建议谨慎执行高消耗长任务`,
        availableModels: meta.available,
        fallbackRoutes: [],
      }
    } else if (cards.some((card) => card.status === 'ok')) {
      // Connected, but no provider returned a real ratio: never call that "sufficient".
      recommendation = {
        primaryModel: 'none',
        primaryModelId: 'none',
        primaryProvider: 'none',
        status: 'warning',
        reason: '已连接的服务均未提供可量化额度（仅连通性或余额），无法判断额度是否充足，请先查看余额或手动确认',
        availableModels: [],
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
        const windows = (c.groups ?? []).flatMap(g => g.windows ?? [])
        const hasQuantified = windows.some(w => isQuantified(w))
        const hasBalance = windows.some(w => windowQuotaKind(w) === 'balance')
        const hasLiveness = windows.some(w => windowQuotaKind(w) === 'liveness')
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
          // Balance-only services report money, never a synthesized percentage.
          balanceText: this.formatBalanceText(c.balance),
          quotaKind: hasQuantified ? 'usage' : hasBalance || c.balance ? 'balance' : hasLiveness ? 'liveness' : 'unknown',
          worstRemainingPercent: this.worstQuantifiedPercent(c),
          burnRatePerHour: c.burnRatePerHour ? `${c.burnRatePerHour}%/h` : undefined,
          estimatedHoursLeft: c.estimatedHoursLeft ? `${c.estimatedHoursLeft} 小时` : undefined,
          quotas: c.groups.map(g => ({
            group: g.title,
            windows: g.windows.map(w => {
              const windowKind = windowQuotaKind(w)
              const quantified = isQuantified(w)
              return {
                label: w.label,
                kind: windowKind,
                // `—` for liveness/unknown; the amount text for balance; a real % only for usage.
                remaining: quantified
                  ? `${w.remainingPercent}%`
                  : windowKind === 'balance'
                    ? (w.amountText ?? this.formatBalanceText(c.balance) ?? '—')
                    : '—',
                used: quantified ? `${w.usedPercent}%` : undefined,
                subtitle: w.subtitle,
                amountText: windowKind === 'balance' ? w.amountText : undefined,
              }
            }),
          })),
        }
      }),
    }
  }

  /** Lowest remaining percent among quantified windows, or undefined when none exists. */
  private worstQuantifiedPercent(card: AuthCardItem): number | undefined {
    let worst: number | undefined
    for (const group of card.groups ?? []) {
      for (const win of group.windows ?? []) {
        if (!isQuantified(win)) continue
        if (worst === undefined || win.remainingPercent < worst) worst = win.remainingPercent
      }
    }
    return worst
  }

  private formatBalanceText(balance?: QuotaBalanceInfo): string | undefined {
    if (!balance) return undefined
    const currency = balance.currency && balance.currency !== 'TOKEN' && balance.currency !== 'COUNT' ? balance.currency : ''
    if (typeof balance.remaining === 'number' && Number.isFinite(balance.remaining)) {
      return `${balance.remaining}${currency ? ` ${currency}` : ''}`
    }
    if (typeof balance.total === 'number' && Number.isFinite(balance.total)) {
      return `${balance.total}${currency ? ` ${currency}` : ''}`
    }
    return undefined
  }

}
