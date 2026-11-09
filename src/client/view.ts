import type { QuotaController } from './controller.ts'
import type { AuthCardItem, QuotaConfig, MetricWindow, ProviderCategory, QuotaSparklinePoint, AccountConfigItem, CustomCompatibleEndpoint } from './api.ts'
import { makeHudMetricKey, isQuantified, windowQuotaKind } from './api.ts'

interface ProviderMeta {
  id: string
  name: string
  category: ProviderCategory
  keyLabel?: string
  keyPlaceholder?: string
  defaultBaseUrl?: string
  hasBaseUrl?: boolean
  isOauth?: boolean
  oauthProvider?: 'antigravity' | 'codex'
  hasLocalDetect?: boolean
  localDetectLabel?: string
  hasGroupId?: boolean
}

const PROVIDER_METAS: Record<string, ProviderMeta> = {
  deepseek: {
    id: 'deepseek',
    name: 'DeepSeek',
    category: 'domestic_llm',
    keyLabel: 'API Key',
    keyPlaceholder: 'sk-...',
    defaultBaseUrl: 'https://api.deepseek.com',
    hasBaseUrl: true,
  },
  cursor: {
    id: 'cursor',
    name: 'Cursor',
    category: 'ide',
    keyLabel: 'Session Token (可选)',
    keyPlaceholder: 'WorkosCursorSessionToken (从浏览器 Cookie 复制)',
    hasLocalDetect: true,
    localDetectLabel: '自动探测本地 state.vscdb (推荐)',
  },
  antigravity: {
    id: 'antigravity',
    name: 'Google Antigravity',
    category: 'official_cloud',
    isOauth: true,
    oauthProvider: 'antigravity',
    hasLocalDetect: true,
    localDetectLabel: '自动探测本地凭据 (gcloud/auth)',
  },
  codex: {
    id: 'codex',
    name: 'Codex (ChatGPT)',
    category: 'official_cloud',
    isOauth: true,
    oauthProvider: 'codex',
    keyLabel: 'Access Token (可选手动填入)',
    keyPlaceholder: 'access_token',
    hasLocalDetect: true,
    localDetectLabel: '自动探测本地 ~/.codex/auth.json',
  },
  github_copilot: {
    id: 'github_copilot',
    name: 'GitHub Copilot',
    category: 'ide',
    keyLabel: 'GitHub Token (可选)',
    keyPlaceholder: 'gho_... / ghp_...',
    hasLocalDetect: true,
    localDetectLabel: '自动探测本地 VS Code Copilot 登录态',
  },
  openai_billing: {
    id: 'openai_billing',
    name: 'OpenAI Platform',
    category: 'official_cloud',
    keyLabel: 'API Key',
    keyPlaceholder: 'sk-...',
    defaultBaseUrl: 'https://api.openai.com',
    hasBaseUrl: true,
  },
  claude: {
    id: 'claude',
    name: 'Anthropic Claude',
    category: 'official_cloud',
    keyLabel: 'API Key',
    keyPlaceholder: 'sk-ant-...',
    defaultBaseUrl: 'https://api.anthropic.com',
    hasBaseUrl: true,
  },
  kimi: {
    id: 'kimi',
    name: 'Moonshot Kimi',
    category: 'domestic_llm',
    keyLabel: 'API Key',
    keyPlaceholder: 'sk-...',
    defaultBaseUrl: 'https://api.moonshot.cn',
    hasBaseUrl: true,
  },
  glm: {
    id: 'glm',
    name: '智谱清言 (GLM)',
    category: 'domestic_llm',
    keyLabel: 'API Key',
    keyPlaceholder: 'id.secret',
    defaultBaseUrl: 'https://open.bigmodel.cn',
    hasBaseUrl: true,
  },
  minimax: {
    id: 'minimax',
    name: 'MiniMax (海螺)',
    category: 'domestic_llm',
    keyLabel: 'API Key',
    keyPlaceholder: 'API Key',
    defaultBaseUrl: 'https://api.minimax.chat',
    hasBaseUrl: true,
    hasGroupId: true,
  },
  qwen: {
    id: 'qwen',
    name: '阿里通义千问',
    category: 'domestic_llm',
    keyLabel: 'API Key',
    keyPlaceholder: 'sk-...',
    defaultBaseUrl: 'https://dashscope.aliyuncs.com',
    hasBaseUrl: true,
  },
  volcengine: {
    id: 'volcengine',
    name: '火山方舟 (豆包)',
    category: 'domestic_llm',
    keyLabel: 'API Key',
    keyPlaceholder: 'ark api key',
    defaultBaseUrl: 'https://ark.cn-beijing.volces.com',
    hasBaseUrl: true,
  },
  siliconflow: {
    id: 'siliconflow',
    name: '硅基流动 (SiliconFlow)',
    category: 'domestic_llm',
    keyLabel: 'API Key',
    keyPlaceholder: 'sk-...',
    defaultBaseUrl: 'https://api.siliconflow.cn',
    hasBaseUrl: true,
  },
  openrouter: {
    id: 'openrouter',
    name: 'OpenRouter',
    category: 'official_cloud',
    keyLabel: 'API Key',
    keyPlaceholder: 'sk-or-v1-...',
    defaultBaseUrl: 'https://openrouter.ai/api',
    hasBaseUrl: true,
  },
  opencode_go: {
    id: 'opencode_go',
    name: 'OpenCode Go',
    category: 'official_cloud',
    keyLabel: 'API Key',
    keyPlaceholder: 'sk-...',
    defaultBaseUrl: 'https://opencode.cc',
    hasBaseUrl: true,
  },
}

const CATEGORY_NAMES: Record<ProviderCategory | 'all', string> = {
  all: '全部服务',
  domestic_llm: '国内大模型',
  ide: 'IDE 编程助手',
  official_cloud: '海外官方',
  custom_api: '自定义中转',
}

/** Escape a value before it is interpolated into markup or an attribute. */
function esc(value: unknown): string {
  if (value === undefined || value === null) return ''
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;')
}

function getQuotaStatusColor(remainingPercent: number): string {
  if (remainingPercent <= 15) return '#B04A46'
  if (remainingPercent <= 35) return '#BA8137'
  return '#3F7A63'
}

function renderHelp(text: string): string {
  return `
    <span class="quota-help-tip" data-tooltip="${text}" title="${text}" tabindex="0">
      <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor">
        <path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14zm0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16z"/>
        <path d="M5.255 5.786a.237.237 0 0 0 .241.247h.825c.138 0 .248-.113.266-.25.09-.656.54-1.134 1.342-1.134.686 0 1.314.343 1.314 1.168 0 .635-.374.927-.965 1.371-.673.489-1.206 1.06-1.168 1.987l.003.217a.25.25 0 0 0 .25.246h.811a.25.25 0 0 0 .25-.25v-.105c0-.718.273-.927 1.01-1.486.609-.463 1.244-.977 1.244-2.056 0-1.511-1.276-2.241-2.673-2.241-1.267 0-2.655.59-2.75 2.286zm1.557 5.763c0 .533.425.927 1.01.927.609 0 1.028-.394 1.028-.927 0-.552-.42-.94-1.029-.94-.584 0-1.009.388-1.009.94z"/>
      </svg>
    </span>
  `
}

/**
 * Subtitle rule shared by cards and the HUD. Never fabricates a ratio: only a
 * `usage` window with both percentages gets a percentage sentence, `balance`
 * shows the truthful amount, `liveness` says connectivity only and `unknown`
 * stays unknown.
 */
export function formatWindowSubtitle(win: MetricWindow, now: number = Date.now()): string {
  const kind = windowQuotaKind(win)
  const subtitle = typeof win.subtitle === 'string' && win.subtitle.trim() !== '' ? win.subtitle : ''

  if (kind === 'usage' && isQuantified(win)) {
    const rem = Math.max(0, Math.min(100, Math.round(win.remainingPercent)))
    const used = Math.max(0, Math.min(100, Math.round(win.usedPercent)))

    if (rem >= 100 || used <= 0) return '已用 0% · 额度充足'

    if (win.resetAt) {
      const resetDate = new Date(win.resetAt)
      if (!isNaN(resetDate.getTime())) {
        const diffMs = resetDate.getTime() - now
        if (diffMs > 0) {
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
          const fullTimeStr = days > 0 ? `${dateStr} ${timeStr}` : timeStr

          let countdown = ''
          if (days > 0) countdown = `${days} 天${hours > 0 ? ` ${hours} 小时` : ''}后`
          else if (hours > 0) countdown = `${hours} 小时${minutes > 0 ? ` ${minutes} 分钟` : ''}后`
          else countdown = `${minutes} 分钟后`

          return `已用 ${used}% · 预计 ${countdown}重置 (${fullTimeStr})`
        }
        return `已用 ${used}% · 即将重置`
      }
    }

    return subtitle || `已用 ${used}%`
  }

  if (kind === 'balance') {
    if (subtitle) return subtitle
    const amountText = typeof win.amountText === 'string' ? win.amountText.trim() : ''
    return amountText !== '' ? `余额 ${amountText}` : '—'
  }

  if (kind === 'liveness') return subtitle || '已连接 · 未提供额度接口'

  // `unknown`, and malformed `usage` windows without two finite percentages.
  return subtitle || '额度状态未知'
}

/** `hh:mm` clock for the "last updated" header, or '' when unknown. */
export function formatClockTime(timestamp: number): string {
  if (typeof timestamp !== 'number' || !Number.isFinite(timestamp) || timestamp <= 0) return ''
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return ''
  const hh = String(date.getHours()).padStart(2, '0')
  const mm = String(date.getMinutes()).padStart(2, '0')
  return `${hh}:${mm}`
}

function renderCircleProgress(remainingPercent: number): string {
  const radius = 11
  const circumference = 2 * Math.PI * radius
  const clampedRem = Math.max(0, Math.min(100, Math.round(remainingPercent)))
  const offset = circumference - (clampedRem / 100) * circumference
  const color = getQuotaStatusColor(clampedRem)

  return `
    <div style="position: relative; width: 28px; height: 28px; display: inline-flex; align-items: center; justify-content: center; flex: none;">
      <svg width="28" height="28" viewBox="0 0 28 28" shape-rendering="geometricPrecision" style="transform: rotate(-90deg); display: block;">
        <circle cx="14" cy="14" r="${radius}" stroke="var(--dsw-alias-border-l1, rgba(0,0,0,0.08))" stroke-width="2.5" fill="none"/>
        <circle cx="14" cy="14" r="${radius}" stroke="${color}" stroke-width="2.5" fill="none"
          stroke-dasharray="${circumference}" stroke-dashoffset="${offset}" stroke-linecap="round"
          style="transition: stroke-dashoffset 0.3s ease, stroke 0.3s ease;"/>
      </svg>
    </div>
  `
}

function renderSparklineSvg(points?: QuotaSparklinePoint[], currentRem = 100, width = 80, height = 24): string {
  let finalPoints = points && points.length >= 2 ? points : []
  if (finalPoints.length < 2) {
    const now = Date.now()
    finalPoints = [
      { t: now - 6 * 86400000, r: 0 },
      { t: now - 5 * 86400000, r: 0 },
      { t: now - 4 * 86400000, r: 0 },
      { t: now - 3 * 86400000, r: 0 },
      { t: now - 2 * 86400000, r: 0 },
      { t: now - 86400000, r: 0 },
      { t: now, r: 0 },
    ]
  }

  const padding = 3
  const drawW = width - padding * 2
  const drawH = height - padding * 2

  const allZero = finalPoints.every(p => p.r === 0)
  const strokeColor = allZero ? 'var(--dsw-alias-border-l2, rgba(0,0,0,0.18))' : getQuotaStatusColor(currentRem)

  const coords = finalPoints.map((p, idx) => {
    const x = padding + (idx / (finalPoints.length - 1)) * drawW
    const clampedR = Math.max(0, Math.min(100, p.r))
    const y = allZero
      ? height - padding - 1
      : padding + (1 - clampedR / 100) * drawH
    return { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 }
  })

  const pathD = coords.reduce((acc, pt, idx) => `${acc} ${idx === 0 ? 'M' : 'L'} ${pt.x},${pt.y}`, '')
  const lastPt = coords[coords.length - 1]!
  const firstPt = coords[0]!
  const areaD = `${pathD} L ${lastPt.x},${height - padding} L ${firstPt.x},${height - padding} Z`

  const tooltipText = allZero ? '最近使用量变化 · 近期无消耗 (0使用量)' : '最近使用量变化趋势'

  return `
    <div title="${tooltipText}" class="quota-sparkline-wrap" style="width: ${width}px; height: ${height}px; display: inline-flex; align-items: center; justify-content: center; flex: none;">
      <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" style="overflow: visible; display: block;">
        ${allZero ? '' : `<path d="${areaD}" fill="${strokeColor}" fill-opacity="0.15" />`}
        <path d="${pathD}" fill="none" stroke="${strokeColor}" stroke-width="${allZero ? 1.2 : 1.65}" stroke-linecap="round" stroke-linejoin="round" ${allZero ? 'stroke-dasharray="2 3"' : ''} />
        ${allZero ? '' : coords.map((pt, idx) => {
          const ptData = finalPoints[idx]!
          const d = new Date(ptData.t)
          const dateLabel = `${d.getMonth() + 1}/${d.getDate()}`
          const pointTip = `${dateLabel} 相对用量: ${ptData.r}%`
          return `<circle cx="${pt.x}" cy="${pt.y}" r="${idx === coords.length - 1 ? 2.4 : 1.8}" fill="${strokeColor}" fill-opacity="${ptData.r > 0 ? 0.9 : 0.4}"><title>${pointTip}</title></circle>`
        }).join('')}
      </svg>
    </div>
  `
}

function showToast(message: string, type: 'success' | 'error' | 'info' = 'success'): void {
  if (typeof document === 'undefined') return
  let toastEl = document.getElementById('dsh-quota-toast')
  if (!toastEl) {
    toastEl = document.createElement('div')
    toastEl.id = 'dsh-quota-toast'
    toastEl.className = 'dsh-quota-toast'
    document.body.appendChild(toastEl)
  }
  toastEl.textContent = message
  toastEl.className = `dsh-quota-toast show ${type}`
  clearTimeout((toastEl as any)._timer)
  ;(toastEl as any)._timer = setTimeout(() => {
    if (toastEl) toastEl.className = 'dsh-quota-toast'
  }, 2600)
}

function showConfirmModal(opts: {
  title: string
  content: string
  confirmText?: string
  onConfirm: () => void
}, onOpen?: (overlay: HTMLElement) => void): void {
  if (typeof document === 'undefined') return
  const overlay = document.createElement('div')
  overlay.className = 'dsh-quota-modal-overlay'
  overlay.innerHTML = `
    <div class="dsh-quota-modal">
      <div class="dsh-quota-modal-title">${opts.title}</div>
      <div class="dsh-quota-modal-body">${opts.content}</div>
      <div class="dsh-quota-modal-footer">
        <button type="button" class="quota-btn secondary btn-modal-cancel">取消</button>
        <button type="button" class="quota-btn danger btn-modal-confirm">${opts.confirmText || '确认删除'}</button>
      </div>
    </div>
  `
  onOpen?.(overlay)
  document.body.appendChild(overlay)
  const close = () => overlay.remove()
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) close()
  })
  overlay.querySelector('.btn-modal-cancel')?.addEventListener('click', close)
  overlay.querySelector('.btn-modal-confirm')?.addEventListener('click', () => {
    close()
    opts.onConfirm()
  })
}

function downloadJsonFile(filename: string, data: any): void {
  if (typeof document === 'undefined') return
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  URL.revokeObjectURL(url)
}

function sanitizeConfigForExport(cfg: QuotaConfig): QuotaConfig {
  const copy: any = JSON.parse(JSON.stringify(cfg || {}))
  const keyProps = ['apiKey', 'sessionToken', 'token']
  for (const [, v] of Object.entries(copy)) {
    if (v && typeof v === 'object') {
      for (const kp of keyProps) {
        if ((v as any)[kp]) (v as any)[kp] = '***'
      }
      if ((v as any).oauth?.accessToken) (v as any).oauth.accessToken = '***'
      if ((v as any).oauth?.refreshToken) (v as any).oauth.refreshToken = '***'
    }
  }
  if (Array.isArray(copy.custom_compatible)) {
    copy.custom_compatible = copy.custom_compatible.map((item: any) => ({
      ...item,
      apiKey: item.apiKey ? '***' : '',
    }))
  }
  if (Array.isArray(copy.accounts)) {
    copy.accounts = copy.accounts.map((item: any) => ({
      ...item,
      apiKey: item.apiKey ? '***' : undefined,
      sessionToken: item.sessionToken ? '***' : undefined,
      oauth: item.oauth ? {
        ...item.oauth,
        accessToken: item.oauth.accessToken ? '***' : undefined,
        refreshToken: item.oauth.refreshToken ? '***' : undefined,
      } : undefined,
    }))
  }
  return copy
}

function maskSecret(str?: string): string {
  if (!str) return ''
  const trimmed = str.trim()
  if (trimmed.length <= 8) return '••••••••'
  return `${trimmed.slice(0, 4)}••••${trimmed.slice(-4)}`
}

function getCredentialInfo(id: string, cfg: QuotaConfig): { isConfigured: boolean; displayValue: string } {
  if (!cfg) return { isConfigured: false, displayValue: '未配置' }

  if (Array.isArray(cfg.custom_compatible)) {
    const cust = cfg.custom_compatible.find(c => c.id === id)
    if (cust) {
      const hasKey = Boolean(cust.apiKey?.trim())
      return {
        isConfigured: hasKey,
        displayValue: hasKey ? maskSecret(cust.apiKey) : '未配置',
      }
    }
  }

  switch (id) {
    case 'deepseek': {
      const k = cfg.deepseek?.apiKey?.trim()
      return { isConfigured: Boolean(k), displayValue: k ? maskSecret(k) : '未配置' }
    }
    case 'cursor': {
      const token = cfg.cursor?.sessionToken?.trim()
      const auto = cfg.cursor?.autoDetectLocal !== false && cfg.cursor?.enabled !== false
      if (token) return { isConfigured: true, displayValue: maskSecret(token) }
      if (auto) return { isConfigured: true, displayValue: '本地探测 (state.vscdb)' }
      return { isConfigured: false, displayValue: '未配置' }
    }
    case 'antigravity': {
      const email = cfg.antigravity?.oauth?.email
      const authed = Boolean(cfg.antigravity?.oauth?.accessToken)
      const auto = cfg.antigravity?.autoDetectLocal !== false && cfg.antigravity?.enabled !== false
      if (authed) return { isConfigured: true, displayValue: email ? `Google (${email})` : '已授权' }
      if (auto) return { isConfigured: true, displayValue: '本地凭据 (gcloud)' }
      return { isConfigured: false, displayValue: '未配置' }
    }
    case 'codex': {
      const authed = Boolean(cfg.codex?.oauth?.accessToken)
      const auto = cfg.codex?.autoDetectLocal !== false && cfg.codex?.enabled !== false
      if (authed) return { isConfigured: true, displayValue: 'OAuth Token' }
      if (auto) return { isConfigured: true, displayValue: '本地凭据 (auth.json)' }
      return { isConfigured: false, displayValue: '未配置' }
    }
    case 'github_copilot': {
      const token = cfg.github_copilot?.token?.trim()
      const auto = cfg.github_copilot?.autoDetectLocal !== false && cfg.github_copilot?.enabled === true
      if (token) return { isConfigured: true, displayValue: maskSecret(token) }
      if (auto) return { isConfigured: true, displayValue: '本地凭据 (VS Code)' }
      return { isConfigured: false, displayValue: '未配置' }
    }
    default: {
      const provConf = (cfg as any)[id]
      const key = provConf?.apiKey?.trim()
      return { isConfigured: Boolean(key), displayValue: key ? maskSecret(key) : '未配置' }
    }
  }
}

function getServiceDisplayName(id: string, cfg: QuotaConfig, defaultName: string): string {
  if (cfg.customNames && cfg.customNames[id]) {
    return cfg.customNames[id]
  }
  const provConf = (cfg as any)[id]
  if (provConf && provConf.name) {
    return provConf.name
  }
  if (Array.isArray(cfg.custom_compatible)) {
    const cust = cfg.custom_compatible.find(c => c.id === id)
    if (cust && cust.name) return cust.name
  }
  return defaultName
}

type DrawerTarget =
  | { kind: 'provider'; id: string }
  | { kind: 'custom'; endpoint: CustomCompatibleEndpoint; index: number }
  | { kind: 'new_custom' }

function getAvailableHudMetricsForTarget(target: DrawerTarget, cards: AuthCardItem[]): Array<{ key: string; label: string }> {
  const provId = target.kind === 'custom' ? target.endpoint.id : (target.kind === 'new_custom' ? 'custom' : target.id)
  const card = cards.find(c => c.id === provId || c.provider === provId)

  const dynamicItems: Array<{ key: string; label: string }> = []
  if (card && card.groups && card.groups.length > 0) {
    for (const g of card.groups) {
      for (const w of g.windows) {
        let label = `${g.title} · ${w.label}`
        if (card.provider === 'antigravity') {
          if (w.id === 'gemini-weekly') label = 'Gemini 模型 · 周限额 (周用量)'
          else if (w.id === 'gemini-5h') label = 'Gemini 模型 · 5小时限额'
          else if (w.id === 'claude-weekly') label = 'Claude & GPT 模型 · 周限额 (周用量)'
          else if (w.id === 'claude-5h') label = 'Claude & GPT 模型 · 5小时限额'
        } else if (card.provider === 'cursor') {
          if (w.id === 'cursor-auto') label = 'Fast Requests (核心高速请求)'
          else if (w.id === 'cursor-named') label = 'Other Models (其他通用模型)'
        }
        dynamicItems.push({
          key: makeHudMetricKey(card.provider, g.title, w.id),
          label,
        })
      }
    }
  }

  if (dynamicItems.length > 0) return dynamicItems

  // Fallback defaults by provider
  if (target.kind === 'provider') {
    const prov = target.id
    if (prov === 'antigravity') {
      return [
        { key: makeHudMetricKey('antigravity', 'Gemini Models', 'gemini-weekly'), label: 'Gemini 模型 · 周限额 (周用量)' },
        { key: makeHudMetricKey('antigravity', 'Gemini Models', 'gemini-5h'), label: 'Gemini 模型 · 5小时限额' },
        { key: makeHudMetricKey('antigravity', 'Claude and GPT models', 'claude-weekly'), label: 'Claude & GPT 模型 · 周限额 (周用量)' },
        { key: makeHudMetricKey('antigravity', 'Claude and GPT models', 'claude-5h'), label: 'Claude & GPT 模型 · 5小时限额' },
      ]
    }
    if (prov === 'cursor') {
      return [
        { key: makeHudMetricKey('cursor', 'Cursor Plan Usage', 'cursor-auto'), label: 'Fast Requests (核心高速请求)' },
        { key: makeHudMetricKey('cursor', 'Cursor Plan Usage', 'cursor-named'), label: 'Other Models (其他通用模型)' },
      ]
    }
    if (prov === 'codex') {
      return [
        { key: makeHudMetricKey('codex', 'Codex 额度', 'codex-weekly'), label: 'Codex / ChatGPT 周限额 (Weekly Limit)' },
      ]
    }
    if (prov === 'github_copilot') {
      return [
        { key: makeHudMetricKey('github_copilot', 'Copilot 订阅与状态', 'copilot-access'), label: 'GitHub Copilot 订阅配额' },
      ]
    }
    if (prov === 'deepseek') {
      return [
        { key: makeHudMetricKey('deepseek', 'Balance', 'deepseek'), label: 'DeepSeek 可用余额' },
      ]
    }
    if (prov === 'kimi') {
      return [
        { key: makeHudMetricKey('kimi', 'Balance', 'kimi'), label: 'Kimi 可用余额' },
      ]
    }
    if (prov === 'glm') {
      return [
        { key: makeHudMetricKey('glm', 'Balance', 'glm'), label: '智谱 GLM 可用余额' },
      ]
    }
    if (prov === 'minimax') {
      return [
        { key: makeHudMetricKey('minimax', 'Balance', 'minimax'), label: 'MiniMax 可用余额' },
      ]
    }
    if (prov === 'qwen') {
      return [
        { key: makeHudMetricKey('qwen', 'Balance', 'qwen'), label: '通义千问可用余额' },
      ]
    }
    if (prov === 'volcengine') {
      return [
        { key: makeHudMetricKey('volcengine', 'Balance', 'volcengine'), label: '火山方舟可用余额' },
      ]
    }
    if (prov === 'siliconflow') {
      return [
        { key: makeHudMetricKey('siliconflow', '硅基流动账户配额', 'siliconflow-balance'), label: '硅基流动可用余额' },
      ]
    }
    if (prov === 'openrouter') {
      return [
        { key: makeHudMetricKey('openrouter', 'OpenRouter 配额状态', 'openrouter-limit'), label: 'OpenRouter 配额状态' },
      ]
    }
    if (prov === 'openai_billing') {
      return [
        { key: makeHudMetricKey('openai_billing', 'OpenAI 账单额度', 'openai-usage'), label: 'OpenAI 月度账单用量' },
      ]
    }
    if (prov === 'claude') {
      return [
        { key: makeHudMetricKey('claude', 'API 额度', 'claude-rate'), label: 'Claude API 连通与配额' },
      ]
    }
    if (prov === 'opencode_go') {
      return [
        { key: makeHudMetricKey('opencode_go', 'Balance', 'opencode_go'), label: 'OpenCode 可用额度' },
      ]
    }
  }

  return [
    { key: makeHudMetricKey(provId, 'Balance', provId), label: '中转站可用余额' },
  ]
}

export function renderQuotaApp(container: HTMLElement, controller: QuotaController): () => void {
  // Both mount paths (legacy conversation overlay and the official slot host)
  // need the view marker: the shared stylesheet and the scroll container rules
  // key off it.
  container.setAttribute('data-dsh-quota-view', '')
  container.setAttribute('data-dsh-plugin', 'quota')

  const styleEl = document.createElement('style')
  styleEl.textContent = `
    [data-pane='conversation'], [class*='centerCol'] {
      position: relative;
    }
    [data-dsh-quota-view] {
      position: absolute;
      inset: 0;
      display: none;
      z-index: 60;
      background: var(--dsw-alias-bg-base, #ffffff);
      color: var(--dsw-alias-label-primary, #1f2328);
      overflow-y: auto;
      font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", "PingFang SC", "Hiragino Sans GB", "Microsoft YaHei", Roboto, sans-serif;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
      text-rendering: optimizeLegibility;
    }
    html[data-dsh-quota-active]:not([data-dsh-taskboard-active]):not([data-dsh-ssh-active]) [data-dsh-quota-view] {
      display: block;
    }
    html[data-dsh-quota-active]:not([data-dsh-taskboard-active]):not([data-dsh-ssh-active]) [data-pane='conversation'] > :not([data-dsh-quota-view]),
    html[data-dsh-quota-active]:not([data-dsh-taskboard-active]):not([data-dsh-ssh-active]) [class*='centerCol'] > :not([data-dsh-quota-view]) {
      display: none !important;
    }

    /* Container & Layout */
    .quota-container {
      max-width: 820px;
      margin: 0 auto;
      padding: 24px 20px 64px;
      display: flex;
      flex-direction: column;
      gap: 18px;
    }
    .quota-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      border-bottom: 1px solid var(--dsw-alias-border-l2, rgba(0,0,0,0.1));
      padding-bottom: 14px;
    }
    .quota-title {
      font-size: 17.5px;
      font-weight: 700;
      color: var(--dsw-alias-label-primary, #111);
      display: flex;
      align-items: center;
      gap: 8px;
      letter-spacing: -0.2px;
    }
    .quota-version-tag {
      font-size: 11px;
      font-weight: 600;
      color: var(--dsw-alias-brand-primary, #0969da);
      background: var(--dsw-alias-bg-layer-2, rgba(0,0,0,0.04));
      padding: 2px 6px;
      border-radius: 4px;
      font-family: ui-monospace, SFMono-Regular, monospace;
    }
    .quota-tabs {
      display: flex;
      background: var(--dsw-alias-bg-layer-1, rgba(0, 0, 0, 0.04));
      border-radius: 8px;
      padding: 3px;
      gap: 2px;
    }
    .quota-tab-btn {
      padding: 5px 14px;
      font-size: 13px;
      font-weight: 600;
      border: none;
      background: transparent;
      color: var(--dsw-alias-label-secondary, #57606a);
      border-radius: 6px;
      cursor: pointer;
      transition: all 0.16s ease;
    }
    .quota-tab-btn:hover {
      color: var(--dsw-alias-label-primary, #1f2328);
    }
    .quota-tab-btn.active {
      background: var(--dsw-alias-bg-base, #ffffff);
      color: var(--dsw-alias-label-primary, #1f2328);
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
    }

    /* Overview Grid & Badges */
    .dashboard-summary-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 12px;
    }
    .summary-card {
      padding: 14px;
      border-radius: 8px;
      border: 1px solid var(--dsw-alias-border-l1, rgba(0, 0, 0, 0.08));
      background: var(--dsw-alias-bg-layer-1, rgba(0, 0, 0, 0.015));
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .summary-card-label {
      font-size: 11.5px;
      color: var(--dsw-alias-label-secondary, #57606a);
      font-weight: 500;
    }
    .summary-card-val {
      font-size: 20px;
      font-weight: 700;
      color: var(--dsw-alias-label-primary, #111);
      letter-spacing: -0.4px;
    }
    .category-filter-bar {
      display: flex;
      gap: 6px;
      overflow-x: auto;
      padding-bottom: 2px;
    }
    .category-chip {
      padding: 4px 11px;
      font-size: 12px;
      font-weight: 500;
      border-radius: 14px;
      border: 1px solid var(--dsw-alias-border-l1, rgba(0, 0, 0, 0.08));
      background: transparent;
      color: var(--dsw-alias-label-secondary, #57606a);
      cursor: pointer;
      white-space: nowrap;
      transition: all 0.15s ease;
    }
    .category-chip:hover {
      background: var(--dsw-alias-bg-layer-1, rgba(0, 0, 0, 0.04));
    }
    .category-chip.active {
      background: #3F7A63;
      color: #ffffff;
      border-color: #3F7A63;
      font-weight: 600;
    }

    /* Section Card in Overview */
    .quota-section {
      border: 1px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.1));
      border-radius: 10px;
      background: var(--dsw-alias-bg-base, #ffffff);
      padding: 16px 18px;
      display: flex;
      flex-direction: column;
      gap: 12px;
      box-shadow: 0 1px 4px rgba(0, 0, 0, 0.03);
    }
    .auth-title-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .auth-section-title {
      font-size: 14.5px;
      font-weight: 700;
      color: var(--dsw-alias-label-primary, #111);
    }
    .btn-card-refresh {
      background: transparent;
      border: none;
      font-size: 14px;
      cursor: pointer;
      color: var(--dsw-alias-label-secondary, #57606a);
      padding: 2px 4px;
      border-radius: 4px;
      transition: color 0.15s ease;
    }
    .btn-card-refresh:hover {
      color: var(--dsw-alias-label-primary, #111);
    }
    .btn-card-refresh.spinning svg {
      animation: spin 0.75s linear infinite;
    }
    @keyframes spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }
    .official-long-card {
      display: flex;
      flex-direction: column;
      border-radius: 6px;
      background: var(--dsw-alias-bg-layer-1, rgba(0, 0, 0, 0.02));
      border: 1px solid var(--dsw-alias-border-l1, rgba(0, 0, 0, 0.05));
    }
    .card-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 10px 14px;
      border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(0, 0, 0, 0.04));
    }
    .card-row:last-child {
      border-bottom: none;
    }
    .row-left-content {
      display: flex;
      flex-direction: column;
      gap: 2px;
    }
    .row-main-label {
      font-size: 13px;
      font-weight: 600;
      color: var(--dsw-alias-label-primary, #111);
    }
    .row-sub-label {
      font-size: 11.5px;
      color: var(--dsw-alias-label-secondary, #57606a);
    }
    .row-right-metric {
      display: flex;
      align-items: center;
      gap: 12px;
    }
    .row-percent-number {
      font-size: 13.5px;
      font-weight: 700;
      min-width: 42px;
      text-align: right;
    }
    .row-percent-number.is-unknown {
      color: var(--dsw-alias-label-tertiary, #888);
    }
    .row-amount-number {
      font-size: 15.5px;
      font-weight: 700;
      letter-spacing: -0.3px;
      font-variant-numeric: tabular-nums;
    }
    .row-metric-caption {
      font-size: 11px;
      color: var(--dsw-alias-label-secondary, #57606a);
      font-weight: 500;
    }
    .quota-kind-badge {
      font-size: 11px;
      font-weight: 600;
      color: var(--dsw-alias-label-secondary, #57606a);
      background: var(--dsw-alias-bg-layer-2, rgba(0, 0, 0, 0.05));
      border: 1px solid var(--dsw-alias-border-l1, rgba(0, 0, 0, 0.08));
      border-radius: 999px;
      padding: 2px 8px;
      white-space: nowrap;
    }
    .quota-updated-tag {
      font-size: 11px;
      font-weight: 500;
      color: var(--dsw-alias-label-tertiary, #888);
      margin-left: 8px;
    }
    .quota-error-banner {
      display: flex;
      align-items: center;
      gap: 10px;
      padding: 9px 14px;
      border-radius: 8px;
      border: 1px solid color-mix(in srgb, #B04A46 35%, transparent);
      background: color-mix(in srgb, #B04A46 8%, transparent);
      color: var(--dsw-alias-label-error, #B04A46);
      font-size: 12.5px;
    }
    .quota-error-banner .quota-error-text {
      flex: 1;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .quota-error-banner .quota-error-time {
      flex: none;
      opacity: 0.8;
      font-size: 11.5px;
    }
    .group-header-title {
      font-size: 12px;
      font-weight: 600;
      color: var(--dsw-alias-label-secondary, #57606a);
      padding: 4px 2px;
      cursor: pointer;
      display: flex;
      align-items: center;
      justify-content: space-between;
      user-select: none;
    }

    /* Standard Buttons */
    .quota-btn {
      padding: 6px 14px;
      font-size: 12.5px;
      font-weight: 600;
      border-radius: 6px;
      border: 1px solid #3F7A63;
      background: #3F7A63;
      color: #ffffff;
      cursor: pointer;
      transition: all 0.15s ease;
      display: inline-flex;
      align-items: center;
      gap: 6px;
      justify-content: center;
    }
    .quota-btn:hover {
      background: #336350;
      border-color: #336350;
    }
    .quota-btn.secondary {
      background: var(--dsw-alias-bg-layer-1, rgba(0, 0, 0, 0.04));
      border-color: var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.12));
      color: var(--dsw-alias-label-primary, #1f2328);
    }
    .quota-btn.secondary:hover {
      background: var(--dsw-alias-bg-layer-2, rgba(0, 0, 0, 0.08));
    }
    .quota-btn.danger {
      background: rgba(176, 74, 70, 0.1);
      border-color: rgba(176, 74, 70, 0.3);
      color: #B04A46;
    }
    .quota-btn.danger:hover {
      background: #B04A46;
      color: #ffffff;
      border-color: #B04A46;
    }
    .quota-btn.action {
      padding: 4px 10px;
      font-size: 12px;
    }
    .quota-btn:disabled {
      opacity: 0.4;
      cursor: not-allowed;
    }

    /* Icon Buttons (Monochrome, Hoverable, Minimalist) */
    .quota-icon-btn {
      width: 28px;
      height: 28px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      background: transparent;
      border: none;
      border-radius: 6px;
      color: var(--dsw-alias-label-secondary, #57606a);
      cursor: pointer;
      transition: all 0.15s ease;
      padding: 0;
      flex: none;
    }
    .quota-icon-btn:hover {
      background: var(--dsw-alias-bg-layer-2, rgba(0, 0, 0, 0.06));
      color: var(--dsw-alias-label-primary, #1f2328);
    }
    .quota-icon-btn.danger:hover {
      background: rgba(176, 74, 70, 0.12);
      color: #B04A46;
    }
    .quota-icon-btn.spinning svg {
      animation: spin 0.75s linear infinite;
    }

    /* Text Inputs */
    .quota-input {
      width: 100%;
      box-sizing: border-box;
      padding: 7px 10px;
      font-size: 12.5px;
      border-radius: 6px;
      border: 1px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.12));
      background: var(--dsw-alias-bg-base, #ffffff);
      color: var(--dsw-alias-label-primary, #1f2328);
      outline: none;
      transition: border-color 0.15s ease;
      font-family: inherit;
    }
    .quota-input:focus {
      border-color: #3F7A63;
      box-shadow: 0 0 0 2px rgba(63, 122, 99, 0.15);
    }

    /* Segmented Control (Sub-tabs) */
    .quota-settings-nav {
      display: flex;
      align-items: center;
      justify-content: space-between;
      margin-bottom: 12px;
    }
    .quota-segmented {
      display: inline-flex;
      background: var(--dsw-alias-bg-layer-1, rgba(0, 0, 0, 0.04));
      border-radius: 8px;
      padding: 3px;
      gap: 3px;
      border: 1px solid var(--dsw-alias-border-l1, rgba(0, 0, 0, 0.06));
    }
    .quota-segmented-btn {
      padding: 5px 14px;
      font-size: 12.5px;
      font-weight: 600;
      border: none;
      background: transparent;
      color: var(--dsw-alias-label-secondary, #57606a);
      border-radius: 6px;
      cursor: pointer;
      transition: all 0.15s ease;
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .quota-segmented-btn.active {
      background: var(--dsw-alias-bg-base, #ffffff);
      color: var(--dsw-alias-label-primary, #1f2328);
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.08);
    }
    .quota-count-pill {
      font-size: 10.5px;
      background: rgba(63, 122, 99, 0.12);
      color: #3F7A63;
      padding: 0 6px;
      border-radius: 10px;
      font-weight: 700;
    }

    /* Switch Component */
    .quota-switch {
      position: relative;
      display: inline-block;
      width: 34px;
      height: 18px;
      cursor: pointer;
      flex: none;
      user-select: none;
    }
    .quota-switch input {
      opacity: 0;
      width: 0;
      height: 0;
    }
    .quota-switch-slider {
      position: absolute;
      inset: 0;
      background-color: var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.18));
      border-radius: 18px;
      transition: background-color 0.18s ease;
    }
    .quota-switch-slider:before {
      position: absolute;
      content: "";
      height: 14px;
      width: 14px;
      left: 2px;
      bottom: 2px;
      background-color: #ffffff;
      border-radius: 50%;
      transition: transform 0.18s cubic-bezier(0.16, 1, 0.3, 1);
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.22);
    }
    .quota-switch input:checked + .quota-switch-slider {
      background-color: #3F7A63;
    }
    .quota-switch input:checked + .quota-switch-slider:before {
      transform: translateX(16px);
    }
    .quota-switch input:disabled + .quota-switch-slider {
      opacity: 0.35;
      cursor: not-allowed;
    }

    /* Service Table (Clean, Non-wrapping, Minimalist) */
    .quota-table-wrap {
      border: 1px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.08));
      border-radius: 8px;
      overflow: hidden;
      background: var(--dsw-alias-bg-base, #ffffff);
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.02);
    }
    .quota-table {
      width: 100%;
      border-collapse: collapse;
      text-align: left;
    }
    .quota-table th {
      padding: 10px 14px;
      background: var(--dsw-alias-bg-layer-1, rgba(0, 0, 0, 0.02));
      color: var(--dsw-alias-label-secondary, #57606a);
      font-weight: 600;
      font-size: 12px;
      border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(0, 0, 0, 0.06));
      white-space: nowrap;
    }
    .quota-table td {
      padding: 11px 14px;
      border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(0, 0, 0, 0.04));
      vertical-align: middle;
      font-size: 13px;
    }
    .quota-table-row:last-child td {
      border-bottom: none;
    }
    .quota-table-row {
      transition: background 0.12s ease;
      cursor: grab;
    }
    .quota-table-row:hover {
      background: var(--dsw-alias-bg-layer-1, rgba(0, 0, 0, 0.025));
    }
    .quota-table-row.dragging {
      opacity: 0.3;
      background: var(--dsw-alias-bg-layer-2, rgba(0, 0, 0, 0.08));
    }
    .quota-table-row.drag-over-top td {
      border-top: 2px solid var(--dsw-alias-brand-primary, #0969da);
    }
    .quota-table-row.drag-over-bottom td {
      border-bottom: 2px solid var(--dsw-alias-brand-primary, #0969da);
    }
    .sort-drag-handle {
      color: var(--dsw-alias-label-tertiary, #8c959f);
      display: inline-flex;
      align-items: center;
      justify-content: center;
      cursor: grab;
      opacity: 0.6;
    }
    .quota-table-row:hover .sort-drag-handle {
      opacity: 1;
      color: var(--dsw-alias-label-primary, #1f2328);
    }
    .service-name-cell {
      font-weight: 600;
      color: var(--dsw-alias-label-primary, #111);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      display: flex;
      align-items: center;
      gap: 8px;
      cursor: pointer;
      user-select: none;
    }
    .service-name-cell:hover span:first-child {
      text-decoration: underline;
      color: #3F7A63;
    }

    /* Detailed Settings Modal Component */
    .dsh-quota-modal.dsh-details-modal {
      width: 92%;
      max-width: 520px;
      max-height: 88vh;
      padding: 0;
      gap: 0;
      border-radius: 12px;
      overflow: hidden;
      display: flex;
      flex-direction: column;
    }
    .dsh-modal-header {
      padding: 16px 20px;
      border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(0, 0, 0, 0.08));
      display: flex;
      align-items: center;
      justify-content: space-between;
      flex: none;
    }
    .dsh-drawer-title-wrap {
      display: flex;
      align-items: baseline;
      gap: 8px;
    }
    .dsh-drawer-title {
      font-size: 16px;
      font-weight: 700;
      color: var(--dsw-alias-label-primary, #111);
    }
    .btn-drawer-close {
      background: transparent;
      border: none;
      font-size: 18px;
      color: var(--dsw-alias-label-secondary, #57606a);
      cursor: pointer;
      padding: 4px 8px;
      border-radius: 4px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
    .btn-drawer-close:hover {
      background: var(--dsw-alias-bg-layer-1, rgba(0, 0, 0, 0.05));
      color: var(--dsw-alias-label-primary, #111);
    }
    .dsh-drawer-body {
      flex: 1;
      padding: 18px 20px;
      overflow-y: auto;
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .dsh-drawer-footer {
      padding: 13px 20px;
      border-top: 1px solid var(--dsw-alias-border-l1, rgba(0, 0, 0, 0.08));
      display: flex;
      align-items: center;
      justify-content: space-between;
      background: var(--dsw-alias-bg-layer-1, rgba(0, 0, 0, 0.015));
      flex: none;
    }
    .quota-input-affix-wrap {
      position: relative;
      display: flex;
      align-items: center;
    }
    .btn-toggle-eye {
      position: absolute;
      right: 8px;
      background: transparent;
      border: none;
      color: var(--dsw-alias-label-tertiary, #8c959f);
      cursor: pointer;
      padding: 3px 5px;
      border-radius: 4px;
      display: inline-flex;
      align-items: center;
    }
    .btn-toggle-eye:hover {
      color: var(--dsw-alias-label-primary, #1f2328);
    }
    .drawer-info-card {
      background: var(--dsw-alias-bg-layer-1, rgba(0, 0, 0, 0.02));
      border: 1px solid var(--dsw-alias-border-l1, rgba(0, 0, 0, 0.06));
      border-radius: 8px;
      padding: 12px 14px;
      display: flex;
      flex-direction: column;
      gap: 8px;
      font-size: 12.5px;
    }
    .drawer-info-row {
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .drawer-info-label {
      color: var(--dsw-alias-label-secondary, #57606a);
      font-weight: 500;
    }
    .drawer-info-val {
      font-weight: 600;
      color: var(--dsw-alias-label-primary, #1f2328);
    }
    .drawer-test-row {
      display: flex;
      align-items: center;
      gap: 12px;
      padding-top: 4px;
    }
    .drawer-test-result {
      font-size: 12px;
      font-weight: 500;
      display: none;
    }
    .drawer-test-result.ok {
      display: inline-block;
      color: #3F7A63;
    }
    .drawer-test-result.err {
      display: inline-block;
      color: #B04A46;
    }

    /* Drawer HUD Metrics List */
    .drawer-hud-section {
      display: flex;
      flex-direction: column;
      gap: 8px;
      border-top: 1px solid var(--dsw-alias-border-l1, rgba(0, 0, 0, 0.06));
      padding-top: 12px;
    }
    .drawer-hud-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .drawer-hud-list {
      display: flex;
      flex-direction: column;
      gap: 8px;
      background: var(--dsw-alias-bg-layer-1, rgba(0, 0, 0, 0.02));
      border: 1px solid var(--dsw-alias-border-l1, rgba(0, 0, 0, 0.06));
      border-radius: 8px;
      padding: 10px 12px;
    }
    .hud-metric-checkbox-row {
      display: flex;
      align-items: center;
      gap: 8px;
      cursor: pointer;
      user-select: none;
      font-size: 12.5px;
      color: var(--dsw-alias-label-primary, #1f2328);
    }
    .hud-metric-checkbox-row input[type="checkbox"] {
      cursor: pointer;
      accent-color: #3F7A63;
      width: 15px;
      height: 15px;
    }

    /* Add Service Selector Modal */
    .add-service-modal {
      display: grid;
      grid-template-columns: repeat(2, 1fr);
      gap: 10px;
      max-height: 380px;
      overflow-y: auto;
      padding: 4px 0;
    }
    .add-service-option {
      padding: 10px 12px;
      border-radius: 8px;
      border: 1px solid var(--dsw-alias-border-l1, rgba(0, 0, 0, 0.08));
      background: var(--dsw-alias-bg-base, #ffffff);
      cursor: pointer;
      transition: all 0.14s ease;
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .add-service-option:hover {
      border-color: #3F7A63;
      background: rgba(63, 122, 99, 0.04);
      transform: translateY(-1px);
    }
    .add-service-option-name {
      font-size: 13px;
      font-weight: 600;
      color: var(--dsw-alias-label-primary, #111);
    }

    /* Preferences Grouped Cards */
    .quota-pref-card {
      border: 1px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.08));
      border-radius: 8px;
      padding: 16px 18px;
      background: var(--dsw-alias-bg-base, #ffffff);
      display: flex;
      flex-direction: column;
      gap: 14px;
      box-shadow: 0 1px 3px rgba(0, 0, 0, 0.02);
    }
    .pref-card-header {
      font-size: 13.5px;
      font-weight: 700;
      color: var(--dsw-alias-label-primary, #111);
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding-bottom: 6px;
      border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(0, 0, 0, 0.05));
    }
    .pref-card-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 12px;
    }

    /* Modal & Toast */
    .dsh-quota-modal-overlay {
      position: fixed;
      inset: 0;
      background: rgba(0, 0, 0, 0.45);
      backdrop-filter: blur(2px);
      z-index: 99999;
      display: flex;
      align-items: center;
      justify-content: center;
      animation: dshModalFadeIn 0.15s ease-out;
    }
    @keyframes dshModalFadeIn {
      from { opacity: 0; }
      to { opacity: 1; }
    }
    .dsh-quota-modal {
      background: var(--dsw-alias-bg-base, #ffffff);
      color: var(--dsw-alias-label-primary, #1f2328);
      border: 1px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.15));
      border-radius: 12px;
      padding: 20px 24px;
      width: 90%;
      max-width: 440px;
      box-shadow: 0 12px 36px rgba(0, 0, 0, 0.24);
      display: flex;
      flex-direction: column;
      gap: 14px;
      animation: dshModalScaleIn 0.15s cubic-bezier(0.16, 1, 0.3, 1);
    }
    @keyframes dshModalScaleIn {
      from { transform: scale(0.94); opacity: 0; }
      to { transform: scale(1); opacity: 1; }
    }
    .dsh-quota-modal-title {
      font-size: 16px;
      font-weight: 700;
      color: var(--dsw-alias-label-primary, #1f2328);
    }
    .dsh-quota-modal-body {
      font-size: 13.5px;
      color: var(--dsw-alias-label-secondary, #57606a);
      line-height: 1.5;
    }
    .dsh-quota-modal-footer {
      display: flex;
      justify-content: flex-end;
      gap: 10px;
      margin-top: 6px;
    }
    .dsh-quota-toast {
      position: fixed;
      top: 24px;
      left: 50%;
      transform: translateX(-50%) translateY(-20px) scale(0.95);
      background: var(--dsw-alias-label-primary, #1f2328);
      color: #ffffff;
      padding: 9px 20px;
      border-radius: 20px;
      font-size: 13px;
      font-weight: 500;
      z-index: 100000;
      opacity: 0;
      pointer-events: none;
      transition: transform 0.22s cubic-bezier(0.16, 1, 0.3, 1), opacity 0.2s ease;
      box-shadow: 0 6px 20px rgba(0, 0, 0, 0.22);
      display: flex;
      align-items: center;
      gap: 8px;
      white-space: nowrap;
    }
    .dsh-quota-toast.show {
      opacity: 1;
      transform: translateX(-50%) translateY(0) scale(1);
      pointer-events: auto;
    }
    .dsh-quota-toast.success {
      background: #2da44e;
    }
    .dsh-quota-toast.error {
      background: #cf222e;
    }
    .dsh-quota-toast.info {
      background: #0969da;
    }
  `
  document.head.appendChild(styleEl)

  // Local UI state
  let settingsSubTab: 'services' | 'preferences' = 'services'
  let activeDrawerTarget: DrawerTarget | null = null
  let isDrawerOpen = false
  let isAddServiceModalOpen = false
  // True while the user has unsaved edits in the panel: background polling must
  // not rebuild the content area and wipe them.
  let settingsDirty = false
  // Nodes appended to document.body by this view (confirm overlays, toast).
  const externalNodes = new Set<HTMLElement>()

  function isEditingInsideContainer(): boolean {
    if (typeof document === 'undefined') return false
    const active = document.activeElement as HTMLElement | null
    if (active === null || !container.contains(active)) return false
    const tag = active.tagName
    return tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA'
  }

  function confirmModal(opts: Parameters<typeof showConfirmModal>[0]): void {
    showConfirmModal(opts, overlay => externalNodes.add(overlay))
  }

  function closeDrawer() {
    isDrawerOpen = false
    activeDrawerTarget = null
    update()
  }

  function openDrawer(target: DrawerTarget) {
    activeDrawerTarget = target
    isDrawerOpen = true
    isAddServiceModalOpen = false
    update()
  }

  function renderDrawerBody(target: DrawerTarget | null, cfg: QuotaConfig, cards: AuthCardItem[]): string {
    if (!target) return ''

    const testRes = target.kind === 'provider' ? controller.getSnapshot().testResults[target.id] : undefined
    const hudMetrics = getAvailableHudMetricsForTarget(target, cards)
    const provId = target.kind === 'custom' ? target.endpoint.id : (target.kind === 'new_custom' ? '' : target.id)
    const selectedMetrics = cfg.floatingHudMetrics
    const hasCustomSelection = Array.isArray(selectedMetrics) && selectedMetrics.some(k => typeof k === 'string' && (k.startsWith(`${provId}::`) || (target.kind === 'provider' && k.startsWith(`${target.id}::`))))

    const isMetricChecked = (key: string): boolean => {
      if (!hasCustomSelection) return true
      if (!Array.isArray(selectedMetrics)) return true
      if (selectedMetrics.includes(`${provId}::__none__`) || (target.kind === 'provider' && selectedMetrics.includes(`${target.id}::__none__`))) return false
      if (selectedMetrics.includes(key)) return true
      if (provId === 'antigravity') {
        const lowerKey = key.toLowerCase()
        const isWeekly = lowerKey.includes('weekly')
        const isGemini = lowerKey.includes('gemini')
        const isClaude = lowerKey.includes('claude') || lowerKey.includes('gpt')
        return selectedMetrics.some(sel => {
          if (typeof sel !== 'string' || !sel.startsWith('antigravity::')) return false
          if (sel.includes('__none__')) return false
          const l = decodeURIComponent(sel).toLowerCase()
          const selWeekly = l.includes('weekly') || l.includes('周')
          const sel5h = l.includes('5h') || l.includes('5-hour') || l.includes('five') || l.includes('5小时')
          const selGemini = l.includes('gemini')
          const selClaude = l.includes('claude') || l.includes('gpt')

          if (isGemini && selGemini && ((isWeekly && selWeekly) || (!isWeekly && sel5h))) return true
          if (isClaude && selClaude && ((isWeekly && selWeekly) || (!isWeekly && sel5h))) return true
          if ((isWeekly && selWeekly) || (!isWeekly && sel5h)) return true
          return false
        })
      }
      return false
    }

    const hudMetricsHtml = hudMetrics.length > 0 ? `
      <div class="drawer-hud-section">
        <div class="drawer-hud-header">
          <span style="font-size: 12.5px; font-weight: 600;">悬浮球轮播显示项</span>
          <span style="font-size: 11px; color: var(--dsw-alias-label-tertiary);">勾选需在悬浮球中轮播的指标项</span>
        </div>
        <div class="drawer-hud-list">
          ${hudMetrics.map(m => {
            const isChecked = isMetricChecked(m.key)
            return `
              <label class="hud-metric-checkbox-row">
                <input type="checkbox" class="cb-hud-metric" data-key="${m.key}" ${isChecked ? 'checked' : ''} />
                <span>${m.label}</span>
              </label>
            `
          }).join('')}
        </div>
      </div>
    ` : ''

    if (target.kind === 'new_custom' || target.kind === 'custom') {
      const ep = target.kind === 'custom' ? target.endpoint : { id: '', name: '', baseUrl: 'https://api.openai.com', apiKey: '' }
      return `
        <div style="display: flex; flex-direction: column; gap: 6px;">
          <label style="font-size: 12.5px; font-weight: 600;">显示名称 (自定义) <span style="color: #cf222e;">*</span></label>
          <input type="text" id="drawer-custom-name-input" class="quota-input" placeholder="例如：NewAPI 分发站 / OneAPI 主池" value="${esc(ep.name || '')}" />
        </div>
        <div style="display: flex; flex-direction: column; gap: 6px;">
          <label style="font-size: 12.5px; font-weight: 600;">Base URL <span style="color: #cf222e;">*</span></label>
          <input type="text" id="drawer-cust-base" class="quota-input" placeholder="https://api.my-oneapi.com" value="${esc(ep.baseUrl || '')}" />
        </div>
        <div style="display: flex; flex-direction: column; gap: 6px;">
          <label style="font-size: 12.5px; font-weight: 600;">API Key <span style="color: #cf222e;">*</span></label>
          <div class="quota-input-affix-wrap">
            <input type="password" id="drawer-cust-key" class="quota-input" placeholder="sk-... / Key" value="${esc(ep.apiKey || '')}" />
            <button type="button" class="btn-toggle-eye" data-target="#drawer-cust-key" title="切换显隐">👁</button>
          </div>
        </div>
        <div class="drawer-test-row">
          <button type="button" class="quota-btn secondary action btn-drawer-test-cust">测试连接</button>
          <span class="drawer-test-result" id="drawer-test-result"></span>
        </div>
        ${hudMetricsHtml}
      `
    }

    const prov = target.id
    const meta = PROVIDER_METAS[prov]
    if (!meta) return ''

    const provConf = (cfg as any)[prov] || {}
    const credInfo = getCredentialInfo(prov, cfg)
    const currentCustomName = cfg.customNames?.[prov] || provConf.name || ''

    let customFieldsHtml = ''

    if (prov === 'cursor') {
      customFieldsHtml = `
        <div style="display: flex; align-items: center; justify-content: space-between; padding: 6px 0;">
          <div>
            <span style="font-size: 12.5px; font-weight: 600;">自动探测本地 state.vscdb</span>
            ${renderHelp('自动读取本地 Cursor 本地数据库免密获取状态')}
          </div>
          <label class="quota-switch">
            <input type="checkbox" id="drawer-cursor-auto" ${provConf.autoDetectLocal !== false ? 'checked' : ''} />
            <span class="quota-switch-slider"></span>
          </label>
        </div>
        <div style="display: flex; flex-direction: column; gap: 6px;">
          <label style="font-size: 12.5px; font-weight: 600;">Session Token (WorkosCursorSessionToken)</label>
          <div class="quota-input-affix-wrap">
            <input type="password" id="drawer-key-input" class="quota-input" placeholder="从浏览器 Cookie 复制 WorkosCursorSessionToken" value="${esc(provConf.sessionToken || '')}" />
            <button type="button" class="btn-toggle-eye" data-target="#drawer-key-input" title="切换显隐">👁</button>
          </div>
          <button type="button" class="quota-btn secondary action btn-connect-cursor" style="align-self: flex-start; margin-top: 4px;">从本地 Cursor 提取登录态</button>
        </div>
      `
    } else if (prov === 'antigravity') {
      const isAuthed = Boolean(provConf.oauth?.accessToken)
      const email = provConf.oauth?.email || ''
      customFieldsHtml = `
        <div style="display: flex; align-items: center; justify-content: space-between; padding: 6px 0;">
          <div>
            <span style="font-size: 12.5px; font-weight: 600;">自动探测本地 gcloud/auth</span>
          </div>
          <label class="quota-switch">
            <input type="checkbox" id="drawer-antigravity-auto" ${provConf.autoDetectLocal !== false ? 'checked' : ''} />
            <span class="quota-switch-slider"></span>
          </label>
        </div>
        <div style="display: flex; align-items: center; gap: 10px; margin-top: 4px;">
          <button type="button" class="quota-btn secondary action btn-login-antigravity">${isAuthed ? '重新授权 Google' : 'Google 账号授权登录'}</button>
          <span style="font-size: 12px; color: ${isAuthed ? '#3F7A63' : 'var(--dsw-alias-label-tertiary)'}; font-weight: 600;">
            ${isAuthed ? `✓ 已连接 (${email || '已授权'})` : '未连接'}
          </span>
        </div>
      `
    } else if (prov === 'codex') {
      const isAuthed = Boolean(provConf.oauth?.accessToken)
      customFieldsHtml = `
        <div style="display: flex; align-items: center; justify-content: space-between; padding: 6px 0;">
          <div>
            <span style="font-size: 12.5px; font-weight: 600;">自动探测本地 auth.json</span>
          </div>
          <label class="quota-switch">
            <input type="checkbox" id="drawer-codex-auto" ${provConf.autoDetectLocal !== false ? 'checked' : ''} />
            <span class="quota-switch-slider"></span>
          </label>
        </div>
        <div style="display: flex; align-items: center; gap: 10px; margin-top: 4px;">
          <button type="button" class="quota-btn secondary action btn-login-codex">ChatGPT 授权登录</button>
          <span style="font-size: 12px; color: ${isAuthed ? '#3F7A63' : 'var(--dsw-alias-label-tertiary)'}; font-weight: 600;">
            ${isAuthed ? '✓ 已获得授权 Token' : '未登录'}
          </span>
        </div>
        <div style="display: flex; flex-direction: column; gap: 6px; margin-top: 8px;">
          <label style="font-size: 12.5px; font-weight: 600;">手动填入 Access Token (可选)</label>
          <div class="quota-input-affix-wrap">
            <input type="password" id="drawer-key-input" class="quota-input" placeholder="access_token" value="${esc(provConf.oauth?.accessToken || '')}" />
            <button type="button" class="btn-toggle-eye" data-target="#drawer-key-input" title="切换显隐">👁</button>
          </div>
        </div>
      `
    } else if (prov === 'github_copilot') {
      customFieldsHtml = `
        <div style="display: flex; align-items: center; justify-content: space-between; padding: 6px 0;">
          <div>
            <span style="font-size: 12.5px; font-weight: 600;">自动探测本地 VS Code 凭据</span>
          </div>
          <label class="quota-switch">
            <input type="checkbox" id="drawer-copilot-auto" ${provConf.autoDetectLocal !== false ? 'checked' : ''} />
            <span class="quota-switch-slider"></span>
          </label>
        </div>
        <div style="display: flex; flex-direction: column; gap: 6px; margin-top: 4px;">
          <label style="font-size: 12.5px; font-weight: 600;">GitHub Token (可选手动填入)</label>
          <div class="quota-input-affix-wrap">
            <input type="password" id="drawer-key-input" class="quota-input" placeholder="gho_... / ghp_..." value="${esc(provConf.token || '')}" />
            <button type="button" class="btn-toggle-eye" data-target="#drawer-key-input" title="切换显隐">👁</button>
          </div>
        </div>
      `
    } else {
      customFieldsHtml = `
        <div style="display: flex; flex-direction: column; gap: 6px;">
          <label style="font-size: 12.5px; font-weight: 600;">${meta.keyLabel || 'API Key'} <span style="color: #cf222e;">*</span></label>
          <div class="quota-input-affix-wrap">
            <input type="password" id="drawer-key-input" class="quota-input" placeholder="${meta.keyPlaceholder || 'API Key'}" value="${esc(provConf.apiKey || '')}" />
            <button type="button" class="btn-toggle-eye" data-target="#drawer-key-input" title="切换显隐">👁</button>
          </div>
        </div>
        ${meta.hasGroupId ? `
          <div style="display: flex; flex-direction: column; gap: 6px;">
            <label style="font-size: 12.5px; font-weight: 600;">Group ID</label>
            <input type="text" id="drawer-group-input" class="quota-input" placeholder="Group ID" value="${esc(provConf.groupId || '')}" />
          </div>
        ` : ''}
        ${meta.hasBaseUrl ? `
          <div style="display: flex; flex-direction: column; gap: 6px;">
            <label style="font-size: 12.5px; font-weight: 600;">Base URL (选填)</label>
            <input type="text" id="drawer-base-input" class="quota-input" placeholder="默认: ${meta.defaultBaseUrl || ''}" value="${esc(provConf.baseUrl || '')}" />
          </div>
        ` : ''}
      `
    }

    return `
      <div style="display: flex; flex-direction: column; gap: 6px;">
        <label style="font-size: 12.5px; font-weight: 600;">自定义显示名称 (选填)</label>
        <input type="text" id="drawer-custom-name-input" class="quota-input" placeholder="默认: ${meta.name}" value="${esc(currentCustomName)}" />
      </div>

      ${credInfo.isConfigured ? `
        <div class="drawer-info-card">
          <div class="drawer-info-row">
            <span class="drawer-info-label">凭据状态</span>
            <span class="drawer-info-val" style="color: #3F7A63;">● ${credInfo.displayValue}</span>
          </div>
          <div class="drawer-info-row">
            <span class="drawer-info-label">连接测活</span>
            <span class="drawer-info-val" style="color: ${testRes?.ok ? '#3F7A63' : (testRes ? '#B04A46' : 'var(--dsw-alias-label-tertiary)')};">
              ${testRes ? (testRes.ok ? `正常 · ${testRes.latencyMs ?? 0}ms` : `异常 · ${testRes.message || '连接失败'}`) : '未测活'}
            </span>
          </div>
        </div>
      ` : ''}

      ${customFieldsHtml}

      <div class="drawer-test-row">
        <button type="button" class="quota-btn secondary action btn-drawer-test">测试连接</button>
        <span class="drawer-test-result" id="drawer-test-result"></span>
      </div>

      ${hudMetricsHtml}
    `
  }

  function update() {
    const state = controller.getSnapshot()
    if (!state.panelOpen) return

    // Prevent background polling from destroying active modal and wiping user input
    const modalAlreadyRendered = container.querySelector('#dsh-details-modal-overlay') || container.querySelector('#dsh-add-service-modal-overlay')
    if (modalAlreadyRendered && (isDrawerOpen || isAddServiceModalOpen)) {
      return
    }

    // Polling / focus refresh must not rebuild the content area while the user is
    // editing a field or has unsaved changes: the rebuild resets scroll and inputs.
    if (settingsDirty || isEditingInsideContainer()) {
      return
    }

    // innerHTML replaces the whole subtree, so remember the scroll offset and
    // restore it after the rebuild (the container itself is the scroll box).
    const previousScrollTop = container.scrollTop

    const cfg = state.config || {}
    let contentHtml = ''

    if (state.activeTab === 'overview') {
      // 1. Summary Grid
      const totalServices = state.cards.length
      const activeServices = state.cards.filter(c => c.status === 'ok' || c.status === 'warn').length
      const alarmCount = state.alarms.length

      const summaryGridHtml = `
        <div class="dashboard-summary-grid">
          <div class="summary-card">
            <span class="summary-card-label">已监控服务</span>
            <span class="summary-card-val">${totalServices}</span>
          </div>
          <div class="summary-card">
            <span class="summary-card-label">正常运行</span>
            <span class="summary-card-val" style="color: #3F7A63;">${activeServices}</span>
          </div>
          <div class="summary-card">
            <span class="summary-card-label">告警 / 异常</span>
            <span class="summary-card-val" style="color: ${alarmCount > 0 ? '#B04A46' : 'var(--dsw-alias-label-secondary)'};">${alarmCount}</span>
          </div>
          <div class="summary-card">
            <span class="summary-card-label">自动刷新</span>
            <span class="summary-card-val" style="font-size: 14px; margin-top: 4px;">每 ${state.config?.refreshIntervalSeconds ?? 60}s</span>
          </div>
        </div>
      `

      // 2. Category tabs
      const categories: Array<'all' | ProviderCategory> = ['all', 'domestic_llm', 'ide', 'official_cloud', 'custom_api']
      const categoryTabsHtml = `
        <div class="category-filter-bar">
          ${categories.map(cat => `
            <button class="category-chip ${state.activeCategory === cat ? 'active' : ''}" data-cat="${cat}">
              ${CATEGORY_NAMES[cat]}
            </button>
          `).join('')}
        </div>
      `

      // 3. Sections list
      const sectionsHtml = state.cards.length === 0
        ? `
          <div style="text-align: center; color: var(--dsw-alias-label-tertiary, #888); padding: 56px 20px; display: flex; flex-direction: column; align-items: center; gap: 10px;">
            <span style="font-size: 15px; font-weight: 600; color: var(--dsw-alias-label-secondary);">暂无可展示的服务</span>
            <span style="font-size: 12.5px; max-width: 400px; line-height: 1.5;">请在「设置」中添加服务并保存凭据，开启「看板」开关后即可在此展示</span>
            <button type="button" class="quota-btn secondary btn-goto-settings" style="margin-top: 8px; padding: 5px 14px; font-size: 12.5px;">前往服务管理</button>
          </div>
        `
        : state.cards.map((card) => {
            const isErr = card.status === 'error' || card.status === 'disabled'
            const isRefreshing = state.refreshingProviders.has(card.id) || state.refreshingProviders.has(card.provider)

            let actionBtn = ''
            if (card.provider === 'codex' && isErr) {
              actionBtn = '<button class="quota-btn action btn-login-codex">登录 OpenAI</button>'
            } else if (card.provider === 'cursor' && isErr) {
              actionBtn = '<button class="quota-btn action btn-login-cursor">连接 Cursor</button>'
            } else if (card.provider === 'antigravity' && isErr) {
              actionBtn = '<button class="quota-btn action btn-login-antigravity">登录 Google</button>'
            }

            let bodyHtml = ''
            if (isErr) {
              bodyHtml = `
                <div class="official-long-card">
                  <div class="card-row">
                    <div class="row-left-content">
                      <span class="row-main-label" style="color: var(--dsw-alias-label-error, #cf222e);">${card.error || '未连接'}</span>
                      <span class="row-sub-label">请在设置中检查凭据配置</span>
                    </div>
                    <div>${actionBtn}</div>
                  </div>
                </div>
              `
            } else {
              bodyHtml = card.groups.map((group, gIdx) => {
                const groupKey = `${card.id}::${group.title}::${gIdx}`
                const isCollapsed = state.collapsedGroups.has(groupKey)

                const rowsHtml = group.windows.map(win => {
                  const kind = windowQuotaKind(win)
                  const quantified = isQuantified(win)
                  const subText = formatWindowSubtitle(win)

                  // Balance-only windows: show the truthful amount, never a ratio.
                  if (kind === 'balance') {
                    const amountText = typeof win.amountText === 'string' && win.amountText.trim() !== ''
                      ? win.amountText.trim()
                      : '—'
                    const amountColor = amountText === '—'
                      ? 'var(--dsw-alias-label-tertiary, #888)'
                      : 'var(--dsw-alias-label-primary, #1f2328)'
                    return `
                      <div class="card-row">
                        <div class="row-left-content">
                          <span class="row-main-label" title="${win.label}">${win.label}</span>
                          <span class="row-sub-label" title="${subText}">${subText}</span>
                        </div>
                        <div class="row-right-metric">
                          <div style="display: flex; flex-direction: column; align-items: flex-end; gap: 1px;">
                            <span class="row-amount-number" style="color: ${amountColor};">${amountText}</span>
                            <span class="row-metric-caption">余额</span>
                          </div>
                        </div>
                      </div>
                    `
                  }

                  // Connectivity-only window: no ring, no percentage, no "额度充足".
                  if (kind === 'liveness') {
                    return `
                      <div class="card-row">
                        <div class="row-left-content">
                          <span class="row-main-label" title="${win.label}">${win.label}</span>
                          <span class="row-sub-label" title="${subText}">${subText}</span>
                        </div>
                        <div class="row-right-metric">
                          <span class="quota-kind-badge">仅连通性</span>
                        </div>
                      </div>
                    `
                  }

                  // `unknown`, or a malformed `usage` window without two finite percentages.
                  if (!quantified) {
                    return `
                      <div class="card-row">
                        <div class="row-left-content">
                          <span class="row-main-label" title="${win.label}">${win.label}</span>
                          <span class="row-sub-label" title="${subText}">${subText}</span>
                        </div>
                        <div class="row-right-metric">
                          <span class="row-percent-number is-unknown">—</span>
                        </div>
                      </div>
                    `
                  }

                  const rem = Math.max(0, Math.min(100, Math.round(win.remainingPercent)))
                  const statusColor = getQuotaStatusColor(rem)
                  return `
                    <div class="card-row">
                      <div class="row-left-content">
                        <span class="row-main-label" title="${win.label}">${win.label}</span>
                        <span class="row-sub-label" title="${subText}">${subText}</span>
                      </div>
                      <div class="row-right-metric">
                        ${Array.isArray(card.sparkline) && card.sparkline.length >= 2 ? renderSparklineSvg(card.sparkline, rem, 80, 24) : ''}
                        <span class="row-percent-number" style="color: ${statusColor};">${rem}%</span>
                        ${renderCircleProgress(rem)}
                      </div>
                    </div>
                  `
                }).join('')

                return `
                  <div class="auth-group-block">
                    <div class="group-header-title" data-group-toggle="${groupKey}">
                      <span>${group.title} (${group.windows.length})</span>
                      <span style="font-size: 11px; opacity: 0.7;">${isCollapsed ? '展开 ▸' : '收起 ▾'}</span>
                    </div>
                    <div class="official-long-card" style="display: ${isCollapsed ? 'none' : 'block'};">
                      ${rowsHtml}
                    </div>
                  </div>
                `
              }).join('')
            }

            // Burn rate is derived from percentages, so it only makes sense when at
            // least one window actually carries a real ratio.
            const hasQuantifiedWindow = card.groups.some(g => g.windows.some(w => isQuantified(w)))
            let rateBadge = ''
            if (hasQuantifiedWindow && card.burnRatePerHour && card.burnRatePerHour > 0) {
              rateBadge = `<span style="font-size: 11.5px; color: var(--dsw-alias-label-tertiary);">消耗: ${card.burnRatePerHour}%/h${card.estimatedHoursLeft ? ` · 余约 ${card.estimatedHoursLeft}h` : ''}</span>`
            }
            const staleBadge = card.stale || card.sourceProvenance?.partial
              ? '<span class="quota-kind-badge" title="数据可能已过期或仅部分窗口可用">缓存</span>'
              : ''

            return `
              <div class="quota-section" data-card-id="${card.id}">
                <div class="auth-title-row">
                  <div class="auth-section-title">
                    <span>${card.name}</span>
                    ${staleBadge}
                  </div>
                  <div style="display: flex; gap: 8px; align-items: center;">
                    ${rateBadge}
                    ${card.account ? `<span style="font-size: 12px; color: var(--dsw-alias-label-secondary);">${card.account}</span>` : ''}
                    <button class="btn-card-refresh ${isRefreshing ? 'spinning' : ''}" data-refresh-id="${card.id}" title="独立刷新此服务">↻</button>
                    ${actionBtn}
                  </div>
                </div>
                ${bodyHtml}
              </div>
            `
          }).join('')

      contentHtml = `
        ${summaryGridHtml}
        ${categoryTabsHtml}
        ${sectionsHtml}
      `
    } else {
      // Settings Tab
      const orderList = cfg.providerOrder && cfg.providerOrder.length > 0 ? cfg.providerOrder : Object.keys(PROVIDER_METAS)
      const enabledProviders = new Set(cfg.enabledProviders || [])
      const hudProviders = new Set(cfg.floatingHudProviders || cfg.enabledProviders || [])

      // Filter only configured items for display
      interface ServiceRowItem {
        id: string
        name: string
        isCustom: boolean
        customIndex?: number
        displayValue: string
      }

      const configuredItems: ServiceRowItem[] = []

      // Custom endpoints
      if (Array.isArray(cfg.custom_compatible)) {
        cfg.custom_compatible.forEach((cust, idx) => {
          const info = getCredentialInfo(cust.id, cfg)
          if (info.isConfigured) {
            configuredItems.push({
              id: cust.id,
              name: getServiceDisplayName(cust.id, cfg, cust.name || `中转站 #${idx + 1}`),
              isCustom: true,
              customIndex: idx,
              displayValue: info.displayValue,
            })
          }
        })
      }

      // Builtin providers
      for (const [id, meta] of Object.entries(PROVIDER_METAS)) {
        const info = getCredentialInfo(id, cfg)
        if (info.isConfigured) {
          configuredItems.push({
            id,
            name: getServiceDisplayName(id, cfg, meta.name),
            isCustom: false,
            displayValue: info.displayValue,
          })
        }
      }

      // Sort items: Chosen for dashboard on top, unchosen at bottom; then by providerOrder
      configuredItems.sort((a, b) => {
        const aChosen = enabledProviders.has(a.id)
        const bChosen = enabledProviders.has(b.id)
        if (aChosen && !bChosen) return -1
        if (!aChosen && bChosen) return 1
        const idxA = orderList.indexOf(a.id)
        const idxB = orderList.indexOf(b.id)
        return (idxA === -1 ? 999 : idxA) - (idxB === -1 ? 999 : idxB)
      })

      if (settingsSubTab === 'services') {
        let tableBodyContent = ''
        if (configuredItems.length === 0) {
          tableBodyContent = `
            <tr>
              <td colspan="5" style="text-align: center; color: var(--dsw-alias-label-tertiary); padding: 42px 14px;">
                暂无已添加的服务，请点击右上角「+ 添加服务」开始接入平台
              </td>
            </tr>
          `
        } else {
          tableBodyContent = configuredItems.map((item) => {
            const isDashOn = enabledProviders.has(item.id)
            const isHudOn = hudProviders.has(item.id)

            return `
              <tr class="quota-table-row" data-service-id="${item.id}">
                <td style="width: 28px; text-align: center;">
                  <span class="sort-drag-handle" draggable="true" title="按住拖动排序">
                    <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor" style="pointer-events: none;">
                      <path d="M5 4a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0zm6 0a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0zm-6 4a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0zm6 0a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0zm-6 4a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0zm6 0a1.5 1.5 0 1 1-3 0 1.5 1.5 0 0 1 3 0z"/>
                    </svg>
                  </span>
                </td>
                <td>
                  <div class="service-name-cell" data-id="${item.id}" data-custom="${item.isCustom ? 'true' : 'false'}" data-idx="${item.customIndex ?? ''}" title="点击打开详细设置">
                    <span>${item.name}</span>
                    ${item.isCustom ? '<span style="font-size: 10px; background: rgba(9, 105, 218, 0.1); color: #0969da; padding: 1px 5px; border-radius: 4px; font-weight: 500;">中转</span>' : ''}
                  </div>
                </td>
                <td style="width: 72px; text-align: center;">
                  <label class="quota-switch" title="在监控看板中展示">
                    <input type="checkbox" class="switch-dashboard cb-show-dashboard" data-id="${item.id}" ${isDashOn ? 'checked' : ''} />
                    <span class="quota-switch-slider"></span>
                  </label>
                </td>
                <td style="width: 72px; text-align: center;">
                  <label class="quota-switch" title="在桌面悬浮球轮播中展示">
                    <input type="checkbox" class="switch-hud cb-show-hud" data-id="${item.id}" ${isHudOn ? 'checked' : ''} />
                    <span class="quota-switch-slider"></span>
                  </label>
                </td>
                <td style="width: 108px; text-align: right;">
                  <div style="display: inline-flex; align-items: center; gap: 4px;">
                    <!-- Small colorless lightning icon for test connection -->
                    <button type="button" class="quota-icon-btn btn-row-test" data-id="${item.id}" title="测试连接">
                      <svg width="13.5" height="13.5" viewBox="0 0 16 16" fill="currentColor" style="pointer-events: none;">
                        <path d="M8.5 1.5a.5.5 0 0 0-.915-.294l-5 7a.5.5 0 0 0 .415.794h3.75l-1.25 5.5a.5.5 0 0 0 .915.294l5-7a.5.5 0 0 0-.415-.794H7.25l1.25-5.5z"/>
                      </svg>
                    </button>
                    <!-- Small gear icon for edit & details -->
                    <button type="button" class="quota-icon-btn btn-open-drawer" data-id="${item.id}" data-custom="${item.isCustom ? 'true' : 'false'}" data-idx="${item.customIndex ?? ''}" title="详细设置">
                      <svg width="13.5" height="13.5" viewBox="0 0 16 16" fill="currentColor" style="pointer-events: none;">
                        <path d="M9.405 1.05c-.413-1.4-2.397-1.4-2.81 0l-.1.34a1.464 1.464 0 0 1-2.105.872l-.31-.17c-1.283-.698-2.686.705-1.987 1.987l.169.311c.446.82.023 1.841-.872 2.105l-.34.1c-1.4.413-1.4 2.397 0 2.81l.34.1a1.464 1.464 0 0 1 .872 2.105l-.17.31c-.698 1.283.705 2.686 1.987 1.987l.311-.169a1.464 1.464 0 0 1 2.105.872l.1.34c.413 1.4 2.397 1.4 2.81 0l.1-.34a1.464 1.464 0 0 1 2.105-.872l.31.17c1.283.698 2.686-.705 1.987-1.987l-.169-.311a1.464 1.464 0 0 1 .872-2.105l.34-.1c1.4-.413 1.4-2.397 0-2.81l-.34-.1a1.464 1.464 0 0 1-.872-2.105l.17-.31c.698-1.283-.705-2.686-1.987-1.987l-.311.169a1.464 1.464 0 0 1-2.105-.872l-.1-.34zM8 10.93a2.929 2.929 0 1 1 0-5.86 2.929 2.929 0 0 1 0 5.858z"/>
                      </svg>
                    </button>
                    <!-- Small trash icon for delete -->
                    <button type="button" class="quota-icon-btn danger btn-row-delete" data-id="${item.id}" data-custom="${item.isCustom ? 'true' : 'false'}" data-idx="${item.customIndex ?? ''}" title="删除凭据">
                      <svg width="13.5" height="13.5" viewBox="0 0 16 16" fill="currentColor" style="pointer-events: none;">
                        <path d="M5.5 5.5A.5.5 0 0 1 6 6v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm2.5 0a.5.5 0 0 1 .5.5v6a.5.5 0 0 1-1 0V6a.5.5 0 0 1 .5-.5zm3 .5a.5.5 0 0 0-1 0v6a.5.5 0 0 0 1 0V6z"/>
                        <path fill-rule="evenodd" d="M14.5 3a1 1 0 0 1-1 1H13v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V4h-.5a1 1 0 0 1-1-1V2a1 1 0 0 1 1-1H6a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1h3.5a1 1 0 0 1 1 1v1zM4.118 4 4 4.059V13a1 1 0 0 0 1 1h6a1 1 0 0 0 1-1V4.059L11.882 4H4.118zM2.5 3V2h11v1h-11z"/>
                      </svg>
                    </button>
                  </div>
                </td>
              </tr>
            `
          }).join('')
        }

        contentHtml = `
          <div class="quota-settings-nav">
            <div class="quota-segmented">
              <button type="button" class="quota-segmented-btn active" data-subtab="services">
                已添加服务
                <span class="quota-count-pill">${configuredItems.length}</span>
              </button>
              <button type="button" class="quota-segmented-btn" data-subtab="preferences">
                偏好与告警设置
              </button>
            </div>
            <div style="display: flex; gap: 8px; align-items: center;">
              <button type="button" class="quota-btn action btn-add-service">+ 添加服务</button>
              <button type="button" class="quota-btn secondary action btn-test-all">
                ${state.testingAll ? '测活中...' : '一键全部测活'}
              </button>
            </div>
          </div>

          <div class="quota-table-wrap">
            <table class="quota-table">
              <thead>
                <tr>
                  <th style="width: 28px;"></th>
                  <th>服务名称</th>
                  <th style="width: 72px; text-align: center;">看板</th>
                  <th style="width: 72px; text-align: center;">悬浮球</th>
                  <th style="width: 108px; text-align: right;">操作</th>
                </tr>
              </thead>
              <tbody>
                ${tableBodyContent}
              </tbody>
            </table>
          </div>
        `
      } else {
        // Preferences & Alerts Sub-tab
        const showHud = cfg.showFloatingHud !== false
        const enableNotify = cfg.enableNotification !== false
        const alarmThreshold = cfg.alarmThresholdPercent ?? 15
        const selectedSec = cfg.refreshIntervalSeconds ?? 60

        contentHtml = `
          <div class="quota-settings-nav">
            <div class="quota-segmented">
              <button type="button" class="quota-segmented-btn" data-subtab="services">
                已添加服务
                <span class="quota-count-pill">${configuredItems.length}</span>
              </button>
              <button type="button" class="quota-segmented-btn active" data-subtab="preferences">
                偏好与告警设置
              </button>
            </div>
          </div>

          <form id="quota-pref-form" style="display: flex; flex-direction: column; gap: 14px;">
            <!-- HUD Card -->
            <div class="quota-pref-card">
              <div class="pref-card-header">
                <span>桌面悬浮环 (HUD)</span>
                <label class="quota-switch">
                  <input type="checkbox" id="pref-hud-switch" ${showHud ? 'checked' : ''} />
                  <span class="quota-switch-slider"></span>
                </label>
              </div>
              <span style="font-size: 12px; color: var(--dsw-alias-label-secondary); line-height: 1.5;">
                在界面右侧显示可拖动的环形额度指示器，支持实时轮播速览各模型余量并自动贴边吸附。
              </span>
            </div>

            <!-- Alerts Card -->
            <div class="quota-pref-card">
              <div class="pref-card-header">
                <span>告警与通知 (Notification)</span>
                <label class="quota-switch">
                  <input type="checkbox" id="pref-notify-switch" ${enableNotify ? 'checked' : ''} />
                  <span class="quota-switch-slider"></span>
                </label>
              </div>
              <span style="font-size: 12px; color: var(--dsw-alias-label-secondary); line-height: 1.5;">
                当模型额度低于警戒阈值或连接失效时触发系统级桌面气泡通知。
              </span>
              <div class="pref-card-row" style="border-top: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,0.05)); padding-top: 10px;">
                <div>
                  <span style="font-size: 12.5px; font-weight: 600;">低额度警戒阈值</span>
                  ${renderHelp('当剩余额度百分比低于此数值时触发警告徽章与系统通知')}
                </div>
                <div style="display: flex; align-items: center; gap: 10px;">
                  <input type="range" id="pref-alarm-slider" min="5" max="50" step="5" value="${esc(alarmThreshold)}" style="width: 140px; cursor: pointer;" />
                  <span id="pref-alarm-val" style="font-size: 13px; font-weight: 700; color: #3F7A63; min-width: 36px;">${alarmThreshold}%</span>
                </div>
              </div>
            </div>

            <!-- Network & Refresh Card -->
            <div class="quota-pref-card">
              <div class="pref-card-header">
                <span>网络代理与自动刷新</span>
              </div>
              <div class="pref-card-row">
                <div>
                  <span style="font-size: 12.5px; font-weight: 600;">定时自动刷新频率</span>
                </div>
                <select id="pref-refresh-select" class="quota-input" style="width: 160px;">
                  <option value="10" ${selectedSec === 10 ? 'selected' : ''}>每 10 秒</option>
                  <option value="30" ${selectedSec === 30 ? 'selected' : ''}>每 30 秒</option>
                  <option value="60" ${selectedSec === 60 ? 'selected' : ''}>每 1 分钟 (推荐)</option>
                  <option value="120" ${selectedSec === 120 ? 'selected' : ''}>每 2 分钟</option>
                  <option value="300" ${selectedSec === 300 ? 'selected' : ''}>每 5 分钟</option>
                  <option value="600" ${selectedSec === 600 ? 'selected' : ''}>每 10 分钟</option>
                </select>
              </div>
              <div style="display: flex; flex-direction: column; gap: 6px; border-top: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,0.05)); padding-top: 10px;">
                <span style="font-size: 12.5px; font-weight: 600;">网络代理 (HTTP Proxy)</span>
                <input type="text" id="pref-proxy-input" class="quota-input" placeholder="例如: http://127.0.0.1:7890 (留空直连)" value="${esc(cfg.httpProxy || '')}" />
              </div>
            </div>

            <!-- Backup & Restore Card -->
            <div class="quota-pref-card">
              <div class="pref-card-header">
                <span>配置备份与跨机迁移</span>
              </div>
              <span style="font-size: 12px; color: var(--dsw-alias-label-secondary); line-height: 1.5;">
                支持将当前所有 Provider 凭据、偏好设置及自定义中转站导出为 JSON 文件，或从已有备份中快速导入恢复。
              </span>
              <div style="display: flex; gap: 8px; flex-wrap: wrap; margin-top: 10px; padding-top: 10px; border-top: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,0.05));">
                <button type="button" class="quota-btn secondary" id="btn-export-safe">导出脱敏备份</button>
                <button type="button" class="quota-btn secondary" id="btn-export-full">导出完整结构 (凭据仍脱敏)</button>
                <button type="button" class="quota-btn secondary" id="btn-import-config">导入配置文件</button>
                <input type="file" id="input-import-file" accept=".json" style="display: none;" />
              </div>
            </div>

            <div style="display: flex; justify-content: flex-end; margin-top: 4px;">
              <button type="submit" class="quota-btn">保存偏好设置</button>
            </div>
          </form>
        `
      }
    }

    // Drawer Title
    let drawerTitle = '配置凭据'
    let isDrawerTargetConfigured = false
    if (activeDrawerTarget) {
      if (activeDrawerTarget.kind === 'new_custom') {
        drawerTitle = '添加自定义中转站'
      } else if (activeDrawerTarget.kind === 'custom') {
        drawerTitle = `编辑 · ${activeDrawerTarget.endpoint.name}`
        isDrawerTargetConfigured = true
      } else {
        const meta = PROVIDER_METAS[activeDrawerTarget.id]
        if (meta) {
          const currentCustomName = cfg.customNames?.[activeDrawerTarget.id] || (cfg as any)[activeDrawerTarget.id]?.name
          drawerTitle = currentCustomName || meta.name
          isDrawerTargetConfigured = getCredentialInfo(activeDrawerTarget.id, state.config || {}).isConfigured
        }
      }
    }

    // Add service modal content (unconfigured providers)
    let addServiceModalHtml = ''
    if (isAddServiceModalOpen) {
      const unconfigured = Object.entries(PROVIDER_METAS).filter(([id]) => !getCredentialInfo(id, state.config || {}).isConfigured)
      const optionsHtml = unconfigured.map(([id, meta]) => `
        <div class="add-service-option" data-id="${id}">
          <span class="add-service-option-name">${meta.name}</span>
          <span style="font-size: 11px; color: #3F7A63; font-weight: 600;">+ 配置</span>
        </div>
      `).join('')

      addServiceModalHtml = `
        <div id="dsh-add-service-overlay" class="dsh-quota-modal-overlay">
          <div class="dsh-quota-modal" style="max-width: 460px;">
            <div style="display: flex; justify-content: space-between; align-items: center;">
              <div class="dsh-quota-modal-title">选择要添加的服务</div>
              <button type="button" class="btn-drawer-close btn-close-add-modal" style="font-size: 16px;">✕</button>
            </div>
            <div class="add-service-modal">
              ${optionsHtml || '<div style="grid-column: span 2; text-align: center; color: var(--dsw-alias-label-tertiary); padding: 20px 0;">已添加所有支持的官方服务</div>'}
            </div>
            <div style="border-top: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,0.06)); padding-top: 10px; display: flex; justify-content: space-between; align-items: center;">
              <button type="button" class="quota-btn secondary action btn-modal-add-custom">+ 自定义 OneAPI / NewAPI 中转</button>
              <button type="button" class="quota-btn secondary action btn-close-add-modal">取消</button>
            </div>
          </div>
        </div>
      `
    }

    // Detailed settings modal content
    let detailsModalHtml = ''
    if (isDrawerOpen && activeDrawerTarget) {
      const cards = state.allCards && state.allCards.length > 0 ? state.allCards : state.cards
      detailsModalHtml = `
        <div id="dsh-details-modal-overlay" class="dsh-quota-modal-overlay">
          <div class="dsh-quota-modal dsh-details-modal">
            <div class="dsh-modal-header">
              <div class="dsh-drawer-title-wrap">
                <span class="dsh-drawer-title">${drawerTitle}</span>
                <span style="font-size: 11.5px; color: var(--dsw-alias-label-secondary); margin-left: 2px;">详细设置</span>
              </div>
              <button type="button" class="btn-drawer-close btn-close-details-modal" title="关闭 (Esc)">✕</button>
            </div>
            <div class="dsh-drawer-body">
              ${renderDrawerBody(activeDrawerTarget, cfg, cards)}
            </div>
            <div class="dsh-drawer-footer">
              <button type="button" class="quota-btn danger btn-drawer-delete" style="display: ${isDrawerTargetConfigured ? 'inline-block' : 'none'};">删除凭据</button>
              <div style="display: flex; gap: 8px; margin-left: auto;">
                <button type="button" class="quota-btn secondary btn-drawer-cancel">取消</button>
                <button type="button" class="quota-btn btn-drawer-save">保存并生效</button>
              </div>
            </div>
          </div>
        </div>
      `
    }

    const lastUpdatedClock = formatClockTime(state.lastUpdated)
    const lastUpdatedLabel = lastUpdatedClock !== '' ? `最后更新 ${lastUpdatedClock}` : '尚未更新'
    const errorBannerHtml = state.error
      ? `
        <div class="quota-error-banner" role="alert">
          <span style="flex: none; font-weight: 600;">⚠ 刷新失败</span>
          <span class="quota-error-text" title="${esc(state.error)}">${esc(state.error)}</span>
          ${lastUpdatedClock !== '' ? `<span class="quota-error-time">显示 ${lastUpdatedClock} 的缓存数据</span>` : ''}
          <button type="button" class="quota-btn secondary btn-retry-refresh" style="flex: none; padding: 3px 10px; font-size: 11.5px;">重试</button>
        </div>
      `
      : ''

    container.innerHTML = `
      <div class="quota-container">
        <div class="quota-header">
          <div class="quota-title">
            <span>AI 额度监控</span>
            <span class="quota-version-tag">v0.4.1</span>
            <span class="quota-updated-tag" title="数据最后更新时间">${lastUpdatedLabel}</span>
            ${state.loading ? '<span style="font-size: 12px; font-weight: normal; color: var(--dsw-alias-brand-primary, #0969da); margin-left: 8px;">正在刷新...</span>' : ''}
          </div>
          <div style="display: flex; gap: 10px; align-items: center;">
            <div class="quota-tabs">
              <button id="tab-overview" class="quota-tab-btn ${state.activeTab === 'overview' ? 'active' : ''}">监控看板</button>
              <button id="tab-settings" class="quota-tab-btn ${state.activeTab === 'settings' ? 'active' : ''}">设置</button>
            </div>
            <button id="btn-refresh" class="quota-btn secondary">↻ 全部刷新</button>
          </div>
        </div>
        ${errorBannerHtml}
        ${contentHtml}
      </div>

      ${addServiceModalHtml}
      ${detailsModalHtml}
    `

    // Restore the scroll offset the user had before this (polling-driven) rebuild.
    if (previousScrollTop > 0) container.scrollTop = previousScrollTop

    // Navigation events
    container.querySelector('#tab-overview')?.addEventListener('click', () => controller.setTab('overview'))
    container.querySelector('#tab-settings')?.addEventListener('click', () => controller.setTab('settings'))
    container.querySelector('#btn-refresh')?.addEventListener('click', () => controller.refresh(true))
    container.querySelector('.btn-retry-refresh')?.addEventListener('click', () => void controller.refresh(true))
    container.querySelector('.btn-goto-settings')?.addEventListener('click', () => controller.setTab('settings'))

    // Overview: Category chips & Accordions
    container.querySelectorAll('.category-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const cat = chip.getAttribute('data-cat') as any
        if (cat) controller.setCategory(cat)
      })
    })
    container.querySelectorAll('[data-group-toggle]').forEach(el => {
      el.addEventListener('click', () => {
        const key = el.getAttribute('data-group-toggle')
        if (key) controller.toggleGroupCollapse(key)
      })
    })
    container.querySelectorAll('.btn-card-refresh').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation()
        const id = btn.getAttribute('data-refresh-id')
        if (id) void controller.refreshSingle(id)
      })
    })

    // Settings Sub-tab switching
    container.querySelectorAll('.quota-segmented-btn').forEach(btn => {
      btn.addEventListener('click', () => {
        const sub = btn.getAttribute('data-subtab') as any
        if (sub && sub !== settingsSubTab) {
          settingsSubTab = sub
          update()
        }
      })
    })

    // Add Service Modal trigger & handlers
    container.querySelector('.btn-add-service')?.addEventListener('click', () => {
      isAddServiceModalOpen = true
      update()
    })
    container.querySelectorAll('.btn-close-add-modal').forEach(btn => {
      btn.addEventListener('click', () => {
        isAddServiceModalOpen = false
        update()
      })
    })
    container.querySelector('#dsh-add-service-overlay')?.addEventListener('click', (e) => {
      if (e.target === container.querySelector('#dsh-add-service-overlay')) {
        isAddServiceModalOpen = false
        update()
      }
    })
    container.querySelectorAll('.add-service-option').forEach(opt => {
      opt.addEventListener('click', () => {
        const id = opt.getAttribute('data-id')
        if (id) openDrawer({ kind: 'provider', id })
      })
    })
    container.querySelector('.btn-modal-add-custom')?.addEventListener('click', () => {
      openDrawer({ kind: 'new_custom' })
    })

    // Services Table: Open Detailed Settings (on gear icon OR clicking service name)
    container.querySelectorAll('.btn-open-drawer, .service-name-cell').forEach(el => {
      el.addEventListener('click', (e) => {
        e.stopPropagation()
        const isCustom = el.getAttribute('data-custom') === 'true' || el.closest('[data-custom]')?.getAttribute('data-custom') === 'true'
        const id = el.getAttribute('data-id') || el.closest('[data-id]')?.getAttribute('data-id')
        const currentCfg = controller.getSnapshot().config || {}
        if (isCustom) {
          const idxRaw = el.getAttribute('data-idx') || el.closest('[data-idx]')?.getAttribute('data-idx')
          const idx = Number(idxRaw)
          const ep = currentCfg.custom_compatible?.[idx]
          if (ep) openDrawer({ kind: 'custom', endpoint: ep, index: idx })
        } else if (id) {
          openDrawer({ kind: 'provider', id })
        }
      })
    })

    // Services Table: Single row Test button with Toast & spinning animation (Monochrome lightning bolt)
    container.querySelectorAll('.btn-row-test').forEach(btn => {
      btn.addEventListener('click', async (e) => {
        e.stopPropagation()
        const id = btn.getAttribute('data-id')
        if (!id) return
        btn.classList.add('spinning')
        try {
          const isCustom = id.startsWith('custom_')
          let res
          if (isCustom) {
            const ep = (controller.getSnapshot().config?.custom_compatible || []).find(c => c.id === id)
            const accountConfig: AccountConfigItem | undefined = ep === undefined ? undefined : {
              id: ep.id,
              provider: 'custom_api',
              name: ep.name,
              apiKey: ep.apiKey,
              baseUrl: ep.baseUrl,
              extra: { balancePath: ep.balancePath },
            }
            res = await controller.testConnection('custom_api', accountConfig)
          } else {
            res = await controller.testConnection(id)
          }
          const targetName = getServiceDisplayName(id, controller.getSnapshot().config || {}, PROVIDER_METAS[id]?.name || id)
          showToast(res.ok ? `${targetName}: 连接成功 (${res.latencyMs ?? 0}ms)` : `${targetName}: 连接失败 (${res.message})`, res.ok ? 'success' : 'error')
        } finally {
          btn.classList.remove('spinning')
        }
      })
    })

    // Services Table: Single row Delete button
    container.querySelectorAll('.btn-row-delete').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation()
        const isCustom = btn.getAttribute('data-custom') === 'true'
        const id = btn.getAttribute('data-id')
        const currentCfg = controller.getSnapshot().config || {}
        if (isCustom) {
          const idx = Number(btn.getAttribute('data-idx'))
          const ep = currentCfg.custom_compatible?.[idx]
          if (!ep) return
          confirmModal({
            title: '确认删除中转站',
            content: `确定要删除「${ep.name}」吗？删除后将从列表中彻底移除。`,
            confirmText: '确认删除',
            onConfirm: async () => {
              const endpoints = [...(currentCfg.custom_compatible || [])]
              endpoints.splice(idx, 1)
              const enabledProviders = (currentCfg.enabledProviders || []).filter(x => x !== ep.id)
              const floatingHudProviders = (currentCfg.floatingHudProviders || []).filter(x => x !== ep.id)
              const providerOrder = (currentCfg.providerOrder || []).filter(x => x !== ep.id)
              try {
                await controller.saveConfig({
                  ...currentCfg,
                  custom_compatible: endpoints,
                  enabledProviders,
                  floatingHudProviders,
                  providerOrder,
                })
                showToast('中转站已删除', 'success')
              } catch (err: any) {
                showToast(`删除失败: ${err.message}`, 'error')
              }
            },
          })
        } else if (id) {
          const meta = PROVIDER_METAS[id]
          const displayName = getServiceDisplayName(id, currentCfg, meta?.name || id)
          confirmModal({
            title: '确认清除凭据',
            content: `确定要清除「${displayName}」的凭据吗？删除后该服务将从列表中移除。`,
            confirmText: '确认清除',
            onConfirm: async () => {
              const enabledProviders = (currentCfg.enabledProviders || []).filter(x => x !== id)
              const floatingHudProviders = (currentCfg.floatingHudProviders || []).filter(x => x !== id)
              const clearObj: Record<string, any> = { enabled: false }
              if (id === 'cursor') { clearObj.sessionToken = ''; clearObj.autoDetectLocal = false }
              else if (id === 'antigravity' || id === 'codex') { clearObj.oauth = undefined; clearObj.autoDetectLocal = false }
              else if (id === 'github_copilot') { clearObj.token = ''; clearObj.autoDetectLocal = false }
              else { clearObj.apiKey = ''; clearObj.baseUrl = '' }

              try {
                await controller.saveConfig({
                  ...currentCfg,
                  enabledProviders,
                  floatingHudProviders,
                  [id]: {
                    ...(currentCfg as any)[id],
                    ...clearObj,
                  },
                })
                showToast(`「${displayName}」凭据已清除`, 'success')
              } catch (err: any) {
                showToast(`清除失败: ${err.message}`, 'error')
              }
            },
          })
        }
      })
    })

    // Services Table: Dashboard Switch (with automatic sinking of unchosen services to bottom)
    container.querySelectorAll('.switch-dashboard').forEach(sw => {
      sw.addEventListener('change', async (e) => {
        e.stopPropagation()
        const currentCfg = controller.getSnapshot().config || {}
        const id = sw.getAttribute('data-id')
        if (!id) return
        const isChecked = (sw as HTMLInputElement).checked
        const enabledSet = new Set(currentCfg.enabledProviders || Object.keys(PROVIDER_METAS))
        
        const customEndpoints = (currentCfg.custom_compatible || []).map(c => c.id)
        const allIds = [...customEndpoints, ...Object.keys(PROVIDER_METAS)]
        let order = currentCfg.providerOrder && currentCfg.providerOrder.length > 0
          ? [...currentCfg.providerOrder]
          : allIds

        for (const provId of allIds) {
          if (!order.includes(provId)) order.push(provId)
        }

        if (isChecked) {
          enabledSet.add(id)
          // Move to the active section
          order = order.filter(x => x !== id)
          const firstUnchosenIdx = order.findIndex(x => !enabledSet.has(x))
          if (firstUnchosenIdx === -1) order.push(id)
          else order.splice(firstUnchosenIdx, 0, id)
        } else {
          enabledSet.delete(id)
          // Move unchosen service to the bottom
          order = order.filter(x => x !== id)
          order.push(id)
        }

        try {
          await controller.saveConfig({
            ...currentCfg,
            enabledProviders: Array.from(enabledSet),
            providerOrder: order,
          })
          showToast(isChecked ? '已添加到看板' : '已从看板移至底部', 'info')
        } catch (err: any) {
          showToast(`更新失败: ${err.message}`, 'error')
        }
      })
    })

    // Services Table: HUD Switch
    container.querySelectorAll('.switch-hud').forEach(sw => {
      sw.addEventListener('change', async (e) => {
        e.stopPropagation()
        const currentCfg = controller.getSnapshot().config || {}
        const id = sw.getAttribute('data-id')
        if (!id) return
        const isChecked = (sw as HTMLInputElement).checked
        const hudSet = new Set(currentCfg.floatingHudProviders || currentCfg.enabledProviders || Object.keys(PROVIDER_METAS))
        if (isChecked) hudSet.add(id)
        else hudSet.delete(id)

        try {
          await controller.saveConfig({ ...currentCfg, floatingHudProviders: Array.from(hudSet) })
          showToast(isChecked ? '已添加到悬浮球轮播' : '已从悬浮球轮播移除', 'info')
        } catch (err: any) {
          showToast(`更新失败: ${err.message}`, 'error')
        }
      })
    })

    // Services Table: Drag & Drop Sorting (Draggable ONLY on the handle icon to avoid blocking button clicks)
    let draggedId: string | null = null
    container.querySelectorAll('.sort-drag-handle').forEach(handleEl => {
      const handle = handleEl as HTMLElement
      const row = handle.closest('.quota-table-row') as HTMLElement | null
      if (!row) return

      handle.addEventListener('dragstart', (e) => {
        draggedId = row.getAttribute('data-service-id')
        row.classList.add('dragging')
        if (e.dataTransfer) {
          e.dataTransfer.effectAllowed = 'move'
          e.dataTransfer.setData('text/plain', draggedId || '')
        }
      })

      handle.addEventListener('dragend', () => {
        row.classList.remove('dragging')
        container.querySelectorAll('.quota-table-row').forEach(r => r.classList.remove('drag-over-top', 'drag-over-bottom'))
        draggedId = null
      })
    })

    container.querySelectorAll('.quota-table-row').forEach(rowEl => {
      const row = rowEl as HTMLElement
      row.addEventListener('dragover', (e) => {
        e.preventDefault()
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'
        const rect = row.getBoundingClientRect()
        const midY = rect.top + rect.height / 2
        if (e.clientY < midY) {
          row.classList.add('drag-over-top')
          row.classList.remove('drag-over-bottom')
        } else {
          row.classList.add('drag-over-bottom')
          row.classList.remove('drag-over-top')
        }
      })

      row.addEventListener('dragleave', () => {
        row.classList.remove('drag-over-top', 'drag-over-bottom')
      })

      row.addEventListener('drop', async (e) => {
        e.preventDefault()
        row.classList.remove('drag-over-top', 'drag-over-bottom')
        const targetId = row.getAttribute('data-service-id')
        if (!draggedId || !targetId || draggedId === targetId) return

        const currentCfg = controller.getSnapshot().config || {}
        const customEndpoints = (currentCfg.custom_compatible || []).map(c => c.id)
        const allIds = [...customEndpoints, ...Object.keys(PROVIDER_METAS)]
        const order = currentCfg.providerOrder && currentCfg.providerOrder.length > 0
          ? [...currentCfg.providerOrder]
          : allIds

        for (const id of allIds) {
          if (!order.includes(id)) order.push(id)
        }

        const fromIdx = order.indexOf(draggedId)
        const toIdx = order.indexOf(targetId)
        if (fromIdx === -1 || toIdx === -1) return

        const rect = row.getBoundingClientRect()
        const insertAfter = e.clientY >= rect.top + rect.height / 2

        order.splice(fromIdx, 1)
        const newTargetIdx = order.indexOf(targetId)
        const finalIdx = insertAfter ? newTargetIdx + 1 : newTargetIdx
        order.splice(finalIdx, 0, draggedId)

        try {
          await controller.saveConfig({ ...currentCfg, providerOrder: order })
          showToast('排序已更新', 'info')
        } catch (err: any) {
          showToast(`排序保存失败: ${err.message}`, 'error')
        }
      })
    })

    // Test All connections
    container.querySelector('.btn-test-all')?.addEventListener('click', async () => {
      const btn = container.querySelector('.btn-test-all') as HTMLButtonElement | null
      if (btn) btn.textContent = '测活中...'
      try {
        await controller.testAllConnections()
        showToast('一键全部测活完成！', 'info')
      } catch (err: any) {
        showToast('测活失败: ' + err.message, 'error')
      } finally {
        if (btn) btn.textContent = '一键全部测活'
      }
    })

    // Preferences Tab: Sliders & Form
    const alarmSlider = container.querySelector('#pref-alarm-slider') as HTMLInputElement | null
    const alarmVal = container.querySelector('#pref-alarm-val') as HTMLElement | null
    alarmSlider?.addEventListener('input', () => {
      if (alarmVal) alarmVal.textContent = `${alarmSlider.value}%`
    })

    const prefForm = container.querySelector('#quota-pref-form')
    prefForm?.addEventListener('submit', async (e) => {
      e.preventDefault()
      const showFloatingHud = (container.querySelector('#pref-hud-switch') as HTMLInputElement)?.checked ?? true
      const enableNotification = (container.querySelector('#pref-notify-switch') as HTMLInputElement)?.checked ?? true
      const alarmThresholdPercent = parseInt((container.querySelector('#pref-alarm-slider') as HTMLInputElement)?.value || '15', 10)
      const refreshIntervalSeconds = parseInt((container.querySelector('#pref-refresh-select') as HTMLSelectElement)?.value || '60', 10)
      const httpProxy = (container.querySelector('#pref-proxy-input') as HTMLInputElement)?.value.trim()

      const currentCfg = controller.getSnapshot().config || {}
      try {
        await controller.saveConfig({
          ...currentCfg,
          showFloatingHud,
          enableNotification,
          alarmThresholdPercent,
          refreshIntervalSeconds,
          httpProxy: httpProxy || undefined,
        })
        showToast('偏好设置已保存！', 'success')
      } catch (err: any) {
        showToast(`保存失败: ${err.message}`, 'error')
      }
    })

    // Backup & Restore event bindings
    container.querySelector('#btn-export-safe')?.addEventListener('click', () => {
      const cfg = controller.getSnapshot().config || {}
      const safeCfg = sanitizeConfigForExport(cfg)
      downloadJsonFile(`dsh-quota-config-safe-${new Date().toISOString().slice(0, 10)}.json`, safeCfg)
      showToast('已导出安全脱敏配置文件', 'success')
    })

    container.querySelector('#btn-export-full')?.addEventListener('click', () => {
      const cfg = controller.getSnapshot().config || {}
      // The browser only ever receives the masked DTO (GET /config), so this export can
      // never contain live secrets; say so instead of promising a credential backup.
      downloadJsonFile(`dsh-quota-config-backup-${new Date().toISOString().slice(0, 10)}.json`, cfg)
      showToast('已导出完整配置结构（凭据已脱敏，不能用于恢复密钥）', 'info')
    })

    container.querySelector('#btn-import-config')?.addEventListener('click', () => {
      (container.querySelector('#input-import-file') as HTMLInputElement)?.click()
    })

    container.querySelector('#input-import-file')?.addEventListener('change', (e: any) => {
      const file = e.target?.files?.[0]
      if (!file) return
      const reader = new FileReader()
      reader.onload = (event) => {
        try {
          const parsed = JSON.parse(event.target?.result as string)
          if (typeof parsed !== 'object' || parsed === null) {
            throw new Error('配置文件非有效 JSON 对象')
          }
          confirmModal({
            title: '导入配置确认',
            content: '确认导入该配置文件吗？导入后现有配置将被覆盖并即刻生效。',
            confirmText: '立即导入',
            onConfirm: async () => {
              await controller.saveConfig(parsed)
              showToast('配置导入成功并已即刻生效！', 'success')
              void controller.refresh(true)
            },
          })
        } catch (err: any) {
          showToast(`导入失败: ${err.message}`, 'error')
        }
      }
      reader.readAsText(file)
      e.target.value = ''
    })

    // Detailed Settings Modal event bindings
    if (isDrawerOpen && activeDrawerTarget) {
      container.querySelector('#dsh-details-modal-overlay')?.addEventListener('click', (e) => {
        if (e.target === container.querySelector('#dsh-details-modal-overlay')) {
          closeDrawer()
        }
      })
      container.querySelector('.btn-close-details-modal')?.addEventListener('click', closeDrawer)
      container.querySelector('.btn-drawer-cancel')?.addEventListener('click', closeDrawer)

      container.querySelectorAll('.btn-toggle-eye').forEach(btn => {
        btn.addEventListener('click', () => {
          const targetSel = btn.getAttribute('data-target')
          if (!targetSel) return
          const input = container.querySelector(targetSel) as HTMLInputElement | null
          if (input) {
            const isPwd = input.type === 'password'
            input.type = isPwd ? 'text' : 'password'
            btn.textContent = isPwd ? '🔒' : '👁'
          }
        })
      })

      container.querySelector('.btn-drawer-save')?.addEventListener('click', async () => {
        if (!activeDrawerTarget) return
        const currentCfg = controller.getSnapshot().config || {}
        const customNameInput = container.querySelector('#drawer-custom-name-input') as HTMLInputElement | null

        const metricCbs = container.querySelectorAll<HTMLInputElement>('.cb-hud-metric')
        const targetProvId = activeDrawerTarget.kind === 'custom'
          ? activeDrawerTarget.endpoint.id
          : (activeDrawerTarget.kind === 'new_custom' ? '' : activeDrawerTarget.id)

        let updatedFloatingMetrics = currentCfg.floatingHudMetrics
        if (metricCbs.length > 0 && targetProvId) {
          let baseList = (currentCfg.floatingHudMetrics || []).filter(k => typeof k === 'string' && !k.startsWith(`${targetProvId}::`))
          let checkedCount = 0
          metricCbs.forEach(cb => {
            if (cb.checked) {
              checkedCount++
              const k = cb.getAttribute('data-key')
              if (k) baseList.push(k)
            }
          })
          if (checkedCount === 0) {
            baseList.push(`${targetProvId}::__none__`)
          }
          updatedFloatingMetrics = baseList
        }

        if (activeDrawerTarget.kind === 'new_custom' || activeDrawerTarget.kind === 'custom') {
          const baseInput = container.querySelector('#drawer-cust-base') as HTMLInputElement | null
          const keyInput = container.querySelector('#drawer-cust-key') as HTMLInputElement | null

          const name = customNameInput?.value.trim() || '自定义中转站'
          const baseUrl = baseInput?.value.trim() || 'https://api.openai.com'
          const apiKey = keyInput?.value.trim() || ''

          if (!apiKey) {
            showToast('请输入中转站 API Key', 'error')
            return
          }

          const endpoints = [...(currentCfg.custom_compatible || [])]
          let targetId = ''

          if (activeDrawerTarget.kind === 'new_custom') {
            targetId = `custom_${Date.now()}`
            endpoints.push({ id: targetId, name, baseUrl, apiKey, enabled: true })
          } else {
            targetId = activeDrawerTarget.endpoint.id
            endpoints[activeDrawerTarget.index] = { id: targetId, name, baseUrl, apiKey, enabled: true }
          }

          const enabledProviders = Array.isArray(currentCfg.enabledProviders) ? [...currentCfg.enabledProviders] : [...Object.keys(PROVIDER_METAS)]
          if (!enabledProviders.includes(targetId)) enabledProviders.push(targetId)
          const floatingHudProviders = Array.isArray(currentCfg.floatingHudProviders) ? [...currentCfg.floatingHudProviders] : [...enabledProviders]
          if (!floatingHudProviders.includes(targetId)) floatingHudProviders.push(targetId)
          const providerOrder = Array.isArray(currentCfg.providerOrder) ? [...currentCfg.providerOrder] : [...Object.keys(PROVIDER_METAS)]
          if (!providerOrder.includes(targetId)) providerOrder.push(targetId)

          try {
            await controller.saveConfig({
              ...currentCfg,
              custom_compatible: endpoints,
              enabledProviders,
              floatingHudProviders,
              floatingHudMetrics: updatedFloatingMetrics,
              providerOrder,
              customNames: {
                ...(currentCfg.customNames || {}),
                [targetId]: name,
              },
            })
            showToast(`中转站「${name}」配置已保存！`, 'success')
            closeDrawer()
          } catch (err: any) {
            showToast(`保存失败: ${err.message}`, 'error')
          }
          return
        }

        // Builtin Provider Save
        const prov = activeDrawerTarget.id
        const meta = PROVIDER_METAS[prov]
        const keyInput = container.querySelector('#drawer-key-input') as HTMLInputElement | null
        const baseInput = container.querySelector('#drawer-base-input') as HTMLInputElement | null
        const groupInput = container.querySelector('#drawer-group-input') as HTMLInputElement | null
        const customName = customNameInput?.value.trim() || undefined

        const provUpdate: Record<string, any> = { enabled: true }
        if (customName) provUpdate.name = customName
        if (keyInput) {
          const val = keyInput.value.trim()
          if (prov === 'cursor') provUpdate.sessionToken = val
          else if (prov === 'codex') provUpdate.oauth = val ? { accessToken: val } : currentCfg.codex?.oauth
          else if (prov === 'github_copilot') provUpdate.token = val
          else provUpdate.apiKey = val
        }
        if (baseInput) provUpdate.baseUrl = baseInput.value.trim() || undefined
        if (groupInput) provUpdate.groupId = groupInput.value.trim() || undefined

        if (prov === 'cursor') {
          const autoDetect = (container.querySelector('#drawer-cursor-auto') as HTMLInputElement | null)?.checked ?? true
          provUpdate.autoDetectLocal = autoDetect
        } else if (prov === 'antigravity') {
          const autoDetect = (container.querySelector('#drawer-antigravity-auto') as HTMLInputElement | null)?.checked ?? true
          provUpdate.autoDetectLocal = autoDetect
        } else if (prov === 'codex') {
          const autoDetect = (container.querySelector('#drawer-codex-auto') as HTMLInputElement | null)?.checked ?? true
          provUpdate.autoDetectLocal = autoDetect
        } else if (prov === 'github_copilot') {
          const autoDetect = (container.querySelector('#drawer-copilot-auto') as HTMLInputElement | null)?.checked ?? true
          provUpdate.autoDetectLocal = autoDetect
        }

        const keyRequiredList = ['deepseek', 'openai_billing', 'claude', 'kimi', 'glm', 'qwen', 'volcengine', 'minimax', 'opencode_go']
        if (keyRequiredList.includes(prov) && !provUpdate.apiKey) {
          showToast('请输入 API Key 后再保存', 'error')
          return
        }

        const enabledProviders = Array.isArray(currentCfg.enabledProviders) ? [...currentCfg.enabledProviders] : [...Object.keys(PROVIDER_METAS)]
        if (!enabledProviders.includes(prov)) enabledProviders.push(prov)
        const floatingHudProviders = Array.isArray(currentCfg.floatingHudProviders) ? [...currentCfg.floatingHudProviders] : [...enabledProviders]
        if (!floatingHudProviders.includes(prov)) floatingHudProviders.push(prov)
        const providerOrder = Array.isArray(currentCfg.providerOrder) ? [...currentCfg.providerOrder] : [...Object.keys(PROVIDER_METAS)]
        if (!providerOrder.includes(prov)) providerOrder.push(prov)

        const updatedCustomNames = {
          ...(currentCfg.customNames || {}),
          [prov]: customName || '',
        }

        try {
          await controller.saveConfig({
            ...currentCfg,
            enabledProviders,
            floatingHudProviders,
            floatingHudMetrics: updatedFloatingMetrics,
            providerOrder,
            customNames: updatedCustomNames,
            [prov]: {
              ...(currentCfg as any)[prov],
              ...provUpdate,
            },
          })
          showToast(`「${customName || meta?.name || prov}」配置已保存生效！`, 'success')
          closeDrawer()
          void controller.refreshSingle(prov)
        } catch (err: any) {
          showToast(`保存失败: ${err.message}`, 'error')
        }
      })

      container.querySelector('.btn-drawer-delete')?.addEventListener('click', () => {
        if (!activeDrawerTarget) return
        const currentCfg = controller.getSnapshot().config || {}

        const drawerTarget = activeDrawerTarget
        if (drawerTarget.kind === 'custom') {
          const targetEp = drawerTarget.endpoint
          confirmModal({
            title: '确认删除中转站',
            content: `确定要删除中转端点「${targetEp.name}」吗？删除后将从列表中彻底移除。`,
            confirmText: '确认删除',
            onConfirm: async () => {
              const endpoints = [...(currentCfg.custom_compatible || [])]
              endpoints.splice(drawerTarget.index, 1)
              const enabledProviders = (currentCfg.enabledProviders || []).filter(id => id !== targetEp.id)
              const floatingHudProviders = (currentCfg.floatingHudProviders || []).filter(id => id !== targetEp.id)
              const providerOrder = (currentCfg.providerOrder || []).filter(id => id !== targetEp.id)
              try {
                await controller.saveConfig({
                  ...currentCfg,
                  custom_compatible: endpoints,
                  enabledProviders,
                  floatingHudProviders,
                  providerOrder,
                })
                showToast('中转站已删除', 'success')
                closeDrawer()
              } catch (err: any) {
                showToast(`删除失败: ${err.message}`, 'error')
              }
            },
          })
          return
        }

        if (activeDrawerTarget.kind === 'provider') {
          const prov = activeDrawerTarget.id
          const meta = PROVIDER_METAS[prov]
          confirmModal({
            title: '确认删除凭据',
            content: `确定要删除「${meta?.name || prov}」的登录凭据吗？删除后该服务将从列表中移除。`,
            confirmText: '确认删除',
            onConfirm: async () => {
              const enabledProviders = (currentCfg.enabledProviders || []).filter(id => id !== prov)
              const floatingHudProviders = (currentCfg.floatingHudProviders || []).filter(id => id !== prov)
              const clearObj: Record<string, any> = { enabled: false }
              if (prov === 'cursor') { clearObj.sessionToken = ''; clearObj.autoDetectLocal = false }
              else if (prov === 'antigravity' || prov === 'codex') { clearObj.oauth = undefined; clearObj.autoDetectLocal = false }
              else if (prov === 'github_copilot') { clearObj.token = ''; clearObj.autoDetectLocal = false }
              else { clearObj.apiKey = ''; clearObj.baseUrl = '' }

              try {
                await controller.saveConfig({
                  ...currentCfg,
                  enabledProviders,
                  floatingHudProviders,
                  [prov]: {
                    ...(currentCfg as any)[prov],
                    ...clearObj,
                  },
                })
                showToast(`「${meta?.name || prov}」凭据已删除`, 'success')
                closeDrawer()
              } catch (err: any) {
                showToast(`删除失败: ${err.message}`, 'error')
              }
            },
          })
        }
      })

      container.querySelector('.btn-drawer-test')?.addEventListener('click', async () => {
        if (!activeDrawerTarget || activeDrawerTarget.kind !== 'provider') return
        const prov = activeDrawerTarget.id
        const fbEl = container.querySelector('#drawer-test-result') as HTMLElement | null
        if (fbEl) {
          fbEl.className = 'drawer-test-result ok'
          fbEl.textContent = '测试中...'
        }
        const keyInput = container.querySelector('#drawer-key-input') as HTMLInputElement | null
        const baseInput = container.querySelector('#drawer-base-input') as HTMLInputElement | null
        const keyVal = keyInput?.value.trim() || ''
        const baseVal = baseInput?.value.trim() || ''
        const accConfig = keyVal ? { id: prov, provider: prov, apiKey: keyVal, sessionToken: keyVal, baseUrl: baseVal || undefined } : undefined

        const res = await controller.testConnection(prov, accConfig)
        if (fbEl) {
          if (res.ok) {
            fbEl.className = 'drawer-test-result ok'
            fbEl.textContent = `✓ 连接成功 (${res.latencyMs ?? 0}ms)`
          } else {
            fbEl.className = 'drawer-test-result err'
            const msg = res.message || '连接失败'
            fbEl.textContent = `✗ ${msg.length > 28 ? msg.slice(0, 28) + '...' : msg}`
          }
        }
      })

      container.querySelector('.btn-drawer-test-cust')?.addEventListener('click', async () => {
        const fbEl = container.querySelector('#drawer-test-result') as HTMLElement | null
        const customNameInput = container.querySelector('#drawer-custom-name-input') as HTMLInputElement | null
        const name = customNameInput?.value.trim() || '中转站'
        const baseUrl = (container.querySelector('#drawer-cust-base') as HTMLInputElement)?.value.trim() || 'https://api.openai.com'
        const apiKey = (container.querySelector('#drawer-cust-key') as HTMLInputElement)?.value.trim() || ''

        if (!apiKey) {
          showToast('请输入 API Key 后再测活', 'error')
          return
        }
        if (fbEl) {
          fbEl.className = 'drawer-test-result ok'
          fbEl.textContent = '测试中...'
        }
        const res = await controller.testConnection('custom_api', {
          id: 'test_cust',
          provider: 'custom_api',
          name,
          baseUrl,
          apiKey,
        })
        if (fbEl) {
          if (res.ok) {
            fbEl.className = 'drawer-test-result ok'
            fbEl.textContent = `✓ 连接成功 (${res.latencyMs ?? 0}ms)`
          } else {
            fbEl.className = 'drawer-test-result err'
            const msg = res.message || '连接失败'
            fbEl.textContent = `✗ ${msg.length > 28 ? msg.slice(0, 28) + '...' : msg}`
          }
        }
      })

      container.querySelector('.btn-login-antigravity')?.addEventListener('click', async () => {
        try {
          const authUrl = await controller.startAntigravityLogin()
          window.open(authUrl, '_blank')
          setTimeout(() => controller.refresh(true), 4000)
        } catch (err: any) {
          showToast('启动 Google 登录失败: ' + err.message, 'error')
        }
      })

      container.querySelector('.btn-login-codex')?.addEventListener('click', async () => {
        try {
          const authUrl = await controller.startCodexLogin()
          window.open(authUrl, '_blank')
          setTimeout(() => controller.refresh(true), 4000)
        } catch (err: any) {
          showToast('启动 Codex 登录失败: ' + err.message, 'error')
        }
      })

      container.querySelector('.btn-connect-cursor')?.addEventListener('click', async () => {
        try {
          await controller.connectCursor()
          showToast('已从本地 Cursor 同步登录凭据！', 'success')
          await controller.refresh(true)
          closeDrawer()
        } catch (err: any) {
          showToast('连接 Cursor 失败: ' + err.message, 'error')
        }
      })
    }
  }

  // Keyboard shortcuts
  function handleKeyDown(e: KeyboardEvent) {
    if (e.key === 'Escape') {
      settingsDirty = false
      if (isDrawerOpen) closeDrawer()
      else if (isAddServiceModalOpen) {
        isAddServiceModalOpen = false
        update()
      }
    }
  }
  document.addEventListener('keydown', handleKeyDown)

  // Track unsaved edits so background polling skips the content rebuild.
  function markDirty(event: Event): void {
    const target = event.target as HTMLElement | null
    if (target === null) return
    if (target.tagName === 'INPUT') {
      const type = (target as HTMLInputElement).type
      if (type === 'checkbox' || type === 'radio' || type === 'file' || type === 'button' || type === 'submit') return
    }
    if (target.tagName === 'BUTTON') return
    settingsDirty = true
  }

  function clearDirtyOnAction(event: Event): void {
    const target = event.target as HTMLElement | null
    if (target === null) return
    if (target.closest('.quota-tab-btn, .category-chip, [data-group-toggle], .btn-card-refresh, #btn-refresh, .quota-segmented-btn, .btn-add-service, .btn-drawer-save, .btn-drawer-cancel, .btn-drawer-close, .btn-drawer-delete, .btn-close-add-modal, .btn-goto-settings, .btn-retry-refresh, button[type="submit"]') !== null
      || target.matches('#dsh-details-modal-overlay, #dsh-add-service-overlay')) {
      settingsDirty = false
    }
  }

  const clearDirtyOnSubmit = (): void => { settingsDirty = false }
  container.addEventListener('input', markDirty, true)
  container.addEventListener('change', markDirty, true)
  container.addEventListener('click', clearDirtyOnAction, true)
  container.addEventListener('submit', clearDirtyOnSubmit, true)

  const unsubscribe = controller.subscribe(update)
  update()

  return () => {
    unsubscribe()
    document.removeEventListener('keydown', handleKeyDown)
    container.removeEventListener('input', markDirty, true)
    container.removeEventListener('change', markDirty, true)
    container.removeEventListener('click', clearDirtyOnAction, true)
    container.removeEventListener('submit', clearDirtyOnSubmit, true)
    // Overlays/confirm boxes are appended to document.body, so the container
    // teardown cannot remove them; drop them explicitly (HMR / plugin disable).
    for (const node of externalNodes) node.remove()
    externalNodes.clear()
    const toast = document.getElementById('dsh-quota-toast')
    if (toast !== null) {
      clearTimeout((toast as any)._timer)
      toast.remove()
    }
    styleEl.remove()
  }
}
