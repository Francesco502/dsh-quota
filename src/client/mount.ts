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

  const ensure = (): void => {
    if (container !== undefined) {
      if (container.isConnected) return
      disposeView?.()
      container.remove()
      container = undefined
    }
    const column = conversationColumn()
    if (column === undefined) return
    container = document.createElement('div')
    container.dataset.dshQuotaView = ''
    container.dataset.dshPlugin = 'quota'
    column.appendChild(container)
    disposeView = renderQuotaApp(container, controller)
  }

  const waitObserver = new MutationObserver(() => { ensure() })
  waitObserver.observe(document.body, { childList: true, subtree: true })

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
    waitObserver.disconnect()
    unsubscribe()
    document.documentElement.removeAttribute(ACTIVE_ATTR)
    disposeView?.()
    container?.remove()
    container = undefined
  }
}
