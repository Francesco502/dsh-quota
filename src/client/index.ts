/**
 * Client entry for dsh-quota Web UI.
 * @package dsh-quota
 * @version 0.4.0
 */
import { QuotaClientApi } from './api.ts'
import { QuotaController } from './controller.ts'
import { mountQuotaSidebarEntry } from './sidebar-entry.ts'
import { mountPanel } from './mount.ts'
import { mountQuotaHud } from './hud.ts'

export const VERSION = '0.4.0'
export const inject: string[] = []

let applied = false

export function apply(ctx: any): void {
  if (applied) return
  applied = true

  const api = new QuotaClientApi()
  const controller = new QuotaController(api)

  try {
    const d1 = mountQuotaSidebarEntry(controller)
    const d2 = mountPanel(controller)
    const d3 = mountQuotaHud(controller)

    // Initialize controller (load config, initial fetch, start background polling & focus listeners)
    void controller.init()

    if (ctx && typeof ctx.effect === 'function') {
      ctx.effect(() => {
        return () => {
          d1()
          d2()
          d3()
          controller.destroy()
          applied = false
        }
      }, 'quota: client cleanup')
    }
  } catch (err) {
    applied = false
    console.error('[dsh-quota] client mount error:', err)
  }
}
