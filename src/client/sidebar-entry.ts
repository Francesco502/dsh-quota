import type { QuotaController } from './controller.ts'
import { mountSidebarEntry } from './sidebar-entry-core.ts'

export const ENTRY_SELECTOR = '[data-dsh-quota-entry]'

// Official DSH IconGaugeOutline16 glyph aligned to the shell's 16x16 grid and 1.25 stroke
const ICON = '<svg viewBox="0 0 16 16" width="16" height="16" fill="none" xmlns="http://www.w3.org/2000/svg" aria-hidden="true"><path d="M3.49 13.26A6.375 6.375 0 1 1 12.51 13.26" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/><path d="M8 8.75L11.4 5.35" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/><circle cx="8" cy="8.75" r="1.55" fill="currentColor"/></svg>'

function ensureSidebarStyles(): void {
  if (document.getElementById('dsh-quota-sidebar-style')) return
  const style = document.createElement('style')
  style.id = 'dsh-quota-sidebar-style'
  style.textContent = `
    .dsh-quota-entry {
      box-sizing: border-box;
      min-height: 36px;
      height: 36px;
      width: calc(100% - 4px);
      margin: 0 2px 4px 2px;
      padding: 7px 8px;
      background: transparent;
      border: none;
      border-radius: 12px;
      color: var(--dsw-alias-label-primary, #1f2328);
      cursor: pointer;
      font: inherit;
      font-size: 14px;
      line-height: 22px;
      white-space: nowrap;
      text-align: left;
      text-decoration: none !important;
      align-items: center;
      gap: 8px;
      display: flex;
      user-select: none;
      position: relative;
      transition: background-color 120ms ease, color 120ms ease;
    }
    .dsh-quota-entry:hover {
      background: var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, 0.06));
      color: var(--dsw-alias-label-primary, #1f2328);
    }
    .dsh-quota-entry[data-active] {
      background: var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, 0.08));
      color: var(--dsw-alias-label-primary, #1f2328);
      font-weight: 400;
    }
    .dsh-quota-entry:focus-visible {
      outline: 2px solid var(--dsw-alias-label-primary, #1f2328);
      outline-offset: -2px;
    }
    .dsh-quota-entry-icon {
      flex: none;
      justify-content: center;
      align-items: center;
      display: inline-flex;
      width: 16px;
      height: 16px;
      color: inherit;
      position: relative;
    }
    .dsh-quota-entry-icon svg {
      display: block;
      width: 16px;
      height: 16px;
    }
    .dsh-quota-entry-label {
      overflow: hidden;
      text-overflow: ellipsis;
      white-space: nowrap;
      min-width: 0;
      flex: 1;
      font-size: 14px;
      line-height: 22px;
      color: inherit;
      text-decoration: none !important;
    }
    [data-dsh-frame][data-sidebar-collapsed] .dsh-quota-entry,
    [data-sidebar-collapsed] .dsh-quota-entry {
      width: 36px;
      height: 36px;
      margin: 0 auto 4px;
      padding: 0;
      justify-content: center;
      border-radius: 12px;
    }
    [data-dsh-frame][data-sidebar-collapsed] .dsh-quota-entry-icon,
    [data-sidebar-collapsed] .dsh-quota-entry-icon {
      width: 18px;
      height: 18px;
    }
    [data-dsh-frame][data-sidebar-collapsed] .dsh-quota-entry-icon svg,
    [data-sidebar-collapsed] .dsh-quota-entry-icon svg {
      width: 18px;
      height: 18px;
    }
    [data-dsh-frame][data-sidebar-collapsed] .dsh-quota-entry-label,
    [data-sidebar-collapsed] .dsh-quota-entry-label {
      display: none;
    }
  `
  document.head.appendChild(style)
}

export function mountQuotaSidebarEntry(controller: QuotaController): () => void {
  ensureSidebarStyles()

  return mountSidebarEntry({
    rowAttribute: 'data-dsh-quota-entry',
    rowSelector: ENTRY_SELECTOR,
    plugin: 'quota',
    icon: ICON,
    css: {
      entry: 'dsh-quota-entry',
      entryIcon: 'dsh-quota-entry-icon',
      entryLabel: 'dsh-quota-entry-label',
    },
    label: () => '额度监控',
    tooltip: () => '查看各 AI 模型与编程助手剩余额度与用量',
    onToggle: () => controller.toggle(),
    position: 'after',
    familySelectors: ['[data-dsh-taskboard-entry]', '[data-dsh-ssh-entry]', '[data-dsh-skill-entry]', '[data-dsh-quota-entry]'],
    active: {
      subscribe: (listener) => {
        return controller.subscribe(() => {
          const entryEl = document.querySelector(ENTRY_SELECTOR) as HTMLElement | null
          if (entryEl) {
            entryEl.dataset.alarm = controller.hasAlarms() ? 'true' : 'false'
          }
          listener()
        })
      },
      isOpen: () => controller.getSnapshot().panelOpen,
    },
  })
}
