/**
 * Client entry for the dsh-quota Web UI.
 *
 * Preferred path: official slots provide the sidebar footer shortcut and the
 * collapsed-rail alert badge, while the dashboard itself keeps the proven
 * overlay mount (it renders into the conversation column and takes over the
 * main area when opened). Hosts without the slots service fall back to the
 * previous DOM-injected sidebar entry.
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

  const disposeSlots = registerQuotaSlots(ctx, { react, controller, t })
  // The dashboard keeps the overlay mount: it is the same renderer users already
  // run, so the official seats only change how the panel is reached. One broken
  // mount must not tear down the seats that already registered.
  const disposePanel = guardedMount('panel mount', () => mountPanel(controller))
  const disposeHud = guardedMount('HUD mount', () => mountQuotaHud(controller))
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
    disposePanel?.()
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
