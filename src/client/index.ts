/**
 * Client entry for the dsh-quota Web UI.
 *
 * Preferred path: official slots register the sidebar panel entry and the main
 * panel content, so the dashboard is a first-class shell panel rather than a
 * conversation-column takeover. The footer shortcut and alert badge are kept
 * for hosts that still show them; the legacy overlay only remains for hosts
 * without the slots service.
 *
 * @package dsh-quota
 * @version 0.4.4
 */
import { QuotaClientApi } from './api.ts'
import { QuotaController } from './controller.ts'
import { mountQuotaSidebarEntry } from './sidebar-entry.ts'
import { mountPanel } from './mount.ts'
import { mountQuotaHud } from './hud.ts'
import { PLUGIN_VERSION } from '../core/types.ts'
import { registerQuotaLocale } from './locale.ts'
import { PANEL_ID, registerQuotaSlots } from './slots.ts'
import { serviceOf } from './services.ts'

export const VERSION = PLUGIN_VERSION
/** Cordis services the shell surfaces depend on. Declared so the fiber waits for them. */
export const inject: string[] = ['slots', 'locale']

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

function startController(controller: QuotaController): void {
  void controller.init().catch((error: unknown) => {
    console.warn('[dsh-quota] initial load failed:', (error as Error)?.message ?? error)
  })
}

function guardedMount<T>(label: string, mount: () => T): T | undefined {
  try {
    return mount()
  } catch (error) {
    console.error(`[dsh-quota] ${label} failed:`, error)
    return undefined
  }
}

function applyWithSlots(ctx: any, react: any): void {
  const api = new QuotaClientApi()
  const controller = new QuotaController(api)
  const t = registerQuotaLocale(ctx)
  // Panel selection is a layout concern. Resolve it lazily on each use: at
  // client-apply time the layout service may not have been registered yet, and
  // `ctx.get` is the non-throwing probe that stays valid on hosts without it.
  const selectPanel = (id: string): boolean => {
    const layout = serviceOf(ctx, 'layout')
    const select = layout?.selectPanel
    if (typeof select !== 'function') return false
    try {
      select.call(layout, id)
      return true
    } catch (error) {
      console.warn('[dsh-quota] panel selection failed:', (error as Error)?.message ?? error)
      return false
    }
  }

  const disposeSlots = registerQuotaSlots(ctx, { react, controller, t, selectPanel })
  // The slot host owns the panel surface: `main` renders the dashboard and
  // `sidebar.panellist` selects it. Mounting the legacy overlay as well would
  // stack two scroll containers and leave the overlay hidden/inert.
  const disposeHud = guardedMount('HUD mount', () =>
    mountQuotaHud(controller, {
      openPanel: () => {
        if (!selectPanel(PANEL_ID)) controller.toggle()
      },
    }),
  )
  // A host that exposes slots but rejected every seat still needs an entry point.
  const disposeLegacyEntry =
    disposeSlots === undefined ? guardedMount('legacy sidebar entry', () => mountQuotaSidebarEntry(controller)) : undefined

  startController(controller)

  const disposeAll = (): void => {
    try {
      disposeSlots?.()
      disposeLegacyEntry?.()
    } catch {
      /* host teardown races are not our problem */
    }
    disposeHud?.()
    controller.destroy()
    applied = false
  }

  if (ctx && typeof ctx.effect === 'function') {
    try {
      ctx.effect(() => disposeAll, 'quota: client cleanup')
    } catch (error) {
      console.warn('[dsh-quota] effect registration failed:', (error as Error)?.message ?? error)
    }
  }
}

function applyLegacy(ctx: any, api: QuotaClientApi, controller: QuotaController): void {
  applied = true
  const disposeEntry = mountQuotaSidebarEntry(controller)
  const disposePanel = mountPanel(controller)
  const disposeHud = mountQuotaHud(controller)

  startController(controller)

  const disposeAll = (): void => {
    disposeEntry()
    disposePanel()
    disposeHud()
    controller.destroy()
    applied = false
  }

  if (ctx && typeof ctx.effect === 'function') {
    try {
      ctx.effect(() => disposeAll, 'quota: client cleanup')
    } catch (error) {
      console.warn('[dsh-quota] effect registration failed:', (error as Error)?.message ?? error)
    }
  }
}

export function apply(ctx: any): void {
  if (applied) return
  applied = true

  try {
    const react = loadReact()
    if (serviceOf(ctx, 'slots') !== undefined && react !== undefined) {
      try {
        applyWithSlots(ctx, react)
        return
      } catch (error) {
        console.error('[dsh-quota] slot mount failed, falling back to DOM mount:', error)
        applied = false
      }
    }

    const api = new QuotaClientApi()
    applyLegacy(ctx, api, new QuotaController(api))
  } catch (error) {
    applied = false
    console.error('[dsh-quota] client mount failed:', error)
  }
}

export { PANEL_ID }
