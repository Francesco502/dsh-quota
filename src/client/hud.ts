import type { QuotaController } from './controller.ts'
import type { AuthCardItem, MetricWindow, QuotaConfig } from './api.ts'
import { makeHudMetricKey, isQuantified, windowQuotaKind } from './api.ts'
import type { QuotaKind } from './api.ts'

interface HudMetric {
  key: string
  provider: string
  /** Full `service · group · window` text; escaped once at the controller boundary. */
  name: string
  /** Service display name for a popover row (ellipsised when the row is too narrow). */
  service: string
  /** Short metric label: 余额 / 5h / 周 / 月 / 滚动 / 量. */
  shortLabel: string
  tag: string
  kind: QuotaKind
  remainingPercent?: number
  amountText?: string
}

type StatusTone = 'ok' | 'warn' | 'error'
type FocusTarget = 'host' | 'pause' | 'panel' | null

const HUD_SIZE = 46
/** Below this viewport width the popover shrinks and always opens away from the right edge. */
const NARROW_BREAKPOINT = 640
const POSITION_STORAGE_KEY = 'dsh_quota_hud_pos'
/** sessionStorage key required by the HUD contract; survives re-mounts in the same tab. */
const PAUSED_STORAGE_KEY = 'dsh_quota_hud_paused'
const CAROUSEL_INTERVAL_MS = 4500
const ERROR_THRESHOLD_PERCENT = 15
const WARN_THRESHOLD_PERCENT = 35
const HOVER_HIDE_DELAY_MS = 140

const PAUSE_ICON = `<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false"><rect x="4" y="3" width="3" height="10" rx="1" fill="currentColor"></rect><rect x="9" y="3" width="3" height="10" rx="1" fill="currentColor"></rect></svg>`
const PLAY_ICON = `<svg viewBox="0 0 16 16" width="12" height="12" aria-hidden="true" focusable="false"><path d="M5 3.4 12.2 8 5 12.6Z" fill="currentColor"></path></svg>`

function isQuantifiedMetric(metric: HudMetric): boolean {
  return metric.kind === 'usage'
    && typeof metric.remainingPercent === 'number'
    && Number.isFinite(metric.remainingPercent)
}

function metricValueText(metric: HudMetric): string {
  if (isQuantifiedMetric(metric)) return `${Math.round(metric.remainingPercent!)}% 剩余`
  if (metric.kind === 'balance') return metric.amountText || '—'
  if (metric.kind === 'liveness') return '仅连通性'
  return '未知'
}

function compactScaled(value: number): string {
  const text = Math.abs(value) >= 100 ? value.toFixed(0) : value.toFixed(1)
  return text.replace(/\.0$/, '')
}

/**
 * Keep the dial's centre label inside the ring. Percentages are already short;
 * balance amounts can be arbitrary strings (`¥1234.56`, `9.99GB`, `余额 …`), so
 * large plain numbers are scaled (K/M/B) and anything else is ellipsised. The
 * CSS side caps the label width and also ellipsises as a last resort.
 */
export function compactHudAmount(text: string): string {
  const raw = typeof text === 'string' ? text.trim() : ''
  if (raw === '') return raw

  const match = /^([^0-9+\-]*)([+\-]?\d[\d,]*(?:\.\d+)?)(.*)$/.exec(raw)
  if (match !== null) {
    const prefix = match[1] ?? ''
    const digits = match[2] ?? ''
    const suffix = match[3] ?? ''
    const value = Number(digits.replace(/,/g, ''))
    if (Number.isFinite(value) && suffix === '') {
      const abs = Math.abs(value)
      if (abs >= 1e9) return `${prefix}${compactScaled(value / 1e9)}B`
      if (abs >= 1e6) return `${prefix}${compactScaled(value / 1e6)}M`
      if (abs >= 1e3) return `${prefix}${compactScaled(value / 1e3)}K`
    }
  }

  if (raw.length <= 8) return raw
  return `${raw.slice(0, 7)}…`
}

/**
 * Condense a window into one of the six labels the popover row shows next to the
 * service name. `quotaKind` wins, then the declared `windowKind`, then the raw
 * label/id so legacy windows (no `windowKind`) still land on the right bucket.
 */
function inferMetricShortLabel(window: MetricWindow): string {
  if (windowQuotaKind(window) === 'balance') return '余额'

  switch (window.windowKind) {
    case '5h': return '5h'
    case 'weekly': return '周'
    case 'monthly': return '月'
    case 'sliding': return '滚动'
    default: break
  }

  const text = `${window.label || ''} ${window.id || ''}`.toLowerCase()
  if (/(^|[^0-9])5\s*[- ]?h|5\s*小时|five[\s-]?hour/.test(text)) return '5h'
  if (/weekly|week|周/.test(text)) return '周'
  if (/monthly|month|月度|月/.test(text)) return '月'
  if (/slid|roll|滚动|滑动/.test(text)) return '滚动'
  if (/balance|余额/.test(text)) return '余额'
  return '量'
}

function statusTone(remainingPercent: number): StatusTone {
  if (remainingPercent <= ERROR_THRESHOLD_PERCENT) return 'error'
  if (remainingPercent <= WARN_THRESHOLD_PERCENT) return 'warn'
  return 'ok'
}

/** Text for an element carrying escaped card text back out of an HTML attribute. */
const HTML_ENTITIES: Record<string, string> = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
}

function decodeHudText(value: string): string {
  return value.replace(/&(amp|lt|gt|quot|#39);/g, entity => HTML_ENTITIES[entity] ?? entity)
}

function metricAriaText(metric: HudMetric): string {
  const service = decodeHudText(metric.service)
  const label = metric.shortLabel === '量' ? '' : `${metric.shortLabel} `
  if (isQuantifiedMetric(metric)) {
    const percent = Math.round(metric.remainingPercent!)
    if (percent <= 0) return `${service} ${label}剩余 0%，额度已耗尽`
    return `${service} ${label}剩余 ${percent}%`
  }
  if (metric.kind === 'balance') return `${service} 余额 ${decodeHudText(metric.amountText || '未知')}`
  if (metric.kind === 'liveness') return `${service} 仅连通性，未提供额度接口`
  return `${service} 额度状态未知`
}

interface HudPosition {
  x: number
  y: number
}

interface PopoverPlacement {
  vertical: 'pop-top' | 'pop-bottom'
  horizontal: 'pop-left' | 'pop-right'
}

/**
 * Pick where the hover card opens. Desktop keeps the historical side rule; narrow
 * viewports prefer opening leftwards (right edge anchored to the ball) so the card
 * never pokes past the right edge, falling back when the left side has no room.
 */
function computePopoverPlacement(position: HudPosition, viewportWidth: number): PopoverPlacement {
  const vertical: PopoverPlacement['vertical'] = position.y < 200 ? 'pop-bottom' : 'pop-top'
  if (viewportWidth >= NARROW_BREAKPOINT) {
    return {
      vertical,
      horizontal: position.x > viewportWidth / 2 ? 'pop-right' : 'pop-left',
    }
  }

  const cardWidth = Math.min(220, viewportWidth - 24)
  const roomLeft = position.x + HUD_SIZE - 8
  const roomRight = viewportWidth - position.x - 8
  if (roomLeft >= cardWidth) return { vertical, horizontal: 'pop-right' }
  if (roomRight >= cardWidth) return { vertical, horizontal: 'pop-left' }
  return { vertical, horizontal: roomRight >= roomLeft ? 'pop-left' : 'pop-right' }
}

/** True when the ball is parked against a viewport edge (the docked/micro state). */
function isDockedPosition(position: HudPosition): boolean {
  return position.x <= 24 || position.x + HUD_SIZE >= window.innerWidth - 24
}

function neutralRingSvg(): string {
  return `
    <svg class="dsh-hud-svg" viewBox="0 0 46 46" aria-hidden="true" focusable="false">
      <circle class="dsh-hud-ring-track" cx="23" cy="23" r="18"></circle>
    </svg>
  `
}

function getSavedPosition(): HudPosition {
  try {
    const raw = localStorage.getItem(POSITION_STORAGE_KEY)
    if (raw) {
      const pos = JSON.parse(raw)
      if (typeof pos.x === 'number' && typeof pos.y === 'number') {
        const maxX = Math.max(10, window.innerWidth - 60)
        const maxY = Math.max(10, window.innerHeight - 60)
        return {
          x: Math.min(Math.max(12, pos.x), maxX),
          y: Math.min(Math.max(12, pos.y), maxY),
        }
      }
    }
  } catch {}
  return { x: Math.max(12, window.innerWidth - 64), y: Math.max(60, window.innerHeight - 160) }
}

function savePosition(pos: HudPosition): void {
  try {
    localStorage.setItem(POSITION_STORAGE_KEY, JSON.stringify(pos))
  } catch {}
}

function readPausedState(): boolean {
  try {
    return sessionStorage.getItem(PAUSED_STORAGE_KEY) === '1'
  } catch {
    return false
  }
}

function savePausedState(paused: boolean): void {
  try {
    sessionStorage.setItem(PAUSED_STORAGE_KEY, paused ? '1' : '0')
  } catch {}
}

export interface HudMountOptions {
  /**
   * Slot hosts own panel selection. When provided, the ball click and the
   * popover's "打开面板" action select the qualified main panel instead of
   * toggling the legacy overlay state (which is not mounted in slot mode).
   */
  openPanel?: () => void
}

export function mountQuotaHud(controller: QuotaController, options: HudMountOptions = {}): () => void {
  const hudEl = document.createElement('div')
  hudEl.setAttribute('data-dsh-quota-hud', '')
  hudEl.setAttribute('role', 'button')
  hudEl.setAttribute('tabindex', '0')
  hudEl.setAttribute('aria-haspopup', 'true')
  hudEl.setAttribute('aria-expanded', 'false')
  hudEl.style.cssText = `
    position: fixed;
    z-index: 990;
    width: 46px;
    height: 46px;
    cursor: grab;
    user-select: none;
    touch-action: none;
    transition: transform 0.16s ease, opacity 0.16s ease;
  `

  const styleEl = document.createElement('style')
  styleEl.textContent = `
    [data-dsh-quota-hud] {
      /* Dashboard semantic palette: the dial is brand-coloured, status colour is
         reserved for the small dot/label accents. Keep the tokens in sync with
         the dashboard's --q-* block in view.ts. */
      --q-brand: var(--dsw-alias-brand-primary, #0969da);
      --q-fg: var(--dsw-alias-label-primary, #1f2328);
      --q-fg-2: var(--dsw-alias-label-secondary, #57606a);
      --q-bg: var(--dsw-alias-bg-base, #fff);
      --q-border: var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.12));
      --q-track: var(--dsw-alias-border-l1, rgba(0, 0, 0, 0.14));
      --q-success: #3F7A63;
      --q-warn: #BA8137;
      --q-error: #B04A46;
      /* The raw border token is a hairline; on dark surfaces it disappears.
         Mixing it toward the label colour keeps the dial ring legible in both themes. */
      --q-track-on-surface: color-mix(in srgb, var(--q-track) 70%, var(--q-fg) 30%);
      --q-shadow: color-mix(in srgb, #000 24%, transparent);
      --q-scrim: color-mix(in srgb, var(--q-fg) 9%, transparent);
      --q-card-width: 240px;
      /* The circle shrinks while docked to an edge; every font size below scales
         from this one variable, so the 46px and docked sizes stay proportional. */
      --hud-size: 46px;
      display: flex;
      align-items: center;
      justify-content: center;
      font-family: inherit;
    }
    @media (prefers-color-scheme: dark) {
      [data-dsh-quota-hud] {
        --q-bg: var(--dsw-alias-bg-base, #17181b);
        --q-fg: var(--dsw-alias-label-primary, #e6edf3);
        --q-fg-2: var(--dsw-alias-label-secondary, #9aa4b2);
        --q-border: var(--dsw-alias-border-l2, rgba(255, 255, 255, 0.18));
        --q-track: var(--dsw-alias-border-l1, rgba(255, 255, 255, 0.3));
        --q-success: #6fa78f;
        --q-warn: #d0a25f;
        --q-error: #cf827d;
      }
    }
    @keyframes q-dot-pulse {
      0%, 100% { box-shadow: 0 0 0 0 color-mix(in srgb, var(--q-error) 45%, transparent); }
      50% { box-shadow: 0 0 0 3px transparent; }
    }
    @media (prefers-reduced-motion: reduce) {
      [data-dsh-quota-hud],
      [data-dsh-quota-hud] * {
        animation: none !important;
        transition: none !important;
        scroll-behavior: auto !important;
      }
    }
    [data-dsh-quota-hud]:focus-visible {
      outline: 2px solid var(--q-fg);
      outline-offset: 3px;
      border-radius: 50%;
    }
    [data-dsh-quota-hud] .dsh-hud-circle {
      position: relative;
      width: var(--hud-size);
      height: var(--hud-size);
      border-radius: 50%;
      background: var(--q-bg);
      border: 1px solid var(--q-border);
      box-shadow: 0 4px 14px var(--q-shadow);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      overflow: visible;
      transition: width 0.18s ease, height 0.18s ease, transform 0.15s ease, box-shadow 0.15s ease, opacity 0.2s ease;
    }
    [data-dsh-quota-hud] .dsh-hud-circle:hover {
      transform: scale(1.06);
      box-shadow: 0 6px 18px var(--q-shadow);
    }
    [data-dsh-quota-hud] .dsh-hud-circle.docked {
      --hud-size: 38px;
      opacity: 0.72;
    }
    [data-dsh-quota-hud] .dsh-hud-circle.docked:hover,
    [data-dsh-quota-hud].is-hovered .dsh-hud-circle.docked,
    [data-dsh-quota-hud].is-open .dsh-hud-circle.docked {
      --hud-size: 46px;
      opacity: 1;
      transform: none;
    }
    [data-dsh-quota-hud] .dsh-hud-circle.is-exhausted {
      /* A thin border is a small accent; the old full-ball pulse read as an
         alarm and is replaced by the dot animation below. */
      border-color: color-mix(in srgb, var(--q-error) 55%, var(--q-border));
    }
    [data-dsh-quota-hud] .dsh-hud-svg {
      position: absolute;
      inset: 0;
      width: 100%;
      height: 100%;
      transform: rotate(-90deg);
      pointer-events: none;
    }
    [data-dsh-quota-hud] .dsh-hud-ring-track {
      fill: none;
      stroke: var(--q-track-on-surface, var(--q-track));
      stroke-width: 3;
    }
    [data-dsh-quota-hud] .dsh-hud-ring-value {
      fill: none;
      stroke: var(--q-brand);
      stroke-width: 3;
      stroke-linecap: round;
      transition: stroke-dashoffset 0.4s ease, stroke 0.3s ease;
    }
    [data-dsh-quota-hud] .dsh-hud-content {
      position: relative;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      width: 100%;
      line-height: 1;
      pointer-events: none;
    }
    [data-dsh-quota-hud] .dsh-hud-percent {
      display: block;
      width: calc(var(--hud-size) - 12px);
      margin: 0 auto;
      text-align: center;
      white-space: nowrap;
      overflow: hidden;
      text-overflow: ellipsis;
      /* Percentage, amount and tag scale with the ball diameter; the fixed
         ceilings keep the 46px ball at the historical type size. */
      font-size: clamp(7.5px, calc(var(--hud-size) * 0.232), 11px);
      font-weight: 700;
      color: var(--q-fg);
      letter-spacing: -0.2px;
      font-variant-numeric: tabular-nums;
    }
    [data-dsh-quota-hud] .dsh-hud-percent.is-empty {
      color: var(--q-error);
    }
    [data-dsh-quota-hud] .dsh-hud-percent-amount {
      font-size: clamp(6.5px, calc(var(--hud-size) * 0.192), 9.3px);
    }
    [data-dsh-quota-hud] .dsh-hud-percent-liveness {
      font-size: clamp(8px, calc(var(--hud-size) * 0.217), 10px);
    }
    [data-dsh-quota-hud] .dsh-hud-tag {
      display: inline-flex;
      align-items: center;
      gap: 3px;
      max-width: calc(var(--hud-size) - 12px);
      overflow: hidden;
      white-space: nowrap;
      font-size: clamp(6.5px, calc(var(--hud-size) * 0.185), 8.5px);
      font-weight: 600;
      color: var(--q-fg-2);
      margin-top: 1.5px;
      text-transform: uppercase;
      letter-spacing: 0.2px;
    }
    [data-dsh-quota-hud] .dsh-hud-status-dot {
      flex: none;
      width: 5px;
      height: 5px;
      border-radius: 50%;
      background: var(--q-warn);
    }
    [data-dsh-quota-hud] .dsh-hud-status-dot.is-warn { background: var(--q-warn); }
    [data-dsh-quota-hud] .dsh-hud-status-dot.is-error {
      background: var(--q-error);
      animation: q-dot-pulse 1.8s ease-in-out infinite;
    }
    [data-dsh-quota-hud] .dsh-hud-popover {
      position: absolute;
      width: var(--q-card-width);
      max-height: min(60vh, 420px);
      overflow-y: auto;
      overscroll-behavior: contain;
      background: var(--q-bg);
      border: 1px solid var(--q-border);
      border-radius: 10px;
      box-shadow: 0 8px 24px var(--q-shadow);
      padding: 9px 10px;
      display: none;
      flex-direction: column;
      gap: 6px;
      pointer-events: none;
      z-index: 1000;
      font-family: inherit;
    }
    [data-dsh-quota-hud].is-hovered .dsh-hud-popover,
    [data-dsh-quota-hud].is-open .dsh-hud-popover {
      display: flex;
      pointer-events: auto;
    }
    [data-dsh-quota-hud] .dsh-hud-popover.pop-top {
      bottom: calc(100% + 8px);
    }
    [data-dsh-quota-hud] .dsh-hud-popover.pop-bottom {
      top: calc(100% + 8px);
    }
    [data-dsh-quota-hud] .dsh-hud-popover.pop-right {
      right: 0;
    }
    [data-dsh-quota-hud] .dsh-hud-popover.pop-left {
      left: 0;
    }
    [data-dsh-quota-hud].is-narrow .dsh-hud-popover {
      width: min(220px, calc(100vw - 24px));
      max-height: min(320px, calc(100vh - 32px));
    }
    [data-dsh-quota-hud] .dsh-hud-popover-title {
      display: flex;
      align-items: center;
      gap: 6px;
      font-size: 11.5px;
      font-weight: 700;
      color: var(--q-fg);
      border-bottom: 1px solid var(--q-border);
      padding-bottom: 5px;
    }
    [data-dsh-quota-hud] .dsh-hud-popover-title-text {
      flex: 1 1 auto;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    [data-dsh-quota-hud] .dsh-hud-popover-count {
      flex: none;
      font-size: 10px;
      font-weight: 600;
      color: var(--q-fg-2);
      font-variant-numeric: tabular-nums;
    }
    [data-dsh-quota-hud] .dsh-hud-icon-button {
      flex: none;
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 20px;
      height: 20px;
      padding: 0;
      border: 1px solid var(--q-border);
      border-radius: 6px;
      background: transparent;
      color: var(--q-fg-2);
      cursor: pointer;
      pointer-events: auto;
    }
    [data-dsh-quota-hud] .dsh-hud-icon-button:hover {
      color: var(--q-fg);
      background: var(--q-scrim);
    }
    [data-dsh-quota-hud] .dsh-hud-icon-button:focus-visible {
      outline: 2px solid var(--q-fg);
      outline-offset: 1px;
    }
    [data-dsh-quota-hud] .dsh-hud-popover-row {
      display: flex;
      align-items: center;
      gap: 6px;
      min-width: 0;
      padding: 2px 4px;
      margin: 0 -4px;
      border-radius: 6px;
      font-size: 11px;
      color: var(--q-fg-2);
    }
    [data-dsh-quota-hud] .dsh-hud-popover-row.is-active {
      background: var(--q-scrim);
    }
    [data-dsh-quota-hud] .dsh-hud-popover-service {
      flex: 1 1 auto;
      min-width: 0;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      font-weight: 600;
      color: var(--q-fg);
    }
    [data-dsh-quota-hud] .dsh-hud-popover-metric {
      flex: none;
      padding: 0 5px;
      border: 1px solid var(--q-border);
      border-radius: 999px;
      background: var(--q-scrim);
      color: var(--q-fg-2);
      font-size: 9.5px;
      font-weight: 600;
      line-height: 1.5;
      white-space: nowrap;
    }
    [data-dsh-quota-hud] .dsh-hud-popover-val {
      flex: none;
      color: var(--q-fg);
      font-weight: 700;
      font-variant-numeric: tabular-nums;
    }
    /* Status colour is a small text accent inside the card, never the whole dial. */
    [data-dsh-quota-hud] .dsh-hud-popover-val.is-ok { color: var(--q-fg); }
    [data-dsh-quota-hud] .dsh-hud-popover-val.is-warn { color: var(--q-warn); }
    [data-dsh-quota-hud] .dsh-hud-popover-val.is-error { color: var(--q-error); }
    [data-dsh-quota-hud] .dsh-hud-popover-empty {
      font-size: 11px;
      color: var(--q-fg-2);
    }
    [data-dsh-quota-hud] .dsh-hud-popover-action {
      width: 100%;
      padding: 4px 6px;
      border: 1px solid var(--q-border);
      border-radius: 6px;
      background: transparent;
      color: var(--q-fg-2);
      font: inherit;
      font-size: 10.5px;
      cursor: pointer;
      pointer-events: auto;
    }
    [data-dsh-quota-hud] .dsh-hud-popover-action:hover {
      color: var(--q-fg);
      background: var(--q-scrim);
    }
    [data-dsh-quota-hud] .dsh-hud-popover-action:focus-visible {
      outline: 2px solid var(--q-fg);
      outline-offset: 1px;
    }
  `
  document.head.appendChild(styleEl)
  document.body.appendChild(hudEl)

  let pos = getSavedPosition()
  hudEl.style.left = `${pos.x}px`
  hudEl.style.top = `${pos.y}px`

  // Drag interaction
  let isDragging = false
  let startX = 0
  let startY = 0
  let initialLeft = 0
  let initialTop = 0
  let moved = false
  let isPointerOver = false
  let isHoverCardVisible = false
  let isPinned = false
  let paused = readPausedState()
  let hoverHideTimer: ReturnType<typeof setTimeout> | null = null

  const motionQuery = typeof window !== 'undefined' && typeof window.matchMedia === 'function'
    ? window.matchMedia('(prefers-reduced-motion: reduce)')
    : null
  let prefersReducedMotion = motionQuery?.matches === true

  // Distinguishes a touch tap from a mouse click on hybrid devices so only touch
  // pins the card open while a mouse keeps the historical tap-to-open-panel action.
  let lastInteractionWasTouch = false

  function bindDragEndListeners(): void {
    window.addEventListener('mousemove', onPointerMove)
    window.addEventListener('mouseup', onPointerUp)
    window.addEventListener('touchmove', onPointerMove, { passive: false })
    window.addEventListener('touchend', onPointerUp)
    // Release paths that a plain mouseup/touchend can miss: pointer cancellation
    // (mobile gestures), a window blur while dragging outside, or a system
    // interruption. Without these `isDragging` stayed true and froze the carousel.
    window.addEventListener('pointerup', onPointerUp)
    window.addEventListener('pointercancel', onPointerUp)
    window.addEventListener('touchcancel', onPointerUp)
    window.addEventListener('blur', onPointerUp)
  }

  function unbindDragEndListeners(): void {
    window.removeEventListener('mousemove', onPointerMove)
    window.removeEventListener('mouseup', onPointerUp)
    window.removeEventListener('touchmove', onPointerMove)
    window.removeEventListener('touchend', onPointerUp)
    window.removeEventListener('pointerup', onPointerUp)
    window.removeEventListener('pointercancel', onPointerUp)
    window.removeEventListener('touchcancel', onPointerUp)
    window.removeEventListener('blur', onPointerUp)
  }

  function isHudButtonTarget(target: EventTarget | null): boolean {
    const el = target as Element | null
    if (!el || typeof el.closest !== 'function') return false
    return el.closest('.dsh-hud-popover') !== null
  }

  function onPointerDown(e: MouseEvent | TouchEvent) {
    // Clicks inside the hover card (pause / open panel) are real controls: never
    // start a drag from there or the follow-up "tap" would toggle the panel.
    if (isHudButtonTarget(e.target)) return

    isDragging = true
    moved = false
    lastInteractionWasTouch = 'touches' in e
    hudEl.style.cursor = 'grabbing'
    hudEl.style.transition = 'none'

    const clientX = 'touches' in e ? e.touches[0]!.clientX : e.clientX
    const clientY = 'touches' in e ? e.touches[0]!.clientY : e.clientY
    startX = clientX
    startY = clientY
    initialLeft = hudEl.offsetLeft
    initialTop = hudEl.offsetTop

    bindDragEndListeners()
  }

  function onPointerMove(e: MouseEvent | TouchEvent) {
    if (!isDragging) return
    const clientX = 'touches' in e ? e.touches[0]!.clientX : e.clientX
    const clientY = 'touches' in e ? e.touches[0]!.clientY : e.clientY
    const dx = clientX - startX
    const dy = clientY - startY

    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) {
      moved = true
      if ('touches' in e && e.cancelable) e.preventDefault()
    }

    const newX = Math.max(8, Math.min(window.innerWidth - 54, initialLeft + dx))
    const newY = Math.max(8, Math.min(window.innerHeight - 54, initialTop + dy))
    hudEl.style.left = `${newX}px`
    hudEl.style.top = `${newY}px`
  }

  function onPointerUp() {
    if (!isDragging) return
    isDragging = false
    hudEl.style.cursor = 'grab'
    hudEl.style.transition = 'transform 0.16s ease, left 0.2s ease, top 0.2s ease'

    unbindDragEndListeners()

    if (!moved) {
      // Touch has no hover: a tap opens the pinned card (pause button included)
      // instead of jumping straight into the panel. The card's footer still
      // reaches the panel, and desktop keeps its historical tap-to-open behaviour.
      if (lastInteractionWasTouch) setPinned(!isPinned)
      else openDashboard()
      return
    }

    // Snap to left or right
    const currentLeft = hudEl.offsetLeft
    const currentTop = hudEl.offsetTop
    const snapLeft = currentLeft < window.innerWidth / 2 ? 14 : window.innerWidth - 60
    const clampedTop = Math.max(14, Math.min(window.innerHeight - 60, currentTop))

    pos = { x: snapLeft, y: clampedTop }
    hudEl.style.left = `${pos.x}px`
    hudEl.style.top = `${pos.y}px`
    savePosition(pos)
    render()
  }

  hudEl.addEventListener('mousedown', onPointerDown)
  hudEl.addEventListener('touchstart', onPointerDown, { passive: false })

  function cancelHoverHide(): void {
    if (hoverHideTimer !== null) {
      clearTimeout(hoverHideTimer)
      hoverHideTimer = null
    }
  }

  function showHoverCard(): void {
    cancelHoverHide()
    if (isHoverCardVisible) return
    isHoverCardVisible = true
    hudEl.classList.add('is-hovered')
  }

  function hideHoverCardSoon(): void {
    if (isPinned) return
    cancelHoverHide()
    // A short grace period lets the pointer cross the 8px gap into the card
    // without the card unmounting mid-way (the gap is outside hudEl's box).
    hoverHideTimer = setTimeout(() => {
      hoverHideTimer = null
      if (isPointerOver || isPinned) return
      isHoverCardVisible = false
      hudEl.classList.remove('is-hovered')
    }, HOVER_HIDE_DELAY_MS)
  }

  hudEl.addEventListener('pointerenter', (event: PointerEvent) => {
    if (event.pointerType !== 'mouse') return
    isPointerOver = true
    showHoverCard()
  })
  hudEl.addEventListener('pointerleave', (event: PointerEvent) => {
    if (event.pointerType !== 'mouse') return
    isPointerOver = false
    hideHoverCardSoon()
  })

  function setPinned(value: boolean, options: { focusHud?: boolean } = {}): void {
    if (isPinned === value) return
    isPinned = value
    hudEl.classList.toggle('is-open', isPinned)
    hudEl.setAttribute('aria-expanded', isPinned ? 'true' : 'false')
    render()
    if (isPinned) {
      cancelHoverHide()
      hudEl.classList.add('is-hovered')
    } else if (!isPointerOver) {
      // Explicit close (tap again / Esc / open panel): hide now instead of waiting
      // out the pointer-traversal grace period.
      cancelHoverHide()
      isHoverCardVisible = false
      hudEl.classList.remove('is-hovered')
      if (options.focusHud) hudEl.focus({ preventScroll: true })
    } else if (options.focusHud) {
      hudEl.focus({ preventScroll: true })
    }
  }

  function togglePaused(): void {
    paused = !paused
    savePausedState(paused)
    render()
  }

  // The legacy overlay path toggles controller state; slot hosts select the
  // registered main panel through layout. Keep the fallback in one place.
  function openDashboard(): void {
    if (typeof options.openPanel === 'function') {
      try {
        options.openPanel()
      } catch (error) {
        console.warn('[dsh-quota] panel selection failed:', (error as Error)?.message ?? error)
      }
      return
    }
    controller.toggle()
  }

  function onHudClick(event: MouseEvent): void {
    const target = event.target as Element | null
    if (!target || typeof target.closest !== 'function') return

    if (target.closest('.dsh-hud-pause')) {
      event.preventDefault()
      event.stopPropagation()
      togglePaused()
      return
    }
    if (target.closest('.dsh-hud-open-panel')) {
      event.preventDefault()
      event.stopPropagation()
      setPinned(false)
      openDashboard()
    }
  }

  function onHudKeyDown(event: KeyboardEvent): void {
    if (event.key === 'Escape') {
      if (!isPinned) return
      event.preventDefault()
      setPinned(false, { focusHud: true })
      return
    }
    if (event.key !== 'Enter' && event.key !== ' ' && event.key !== 'Spacebar') return
    // Enter/Space on the pause button keeps its native button behaviour.
    if (event.target !== hudEl) return
    event.preventDefault()
    setPinned(!isPinned)
  }

  hudEl.addEventListener('click', onHudClick)
  hudEl.addEventListener('keydown', onHudKeyDown)

  // Window resize / monitor change: re-clamp so the HUD cannot end up off-screen.
  function clampHudPosition(): void {
    const maxX = Math.max(8, window.innerWidth - 54)
    const maxY = Math.max(8, window.innerHeight - 54)
    const currentLeft = Number.parseFloat(hudEl.style.left)
    const currentTop = Number.parseFloat(hudEl.style.top)
    const sourceX = Number.isFinite(currentLeft) ? currentLeft : pos.x
    const sourceY = Number.isFinite(currentTop) ? currentTop : pos.y
    const x = Math.min(Math.max(8, sourceX), maxX)
    const y = Math.min(Math.max(8, sourceY), maxY)
    if (x !== pos.x || y !== pos.y) {
      pos = { x, y }
      savePosition(pos)
    }
    hudEl.style.left = `${pos.x}px`
    hudEl.style.top = `${pos.y}px`
  }

  const onWindowResize = (): void => {
    clampHudPosition()
    if (typeof document !== 'undefined' && document.hidden) return
    render()
  }
  window.addEventListener('resize', onWindowResize)

  const onMotionPreferenceChange = (event: MediaQueryListEvent): void => {
    prefersReducedMotion = event.matches
    render()
  }
  if (motionQuery && typeof motionQuery.addEventListener === 'function') {
    motionQuery.addEventListener('change', onMotionPreferenceChange)
  }

  // Tag helper
  function getProviderTag(provider: string): string {
    const map: Record<string, string> = {
      deepseek: 'DSK',
      antigravity: 'AGY',
      cursor: 'CUR',
      codex: 'CDX',
      github_copilot: 'COP',
      openai_billing: 'OAI',
      claude: 'CLD',
      kimi: 'KMI',
      glm: 'GLM',
      minimax: 'MMX',
      qwen: 'QWN',
      volcengine: 'ARK',
      opencode_go: 'OPN',
      custom_api: 'API',
    }
    return map[provider] || provider.slice(0, 3).toUpperCase()
  }

  function isMetricSelected(cardProvider: string, cardId: string, groupTitle: string, windowId: string, selectedMetrics?: string[]): boolean {
    if (!Array.isArray(selectedMetrics)) return true
    const hasCustomSelection = selectedMetrics.some(k => typeof k === 'string' && (k.startsWith(`${cardProvider}::`) || k.startsWith(`${cardId}::`)))
    if (!hasCustomSelection) return true
    if (selectedMetrics.includes(`${cardProvider}::__none__`) || selectedMetrics.includes(`${cardId}::__none__`)) return false

    const exactKey = makeHudMetricKey(cardProvider, groupTitle, windowId)
    if (selectedMetrics.includes(exactKey)) return true

    // Flexible match for antigravity weekly / 5h
    if (cardProvider === 'antigravity') {
      const isWeekly = windowId.toLowerCase().includes('weekly')
      const isGemini = groupTitle.toLowerCase().includes('gemini') || windowId.toLowerCase().includes('gemini')
      const isClaude = groupTitle.toLowerCase().includes('claude') || groupTitle.toLowerCase().includes('gpt') || windowId.toLowerCase().includes('claude')
      for (const sel of selectedMetrics) {
        if (typeof sel !== 'string' || !sel.startsWith('antigravity::')) continue
        if (sel.includes('__none__')) return false
        const lower = decodeURIComponent(sel).toLowerCase()
        const selWeekly = lower.includes('weekly') || lower.includes('周')
        const sel5h = lower.includes('5h') || lower.includes('5-hour') || lower.includes('five') || lower.includes('5小时')
        const selGemini = lower.includes('gemini')
        const selClaude = lower.includes('claude') || lower.includes('gpt')

        if (isGemini && selGemini && ((isWeekly && selWeekly) || (!isWeekly && sel5h))) return true
        if (isClaude && selClaude && ((isWeekly && selWeekly) || (!isWeekly && sel5h))) return true
        if ((isWeekly && selWeekly) || (!isWeekly && sel5h)) return true
      }
    }

    // Flexible match for Balance cards
    if (groupTitle === 'Balance' || windowId === cardId || windowId.endsWith('-balance')) {
      for (const sel of selectedMetrics) {
        if (typeof sel === 'string' && (sel.startsWith(`${cardProvider}::`) || sel.startsWith(`${cardId}::`))) {
          const lower = decodeURIComponent(sel).toLowerCase()
          if (lower.includes('balance') || lower.includes('余额') || lower.includes('额度')) return true
        }
      }
    }

    return false
  }

  function formatBalanceAmount(card: AuthCardItem): string | undefined {
    const balance = card.balance
    if (!balance || typeof balance.remaining !== 'number' || !Number.isFinite(balance.remaining)) return undefined
    const currency = balance.currency
    const symbol = currency === 'USD' ? '$' : (currency === 'TOKEN' || currency === 'COUNT' ? '' : '¥')
    const digits = currency === 'TOKEN' || currency === 'COUNT' ? 0 : 2
    return `${symbol}${balance.remaining.toFixed(digits)}`
  }

  function getMetricsList(cards: AuthCardItem[], config?: QuotaConfig): HudMetric[] {
    const list: HudMetric[] = []

    const hudProviders = config?.floatingHudProviders
    const selectedMetrics = config?.floatingHudMetrics

    const toMetric = (card: AuthCardItem, tag: string, groupTitle: string, window: MetricWindow): HudMetric => {
      const kind = windowQuotaKind(window)
      const quantified = isQuantified(window)
      const amountText = typeof window.amountText === 'string' ? window.amountText.trim() : ''
      return {
        key: makeHudMetricKey(card.provider, groupTitle, window.id),
        provider: card.provider,
        name: `${card.name} · ${groupTitle} · ${window.label}`,
        service: card.name,
        shortLabel: inferMetricShortLabel(window),
        tag,
        kind,
        remainingPercent: quantified ? Math.max(0, Math.min(100, Math.round(window.remainingPercent))) : undefined,
        amountText: kind === 'balance' ? (amountText !== '' ? amountText : formatBalanceAmount(card)) : undefined,
      }
    }

    for (const card of cards) {
      if (card.status !== 'ok' && card.status !== 'warn') continue

      // Filter by floatingHudProviders if configured
      if (Array.isArray(hudProviders)) {
        if (!hudProviders.includes(card.id) && !hudProviders.includes(card.provider)) {
          continue
        }
      }

      const tag = getProviderTag(card.provider)

      // Balance-only card: show the amount, never derive a percentage from it.
      if (card.groups.length === 0) {
        if (card.balance === undefined) continue
        const key = makeHudMetricKey(card.provider, 'Balance', card.id)
        if (!isMetricSelected(card.provider, card.id, 'Balance', card.id, selectedMetrics)) {
          continue
        }
        list.push({
          key,
          provider: card.provider,
          name: `${card.name} · 账户余额`,
          service: card.name,
          shortLabel: '余额',
          tag,
          kind: 'balance',
          amountText: formatBalanceAmount(card),
        })
        continue
      }

      const cardStartIndex = list.length
      for (const group of card.groups) {
        for (const window of group.windows) {
          if (!isMetricSelected(card.provider, card.id, group.title, window.id, selectedMetrics)) {
            continue
          }
          list.push(toMetric(card, tag, group.title, window))
        }
      }

      // If card was selected for HUD, not explicitly muted with __none__, but zero metrics matched (e.g. key drift), fallback to include all card windows
      const hasExplicitNone = Array.isArray(selectedMetrics) && selectedMetrics.some(k => k === `${card.provider}::__none__` || k === `${card.id}::__none__`)
      if (list.length === cardStartIndex && !hasExplicitNone && card.groups.length > 0) {
        for (const group of card.groups) {
          for (const window of group.windows) {
            list.push(toMetric(card, tag, group.title, window))
          }
        }
      }
    }

    return list
  }

  let activeIndex = 0
  let intervalTimer: ReturnType<typeof setInterval> | null = null

  function captureFocusTarget(): FocusTarget {
    if (typeof document === 'undefined') return null
    const active = document.activeElement
    if (!active) return null
    if (active === hudEl) return 'host'
    if (typeof active.closest === 'function') {
      if (active.closest('.dsh-hud-pause')) return 'pause'
      if (active.closest('.dsh-hud-open-panel')) return 'panel'
    }
    return null
  }

  function restoreFocusTarget(target: FocusTarget): void {
    if (target === null) return
    if (target === 'host') {
      hudEl.focus({ preventScroll: true })
      return
    }
    const selector = target === 'pause' ? '.dsh-hud-pause' : '.dsh-hud-open-panel'
    const el = hudEl.querySelector<HTMLElement>(selector)
    el?.focus({ preventScroll: true })
  }

  function setHudAriaLabel(label: string): void {
    hudEl.setAttribute('aria-label', label)
  }

  function pauseButtonHtml(): string {
    const label = paused ? '继续轮播' : '暂停轮播'
    const icon = paused ? PLAY_ICON : PAUSE_ICON
    return `<button type="button" class="dsh-hud-icon-button dsh-hud-pause" aria-label="${label}" aria-pressed="${paused ? 'true' : 'false'}" title="${label}">${icon}</button>`
  }

  function render() {
    const state = controller.getSnapshot()
    const isEnabled = state.config?.showFloatingHud !== false

    if (!isEnabled) {
      hudEl.style.display = 'none'
      return
    }
    hudEl.style.display = 'flex'

    const metrics = getMetricsList(state.cards, state.config)
    const focusTarget = captureFocusTarget()
    const docked = isDockedPosition(pos)
    const circleClass = `dsh-hud-circle${docked ? ' docked' : ''}`

    hudEl.classList.toggle('is-narrow', window.innerWidth < NARROW_BREAKPOINT)
    const placement = computePopoverPlacement(pos, window.innerWidth)
    const popoverClass = `dsh-hud-popover ${placement.vertical} ${placement.horizontal}`

    if (metrics.length === 0) {
      const hasMetricSelection = Array.isArray(state.config?.floatingHudMetrics)
      const emptyTitle = hasMetricSelection ? '未选择额度' : '未连接服务'
      const emptyHint = hasMetricSelection ? '请在设置中选择要显示的额度窗口' : '点击打开面板完成服务连接'
      setHudAriaLabel(`额度监控：${emptyTitle}。按 Enter 展开提示`)
      hudEl.innerHTML = `
        <div class="${circleClass}">
          ${neutralRingSvg()}
          <div class="dsh-hud-content">
            <span class="dsh-hud-percent">--</span>
            <span class="dsh-hud-tag">AI</span>
          </div>
        </div>
        <div class="${popoverClass}" role="group" aria-label="额度状态">
          <div class="dsh-hud-popover-title">
            <span class="dsh-hud-popover-title-text">AI 额度监控</span>
            <span class="dsh-hud-popover-count">${emptyTitle}</span>
          </div>
          <div class="dsh-hud-popover-empty">${emptyHint}</div>
          <button type="button" class="dsh-hud-popover-action dsh-hud-open-panel" aria-label="打开额度面板">打开面板</button>
        </div>
      `
      restoreFocusTarget(focusTarget)
      return
    }

    if (activeIndex >= metrics.length) activeIndex = 0
    const current = metrics[activeIndex]!
    const quantified = isQuantifiedMetric(current)
    const percent = quantified ? Math.round(current.remainingPercent!) : undefined
    const exhausted = percent !== undefined && percent <= 0
    const tone = percent !== undefined ? statusTone(percent) : undefined

    const ariaText = metricAriaText(current)
    setHudAriaLabel(
      isPinned
        ? `额度监控：${ariaText}。已展开明细，按 Esc 收起`
        : `额度监控：${ariaText}。按 Enter 展开明细`,
    )

    const popoverRows = metrics.map((m, index) => {
      const quantifiedRow = isQuantifiedMetric(m)
      const rowTone = quantifiedRow ? statusTone(m.remainingPercent!) : ''
      const valueClass = rowTone === '' ? 'dsh-hud-popover-val' : `dsh-hud-popover-val is-${rowTone}`
      const activeClass = index === activeIndex ? ' is-active' : ''
      // Card/group/window text is escaped once at the controller boundary; escaping again here
      // would render visible entities (`&amp;`). Service name is ellipsised by CSS and the
      // full `service · group · window` text stays available through `title`.
      return `
        <div class="dsh-hud-popover-row${activeClass}" title="${m.name}">
          <span class="dsh-hud-popover-service" title="${m.name}">${m.service}</span>
          <span class="dsh-hud-popover-metric">${m.shortLabel}</span>
          <span class="${valueClass}">${metricValueText(m)}</span>
        </div>
      `
    }).join('')

    // A percentage ring is only legitimate for `usage` windows; balance/liveness/
    // unknown render a neutral dial instead of a fabricated full/empty ring.
    // The ring itself always uses the dashboard brand colour; status is a small
    // dot next to the provider tag (and the popover value text), never a
    // whole-ball green/yellow/red flood.
    let ringHtml = ''
    let centerHtml = ''
    let statusDotHtml = ''
    if (quantified) {
      const radius = 18
      const circumference = 2 * Math.PI * radius
      const offset = circumference - (percent! / 100) * circumference
      ringHtml = `
        <svg class="dsh-hud-svg" viewBox="0 0 46 46" aria-hidden="true" focusable="false">
          <circle class="dsh-hud-ring-track" cx="23" cy="23" r="${radius}"></circle>
          <circle class="dsh-hud-ring-value" cx="23" cy="23" r="${radius}"
            stroke-dasharray="${circumference}" stroke-dashoffset="${offset}"></circle>
        </svg>
      `
      centerHtml = `<span class="dsh-hud-percent${exhausted ? ' is-empty' : ''}">${percent}%</span>`
      if (tone === 'warn' || tone === 'error') {
        statusDotHtml = `<span class="dsh-hud-status-dot is-${tone}" aria-hidden="true"></span>`
      }
    } else if (current.kind === 'balance') {
      ringHtml = neutralRingSvg()
      centerHtml = `<span class="dsh-hud-percent dsh-hud-percent-amount">${compactHudAmount(current.amountText || '—')}</span>`
    } else if (current.kind === 'liveness') {
      centerHtml = `<span class="dsh-hud-percent dsh-hud-percent-liveness">✓</span>`
    } else {
      centerHtml = `<span class="dsh-hud-percent">--</span>`
    }

    hudEl.innerHTML = `
      <div class="${circleClass}${exhausted ? ' is-exhausted' : ''}">
        ${ringHtml}
        <div class="dsh-hud-content">
          ${centerHtml}
          <span class="dsh-hud-tag">${current.tag}${statusDotHtml}</span>
        </div>
      </div>
      <div class="${popoverClass}" role="group" aria-label="额度明细">
        <div class="dsh-hud-popover-title">
          <span class="dsh-hud-popover-title-text">AI 额度监控</span>
          <span class="dsh-hud-popover-count">${activeIndex + 1}/${metrics.length}</span>
          ${pauseButtonHtml()}
        </div>
        ${popoverRows}
        <button type="button" class="dsh-hud-popover-action dsh-hud-open-panel" aria-label="打开额度面板">打开面板</button>
      </div>
    `
    restoreFocusTarget(focusTarget)
  }

  function shouldAdvanceCarousel(): boolean {
    // Pause the 4.5s carousel while the tab/window is hidden, while the user reads
    // the card, drags the ball, or when the OS asks for reduced motion.
    if (typeof document !== 'undefined' && document.hidden) return false
    if (prefersReducedMotion) return false
    if (paused || isPinned || isHoverCardVisible || isDragging) return false
    if (typeof document !== 'undefined' && document.activeElement === hudEl) return false
    return true
  }

  intervalTimer = setInterval(() => {
    if (!shouldAdvanceCarousel()) return
    const state = controller.getSnapshot()
    const metrics = getMetricsList(state.cards, state.config)
    if (metrics.length > 1) {
      activeIndex = (activeIndex + 1) % metrics.length
      render()
    }
  }, CAROUSEL_INTERVAL_MS)

  const unsubscribe = controller.subscribe(render)
  render()

  return () => {
    if (intervalTimer !== null) clearInterval(intervalTimer)
    cancelHoverHide()
    unbindDragEndListeners()
    window.removeEventListener('resize', onWindowResize)
    if (motionQuery && typeof motionQuery.removeEventListener === 'function') {
      motionQuery.removeEventListener('change', onMotionPreferenceChange)
    }
    unsubscribe()
    hudEl.remove()
    styleEl.remove()
  }
}
