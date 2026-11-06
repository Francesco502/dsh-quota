/**
 * Client entry for the dsh-quota Web UI.
 *
 * Preferred path (current hosts): official slots — the dashboard is a real main
 * panel, the entry is a sidebar panel row, the alert dot lives on the collapsed
 * rail, and a footer shortcut jumps to the panel. If the host does not expose
 * `ctx.slots` (older builds or a missing React seat), the plugin falls back to
 * the previous DOM-injection mount so it keeps working.
 *
 * @package dsh-quota
 * @version 0.4.1
 */
import { QuotaClientApi } from './api.ts'
import { QuotaController } from './controller.ts'
import { mountQuotaSidebarEntry } from './sidebar-entry.ts'
import { mountPanel } from './mount.ts'
import { mountQuotaHud } from './hud.ts'
import { PLUGIN_VERSION } from '../core/types.ts'
import { registerQuotaLocale } from './locale.ts'
import { PANEL_ID, registerQuotaSlots } from './slots.ts'

export const VERSION = PLUGIN_VERSION
export const inject: string[] = []

let applied = false

/**
 * React is a seed word in the host module table. The factory receives `require`,
 * so we resolve it lazily instead of at module top level: that keeps the bundle
 * loadable in hosts that never render a React seat (and in unit tests).
 */
function loadReact(): any {
  try {
    if (typeof require === 'function') return require('react')
  } catch (error) {
    console.warn('[dsh-quota] react unavailable:', (error as Error)?.message ?? error)
  }
  return undefined
}

function selectPanelFrom(ctx: any): ((id: string) => void) | undefined {
  const layout = ctx?.layout
  if (layout === undefined || typeof layout.selectPanel !== 'function') return undefined
  return (id: string) => layout.selectPanel(id)
}

function applyWithSlots(ctx: any, react: any, selectPanel: ((id: string) => void) | undefined): void {
  const api = new QuotaClientApi()
  const controller = new QuotaController(api)
  const t = registerQuotaLocale(ctx)

  const disposeSlots = registerQuotaSlots(ctx, { react, controller, t, selectPanel })
  if (disposeSlots === undefined) {
    // Registration produced nothing usable — fall through to the legacy mount.
    applied = false
    applyLegacy(ctx, api, controller)
    return
  }

  const disposeHud = mountQuotaHud(controller)
  void controller.init()

  // The host owns panel selection; only nudge it back when we know the layout
  // service exists (a footer shortcut implies it does).
  const closeSubscription = controller.subscribe(() => {
    if (controller.getSnapshot().panelOpen) return
    selectPanel?.('conversation')
  })

  const disposeAll = (): void => {
    try {
      closeSubscription()
    } catch {
      /* ignore */
    }
    disposeSlots()
    disposeHud()
    controller.destroy()
    applied = false
  }

  if (ctx && typeof ctx.effect === 'function') {
    ctx.effect(() => disposeAll, 'quota: client cleanup')
  }
}

function applyLegacy(ctx: any, api: QuotaClientApi, controller: QuotaController): void {
  applied = true
  const d1 = mountQuotaSidebarEntry(controller)
  const d2 = mountPanel(controller)
  const d3 = mountQuotaHud(controller)

  void controller.init()

  const disposeAll = (): void => {
    d1()
    d2()
    d3()
    controller.destroy()
    applied = false
  }

  if (ctx && typeof ctx.effect === 'function') {
    ctx.effect(() => disposeAll, 'quota: client cleanup')
  }
}

export function apply(ctx: any): void {
  if (applied) return
  applied = true

  const react = loadReact()
  const selectPanel = selectPanelFrom(ctx)

  if (ctx?.slots !== undefined && react !== undefined) {
    try {
      applyWithSlots(ctx, react, selectPanel)
      return
    } catch (error) {
      console.error('[dsh-quota] slot mount failed, falling back to DOM mount:', error)
      applied = false
    }
  }

  try {
    const api = new QuotaClientApi()
    applyLegacy(ctx, api, new QuotaController(api))
  } catch (error) {
    applied = false
    console.error('[dsh-quota] legacy mount failed:', error)
  }
}

export { PANEL_ID }
