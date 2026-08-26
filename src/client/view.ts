import type { QuotaController } from './controller.ts'
import type { AuthCardItem, QuotaConfig, MetricWindow } from './api.ts'
import { makeHudMetricKey } from './api.ts'

const PROVIDER_TITLES: Record<string, string> = {
  antigravity: 'Google Antigravity',
  cursor: 'Cursor',
  codex: 'Codex (OpenAI)',
  opencode_go: 'OpenCode Go',
}

function getQuotaStatusColor(remainingPercent: number): string {
  // 宋式雅色（低饱和度、沉静克制、护眼素雅）
  if (remainingPercent <= 15) {
    return '#B04A46' // 🔴 茜色 / 殷红（危急，克制而不刺目）
  } else if (remainingPercent <= 35) {
    return '#BA8137' // 🟡 缃黄 / 栀子（预警，沉静温和）
  }
  return '#3F7A63' // 🟢 竹青 / 豆绿（充足，温润如瓷）
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

function renderHudMetricOptions(cards: AuthCardItem[], selectedMetrics?: string[]): string {
  const providerBlocks = cards.map(card => {
    const groupBlocks = card.groups.map(group => {
      const windowOptions = group.windows.map(win => {
        const key = makeHudMetricKey(card.provider, group.title, win.id)
        const checked = selectedMetrics === undefined || selectedMetrics.includes(key) ? 'checked' : ''
        return `
          <label class="hud-metric-option">
            <input type="checkbox" class="hud-metric-cb" data-metric-key="${key}" ${checked} />
            <span title="${win.label}">${win.label}</span>
          </label>
        `
      }).join('')
      if (!windowOptions) return ''
      return `
        <div class="hud-metric-group">
          <div class="hud-metric-group-title">${group.title}</div>
          ${windowOptions}
        </div>
      `
    }).filter(Boolean).join('')

    if (!groupBlocks) return ''
    return `
      <div class="hud-metric-provider">
        <div class="hud-metric-provider-title">${card.name}</div>
        ${groupBlocks}
      </div>
    `
  }).filter(Boolean).join('')

  return providerBlocks || '<div class="hud-metric-empty">刷新额度后可选择具体模型或额度窗口</div>'
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

    /* --- Sidebar Row Styles --- */
    .dsh-quota-entry {
      box-sizing: border-box;
      display: flex;
      align-items: center;
      gap: 8px;
      width: 100%;
      height: 36px;
      padding: 0 10px;
      background: transparent;
      border: none;
      border-radius: 8px;
      color: var(--dsw-alias-label-secondary, #57606a);
      cursor: pointer;
      font-size: 13px;
      white-space: nowrap;
      font-family: inherit;
      text-align: left;
      transition: background-color 120ms ease, color 120ms ease;
    }
    .dsh-quota-entry:hover {
      background: var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, 0.06));
      color: var(--dsw-alias-label-primary, #1f2328);
    }
    .dsh-quota-entry[data-active] {
      background: var(--dsw-alias-interactive-bg-active, rgba(0, 0, 0, 0.1));
      color: var(--dsw-alias-label-primary, #1f2328);
      font-weight: 600;
    }
    .dsh-quota-entry-icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 24px;
      height: 24px;
      flex: none;
    }
    .dsh-quota-entry-icon svg {
      display: block;
      width: 18px;
      height: 18px;
    }
    .dsh-quota-entry-label {
      overflow: hidden;
      text-overflow: ellipsis;
      flex: 1;
    }
    [data-dsh-frame][data-sidebar-collapsed] .dsh-quota-entry {
      justify-content: center;
      padding: 0;
      width: 36px;
      height: 36px;
      margin: 0 auto 12px;
      border-radius: 50%;
    }
    [data-dsh-frame][data-sidebar-collapsed] .dsh-quota-entry-label {
      display: none;
    }

    /* --- Container & Layout --- */
    .quota-container {
      max-width: 680px;
      margin: 0 auto;
      padding: 24px 16px 56px;
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
      font-size: 17px;
      font-weight: 700;
      color: var(--dsw-alias-label-primary, #111);
      display: flex;
      align-items: center;
      gap: 6px;
      letter-spacing: -0.2px;
    }
    .quota-version-tag {
      font-size: 11px;
      font-weight: 500;
      color: var(--dsw-alias-label-tertiary, #8c959f);
      font-family: ui-monospace, SFMono-Regular, "SF Mono", Menlo, Consolas, monospace;
    }
    .quota-tabs {
      display: flex;
      gap: 4px;
      background: var(--dsw-alias-bg-layer-2, rgba(0,0,0,0.04));
      padding: 3px;
      border-radius: 8px;
    }
    .quota-tab-btn {
      padding: 5px 12px;
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
      transition: color 0.15s, background 0.15s, transform 0.2s;
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

    /* --- Cards & Sections --- */
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
      font-size: 13.5px;
      font-weight: 600;
      color: var(--dsw-alias-label-secondary, #57606a);
      display: flex;
      align-items: center;
      gap: 6px;
      padding-left: 2px;
    }

    .official-long-card {
      background: var(--dsw-alias-bg-layer-1, #ffffff);
      border: 1px solid var(--dsw-alias-border-l2, rgba(0,0,0,0.08));
      border-radius: 8px;
      overflow: hidden;
      box-shadow: 0 1px 2px rgba(0,0,0,0.02);
    }
    .official-long-card:hover {
      overflow: visible;
    }
    .card-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      height: 56px;
      min-height: 56px;
      max-height: 56px;
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
      overflow: visible;
    }
    .row-left-content:hover {
      z-index: 3;
    }
    .row-main-label {
      font-size: 13.5px;
      font-weight: 600;
      color: var(--dsw-alias-label-primary, #1f2328);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      line-height: 1.35;
      cursor: default;
    }
    .row-sub-label {
      font-size: 12px;
      font-weight: 400;
      color: var(--dsw-alias-label-secondary, #57606a);
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      line-height: 1.35;
      cursor: default;
    }
    .row-main-label:hover,
    .row-sub-label:hover {
      position: relative;
      z-index: 4;
      display: block;
      width: max-content;
      max-width: min(620px, calc(100vw - 150px));
      overflow: visible;
      white-space: normal;
      text-overflow: clip;
      background: var(--dsw-alias-bg-layer-1, #ffffff);
      border-radius: 4px;
      padding: 2px 6px;
      margin: -2px -6px;
      box-shadow: 0 3px 12px rgba(0, 0, 0, 0.12);
    }
    .row-right-metric {
      display: flex;
      align-items: center;
      gap: 10px;
      flex: none;
      margin-left: 16px;
    }
    .row-percent-number {
      font-size: 14px;
      font-weight: 700;
      font-feature-settings: "tnum";
      font-variant-numeric: tabular-nums;
      min-width: 38px;
      text-align: right;
      letter-spacing: -0.2px;
    }
    .row-top-info {
      display: flex;
      align-items: center;
      justify-content: space-between;
    }

    /* --- Form & Settings --- */
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
      gap: 4px;
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
      transition: background 0.15s ease;
    }
    .sort-item-row:hover {
      background: var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,0.04));
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
      transition: background 0.12s;
    }
    .btn-arrow:hover:not(:disabled) {
      background: var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,0.06));
    }
    .btn-arrow:disabled {
      opacity: 0.35;
      cursor: default;
    }

    .setting-item-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      padding: 4px 0;
    }
    .setting-item-col {
      display: flex;
      flex-direction: column;
      gap: 6px;
      padding: 4px 0;
    }
    .setting-item-label-col {
      display: flex;
      align-items: center;
      gap: 4px;
    }
    .setting-label {
      font-size: 13px;
      font-weight: 600;
      color: var(--dsw-alias-label-primary, #1f2328);
    }
    .quota-toggle-label {
      display: flex;
      align-items: center;
      gap: 6px;
      cursor: pointer;
      font-size: 12.5px;
      color: var(--dsw-alias-label-secondary, #57606a);
    }
    .hud-metric-list {
      display: flex;
      flex-direction: column;
      gap: 6px;
      max-height: 260px;
      overflow-y: auto;
      padding: 2px 0;
    }
    .hud-metric-provider {
      display: flex;
      flex-direction: column;
      gap: 4px;
    }
    .hud-metric-provider-title {
      font-size: 12.5px;
      font-weight: 700;
      color: var(--dsw-alias-label-primary, #1f2328);
      padding: 2px 0;
    }
    .hud-metric-group {
      display: flex;
      flex-direction: column;
      gap: 3px;
      padding-left: 8px;
    }
    .hud-metric-group-title {
      font-size: 11.5px;
      font-weight: 600;
      color: var(--dsw-alias-label-secondary, #57606a);
      padding: 2px 0;
    }
    .hud-metric-option {
      display: flex;
      align-items: center;
      gap: 8px;
      min-height: 26px;
      padding: 3px 8px;
      border-radius: 5px;
      font-size: 12px;
      color: var(--dsw-alias-label-primary, #1f2328);
      cursor: pointer;
    }
    .hud-metric-option:hover {
      background: var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,0.04));
    }
    .hud-metric-option span {
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .hud-metric-empty,
    .hud-metric-note {
      font-size: 11.5px;
      line-height: 1.45;
      color: var(--dsw-alias-label-tertiary, #8c959f);
    }
    .hud-metric-note {
      margin-top: -4px;
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
      padding: 8px 0;
    }
    .credential-item + .credential-item {
      border-top: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,0.05));
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
      gap: 4px;
    }
    .credential-title {
      font-size: 13px;
      font-weight: 600;
      color: var(--dsw-alias-label-primary, #1f2328);
    }
    .credential-status {
      font-size: 11.5px;
      color: var(--dsw-alias-label-tertiary, #8c959f);
    }
    .credential-status.connected {
      color: #3F7A63;
      font-weight: 500;
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
      vertical-align: -1px;
      margin-left: 4px;
      transition: color 0.15s ease;
      outline: none;
    }
    .quota-help-tip:hover, .quota-help-tip:focus {
      color: var(--dsw-alias-brand-primary, #0969da);
    }
    .quota-help-tip::after {
      content: attr(data-tooltip);
      position: absolute;
      bottom: calc(100% + 7px);
      left: 50%;
      transform: translateX(-50%) translateY(4px);
      background: #ffffff !important;
      color: #1f2328 !important;
      border: 1px solid rgba(0, 0, 0, 0.14) !important;
      font-size: 11.5px;
      font-weight: 500;
      line-height: 1.45;
      padding: 7px 11px;
      border-radius: 6px;
      white-space: normal;
      width: max-content;
      max-width: 280px;
      box-shadow: 0 6px 20px rgba(0, 0, 0, 0.14), 0 1px 3px rgba(0, 0, 0, 0.08);
      pointer-events: none;
      opacity: 0;
      visibility: hidden;
      transition: opacity 0.15s ease, transform 0.15s ease, visibility 0.15s ease;
      z-index: 999;
      text-align: left;
    }
    .quota-help-tip::before {
      content: '';
      position: absolute;
      bottom: calc(100% + 2px);
      left: 50%;
      transform: translateX(-50%) translateY(4px);
      border-width: 5px 5px 0 5px;
      border-style: solid;
      border-color: #ffffff transparent transparent transparent;
      pointer-events: none;
      opacity: 0;
      visibility: hidden;
      transition: opacity 0.15s ease, transform 0.15s ease, visibility 0.15s ease;
      z-index: 1000;
      filter: drop-shadow(0 1px 1px rgba(0, 0, 0, 0.08));
    }
    .quota-help-tip:hover::after, .quota-help-tip:focus::after,
    .quota-help-tip:hover::before, .quota-help-tip:focus::before {
      opacity: 1;
      visibility: visible;
      transform: translateX(-50%) translateY(0);
    }
  `
  document.head.appendChild(styleEl)

  function update() {
    const state = controller.getSnapshot()
    if (!state.panelOpen) return

    let contentHtml = ''

    if (state.activeTab === 'overview') {
      const sectionsHtml = state.cards.length === 0
        ? '<div style="text-align: center; color: var(--dsw-alias-label-tertiary, #888); padding: 48px;">未启用或正在加载各服务额度...</div>'
        : state.cards.map((card) => {
            const isErr = card.status === 'error' || card.status === 'disabled'
            const isRefreshing = state.refreshingProviders.has(card.provider)

            let actionBtn = ''
            if (card.provider === 'codex' && isErr) {
              actionBtn = '<button class="quota-btn action btn-login-codex">登录 Codex</button>'
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
                      <span class="row-sub-label">请连接授权后刷新查看实时额度</span>
                    </div>
                    <div>${actionBtn}</div>
                  </div>
                </div>
              `
            } else {
              bodyHtml = card.groups.map(group => {
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
                        <span class="row-percent-number" style="color: ${statusColor};">${rem}%</span>
                        ${renderCircleProgress(rem)}
                      </div>
                    </div>
                  `
                }).join('')

                return `
                  <div class="auth-group-block">
                    <div class="group-header-title">
                      <span>${group.title}</span>
                    </div>
                    <div class="official-long-card">
                      ${rowsHtml}
                    </div>
                  </div>
                `
              }).join('')
            }

            return `
              <div class="quota-section" data-provider="${card.provider}">
                <div class="auth-title-row">
                  <div class="auth-section-title">
                    <span>${card.name}</span>
                  </div>
                  <div style="display: flex; gap: 8px; align-items: center;">
                    ${card.account ? `<span style="font-size: 12px; color: var(--dsw-alias-label-secondary);">${card.account}</span>` : ''}
                    <button class="btn-card-refresh ${isRefreshing ? 'spinning' : ''}" data-refresh-provider="${card.provider}" title="独立刷新此服务">↻</button>
                    ${actionBtn}
                  </div>
                </div>
                ${bodyHtml}
              </div>
            `
          }).join('')

      contentHtml = sectionsHtml
    } else {
      // Settings tab
      const cfg = state.config || {}
      const currentOrder = (cfg.providerOrder && cfg.providerOrder.length > 0) ? cfg.providerOrder : DEFAULT_PROVIDER_ORDER
      const showHud = cfg.showFloatingHud !== false

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

      contentHtml = `
        <form id="dsh-quota-form" class="quota-form">
          <!-- 1. 服务展示与排序 -->
          <div class="quota-settings-section">
            <div class="settings-section-header">
              <span class="settings-section-title">服务展示与排序</span>
              ${renderHelp('勾选以在概览页显示该服务；点击右侧箭头可自定义卡片在概览中的排序')}
            </div>
            <div class="sort-list">
              ${orderListHtml}
            </div>
          </div>

          <!-- 2. 通用偏好 -->
          <div class="quota-settings-section">
            <div class="settings-section-header">
              <span class="settings-section-title">通用偏好</span>
            </div>

            <div class="setting-item-row">
              <div class="setting-item-label-col">
                <span class="setting-label">主界面悬浮环 (HUD)</span>
                ${renderHelp('在 DSH 页面右侧显示可拖动的圆形额度悬浮窗，支持轮播速览')}
              </div>
              <label class="quota-toggle-label">
                <input type="checkbox" id="show-floating-hud" ${showHud ? 'checked' : ''} />
                <span>显示悬浮环</span>
              </label>
            </div>

            <div class="setting-item-col hud-metric-settings" style="border-top: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,0.05)); padding-top: 8px;">
              <div class="setting-item-label-col">
                <span class="setting-label">悬浮环内容</span>
                ${renderHelp('选择悬浮环轮播显示的服务、模型和额度窗口；未选择时默认显示全部')}
              </div>
              <div class="hud-metric-list">
                ${renderHudMetricOptions(state.allCards, cfg.floatingHudMetrics)}
              </div>
              <div class="hud-metric-note">勾选要显示的额度窗口 · 未配置时默认显示全部</div>
            </div>

            <div class="setting-item-col" style="border-top: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,0.05)); padding-top: 8px;">
              <div class="setting-item-label-col">
                <span class="setting-label">网络代理</span>
                ${renderHelp('直连访问 Google 或 OpenAI 出现超时或 403 拦截时配置本地代理 (如 http://127.0.0.1:7890)')}
              </div>
              <input type="text" id="http-proxy" class="quota-input" placeholder="http://127.0.0.1:7890" value="${cfg.httpProxy || ''}" />
            </div>
          </div>

          <!-- 3. 服务凭据与授权 -->
          <div class="quota-settings-section">
            <div class="settings-section-header">
              <span class="settings-section-title">服务凭据与授权</span>
              ${renderHelp('各平台均支持自动探测本地已登录凭据，亦可在此进行独立配置')}
            </div>

            <!-- Google Antigravity -->
            <div class="credential-item">
              <div class="credential-header">
                <div class="credential-title-wrap">
                  <span class="credential-title">Google Antigravity</span>
                  ${renderHelp('自动读取本地 IDE 登录态；亦可点击授权按钮在浏览器中登录 Google 账号')}
                </div>
                <div style="display: flex; gap: 8px; align-items: center;">
                  <span class="credential-status ${cfg.antigravity?.oauth?.accessToken ? 'connected' : ''}">
                    ${cfg.antigravity?.oauth?.accessToken ? `已连接${cfg.antigravity?.oauth?.email ? ` · ${cfg.antigravity.oauth.email}` : ''}` : '未连接'}
                  </span>
                  <button type="button" class="quota-btn secondary btn-login-antigravity" style="padding: 4px 10px; font-size: 12px;">${cfg.antigravity?.oauth?.accessToken ? '重新授权' : '登录 Google'}</button>
                </div>
              </div>
            </div>

            <!-- Cursor -->
            <div class="credential-item">
              <div class="credential-header">
                <div class="credential-title-wrap">
                  <span class="credential-title">Cursor</span>
                  ${renderHelp('自动探测本地 Cursor state.vscdb；跨机器部署可填入 WorkosCursorSessionToken')}
                </div>
                <button type="button" class="quota-btn secondary btn-login-cursor" style="padding: 4px 10px; font-size: 12px;">自动读取本地登录</button>
              </div>
              <input type="password" id="cursor-token" class="quota-input" placeholder="WorkosCursorSessionToken" value="${cfg.cursor?.sessionToken || ''}" />
            </div>

            <!-- Codex (OpenAI) -->
            <div class="credential-item">
              <div class="credential-header">
                <div class="credential-title-wrap">
                  <span class="credential-title">Codex (OpenAI)</span>
                  ${renderHelp('自动读取本地 ~/.codex/auth.json；亦可点击登录或手动填入 access_token')}
                </div>
                <div style="display: flex; gap: 8px; align-items: center;">
                  <span class="credential-status ${cfg.codex?.oauth?.accessToken ? 'connected' : ''}">
                    ${cfg.codex?.oauth?.accessToken ? '已授权' : '未连接'}
                  </span>
                  <button type="button" class="quota-btn secondary btn-login-codex" style="padding: 4px 10px; font-size: 12px;">登录 OpenAI</button>
                </div>
              </div>
              <input type="password" id="codex-token" class="quota-input" placeholder="access_token" value="${cfg.codex?.oauth?.accessToken || ''}" />
            </div>

            <!-- OpenCode Go -->
            <div class="credential-item">
              <div class="credential-header">
                <div class="credential-title-wrap">
                  <span class="credential-title">OpenCode Go</span>
                  ${renderHelp('填入 OpenCode 官方 API Key (sk-...) 以查询 Go 订阅额度与重置周期')}
                </div>
              </div>
              <div style="display: flex; flex-direction: column; gap: 6px;">
                <input type="password" id="opencode-key" class="quota-input" placeholder="sk-..." value="${cfg.opencode_go?.apiKey || ''}" />
                <input type="text" id="opencode-base" class="quota-input" placeholder="https://opencode.ai" value="${cfg.opencode_go?.baseUrl || ''}" />
              </div>
            </div>
          </div>

          <!-- Bottom Action Bar -->
          <div class="settings-bottom-bar">
            <span id="save-status-hint" style="font-size: 12px; color: #3F7A63; font-weight: 500; display: none;">✓ 设置已保存</span>
            <button type="submit" class="quota-btn">保存设置</button>
          </div>
        </form>
      `
    }

    container.innerHTML = `
      <div class="quota-container">
        <div class="quota-header">
          <div class="quota-title">
            <span>AI 额度监控</span>
            <span class="quota-version-tag">v0.1.0</span>
            ${state.loading ? '<span style="font-size: 12px; font-weight: normal; color: var(--dsw-alias-brand-primary, #0969da); margin-left: 8px;">正在刷新...</span>' : ''}
          </div>
          <div style="display: flex; gap: 10px; align-items: center;">
            <div class="quota-tabs">
              <button id="tab-overview" class="quota-tab-btn ${state.activeTab === 'overview' ? 'active' : ''}">概览</button>
              <button id="tab-settings" class="quota-tab-btn ${state.activeTab === 'settings' ? 'active' : ''}">设置</button>
            </div>
            <button id="btn-refresh" class="quota-btn secondary">↻ 全部刷新</button>
          </div>
        </div>
        ${contentHtml}
      </div>
    `

    // Event binding
    const tabOverview = container.querySelector('#tab-overview')
    const tabSettings = container.querySelector('#tab-settings')
    const btnRefresh = container.querySelector('#btn-refresh')
    const form = container.querySelector('#dsh-quota-form')

    tabOverview?.addEventListener('click', () => controller.setTab('overview'))
    tabSettings?.addEventListener('click', () => controller.setTab('settings'))
    btnRefresh?.addEventListener('click', () => controller.refresh(true))

    // Single card independent refresh
    container.querySelectorAll('.btn-card-refresh').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.stopPropagation()
        const prov = btn.getAttribute('data-refresh-provider')
        if (prov) void controller.refreshSingle(prov)
      })
    })

    container.querySelectorAll('.btn-login-codex').forEach(btn => {
      btn.addEventListener('click', async () => {
        try {
          const authUrl = await controller.startCodexLogin()
          window.open(authUrl, '_blank')
          setTimeout(() => controller.refresh(true), 3000)
          setTimeout(() => controller.refresh(true), 8000)
        } catch (err: any) {
          alert('启动 Codex 登录失败: ' + err.message)
        }
      })
    })

    container.querySelectorAll('.btn-login-antigravity').forEach(btn => {
      btn.addEventListener('click', async () => {
        try {
          const authUrl = await controller.startAntigravityLogin()
          window.open(authUrl, '_blank')
          setTimeout(() => controller.refresh(true), 3000)
          setTimeout(() => controller.refresh(true), 8000)
          setTimeout(() => controller.refresh(true), 15000)
        } catch (err: any) {
          alert('启动 Google Antigravity 登录失败: ' + err.message)
        }
      })
    })

    container.querySelectorAll('.btn-login-cursor').forEach(btn => {
      btn.addEventListener('click', async () => {
        try {
          await controller.connectCursor()
          await controller.refresh(true)
        } catch (err: any) {
          alert('连接 Cursor 失败: ' + err.message)
        }
      })
    })

    // Immediate checkbox change handler
    container.querySelectorAll('.prov-enable-cb').forEach((cb: any) => {
      cb.addEventListener('change', () => {
        const enabledProviders: string[] = []
        container.querySelectorAll('.prov-enable-cb').forEach((c: any) => {
          if (c.checked) {
            const p = c.getAttribute('data-prov')
            if (p) enabledProviders.push(p)
          }
        })
        const currentCfg = controller.getSnapshot().config || {}
        void controller.saveConfig({
          ...currentCfg,
          enabledProviders,
          floatingHudMetrics: currentCfg.floatingHudMetrics,
          opencode_go: { ...currentCfg.opencode_go, enabled: enabledProviders.includes('opencode_go') },
          cursor: { ...currentCfg.cursor, enabled: enabledProviders.includes('cursor') },
          codex: { ...currentCfg.codex, enabled: enabledProviders.includes('codex') },
          antigravity: { ...currentCfg.antigravity, enabled: enabledProviders.includes('antigravity') },
        })
      })
    })

    // Reorder buttons in settings
    let dynamicOrder = [...((state.config?.providerOrder && state.config.providerOrder.length > 0) ? state.config.providerOrder : DEFAULT_PROVIDER_ORDER)]

    container.querySelectorAll('.btn-move-up').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.getAttribute('data-idx'))
        if (idx > 0) {
          const temp = dynamicOrder[idx - 1]!
          dynamicOrder[idx - 1] = dynamicOrder[idx]!
          dynamicOrder[idx] = temp
          const currentCfg = controller.getSnapshot().config || {}
          void controller.saveConfig({ ...currentCfg, providerOrder: dynamicOrder, floatingHudMetrics: currentCfg.floatingHudMetrics })
        }
      })
    })

    container.querySelectorAll('.btn-move-down').forEach(btn => {
      btn.addEventListener('click', () => {
        const idx = Number(btn.getAttribute('data-idx'))
        if (idx < dynamicOrder.length - 1) {
          const temp = dynamicOrder[idx + 1]!
          dynamicOrder[idx + 1] = dynamicOrder[idx]!
          dynamicOrder[idx] = temp
          const currentCfg = controller.getSnapshot().config || {}
          void controller.saveConfig({ ...currentCfg, providerOrder: dynamicOrder, floatingHudMetrics: currentCfg.floatingHudMetrics })
        }
      })
    })

    if (form) {
      form.addEventListener('submit', (e) => {
        e.preventDefault()
        const httpProxy = (container.querySelector('#http-proxy') as HTMLInputElement)?.value?.trim()
        const cursorToken = (container.querySelector('#cursor-token') as HTMLInputElement)?.value?.trim()
        const codexToken = (container.querySelector('#codex-token') as HTMLInputElement)?.value?.trim()
        const opencodeKey = (container.querySelector('#opencode-key') as HTMLInputElement)?.value?.trim()
        const opencodeBase = (container.querySelector('#opencode-base') as HTMLInputElement)?.value?.trim()
        const showFloatingHud = (container.querySelector('#show-floating-hud') as HTMLInputElement)?.checked

        const enabledProviders: string[] = []
        container.querySelectorAll('.prov-enable-cb').forEach((cb: any) => {
          if (cb.checked) {
            const prov = cb.getAttribute('data-prov')
            if (prov) enabledProviders.push(prov)
          }
        })

        const currentCfg = controller.getSnapshot().config || {}
        const hudMetricInputs = Array.from(container.querySelectorAll<HTMLInputElement>('.hud-metric-cb'))
        const floatingHudMetrics = hudMetricInputs.length > 0
          ? hudMetricInputs.filter(input => input.checked)
            .map(input => input.getAttribute('data-metric-key'))
            .filter((key): key is string => Boolean(key))
          : currentCfg.floatingHudMetrics

        void controller.saveConfig({
          ...currentCfg,
          httpProxy: httpProxy || undefined,
          enabledProviders,
          providerOrder: dynamicOrder,
          showFloatingHud,
          floatingHudMetrics,
          cursor: { ...currentCfg.cursor, enabled: enabledProviders.includes('cursor'), autoDetectLocal: true, sessionToken: cursorToken },
          codex: {
            ...currentCfg.codex,
            enabled: enabledProviders.includes('codex'),
            autoDetectLocal: true,
            oauth: codexToken ? { accessToken: codexToken } : currentCfg.codex?.oauth,
          },
          antigravity: { ...currentCfg.antigravity, enabled: enabledProviders.includes('antigravity'), autoDetectLocal: true, oauth: currentCfg.antigravity?.oauth },
          opencode_go: { ...currentCfg.opencode_go, enabled: enabledProviders.includes('opencode_go'), apiKey: opencodeKey, baseUrl: opencodeBase },
          refreshIntervalMinutes: 10,
        }).then(() => {
          const hint = container.querySelector('#save-status-hint') as HTMLElement
          if (hint) {
            hint.style.display = 'inline-block'
            setTimeout(() => {
              if (hint) hint.style.display = 'none'
            }, 2500)
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
