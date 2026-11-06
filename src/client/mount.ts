import type { QuotaController } from './controller.ts'
import { renderQuotaApp } from './view.ts'

export const PANEL_VIEW_SELECTOR = '[data-dsh-quota-view]'
const CONVERSATION_COLUMN_SELECTOR = '[data-pane="conversation"], [class*="centerCol"]'
const ACTIVE_ATTR = 'data-dsh-quota-active'
const OTHER_ACTIVE_ATTRS = ['data-dsh-taskboard-active', 'data-dsh-ssh-active']
const ACTIVATE_EVENT = 'dsh-panel-activate'
const PANEL_NAME = 'quota'

function conversationColumn(): HTMLElement | undefined {
  return document.querySelector<HTMLElement>(CONVERSATION_COLUMN_SELECTOR) ?? undefined
}

export function mountPanel(controller: QuotaController): () => void {
  let container: HTMLDivElement | undefined
  let disposeView: (() => void) | undefined
  let frameId: number | null = null

  const requestFrame = (callback: () => void): number => {
    if (typeof requestAnimationFrame === 'function') return requestAnimationFrame(() => callback())
    return setTimeout(callback, 16) as unknown as number
  }

  const cancelFrame = (id: number): void => {
    if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(id)
    else clearTimeout(id as unknown as ReturnType<typeof setTimeout>)
  }

  // Coalesce a mutation burst into one scan per frame; the panel is re-rendered by
  // the controller anyway, this observer only cares about mount/unmount edges.
  const observer = new MutationObserver(() => {
    if (frameId !== null) return
    frameId = requestFrame(() => {
      frameId = null
      ensure()
    })
  })

  // Observe the narrowest target that can still reveal a mount/unmount: while the
  // panel is missing the whole shell is scanned (rare, only during startup / pane
  // switches); once mounted only the conversation column and its parent are watched.
  const observeNarrow = (column: HTMLElement): void => {
    observer.disconnect()
    observer.observe(column, { childList: true })
    if (column.parentElement !== null) observer.observe(column.parentElement, { childList: true })
    // Top-level shell swaps are cheap to watch (direct body children only) and
    // cover the case where the whole conversation column is replaced.
    observer.observe(document.body, { childList: true })
  }

  const observeBroad = (): void => {
    observer.disconnect()
    observer.observe(document.body, { childList: true, subtree: true })
  }

  const ensure = (): void => {
    if (container !== undefined) {
      if (container.isConnected) return
      disposeView?.()
      container.remove()
      container = undefined
      disposeView = undefined
    }
    const column = conversationColumn()
    if (column === undefined) {
      observeBroad()
      return
    }
    container = document.createElement('div')
    container.dataset.dshQuotaView = ''
    container.dataset.dshPlugin = 'quota'
    column.appendChild(container)
    disposeView = renderQuotaApp(container, controller)
    observeNarrow(column)
  }

  const applyActive = (): void => {
    if (controller.getSnapshot().panelOpen) {
      for (const attr of OTHER_ACTIVE_ATTRS) {
        document.documentElement.removeAttribute(attr)
      }
      document.documentElement.setAttribute(ACTIVE_ATTR, '')
      document.dispatchEvent(new CustomEvent(ACTIVATE_EVENT, { detail: PANEL_NAME }))
    } else {
      document.documentElement.removeAttribute(ACTIVE_ATTR)
    }
  }

  const onOtherActivate = (event: Event): void => {
    const detail = (event as CustomEvent).detail
    if (detail !== PANEL_NAME && controller.getSnapshot().panelOpen) {
      controller.close()
    }
  }

  const SIDEBAR_ROW_SELECTOR = '[class*="sessionRow"], [class*="projectRow"], [class*="searchResultRow"], [class*="searchResultWorkspace"], [class*="newSession"]'
  const onClickSidebarRow = (event: MouseEvent): void => {
    if (!controller.getSnapshot().panelOpen) return
    const target = event.target as HTMLElement | null
    if (target === null) return
    if (target.closest(SIDEBAR_ROW_SELECTOR) !== null) controller.close()
  }

  document.addEventListener('click', onClickSidebarRow, true)
  document.addEventListener(ACTIVATE_EVENT, onOtherActivate)
  const unsubscribe = controller.subscribe(applyActive)
  applyActive()
  ensure()

  return () => {
    document.removeEventListener('click', onClickSidebarRow, true)
    document.removeEventListener(ACTIVATE_EVENT, onOtherActivate)
    observer.disconnect()
    if (frameId !== null) {
      cancelFrame(frameId)
      frameId = null
    }
    unsubscribe()
    document.documentElement.removeAttribute(ACTIVE_ATTR)
    disposeView?.()
    container?.remove()
    container = undefined
  }
}
