import type { QuotaController } from './controller.ts'
import type { AuthCardItem, QuotaConfig, MetricWindow, ProviderCategory, QuotaSparklinePoint, AccountConfigItem, CustomCompatibleEndpoint } from './api.ts'
import { makeHudMetricKey } from './api.ts'

const PROVIDER_TITLES: Record<string, string> = {
  deepseek: 'DeepSeek 官方 API',
  antigravity: 'Google Antigravity',
  cursor: 'Cursor',
  codex: 'Codex (ChatGPT)',
  github_copilot: 'GitHub Copilot',
  openai_billing: 'OpenAI Platform',
  claude: 'Anthropic Claude',
  kimi: 'Moonshot Kimi',
  glm: '智谱清言 (GLM)',
  minimax: 'MiniMax (海螺)',
  qwen: '阿里通义千问',
  volcengine: '火山方舟 (豆包)',
  opencode_go: 'OpenCode Go',
  custom_api: '自定义中转 (OneAPI)',
}

const CATEGORY_NAMES: Record<ProviderCategory | 'all', string> = {
  all: '全部服务',
  ide: 'IDE 编程助手',
  domestic_llm: '国内大模型',
  official_cloud: '海外官方',
  custom_api: '自定义中转',
}

function getQuotaStatusColor(remainingPercent: number): string {
  // 宋式雅色（低饱和度、沉静克制、护眼素雅）
  if (remainingPercent <= 15) {
    return '#B04A46' // 🔴 茜色 / 殷红（危急）
  } else if (remainingPercent <= 35) {
    return '#BA8137' // 🟡 缃黄 / 栀子（预警）
  }
  return '#3F7A63' // 🟢 竹青 / 豆绿（充足）
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

function formatWindowSubtitle(win: MetricWindow): string {
  const rem = Math.max(0, Math.min(100, Math.round(win.remainingPercent)))
  const used = Math.max(0, Math.min(100, Math.round(win.usedPercent ?? (100 - rem))))

  if (rem >= 100 || used <= 0) {
    return '已用 0% · 额度充足'
  }

  if (win.resetAt) {
    const resetDate = new Date(win.resetAt)
    if (!isNaN(resetDate.getTime())) {
      const diffMs = resetDate.getTime() - Date.now()
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
        if (days > 0) {
          countdown = `${days} 天${hours > 0 ? ` ${hours} 小时` : ''}后`
        } else if (hours > 0) {
          countdown = `${hours} 小时${minutes > 0 ? ` ${minutes} 分钟` : ''}后`
        } else {
          countdown = `${minutes} 分钟后`
        }

        return `已用 ${used}% · 预计 ${countdown}重置 (${fullTimeStr})`
      } else {
        return `已用 ${used}% · 即将重置`
      }
    }
  }

  if (win.subtitle && win.subtitle.trim()) {
    return win.subtitle
  }

  return `已用 ${used}%`
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

/**
 * Pure SVG 7-day sparkline trend chart (Zero external dependencies)
 */
function renderSparklineSvg(points?: QuotaSparklinePoint[], currentRem = 100, width = 80, height = 24): string {
  let finalPoints = points && points.length >= 2 ? points : []

  if (finalPoints.length < 2) {
    const r = Math.max(0, Math.min(100, Math.round(currentRem)))
    const p1 = Math.min(100, r + (r < 95 ? Math.round((100 - r) * 0.25) : 0))
    const p2 = Math.min(100, r + (r < 95 ? Math.round((100 - r) * 0.15) : 0))
    finalPoints = [
      { t: 1, r: p1 },
      { t: 2, r: p2 },
      { t: 3, r: r },
      { t: 4, r: r },
      { t: 5, r: r },
    ]
  }

  const padding = 3
  const drawW = width - padding * 2
  const drawH = height - padding * 2

  const coords = finalPoints.map((p, idx) => {
    const x = padding + (idx / (finalPoints.length - 1)) * drawW
    const clampedR = Math.max(0, Math.min(100, p.r))
    const y = padding + (1 - clampedR / 100) * drawH
    return { x: Math.round(x * 10) / 10, y: Math.round(y * 10) / 10 }
  })

  const pathD = coords.reduce((acc, pt, idx) => `${acc} ${idx === 0 ? 'M' : 'L'} ${pt.x},${pt.y}`, '')
  const lastPt = coords[coords.length - 1]!
  const firstPt = coords[0]!
  const strokeColor = getQuotaStatusColor(currentRem)
  const areaD = `${pathD} L ${lastPt.x},${height - padding} L ${firstPt.x},${height - padding} Z`

  return `
    <div title="7天额度消耗趋势 · 剩余 ${currentRem}%" class="quota-sparkline-wrap" style="width: ${width}px; height: ${height}px; display: inline-flex; align-items: center; justify-content: center; flex: none;">
      <svg width="${width}" height="${height}" viewBox="0 0 ${width} ${height}" style="overflow: visible; display: block;">
        <path d="${areaD}" fill="${strokeColor}" fill-opacity="0.15" />
        <path d="${pathD}" fill="none" stroke="${strokeColor}" stroke-width="1.65" stroke-linecap="round" stroke-linejoin="round" />
        <circle cx="${lastPt.x}" cy="${lastPt.y}" r="2.2" fill="${strokeColor}" />
      </svg>
    </div>
  `
}

export function renderQuotaApp(container: HTMLElement, controller: QuotaController): () => void {
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
      max-width: 780px;
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
      gap: 4px;
      background: var(--dsw-alias-bg-layer-2, rgba(0,0,0,0.04));
      padding: 3px;
      border-radius: 8px;
    }
    .quota-tab-btn {
      padding: 5px 13px;
      border-radius: 6px;
      font-size: 12.5px;
      font-weight: 500;
      cursor: pointer;
      border: none;
      background: transparent;
      color: var(--dsw-alias-label-secondary, #57606a);
      transition: background 0.15s, color 0.15s;
    }
    .quota-tab-btn.active {
      background: var(--dsw-alias-bg-layer-1, #fff);
      color: var(--dsw-alias-label-primary, #111);
      font-weight: 600;
      box-shadow: 0 1px 3px rgba(0,0,0,0.08);
    }
    .quota-btn {
      padding: 6px 14px;
      border-radius: 7px;
      font-size: 12.5px;
      cursor: pointer;
      font-weight: 600;
      border: 1px solid transparent;
      background: var(--dsw-alias-label-primary, #1f2328);
      color: var(--dsw-alias-bg-layer-1, #fff);
      display: inline-flex;
      align-items: center;
      gap: 6px;
      transition: opacity 0.15s, transform 0.1s;
    }
    .quota-btn:hover { opacity: 0.88; }
    .quota-btn:active { transform: scale(0.98); }
    .quota-btn.secondary {
      background: var(--dsw-alias-bg-layer-1, #fff);
      color: var(--dsw-alias-label-primary, #1f2328);
      border: 1px solid var(--dsw-alias-border-l2, rgba(0,0,0,0.15));
    }
    .quota-btn.action {
      background: var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,0.06));
      color: var(--dsw-alias-label-primary, #1f2328);
      border: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,0.12));
      padding: 4px 10px;
      font-size: 12px;
      border-radius: 6px;
    }
    .quota-btn.danger {
      background: rgba(176, 74, 70, 0.1);
      color: #B04A46;
      border: 1px solid rgba(176, 74, 70, 0.2);
    }
    .quota-btn.danger:hover {
      background: rgba(176, 74, 70, 0.2);
    }

    /* Dashboard Header Summary 4-Grid */
    .dashboard-summary-grid {
      display: grid;
      grid-template-columns: repeat(4, 1fr);
      gap: 10px;
    }
    .summary-card {
      background: var(--dsw-alias-bg-layer-1, #ffffff);
      border: 1px solid var(--dsw-alias-border-l2, rgba(0,0,0,0.08));
      border-radius: 8px;
      padding: 12px 14px;
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .summary-card-label {
      font-size: 11.5px;
      font-weight: 600;
      color: var(--dsw-alias-label-secondary, #57606a);
    }
    .summary-card-val {
      font-size: 19px;
      font-weight: 700;
      color: var(--dsw-alias-label-primary, #1f2328);
      font-feature-settings: "tnum";
    }

    /* Category Filter Tabs */
    .category-filter-bar {
      display: flex;
      gap: 6px;
      overflow-x: auto;
      padding-bottom: 2px;
    }
    .category-chip {
      padding: 4px 11px;
      border-radius: 20px;
      font-size: 12px;
      font-weight: 500;
      border: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,0.1));
      background: var(--dsw-alias-bg-layer-1, #fff);
      color: var(--dsw-alias-label-secondary, #57606a);
      cursor: pointer;
      white-space: nowrap;
      transition: all 0.15s ease;
    }
    .category-chip:hover {
      border-color: var(--dsw-alias-brand-primary, #0969da);
      color: var(--dsw-alias-brand-primary, #0969da);
    }
    .category-chip.active {
      background: var(--dsw-alias-label-primary, #1f2328);
      color: var(--dsw-alias-bg-layer-1, #fff);
      border-color: transparent;
      font-weight: 600;
    }

    /* Cards & Sections */
    .quota-section {
      display: flex;
      flex-direction: column;
      gap: 12px;
    }
    .auth-title-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }
    .auth-section-title {
      font-size: 15.5px;
      font-weight: 700;
      color: var(--dsw-alias-label-primary, #1f2328);
      display: flex;
      align-items: center;
      gap: 8px;
    }
    .auth-group-block {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .group-header-title {
      font-size: 13px;
      font-weight: 600;
      color: var(--dsw-alias-label-secondary, #57606a);
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 0 4px;
      cursor: pointer;
      user-select: none;
    }
    .group-header-title:hover {
      color: var(--dsw-alias-label-primary, #1f2328);
    }

    .official-long-card {
      background: var(--dsw-alias-bg-layer-1, #ffffff);
      border: 1px solid var(--dsw-alias-border-l2, rgba(0,0,0,0.08));
      border-radius: 8px;
      overflow: hidden;
      box-shadow: 0 1px 2px rgba(0,0,0,0.02);
    }
    .card-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      height: 56px;
      min-height: 56px;
      padding: 0 16px;
      box-sizing: border-box;
    }
    .card-row + .card-row {
      border-top: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,0.06));
    }
    .row-left-content {
      display: flex;
      flex-direction: column;
      justify-content: center;
      gap: 3px;
      min-width: 0;
      flex: 1;
    }
    .row-main-label {
      font-size: 13.5px;
      font-weight: 600;
      color: var(--dsw-alias-label-primary, #1f2328);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      line-height: 1.35;
    }
    .row-sub-label {
      font-size: 12px;
      font-weight: 400;
      color: var(--dsw-alias-label-secondary, #57606a);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      line-height: 1.35;
    }
    .row-right-metric {
      display: flex;
      align-items: center;
      gap: 12px;
      flex: none;
      margin-left: 16px;
    }
    .row-percent-number {
      font-size: 14px;
      font-weight: 700;
      font-feature-settings: "tnum";
      min-width: 38px;
      text-align: right;
    }
    .btn-card-refresh {
      background: transparent;
      border: none;
      cursor: pointer;
      color: var(--dsw-alias-label-tertiary, #8c959f);
      width: 26px;
      height: 26px;
      border-radius: 6px;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      font-size: 13px;
      transition: color 0.15s, background 0.15s;
    }
    .btn-card-refresh:hover {
      color: var(--dsw-alias-label-primary, #1f2328);
      background: var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,0.06));
    }
    .btn-card-refresh.spinning {
      animation: dshQuotaSpin 0.7s linear infinite;
    }
    @keyframes dshQuotaSpin {
      100% { transform: rotate(360deg); }
    }

    /* Settings Form */
    .quota-form {
      display: flex;
      flex-direction: column;
      gap: 16px;
    }
    .quota-settings-section {
      background: var(--dsw-alias-bg-layer-1, #ffffff);
      border: 1px solid var(--dsw-alias-border-l2, rgba(0,0,0,0.08));
      border-radius: 8px;
      padding: 16px 18px;
      display: flex;
      flex-direction: column;
      gap: 12px;
      box-shadow: 0 1px 2px rgba(0,0,0,0.02);
    }
    .settings-section-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding-bottom: 8px;
      border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,0.06));
    }
    .settings-section-title {
      font-size: 13.5px;
      font-weight: 700;
      color: var(--dsw-alias-label-primary, #1f2328);
    }
    .sort-list {
      display: flex;
      flex-direction: column;
      gap: 6px;
    }
    .sort-item-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 7px 12px;
      border: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,0.06));
      border-radius: 6px;
      background: var(--dsw-alias-bg-layer-2, rgba(0,0,0,0.02));
    }
    .sort-item-left {
      display: flex;
      align-items: center;
      gap: 10px;
      font-size: 13px;
      font-weight: 600;
      color: var(--dsw-alias-label-primary, #1f2328);
      cursor: pointer;
    }
    .sort-item-btns {
      display: flex;
      gap: 4px;
    }
    .btn-arrow {
      background: var(--dsw-alias-bg-layer-1, #fff);
      border: 1px solid var(--dsw-alias-border-l2, rgba(0,0,0,0.12));
      color: var(--dsw-alias-label-primary, #1f2328);
      border-radius: 4px;
      width: 24px;
      height: 22px;
      font-size: 11px;
      cursor: pointer;
      display: inline-flex;
      align-items: center;
      justify-content: center;
    }
    .btn-arrow:hover:not(:disabled) {
      background: var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,0.06));
    }
    .btn-arrow:disabled {
      opacity: 0.35;
      cursor: default;
    }

    .quota-input {
      padding: 7px 11px;
      border-radius: 6px;
      border: 1px solid var(--dsw-alias-border-l2, rgba(0,0,0,0.15));
      background: var(--dsw-alias-bg-layer-2, rgba(0,0,0,0.02));
      color: var(--dsw-alias-label-primary, #1f2328);
      font-size: 12.5px;
      outline: none;
      box-sizing: border-box;
      width: 100%;
      transition: border-color 0.15s, background 0.15s;
    }
    .quota-input:focus {
      border-color: var(--dsw-alias-brand-primary, #0969da);
      background: var(--dsw-alias-bg-layer-1, #ffffff);
    }

    .credential-item {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 10px 0;
    }
    .credential-item + .credential-item {
      border-top: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,0.06));
    }
    .credential-header {
      display: flex;
      align-items: center;
      justify-content: space-between;
      gap: 8px;
    }
    .credential-title-wrap {
      display: flex;
      align-items: center;
      gap: 6px;
    }
    .credential-title {
      font-size: 13px;
      font-weight: 600;
      color: var(--dsw-alias-label-primary, #1f2328);
    }
    .credential-actions {
      display: flex;
      gap: 6px;
      align-items: center;
    }
    .test-conn-feedback {
      font-size: 11.5px;
      padding: 2px 6px;
      border-radius: 4px;
      display: none;
    }
    .test-conn-feedback.ok {
      display: inline-block;
      color: #3F7A63;
      background: rgba(63, 122, 99, 0.1);
    }
    .test-conn-feedback.error {
      display: inline-block;
      color: #B04A46;
      background: rgba(176, 74, 70, 0.1);
    }

    /* Multi-account & Custom list */
    .custom-endpoint-card {
      display: flex;
      flex-direction: column;
      gap: 8px;
      padding: 10px;
      border-radius: 6px;
      background: var(--dsw-alias-bg-layer-2, rgba(0,0,0,0.03));
      border: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,0.08));
    }

    .settings-bottom-bar {
      display: flex;
      justify-content: flex-end;
      align-items: center;
      gap: 12px;
      padding: 4px 0;
    }

    .quota-help-tip {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 14px;
      height: 14px;
      color: var(--dsw-alias-label-tertiary, #8c959f);
      cursor: help;
      position: relative;
      margin-left: 4px;
    }
    .quota-help-tip:hover { color: var(--dsw-alias-brand-primary, #0969da); }
    .quota-help-tip::after {
      content: attr(data-tooltip);
      position: absolute;
      bottom: calc(100% + 7px);
      left: 50%;
      transform: translateX(-50%) translateY(4px);
      background: var(--dsw-alias-bg-layer-1, #ffffff) !important;
      color: var(--dsw-alias-label-primary, #1f2328) !important;
      border: 1px solid var(--dsw-alias-border-l2, rgba(0,0,0,0.14)) !important;
      font-size: 11.5px;
      font-weight: 500;
      line-height: 1.45;
      padding: 7px 11px;
      border-radius: 6px;
      white-space: normal;
      width: max-content;
      max-width: 280px;
      box-shadow: 0 6px 20px rgba(0, 0, 0, 0.14);
      pointer-events: none;
      opacity: 0;
      visibility: hidden;
      transition: opacity 0.15s ease, transform 0.15s ease, visibility 0.15s ease;
      z-index: 999;
    }
    .quota-help-tip:hover::after {
      opacity: 1;
      visibility: visible;
      transform: translateX(-50%) translateY(0);
    }
  `
  document.head.appendChild(styleEl)

  // Local state for dynamic multi-accounts & custom endpoints in settings
  let localCustomEndpoints: CustomCompatibleEndpoint[] = []
  let localAccounts: AccountConfigItem[] = []

  function update() {
    const state = controller.getSnapshot()
    if (!state.panelOpen) return

    let contentHtml = ''

    if (state.activeTab === 'overview') {
      // 1. Summary Grid
      const totalServices = state.allCards.length
      const activeServices = state.allCards.filter(c => c.status === 'ok' || c.status === 'warn').length
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
        ? '<div style="text-align: center; color: var(--dsw-alias-label-tertiary, #888); padding: 48px;">当前分类下无服务或未启用，可在「设置」中添加</div>'
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
                      <span class="row-sub-label">请在设置中配置凭据或点击连接后查看实时额度</span>
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
                  const rem = Math.max(0, Math.min(100, Math.round(win.remainingPercent)))
                  const statusColor = getQuotaStatusColor(rem)
                  const subText = formatWindowSubtitle(win)

                  return `
                    <div class="card-row">
                      <div class="row-left-content">
                        <span class="row-main-label" title="${win.label}">${win.label}</span>
                        <span class="row-sub-label" title="${subText}">${subText}</span>
                      </div>
                      <div class="row-right-metric">
                        ${renderSparklineSvg(card.sparkline, rem, 80, 24)}
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

            // Burn rate & estimated badge
            let rateBadge = ''
            if (card.burnRatePerHour && card.burnRatePerHour > 0) {
              rateBadge = `<span style="font-size: 11.5px; color: var(--dsw-alias-label-tertiary);">消耗: ${card.burnRatePerHour}%/h${card.estimatedHoursLeft ? ` · 余约 ${card.estimatedHoursLeft}h` : ''}</span>`
            }

            return `
              <div class="quota-section" data-card-id="${card.id}">
                <div class="auth-title-row">
                  <div class="auth-section-title">
                    <span>${card.name}</span>
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
      const cfg = state.config || {}
      const currentOrder = (cfg.providerOrder && cfg.providerOrder.length > 0) ? cfg.providerOrder : Object.keys(PROVIDER_TITLES)
      const showHud = cfg.showFloatingHud !== false
      const selectedSec = cfg.refreshIntervalSeconds ?? 60
      const alarmThreshold = cfg.alarmThresholdPercent ?? 15
      const enableNotify = cfg.enableNotification !== false

      localCustomEndpoints = cfg.custom_compatible || []
      localAccounts = cfg.accounts || []

      const isProvChecked = (prov: string) => {
        if (cfg.enabledProviders && Array.isArray(cfg.enabledProviders)) {
          return cfg.enabledProviders.includes(prov)
        }
        return (cfg as any)[prov]?.enabled !== false
      }

      const orderListHtml = currentOrder.map((prov, idx) => {
        const title = PROVIDER_TITLES[prov] || prov
        const checked = isProvChecked(prov) ? 'checked' : ''
        const isFirst = idx === 0
        const isLast = idx === currentOrder.length - 1

        return `
          <div class="sort-item-row" data-prov-id="${prov}">
            <label class="sort-item-left">
              <input type="checkbox" class="prov-enable-cb" data-prov="${prov}" ${checked} />
              <span>${title}</span>
            </label>
            <div class="sort-item-btns">
              <button type="button" class="btn-arrow btn-move-up" data-idx="${idx}" ${isFirst ? 'disabled' : ''}>↑</button>
              <button type="button" class="btn-arrow btn-move-down" data-idx="${idx}" ${isLast ? 'disabled' : ''}>↓</button>
            </div>
          </div>
        `
      }).join('')

      // Custom endpoints UI list
      const customEndpointsHtml = localCustomEndpoints.map((ep, idx) => `
        <div class="custom-endpoint-card" data-cust-idx="${idx}">
          <div style="display: flex; justify-content: space-between; align-items: center;">
            <input type="text" class="quota-input cust-name" placeholder="中转站名称 (如: NewAPI 分发池)" value="${ep.name || ''}" style="width: 65%; font-weight: 600;" />
            <button type="button" class="quota-btn action danger btn-del-cust" data-idx="${idx}">删除</button>
          </div>
          <input type="text" class="quota-input cust-base" placeholder="Base URL (如: https://api.my-oneapi.com)" value="${ep.baseUrl || ''}" />
          <input type="password" class="quota-input cust-key" placeholder="API Key (sk-...)" value="${ep.apiKey || ''}" />
        </div>
      `).join('')

      contentHtml = `
        <form id="dsh-quota-form" class="quota-form">
          <!-- 1. 服务展示与排序 -->
          <div class="quota-settings-section">
            <div class="settings-section-header">
              <span class="settings-section-title">服务展示与排序</span>
              ${renderHelp('勾选以在概览页显示该服务；点击右侧箭头可自定义卡片在看板中的先后顺序')}
            </div>
            <div class="sort-list">
              ${orderListHtml}
            </div>
          </div>

          <!-- 2. 通用偏好与告警阈值 -->
          <div class="quota-settings-section">
            <div class="settings-section-header">
              <span class="settings-section-title">通用偏好、告警与通知</span>
            </div>

            <div style="display: flex; justify-content: space-between; align-items: center; padding: 4px 0;">
              <div>
                <span style="font-size: 13px; font-weight: 600;">桌面悬浮环 (HUD)</span>
                ${renderHelp('在 DSH 界面显示可拖动的圆形额度悬浮窗，支持轮播速览与贴边吸附')}
              </div>
              <input type="checkbox" id="show-floating-hud" ${showHud ? 'checked' : ''} />
            </div>

            <div style="display: flex; justify-content: space-between; align-items: center; border-top: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,0.06)); padding-top: 8px;">
              <div>
                <span style="font-size: 13px; font-weight: 600;">桌面通知提醒 (Notification)</span>
                ${renderHelp('当额度跌破阈值或服务失效时，触发系统级桌面通知弹窗')}
              </div>
              <input type="checkbox" id="enable-notification" ${enableNotify ? 'checked' : ''} />
            </div>

            <div style="display: flex; justify-content: space-between; align-items: center; border-top: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,0.06)); padding-top: 8px;">
              <div>
                <span style="font-size: 13px; font-weight: 600;">低额度告警阈值</span>
                ${renderHelp('当剩余额度低于该百分比时触发告警（默认 15%）')}
              </div>
              <div style="display: flex; gap: 8px; align-items: center;">
                <input type="range" id="alarm-threshold" min="5" max="50" step="5" value="${alarmThreshold}" style="width: 120px;" />
                <span id="alarm-threshold-val" style="font-size: 12px; font-weight: 700; min-width: 32px;">${alarmThreshold}%</span>
              </div>
            </div>

            <div style="display: flex; justify-content: space-between; align-items: center; border-top: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,0.06)); padding-top: 8px;">
              <div>
                <span style="font-size: 13px; font-weight: 600;">自动刷新频率</span>
                ${renderHelp('后台定期自动刷新各平台配额与剩余额度')}
              </div>
              <select id="refresh-interval" class="quota-input" style="width: 150px; padding: 5px 8px;">
                <option value="10" ${selectedSec === 10 ? 'selected' : ''}>每 10 秒</option>
                <option value="30" ${selectedSec === 30 ? 'selected' : ''}>每 30 秒</option>
                <option value="60" ${selectedSec === 60 ? 'selected' : ''}>每 1 分钟 (推荐)</option>
                <option value="120" ${selectedSec === 120 ? 'selected' : ''}>每 2 分钟</option>
                <option value="300" ${selectedSec === 300 ? 'selected' : ''}>每 5 分钟</option>
                <option value="600" ${selectedSec === 600 ? 'selected' : ''}>每 10 分钟</option>
              </select>
            </div>

            <div style="display: flex; flex-direction: column; gap: 6px; border-top: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,0.06)); padding-top: 8px;">
              <span style="font-size: 13px; font-weight: 600;">网络代理 (HTTP Proxy)</span>
              <input type="text" id="http-proxy" class="quota-input" placeholder="http://127.0.0.1:7890" value="${cfg.httpProxy || ''}" />
            </div>
          </div>

          <!-- 3. 自定义 OneAPI / NewAPI 中转站 -->
          <div class="quota-settings-section">
            <div class="settings-section-header">
              <span class="settings-section-title">自定义 OneAPI / NewAPI 中转站</span>
              <button type="button" class="quota-btn action btn-add-custom-ep">+ 添加中转站</button>
            </div>
            <div id="custom-endpoints-list" style="display: flex; flex-direction: column; gap: 8px;">
              ${customEndpointsHtml || '<div style="font-size: 12px; color: var(--dsw-alias-label-tertiary);">暂无自定义中转站，点击右上角添加</div>'}
            </div>
          </div>

          <!-- 4. 平台凭据与全部测活 -->
          <div class="quota-settings-section">
            <div class="settings-section-header">
              <div style="display: flex; align-items: center; gap: 6px;">
                <span class="settings-section-title">平台凭据配置</span>
                ${renderHelp('填入各模型/工具的 API Key 或 Session，支持一键并发测活')}
              </div>
              <button type="button" class="quota-btn secondary btn-test-all" style="padding: 3px 10px; font-size: 12px;">
                ${state.testingAll ? '⚡ 测活中...' : '⚡ 一键全部测活'}
              </button>
            </div>

            <!-- DeepSeek -->
            <div class="credential-item">
              <div class="credential-header">
                <div class="credential-title-wrap">
                  <span class="credential-title">DeepSeek 官方 API</span>
                  ${renderHelp('填入 DeepSeek API Key (sk-...) 查询充值与赠金余额')}
                </div>
                <div class="credential-actions">
                  <span class="test-conn-feedback" data-fb="deepseek"></span>
                  <button type="button" class="quota-btn action btn-test-conn" data-prov="deepseek">测试连接</button>
                </div>
              </div>
              <input type="password" id="key-deepseek" class="quota-input" placeholder="sk-..." value="${cfg.deepseek?.apiKey || ''}" />
            </div>

            <!-- Cursor -->
            <div class="credential-item">
              <div class="credential-header">
                <div class="credential-title-wrap">
                  <span class="credential-title">Cursor</span>
                  ${renderHelp('自动探测本地 state.vscdb 或填入 WorkosCursorSessionToken')}
                </div>
                <div class="credential-actions">
                  <span class="test-conn-feedback" data-fb="cursor"></span>
                  <button type="button" class="quota-btn action btn-test-conn" data-prov="cursor">测试连接</button>
                </div>
              </div>
              <input type="password" id="key-cursor" class="quota-input" placeholder="WorkosCursorSessionToken" value="${cfg.cursor?.sessionToken || ''}" />
            </div>

            <!-- Google Antigravity -->
            <div class="credential-item">
              <div class="credential-header">
                <div class="credential-title-wrap">
                  <span class="credential-title">Google Antigravity</span>
                </div>
                <div class="credential-actions">
                  <span class="test-conn-feedback" data-fb="antigravity"></span>
                  <button type="button" class="quota-btn action btn-login-antigravity">${cfg.antigravity?.oauth?.accessToken ? '重新授权' : '登录 Google'}</button>
                  <button type="button" class="quota-btn action btn-test-conn" data-prov="antigravity">测试连接</button>
                </div>
              </div>
            </div>

            <!-- Codex (OpenAI) -->
            <div class="credential-item">
              <div class="credential-header">
                <div class="credential-title-wrap">
                  <span class="credential-title">Codex (ChatGPT Wham)</span>
                </div>
                <div class="credential-actions">
                  <span class="test-conn-feedback" data-fb="codex"></span>
                  <button type="button" class="quota-btn action btn-login-codex">登录 OpenAI</button>
                  <button type="button" class="quota-btn action btn-test-conn" data-prov="codex">测试连接</button>
                </div>
              </div>
              <input type="password" id="key-codex" class="quota-input" placeholder="access_token" value="${cfg.codex?.oauth?.accessToken || ''}" />
            </div>

            <!-- GitHub Copilot -->
            <div class="credential-item">
              <div class="credential-header">
                <div class="credential-title-wrap">
                  <span class="credential-title">GitHub Copilot</span>
                  ${renderHelp('自动探测本地 VS Code Copilot 登录态或填入 GitHub Token')}
                </div>
                <div class="credential-actions">
                  <span class="test-conn-feedback" data-fb="github_copilot"></span>
                  <button type="button" class="quota-btn action btn-test-conn" data-prov="github_copilot">测试连接</button>
                </div>
              </div>
              <input type="password" id="key-copilot" class="quota-input" placeholder="gho_... / ghp_..." value="${cfg.github_copilot?.token || ''}" />
            </div>

            <!-- OpenAI Platform Billing -->
            <div class="credential-item">
              <div class="credential-header">
                <div class="credential-title-wrap">
                  <span class="credential-title">OpenAI Platform (API)</span>
                </div>
                <div class="credential-actions">
                  <span class="test-conn-feedback" data-fb="openai_billing"></span>
                  <button type="button" class="quota-btn action btn-test-conn" data-prov="openai_billing">测试连接</button>
                </div>
              </div>
              <input type="password" id="key-openai-billing" class="quota-input" placeholder="sk-..." value="${cfg.openai_billing?.apiKey || ''}" />
            </div>

            <!-- Anthropic Claude -->
            <div class="credential-item">
              <div class="credential-header">
                <div class="credential-title-wrap">
                  <span class="credential-title">Anthropic Claude</span>
                </div>
                <div class="credential-actions">
                  <span class="test-conn-feedback" data-fb="claude"></span>
                  <button type="button" class="quota-btn action btn-test-conn" data-prov="claude">测试连接</button>
                </div>
              </div>
              <input type="password" id="key-claude" class="quota-input" placeholder="sk-ant-..." value="${cfg.claude?.apiKey || ''}" />
            </div>

            <!-- Moonshot Kimi -->
            <div class="credential-item">
              <div class="credential-header">
                <div class="credential-title-wrap">
                  <span class="credential-title">Moonshot Kimi</span>
                </div>
                <div class="credential-actions">
                  <span class="test-conn-feedback" data-fb="kimi"></span>
                  <button type="button" class="quota-btn action btn-test-conn" data-prov="kimi">测试连接</button>
                </div>
              </div>
              <input type="password" id="key-kimi" class="quota-input" placeholder="sk-..." value="${cfg.kimi?.apiKey || ''}" />
            </div>

            <!-- 智谱 GLM -->
            <div class="credential-item">
              <div class="credential-header">
                <div class="credential-title-wrap">
                  <span class="credential-title">智谱清言 (GLM)</span>
                </div>
                <div class="credential-actions">
                  <span class="test-conn-feedback" data-fb="glm"></span>
                  <button type="button" class="quota-btn action btn-test-conn" data-prov="glm">测试连接</button>
                </div>
              </div>
              <input type="password" id="key-glm" class="quota-input" placeholder="glm api key" value="${cfg.glm?.apiKey || ''}" />
            </div>

            <!-- 阿里通义千问 -->
            <div class="credential-item">
              <div class="credential-header">
                <div class="credential-title-wrap">
                  <span class="credential-title">阿里通义千问 (百炼)</span>
                </div>
                <div class="credential-actions">
                  <span class="test-conn-feedback" data-fb="qwen"></span>
                  <button type="button" class="quota-btn action btn-test-conn" data-prov="qwen">测试连接</button>
                </div>
              </div>
              <input type="password" id="key-qwen" class="quota-input" placeholder="sk-..." value="${cfg.qwen?.apiKey || ''}" />
            </div>

            <!-- 火山方舟 (豆包) -->
            <div class="credential-item">
              <div class="credential-header">
                <div class="credential-title-wrap">
                  <span class="credential-title">火山方舟 (豆包)</span>
                </div>
                <div class="credential-actions">
                  <span class="test-conn-feedback" data-fb="volcengine"></span>
                  <button type="button" class="quota-btn action btn-test-conn" data-prov="volcengine">测试连接</button>
                </div>
              </div>
              <input type="password" id="key-volc" class="quota-input" placeholder="ark api key" value="${cfg.volcengine?.apiKey || ''}" />
            </div>

            <!-- OpenCode Go -->
            <div class="credential-item">
              <div class="credential-header">
                <div class="credential-title-wrap">
                  <span class="credential-title">OpenCode Go</span>
                </div>
                <div class="credential-actions">
                  <span class="test-conn-feedback" data-fb="opencode_go"></span>
                  <button type="button" class="quota-btn action btn-test-conn" data-prov="opencode_go">测试连接</button>
                </div>
              </div>
              <input type="password" id="key-opencode" class="quota-input" placeholder="sk-..." value="${cfg.opencode_go?.apiKey || ''}" />
            </div>
          </div>

          <!-- Bottom Action Bar -->
          <div class="settings-bottom-bar">
            <span id="save-status-hint" style="font-size: 12px; color: #3F7A63; font-weight: 600; display: none;">✓ 设置已保存</span>
            <button type="submit" class="quota-btn">保存所有设置</button>
          </div>
        </form>
      `
    }

    container.innerHTML = `
      <div class="quota-container">
        <div class="quota-header">
          <div class="quota-title">
            <span>AI 额度监控</span>
            <span class="quota-version-tag">v0.2.2</span>
            ${state.loading ? '<span style="font-size: 12px; font-weight: normal; color: var(--dsw-alias-brand-primary, #0969da); margin-left: 8px;">正在刷新...</span>' : ''}
          </div>
          <div style="display: flex; gap: 10px; align-items: center;">
            <div class="quota-tabs">
              <button id="tab-overview" class="quota-tab-btn ${state.activeTab === 'overview' ? 'active' : ''}">看板</button>
              <button id="tab-settings" class="quota-tab-btn ${state.activeTab === 'settings' ? 'active' : ''}">设置</button>
            </div>
            <button id="btn-refresh" class="quota-btn secondary">↻ 全部刷新</button>
          </div>
        </div>
        ${contentHtml}
      </div>
    `

    // Event listeners
    container.querySelector('#tab-overview')?.addEventListener('click', () => controller.setTab('overview'))
    container.querySelector('#tab-settings')?.addEventListener('click', () => controller.setTab('settings'))
    container.querySelector('#btn-refresh')?.addEventListener('click', () => controller.refresh(true))

    // Threshold slider input
    const thresholdSlider = container.querySelector('#alarm-threshold') as HTMLInputElement | null
    const thresholdVal = container.querySelector('#alarm-threshold-val') as HTMLElement | null
    thresholdSlider?.addEventListener('input', () => {
      if (thresholdVal) thresholdVal.textContent = `${thresholdSlider.value}%`
    })

    // Category filter chips
    container.querySelectorAll('.category-chip').forEach(chip => {
      chip.addEventListener('click', () => {
        const cat = chip.getAttribute('data-cat') as any
        if (cat) controller.setCategory(cat)
      })
    })

    // Group toggle (Accordion)
    container.querySelectorAll('[data-group-toggle]').forEach(el => {
      el.addEventListener('click', () => {
        const key = el.getAttribute('data-group-toggle')
        if (key) controller.toggleGroupCollapse(key)
      })
    })

    // Single refresh
    container.querySelectorAll('.btn-card-refresh').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation()
        const id = btn.getAttribute('data-refresh-id')
        if (id) void controller.refreshSingle(id)
      })
    })

    // Add Custom Endpoint
    container.querySelector('.btn-add-custom-ep')?.addEventListener('click', () => {
      localCustomEndpoints.push({
        id: `custom_${Date.now()}`,
        name: `中转站 #${localCustomEndpoints.length + 1}`,
        baseUrl: 'https://api.openai.com',
        apiKey: '',
        enabled: true,
      })
      const currentCfg = controller.getSnapshot().config || {}
      void controller.saveConfig({ ...currentCfg, custom_compatible: localCustomEndpoints })
    })

    // Delete Custom Endpoint
    container.querySelectorAll('.btn-del-cust').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.getAttribute('data-idx'))
        if (!isNaN(idx) && idx >= 0 && idx < localCustomEndpoints.length) {
          localCustomEndpoints.splice(idx, 1)
          const currentCfg = controller.getSnapshot().config || {}
          void controller.saveConfig({ ...currentCfg, custom_compatible: localCustomEndpoints })
        }
      })
    })

    // Single Test Connection buttons
    container.querySelectorAll('.btn-test-conn').forEach(btn => {
      btn.addEventListener('click', async () => {
        const prov = btn.getAttribute('data-prov')
        if (!prov) return
        const fbEl = container.querySelector(`[data-fb="${prov}"]`) as HTMLElement | null
        if (fbEl) {
          fbEl.className = 'test-conn-feedback'
          fbEl.textContent = '测试中...'
          fbEl.style.display = 'inline-block'
        }

        let keyVal = ''
        if (prov === 'deepseek') keyVal = (container.querySelector('#key-deepseek') as HTMLInputElement)?.value
        else if (prov === 'cursor') keyVal = (container.querySelector('#key-cursor') as HTMLInputElement)?.value
        else if (prov === 'codex') keyVal = (container.querySelector('#key-codex') as HTMLInputElement)?.value
        else if (prov === 'github_copilot') keyVal = (container.querySelector('#key-copilot') as HTMLInputElement)?.value
        else if (prov === 'openai_billing') keyVal = (container.querySelector('#key-openai-billing') as HTMLInputElement)?.value
        else if (prov === 'claude') keyVal = (container.querySelector('#key-claude') as HTMLInputElement)?.value
        else if (prov === 'kimi') keyVal = (container.querySelector('#key-kimi') as HTMLInputElement)?.value
        else if (prov === 'glm') keyVal = (container.querySelector('#key-glm') as HTMLInputElement)?.value
        else if (prov === 'qwen') keyVal = (container.querySelector('#key-qwen') as HTMLInputElement)?.value
        else if (prov === 'volcengine') keyVal = (container.querySelector('#key-volc') as HTMLInputElement)?.value
        else if (prov === 'opencode_go') keyVal = (container.querySelector('#key-opencode') as HTMLInputElement)?.value

        const accConfig = keyVal ? { id: prov, provider: prov, apiKey: keyVal, sessionToken: keyVal } : undefined
        const res = await controller.testConnection(prov, accConfig)

        if (fbEl) {
          if (res.ok) {
            fbEl.className = 'test-conn-feedback ok'
            fbEl.textContent = `✓ 成功 (${res.latencyMs}ms)`
          } else {
            fbEl.className = 'test-conn-feedback error'
            fbEl.textContent = `✗ ${res.message.slice(0, 30)}`
          }
        }
      })
    })

    // Test All Connections
    container.querySelector('.btn-test-all')?.addEventListener('click', async () => {
      const results = await controller.testAllConnections()
      for (const [id, res] of Object.entries(results)) {
        const fbEl = container.querySelector(`[data-fb="${id}"]`) as HTMLElement | null
        if (fbEl) {
          if (res.ok) {
            fbEl.className = 'test-conn-feedback ok'
            fbEl.textContent = `✓ 成功 (${res.latencyMs}ms)`
          } else {
            fbEl.className = 'test-conn-feedback error'
            fbEl.textContent = `✗ ${res.message.slice(0, 30)}`
          }
        }
      }
    })

    // OAuth Logins
    container.querySelector('.btn-login-antigravity')?.addEventListener('click', async () => {
      try {
        const authUrl = await controller.startAntigravityLogin()
        window.open(authUrl, '_blank')
        setTimeout(() => controller.refresh(true), 4000)
      } catch (err: any) {
        alert('启动 Antigravity 登录失败: ' + err.message)
      }
    })

    container.querySelector('.btn-login-codex')?.addEventListener('click', async () => {
      try {
        const authUrl = await controller.startCodexLogin()
        window.open(authUrl, '_blank')
        setTimeout(() => controller.refresh(true), 4000)
      } catch (err: any) {
        alert('启动 Codex 登录失败: ' + err.message)
      }
    })

    // Form submit
    const form = container.querySelector('#dsh-quota-form')
    if (form) {
      form.addEventListener('submit', (e) => {
        e.preventDefault()
        const httpProxy = (container.querySelector('#http-proxy') as HTMLInputElement)?.value?.trim()
        const showFloatingHud = (container.querySelector('#show-floating-hud') as HTMLInputElement)?.checked
        const enableNotification = (container.querySelector('#enable-notification') as HTMLInputElement)?.checked
        const alarmThresholdPercent = parseInt((container.querySelector('#alarm-threshold') as HTMLInputElement)?.value || '15', 10)
        const refreshInterval = parseInt((container.querySelector('#refresh-interval') as HTMLSelectElement)?.value || '60', 10)

        const enabledProviders: string[] = []
        container.querySelectorAll('.prov-enable-cb').forEach((cb: any) => {
          if (cb.checked) {
            const p = cb.getAttribute('data-prov')
            if (p) enabledProviders.push(p)
          }
        })

        // Collect custom endpoints values from form
        const customCards = container.querySelectorAll('.custom-endpoint-card')
        const updatedCustomEndpoints: CustomCompatibleEndpoint[] = []
        customCards.forEach((cEl, i) => {
          const name = (cEl.querySelector('.cust-name') as HTMLInputElement)?.value?.trim() || `中转站 #${i + 1}`
          const baseUrl = (cEl.querySelector('.cust-base') as HTMLInputElement)?.value?.trim() || 'https://api.openai.com'
          const apiKey = (cEl.querySelector('.cust-key') as HTMLInputElement)?.value?.trim() || ''
          updatedCustomEndpoints.push({
            id: localCustomEndpoints[i]?.id || `custom_${Date.now()}_${i}`,
            name,
            baseUrl,
            apiKey,
            enabled: true,
          })
        })

        const deepseekKey = (container.querySelector('#key-deepseek') as HTMLInputElement)?.value?.trim()
        const cursorToken = (container.querySelector('#key-cursor') as HTMLInputElement)?.value?.trim()
        const codexToken = (container.querySelector('#key-codex') as HTMLInputElement)?.value?.trim()
        const copilotToken = (container.querySelector('#key-copilot') as HTMLInputElement)?.value?.trim()
        const openaiKey = (container.querySelector('#key-openai-billing') as HTMLInputElement)?.value?.trim()
        const claudeKey = (container.querySelector('#key-claude') as HTMLInputElement)?.value?.trim()
        const kimiKey = (container.querySelector('#key-kimi') as HTMLInputElement)?.value?.trim()
        const glmKey = (container.querySelector('#key-glm') as HTMLInputElement)?.value?.trim()
        const qwenKey = (container.querySelector('#key-qwen') as HTMLInputElement)?.value?.trim()
        const volcKey = (container.querySelector('#key-volc') as HTMLInputElement)?.value?.trim()
        const opencodeKey = (container.querySelector('#key-opencode') as HTMLInputElement)?.value?.trim()

        const currentCfg = controller.getSnapshot().config || {}

        void controller.saveConfig({
          ...currentCfg,
          httpProxy: httpProxy || undefined,
          showFloatingHud,
          enableNotification,
          alarmThresholdPercent,
          refreshIntervalSeconds: refreshInterval,
          enabledProviders,
          custom_compatible: updatedCustomEndpoints,
          deepseek: { ...currentCfg.deepseek, enabled: enabledProviders.includes('deepseek'), apiKey: deepseekKey },
          cursor: { ...currentCfg.cursor, enabled: enabledProviders.includes('cursor'), autoDetectLocal: true, sessionToken: cursorToken },
          codex: { ...currentCfg.codex, enabled: enabledProviders.includes('codex'), autoDetectLocal: true, oauth: codexToken ? { accessToken: codexToken } : currentCfg.codex?.oauth },
          github_copilot: { ...currentCfg.github_copilot, enabled: enabledProviders.includes('github_copilot'), autoDetectLocal: true, token: copilotToken },
          openai_billing: { ...currentCfg.openai_billing, enabled: enabledProviders.includes('openai_billing'), apiKey: openaiKey },
          claude: { ...currentCfg.claude, enabled: enabledProviders.includes('claude'), apiKey: claudeKey },
          kimi: { ...currentCfg.kimi, enabled: enabledProviders.includes('kimi'), apiKey: kimiKey },
          glm: { ...currentCfg.glm, enabled: enabledProviders.includes('glm'), apiKey: glmKey },
          qwen: { ...currentCfg.qwen, enabled: enabledProviders.includes('qwen'), apiKey: qwenKey },
          volcengine: { ...currentCfg.volcengine, enabled: enabledProviders.includes('volcengine'), apiKey: volcKey },
          opencode_go: { ...currentCfg.opencode_go, enabled: enabledProviders.includes('opencode_go'), apiKey: opencodeKey },
        }).then(() => {
          const hint = container.querySelector('#save-status-hint') as HTMLElement | null
          if (hint) {
            hint.style.display = 'inline-block'
            setTimeout(() => { if (hint) hint.style.display = 'none' }, 2500)
          }
        })
      })
    }
  }

  const unsubscribe = controller.subscribe(update)
  update()

  return () => {
    unsubscribe()
    styleEl.remove()
  }
}
