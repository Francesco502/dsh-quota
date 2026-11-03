import type { QuotaController } from './controller.ts'
import type { AuthCardItem } from './api.ts'
import { makeHudMetricKey } from './api.ts'

interface HudPosition {
  x: number
  y: number
}

const STORAGE_KEY = 'dsh_quota_hud_pos'

function getSavedPosition(): HudPosition {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
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
    localStorage.setItem(STORAGE_KEY, JSON.stringify(pos))
  } catch {}
}

export function mountQuotaHud(controller: QuotaController): () => void {
  const hudEl = document.createElement('div')
  hudEl.setAttribute('data-dsh-quota-hud', '')
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
      display: flex;
      align-items: center;
      justify-content: center;
    }
    .dsh-hud-circle {
      position: relative;
      width: 46px;
      height: 46px;
      border-radius: 50%;
      background: var(--dsw-alias-bg-layer-1, #ffffff);
      border: 1px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.14));
      box-shadow: 0 4px 14px rgba(0, 0, 0, 0.12);
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      overflow: visible;
      transition: transform 0.15s ease, box-shadow 0.15s ease, opacity 0.2s ease;
    }
    .dsh-hud-circle:hover {
      transform: scale(1.06);
      box-shadow: 0 6px 18px rgba(0, 0, 0, 0.18);
    }
    .dsh-hud-circle.docked {
      opacity: 0.72;
    }
    .dsh-hud-circle.docked:hover {
      opacity: 1;
    }
    .dsh-hud-svg {
      position: absolute;
      inset: 0;
      width: 46px;
      height: 46px;
      transform: rotate(-90deg);
      pointer-events: none;
    }
    .dsh-hud-content {
      position: relative;
      display: flex;
      flex-direction: column;
      align-items: center;
      justify-content: center;
      line-height: 1;
      pointer-events: none;
    }
    .dsh-hud-percent {
      font-size: 11px;
      font-weight: 700;
      color: var(--dsw-alias-label-primary, #1f2328);
      letter-spacing: -0.2px;
    }
    .dsh-hud-tag {
      font-size: 8.5px;
      font-weight: 600;
      color: var(--dsw-alias-label-secondary, #57606a);
      margin-top: 1.5px;
      text-transform: uppercase;
    }
    .dsh-hud-popover {
      position: absolute;
      width: 240px;
      background: var(--dsw-alias-bg-layer-1, #ffffff);
      border: 1px solid var(--dsw-alias-border-l2, rgba(0, 0, 0, 0.15));
      border-radius: 10px;
      box-shadow: 0 8px 24px rgba(0, 0, 0, 0.18);
      padding: 10px 12px;
      display: none;
      flex-direction: column;
      gap: 7px;
      pointer-events: none;
      z-index: 1000;
      font-family: inherit;
    }
    .dsh-hud-popover.pop-top {
      bottom: calc(100% + 8px);
    }
    .dsh-hud-popover.pop-bottom {
      top: calc(100% + 8px);
    }
    .dsh-hud-popover.pop-right {
      right: 0;
    }
    .dsh-hud-popover.pop-left {
      left: 0;
    }
    [data-dsh-quota-hud]:hover .dsh-hud-popover {
      display: flex;
    }
    .dsh-hud-popover-title {
      font-size: 11.5px;
      font-weight: 700;
      color: var(--dsw-alias-label-primary, #1f2328);
      border-bottom: 1px solid var(--dsw-alias-border-l1, rgba(0,0,0,0.08));
      padding-bottom: 5px;
      display: flex;
      justify-content: space-between;
      align-items: center;
    }
    .dsh-hud-popover-row {
      display: flex;
      align-items: center;
      justify-content: space-between;
      font-size: 11px;
      color: var(--dsw-alias-label-secondary, #57606a);
      gap: 8px;
    }
    .dsh-hud-popover-name {
      font-weight: 600;
      color: var(--dsw-alias-label-primary, #1f2328);
      max-width: 145px;
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
    }
    .dsh-hud-popover-val {
      font-weight: 700;
      flex: none;
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
  let isHovered = false

  function onPointerDown(e: MouseEvent | TouchEvent) {
    isDragging = true
    moved = false
    hudEl.style.cursor = 'grabbing'
    hudEl.style.transition = 'none'

    const clientX = 'touches' in e ? e.touches[0]!.clientX : e.clientX
    const clientY = 'touches' in e ? e.touches[0]!.clientY : e.clientY
    startX = clientX
    startY = clientY
    initialLeft = hudEl.offsetLeft
    initialTop = hudEl.offsetTop

    window.addEventListener('mousemove', onPointerMove)
    window.addEventListener('mouseup', onPointerUp)
    window.addEventListener('touchmove', onPointerMove, { passive: false })
    window.addEventListener('touchend', onPointerUp)
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

    window.removeEventListener('mousemove', onPointerMove)
    window.removeEventListener('mouseup', onPointerUp)
    window.removeEventListener('touchmove', onPointerMove)
    window.removeEventListener('touchend', onPointerUp)

    if (!moved) {
      controller.toggle()
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

  hudEl.addEventListener('mouseenter', () => {
    isHovered = true
  })
  hudEl.addEventListener('mouseleave', () => {
    isHovered = false
  })

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

  function getMetricsList(cards: AuthCardItem[], config?: QuotaConfig): Array<{
    key: string
    provider: string
    name: string
    tag: string
    remainingPercent: number
    balanceText?: string
  }> {
    const list: Array<{
      key: string
      provider: string
      name: string
      tag: string
      remainingPercent: number
      balanceText?: string
    }> = []

    const hudProviders = config?.floatingHudProviders
    const selectedMetrics = config?.floatingHudMetrics

    for (const card of cards) {
      if (card.status !== 'ok' && card.status !== 'warn') continue

      // Filter by floatingHudProviders if configured
      if (Array.isArray(hudProviders)) {
        if (!hudProviders.includes(card.id) && !hudProviders.includes(card.provider)) {
          continue
        }
      }

      const tag = getProviderTag(card.provider)

      if (card.groups.length === 0 && card.balance?.total) {
        const rem = card.balance.remaining !== undefined ? Math.round((card.balance.remaining / card.balance.total) * 100) : 100
        const key = makeHudMetricKey(card.provider, 'Balance', card.id)
        if (!isMetricSelected(card.provider, card.id, 'Balance', card.id, selectedMetrics)) {
          continue
        }
        const sym = card.balance.currency === 'USD' ? '$' : '¥'
        list.push({
          key,
          provider: card.provider,
          name: `${card.name} · 账户余额`,
          tag,
          remainingPercent: Math.max(0, Math.min(100, rem)),
          balanceText: `${sym}${Number(card.balance.remaining ?? 0).toFixed(1)}`,
        })
        continue
      }

      const cardStartIndex = list.length
      for (const group of card.groups) {
        for (const window of group.windows) {
          const key = makeHudMetricKey(card.provider, group.title, window.id)
          if (!isMetricSelected(card.provider, card.id, group.title, window.id, selectedMetrics)) {
            continue
          }
          const isBalance = card.balance?.remaining !== undefined && (card.provider === 'deepseek' || window.barType === 'balance' as any)
          const sym = card.balance?.currency === 'USD' ? '$' : '¥'
          list.push({
            key,
            provider: card.provider,
            name: `${card.name} · ${group.title} · ${window.label}`,
            tag,
            remainingPercent: Math.max(0, Math.min(100, Math.round(window.remainingPercent))),
            balanceText: isBalance ? `${sym}${Number(card.balance!.remaining).toFixed(1)}` : undefined,
          })
        }
      }

      // If card was selected for HUD, not explicitly muted with __none__, but zero metrics matched (e.g. key drift), fallback to include all card windows
      const hasExplicitNone = Array.isArray(selectedMetrics) && selectedMetrics.some(k => k === `${card.provider}::__none__` || k === `${card.id}::__none__`)
      if (list.length === cardStartIndex && !hasExplicitNone && card.groups.length > 0) {
        for (const group of card.groups) {
          for (const window of group.windows) {
            const key = makeHudMetricKey(card.provider, group.title, window.id)
            const isBalance = card.balance?.remaining !== undefined && (card.provider === 'deepseek' || window.barType === 'balance' as any)
            const sym = card.balance?.currency === 'USD' ? '$' : '¥'
            list.push({
              key,
              provider: card.provider,
              name: `${card.name} · ${group.title} · ${window.label}`,
              tag,
              remainingPercent: Math.max(0, Math.min(100, Math.round(window.remainingPercent))),
              balanceText: isBalance ? `${sym}${Number(card.balance!.remaining).toFixed(1)}` : undefined,
            })
          }
        }
      }
    }

    return list
  }

  let activeIndex = 0
  let intervalTimer: any = null

  function getStatusColor(rem: number): string {
    if (rem <= 15) return '#B04A46' // 🔴 茜色
    if (rem <= 35) return '#BA8137' // 🟡 缃黄
    return '#3F7A63' // 🟢 竹青
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

    // Calculate smart collision position for Popover
    const isNearTop = pos.y < 200
    const isNearRight = pos.x > window.innerWidth / 2
    const popoverVClass = isNearTop ? 'pop-bottom' : 'pop-top'
    const popoverHClass = isNearRight ? 'pop-right' : 'pop-left'

    if (metrics.length === 0) {
      const hasMetricSelection = Array.isArray(state.config?.floatingHudMetrics)
      const emptyTitle = hasMetricSelection ? '未选择额度' : '未连接服务'
      const emptyHint = hasMetricSelection ? '请在设置中选择要显示的额度窗口' : '点击打开面板完成服务连接'
      hudEl.innerHTML = `
        <div class="dsh-hud-circle">
          <svg class="dsh-hud-svg" viewBox="0 0 46 46">
            <circle cx="23" cy="23" r="18" stroke="var(--dsw-alias-border-l1, rgba(0,0,0,0.1))" stroke-width="3" fill="none"/>
          </svg>
          <div class="dsh-hud-content">
            <span class="dsh-hud-percent">--</span>
            <span class="dsh-hud-tag">AI</span>
          </div>
          <div class="dsh-hud-popover ${popoverVClass} ${popoverHClass}">
            <div class="dsh-hud-popover-title"><span>AI 额度监控</span><span style="font-weight: normal; font-size: 10px; opacity: 0.7;">${emptyTitle}</span></div>
            <div style="font-size: 11px; color: var(--dsw-alias-label-tertiary, #888);">${emptyHint}</div>
          </div>
        </div>
      `
      return
    }

    if (activeIndex >= metrics.length) activeIndex = 0
    const current = metrics[activeIndex]!

    const radius = 18
    const circumference = 2 * Math.PI * radius
    const offset = circumference - (current.remainingPercent / 100) * circumference
    const strokeColor = getStatusColor(current.remainingPercent)

    const popoverRows = metrics.map(m => {
      const color = getStatusColor(m.remainingPercent)
      // Card/group/window text is escaped once at the controller boundary; escaping again here
      // would render visible entities (`&amp;`).
      return `
        <div class="dsh-hud-popover-row">
          <span class="dsh-hud-popover-name" title="${m.name}">${m.name}</span>
          <span class="dsh-hud-popover-val" style="color: ${color};">${m.balanceText || `${m.remainingPercent}% 剩余`}</span>
        </div>
      `
    }).join('')

    hudEl.innerHTML = `
      <div class="dsh-hud-circle">
        <svg class="dsh-hud-svg" viewBox="0 0 46 46">
          <circle cx="23" cy="23" r="${radius}" stroke="var(--dsw-alias-border-l1, rgba(0,0,0,0.08))" stroke-width="3" fill="none"/>
          <circle cx="23" cy="23" r="${radius}" stroke="${strokeColor}" stroke-width="3" fill="none"
            stroke-dasharray="${circumference}" stroke-dashoffset="${offset}" stroke-linecap="round"
            style="transition: stroke-dashoffset 0.4s ease, stroke 0.3s ease;"/>
        </svg>
        <div class="dsh-hud-content">
          <span class="dsh-hud-percent" style="${current.balanceText ? 'font-size: 9.5px; font-weight: 700;' : ''}">${current.balanceText || `${current.remainingPercent}%`}</span>
          <span class="dsh-hud-tag">${current.tag}</span>
        </div>
        <div class="dsh-hud-popover ${popoverVClass} ${popoverHClass}">
          <div class="dsh-hud-popover-title">
            <span>AI 额度监控</span>
            <span style="font-weight: normal; font-size: 10px; opacity: 0.7;">点击查看详情</span>
          </div>
          ${popoverRows}
        </div>
      </div>
    `
  }

  intervalTimer = setInterval(() => {
    if (isHovered || isDragging) return // Pause carousel on hover or dragging
    const state = controller.getSnapshot()
    const metrics = getMetricsList(state.cards, state.config)
    if (metrics.length > 1) {
      activeIndex = (activeIndex + 1) % metrics.length
      render()
    }
  }, 4500)

  const unsubscribe = controller.subscribe(render)
  render()

  return () => {
    if (intervalTimer) clearInterval(intervalTimer)
    unsubscribe()
    hudEl.remove()
    styleEl.remove()
  }
}
