/**
 * Official slot wiring for the Web GUI.
 *
 * The host renders React components into declared seats. We keep the dashboard's
 * existing DOM renderer and mount it inside a React wrapper, so the plugin gains
 * the shell's layout/theme/accessibility for free without rewriting the view.
 *
 * Seats used:
 *  - `sidebar.panellist`     first-class global panel row (`quota`)
 *  - `main`                  the dashboard as the main panel (`key: quota`)
 *  - `sidebar.toggle.badge`  alert badge on the collapsed rail
 *  - `sidebar.footer.action` quick jump next to Settings (legacy hosts)
 *
 * Every host call is best-effort: a missing seat must degrade, never throw.
 */
import type { QuotaController } from './controller.ts'
import { renderQuotaApp } from './view.ts'
import { LOCALE_NS, type QuotaTranslate } from './locale.ts'
import { serviceOf } from './services.ts'

export const PANEL_ID = 'quota'

export interface SlotWiring {
  react: any
  controller: QuotaController
  t: QuotaTranslate
  /** Selects a main panel; when absent the footer shortcut is not registered. */
  selectPanel?: (id: string) => boolean | void
}

const ACTIVE_ATTR = 'data-dsh-quota-active'

function ensureSlotStyles(): void {
  if (typeof document === 'undefined') return
  if (document.getElementById('dsh-quota-slot-style') !== null) return
  const style = document.createElement('style')
  style.id = 'dsh-quota-slot-style'
  style.textContent = `
    .dsh-quota-slot-root { position: relative; height: 100%; min-height: 0; overflow: hidden; }
    .dsh-quota-slot-panel { height: 100%; min-height: 0; }
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
  const slots = serviceOf(ctx, 'slots')
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

  // ---- sidebar panel entry ----------------------------------------------
  // The host hands the icon a `size` prop; reuse the footer gauge so the two
  // surfaces share one visual identity.
  const QuotaPanelIcon = (props: { size?: number }) =>
    gaugeIcon(react, typeof props?.size === 'number' ? props.size : 16, false)

  // ---- main panel content ------------------------------------------------
  // The host mounts this component only while the `quota` panel is selected.
  // renderQuotaApp owns the DOM inside the wrapper; React only owns the host
  // div, so controller-driven repaints never fight React's tree.
  const QuotaMainPanel = () => {
    const hostRef = react.useRef(null)
    react.useEffect(() => {
      const host = hostRef.current
      if (host === null || host === undefined) return
      let dispose: (() => void) | undefined
      try {
        dispose = renderQuotaApp(host, controller, { mode: 'panel' })
      } catch (error) {
        console.warn('[dsh-quota] panel render failed:', (error as Error)?.message ?? error)
      }
      return () => {
        try {
          dispose?.()
        } catch {
          /* host teardown races are not our problem */
        }
      }
    }, [])
    return react.createElement('div', { ref: hostRef, className: 'dsh-quota-slot-panel' })
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
            // Slot hosts own panel selection; only the legacy overlay keeps the
            // controller's open/close state.
            if (typeof wiring.selectPanel === 'function') {
              wiring.selectPanel(PANEL_ID)
              return
            }
            const open = controller.getSnapshot().panelOpen
            if (open) controller.close()
            else controller.open()
          } catch (error) {
            console.warn('[dsh-quota] panel toggle failed:', (error as Error)?.message ?? error)
          }
        },
      },
      gaugeIcon(react, 16, false),
      react.createElement('span', { className: 'dsh-quota-footer-label' }, t('footer.open')),
    )
  }

  register('sidebar.panellist', { id: PANEL_ID, order: 10, label: () => t('footer.open') }, QuotaPanelIcon)
  register('main', { key: PANEL_ID }, QuotaMainPanel)
  register('sidebar.toggle.badge', {}, QuotaBadge)
  register('sidebar.footer.action', { id: 'dsh-quota-footer', order: 20 }, QuotaFooterAction)

  // `slots.inject` may defer the callback until the seat's declaring entry is
  // ready, so a seat can register after `apply()` returns. Return a working
  // disposer as soon as the slots service exists; the caller must not interpret
  // "nothing registered synchronously" as "no seats" and mount a second entry.
  void registered
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
