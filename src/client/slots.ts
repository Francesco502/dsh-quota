/**
 * Official slot wiring for the Web GUI.
 *
 * The host renders React components into declared seats. We keep the dashboard's
 * existing DOM renderer and mount it inside a React wrapper, so the plugin gains
 * the shell's layout/theme/accessibility for free without rewriting the view.
 *
 * Seats used:
 *  - `main`                  the dashboard as a first-class main panel (`quota`)
 *  - `sidebar.panellist`     the global panel icon (owned by the sidebar)
 *  - `sidebar.toggle.badge`  alert badge on the collapsed rail
 *  - `sidebar.footer.action` quick jump next to Settings
 *
 * Every host call is best-effort: a missing seat must degrade, never throw.
 */
import type { QuotaController } from './controller.ts'
import { renderQuotaApp } from './view.ts'
import { LOCALE_NS, type QuotaTranslate } from './locale.ts'

export const PANEL_ID = 'quota'

export interface SlotWiring {
  react: any
  controller: QuotaController
  t: QuotaTranslate
  /** Selects a main panel; when absent the footer shortcut is not registered. */
  selectPanel?: (id: string) => void
}

const ACTIVE_ATTR = 'data-dsh-quota-active'

function ensureSlotStyles(): void {
  if (typeof document === 'undefined') return
  if (document.getElementById('dsh-quota-slot-style') !== null) return
  const style = document.createElement('style')
  style.id = 'dsh-quota-slot-style'
  style.textContent = `
    .dsh-quota-slot-root { position: relative; height: 100%; min-height: 0; overflow: hidden; }
    .dsh-quota-slot-panel { height: 100%; }
    .dsh-quota-slot-badge {
      display: inline-flex; align-items: center; justify-content: center;
      min-width: 16px; height: 16px; padding: 0 4px; border-radius: 8px;
      background: var(--dsw-alias-state-error-primary, #B04A46); color: #fff;
      font-size: 10px; font-weight: 600; line-height: 1;
    }
    .dsh-quota-footer-action {
      display: flex; align-items: center; gap: 8px; width: 100%;
      min-height: 32px; padding: 6px 8px; margin: 0;
      background: transparent; border: none; border-radius: 8px;
      color: var(--dsw-alias-label-primary, #1f2328); cursor: pointer;
      font: inherit; font-size: 13px; text-align: left;
    }
    .dsh-quota-footer-action:hover { background: var(--dsw-alias-interactive-bg-hover, rgba(0,0,0,0.06)); }
    .dsh-quota-footer-action[data-wide='false'] { justify-content: center; padding: 6px; }
    .dsh-quota-footer-action .dsh-quota-footer-label { white-space: nowrap; }
    .dsh-quota-footer-action[data-wide='false'] .dsh-quota-footer-label { display: none; }
  `
  document.head.appendChild(style)
}

function gaugeIcon(react: any, size: number, active: boolean): any {
  return react.createElement(
    'svg',
    {
      viewBox: '0 0 16 16',
      width: size,
      height: size,
      fill: 'none',
      xmlns: 'http://www.w3.org/2000/svg',
      'aria-hidden': 'true',
      style: { opacity: active ? 1 : 0.86 },
    },
    react.createElement('path', {
      d: 'M3.49 13.26A6.375 6.375 0 1 1 12.51 13.26',
      stroke: 'currentColor',
      strokeWidth: 1.25,
      strokeLinecap: 'round',
    }),
    react.createElement('path', {
      d: 'M8 8.75L11.4 5.35',
      stroke: 'currentColor',
      strokeWidth: 1.25,
      strokeLinecap: 'round',
    }),
    react.createElement('circle', { cx: 8, cy: 8.75, r: 1.55, fill: 'currentColor' }),
  )
}

export function registerQuotaSlots(ctx: any, wiring: SlotWiring): (() => void) | undefined {
  const slots = ctx?.slots
  if (!slots || typeof slots.register !== 'function') return undefined
  const { react, controller, t } = wiring
  if (!react || typeof react.createElement !== 'function') return undefined

  ensureSlotStyles()

  const disposers: Array<() => void> = []
  let registered = 0
  const track = (result: unknown): void => {
    if (typeof result === 'function') disposers.push(result as () => void)
  }

  const register = (name: string, spec: Record<string, any>, component: any): void => {
    const doRegister = () => {
      try {
        const result = slots.register({ name, locale: LOCALE_NS, ...spec }, component)
        registered += 1
        return result
      } catch (error) {
        console.warn(`[dsh-quota] slot "${name}" registration failed:`, (error as Error)?.message ?? error)
        return undefined
      }
    }
    try {
      if (typeof slots.inject === 'function') {
        track(slots.inject(name, doRegister))
        return
      }
      track(doRegister())
    } catch (error) {
      console.warn(`[dsh-quota] slot "${name}" injection failed:`, (error as Error)?.message ?? error)
    }
  }

  // ---- main panel -------------------------------------------------------
  const QuotaPanel = () => {
    const ref = react.useRef(null)
    react.useEffect(() => {
      const host = ref.current
      if (host === null || host === undefined) return undefined
      document.documentElement.setAttribute(ACTIVE_ATTR, '')
      try {
        controller.open()
      } catch {
        /* opening only flips internal state */
      }
      let dispose: (() => void) | undefined
      try {
        dispose = renderQuotaApp(host, controller)
      } catch (error) {
        console.error('[dsh-quota] panel mount failed:', error)
      }
      return () => {
        try {
          dispose?.()
        } finally {
          document.documentElement.removeAttribute(ACTIVE_ATTR)
        }
      }
    }, [])
    return react.createElement(
      'div',
      { className: 'dsh-quota-slot-root' },
      react.createElement('div', { ref, className: 'dsh-quota-slot-panel' }),
    )
  }

  // ---- sidebar icon -----------------------------------------------------
  const QuotaEntryIcon = (props: { size?: number; active?: boolean }) => {
    const size = typeof props?.size === 'number' ? props.size : 16
    return gaugeIcon(react, size, props?.active === true)
  }

  // ---- collapsed-rail badge --------------------------------------------
  const QuotaBadge = () => {
    const [count, setCount] = react.useState(() => {
      try {
        return controller.getSnapshot().alarms.length
      } catch {
        return 0
      }
    })
    react.useEffect(() => {
      let unsubscribe: (() => void) | undefined
      try {
        unsubscribe = controller.subscribe(() => {
          const snapshot = controller.getSnapshot()
          setCount(Array.isArray(snapshot?.alarms) ? snapshot.alarms.length : 0)
        })
      } catch {
        /* controller may be destroyed during teardown */
      }
      return () => {
        try {
          unsubscribe?.()
        } catch {
          /* ignore */
        }
      }
    }, [])
    if (count <= 0) return null
    return react.createElement(
      'span',
      { className: 'dsh-quota-slot-badge', 'aria-label': t('badge.alarmsCount', { count }) },
      count > 9 ? '9+' : String(count),
    )
  }

  // ---- sidebar footer shortcut -----------------------------------------
  const QuotaFooterAction = (props: { wide?: boolean }) => {
    const wide = props?.wide !== false
    return react.createElement(
      'button',
      {
        type: 'button',
        className: 'dsh-quota-footer-action',
        'data-wide': wide ? 'true' : 'false',
        title: t('footer.open'),
        'aria-label': t('footer.open'),
        onClick: () => {
          try {
            wiring.selectPanel?.(PANEL_ID)
          } catch (error) {
            console.warn('[dsh-quota] selectPanel failed:', (error as Error)?.message ?? error)
          }
        },
      },
      gaugeIcon(react, 16, false),
      react.createElement('span', { className: 'dsh-quota-footer-label' }, t('footer.open')),
    )
  }

  register('main', { key: PANEL_ID }, QuotaPanel)
  register(
    'sidebar.panellist',
    { id: PANEL_ID, order: 20, label: () => t('entry') },
    QuotaEntryIcon,
  )
  register('sidebar.toggle.badge', {}, QuotaBadge)
  if (typeof wiring.selectPanel === 'function') {
    register('sidebar.footer.action', { id: 'dsh-quota-footer', order: 20 }, QuotaFooterAction)
  }

  // `slots.inject` hands back a disposer even when the seat never arrives. Only a
  // real registration means the host accepted the seat; otherwise the caller must
  // fall back to the DOM mount.
  if (registered === 0) return undefined
  return () => {
    for (const dispose of disposers.reverse()) {
      try {
        dispose()
      } catch {
        /* host teardown races are not our problem */
      }
    }
  }
}
