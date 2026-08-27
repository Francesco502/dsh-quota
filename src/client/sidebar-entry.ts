import type { QuotaController } from './controller.ts'
import { mountSidebarEntry } from './sidebar-entry-core.ts'

export const ENTRY_SELECTOR = '[data-dsh-quota-entry]'

// 18x18 SVG meter glyph aligned to the shell's 16x16 grid and stroke
const ICON = '<svg viewBox=\"0 0 16 16\" width=\"18\" height=\"18\" fill=\"none\" stroke=\"currentColor\" stroke-width=\"1.35\" stroke-linecap=\"round\" stroke-linejoin=\"round\" aria-hidden=\"true\"><circle cx=\"8\" cy=\"8\" r=\"6.25\"/><path d=\"M8 8l2.5-2.5\"/><path d=\"M4.5 10.5a4.75 4.75 0 0 1 0-5\"/></svg>'

function ensureSidebarStyles(): void {
  if (document.getElementById('dsh-quota-sidebar-style')) return
  const style = document.createElement('style')
  style.id = 'dsh-quota-sidebar-style'
  style.textContent = `
    .dsh-quota-entry {
      box-sizing: border-box;
      display: flex;
      align-items: center;
      gap: 8px;
      width: 100%;
      height: 36px;
      padding: 0 10px;
      background: transparent;
      border: none;
      border-radius: 8px;
      color: var(--dsw-alias-label-secondary, #57606a);
      cursor: pointer;
      font-size: 13px;
      white-space: nowrap;
      font-family: inherit;
      text-align: left;
      transition: background-color 120ms ease, color 120ms ease;
      position: relative;
    }
    .dsh-quota-entry:hover {
      background: var(--dsw-alias-interactive-bg-hover, rgba(0, 0, 0, 0.06));
      color: var(--dsw-alias-label-primary, #1f2328);
    }
    .dsh-quota-entry[data-active] {
      background: var(--dsw-alias-interactive-bg-active, rgba(0, 0, 0, 0.1));
      color: var(--dsw-alias-label-primary, #1f2328);
      font-weight: 600;
    }
    .dsh-quota-entry-icon {
      display: inline-flex;
      align-items: center;
      justify-content: center;
      width: 24px;
      height: 24px;
      flex: none;
      position: relative;
    }
    .dsh-quota-entry-icon svg {
      display: block;
      width: 18px;
      height: 18px;
    }
    .dsh-quota-entry[data-alarm='true'] .dsh-quota-entry-icon::after {
      content: '';
      position: absolute;
      top: 1px;
      right: 1px;
      width: 6.5px;
      height: 6.5px;
      border-radius: 50%;
      background: #B04A46;
      border: 1.5px solid var(--dsw-alias-bg-base, #ffffff);
      box-shadow: 0 0 6px rgba(176, 74, 70, 0.6);
      animation: dshQuotaPulse 2.5s infinite ease-in-out;
    }
    @keyframes dshQuotaPulse {
      0%, 100% { transform: scale(1); opacity: 1; }
      50% { transform: scale(1.15); opacity: 0.75; }
    }
    .dsh-quota-entry-label {
      overflow: hidden;
      text-overflow: ellipsis;
      flex: 1;
    }
    [data-dsh-frame][data-sidebar-collapsed] .dsh-quota-entry {
      justify-content: center;
      padding: 0;
      width: 36px;
      height: 36px;
      margin: 0 auto 12px;
      border-radius: 50%;
    }
    [data-dsh-frame][data-sidebar-collapsed] .dsh-quota-entry-label {
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
