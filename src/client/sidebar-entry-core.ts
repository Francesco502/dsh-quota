/**
 * Shared sidebar entry injection core.
 */
export interface SidebarEntryOptions {
  rowAttribute: string
  rowSelector: string
  plugin?: string
  icon: string
  css: Record<string, string>
  label(): string
  tooltip?(): string
  onToggle(): void
  position: 'before' | 'after'
  familySelectors: readonly string[]
  active?: {
    subscribe(listener: () => void): () => void
    isOpen(): boolean
  }
}

function sidebarRoot(): HTMLElement | undefined {
  const column = document.querySelector<HTMLElement>('[data-pane="sidebar"], [class*="sidebarCol"]')
  if (column === null) return undefined
  const logoOwner = column.querySelector<HTMLElement>('[class*="logoRow"]')?.parentElement
  return logoOwner ?? (column.firstElementChild as HTMLElement | undefined)
}

function newSessionButton(root: HTMLElement): HTMLButtonElement | undefined {
  const nested = root.querySelector<HTMLButtonElement>('button[class*="newSession"]')
  if (nested !== null) return nested
  for (const child of root.children) {
    if (child.tagName === 'BUTTON') return child as HTMLButtonElement
  }
  return undefined
}

function createEntry(options: SidebarEntryOptions): HTMLButtonElement {
  const entry = document.createElement('button')
  entry.type = 'button'
  entry.spellcheck = false
  entry.setAttribute(options.rowAttribute, '')
  if (options.plugin !== undefined) {
    entry.setAttribute('data-dsh-plugin', options.plugin)
    entry.setAttribute('data-dsh-part', 'sidebar-entry')
  }
  entry.className = options.css['entry'] ?? ''
  entry.setAttribute('aria-label', options.label())
  if (options.tooltip !== undefined) entry.setAttribute('title', options.tooltip())
  entry.innerHTML = '<span class="' + (options.css['entryIcon'] ?? '') + '">' + options.icon
    + '</span><span class="' + (options.css['entryLabel'] ?? '') + '">' + options.label() + '</span>'
  entry.addEventListener('click', options.onToggle)
  return entry
}

function placeEntry(root: HTMLElement, entry: HTMLButtonElement, options: SidebarEntryOptions): boolean {
  const button = newSessionButton(root)
  if (button === undefined) return false
  if (entry.parentElement !== root) {
    const row = button.closest('[class*="logoRow"]')
    const base = (row !== null && row.parentElement === root) ? row : button
    const family = Array.from(root.children).filter(
      (el): el is HTMLElement => el instanceof HTMLElement && el.matches(options.familySelectors.join(', ')),
    )
    const anchor = options.position === 'before'
      ? (family.length > 0 ? family[0] : base.nextElementSibling)
      : (family.length > 0 ? family[family.length - 1]!.nextElementSibling : base.nextElementSibling)
    root.insertBefore(entry, anchor)
  }
  return true
}

export function mountSidebarEntry(options: SidebarEntryOptions): () => void {
  if (typeof document === 'undefined') return () => {}

  // Idempotent re-apply: a leftover entry from a previous instance (HMR, plugin
  // re-enable) kept its DOM node but lost its click handler, i.e. a dead button.
  // Remove every leftover before mounting the live one.
  for (const stale of Array.from(document.querySelectorAll<HTMLElement>(options.rowSelector))) {
    stale.remove()
  }

  const entry = createEntry(options)
  let root: HTMLElement | undefined
  let placed = false
  let frameId: number | null = null

  const requestFrame = (callback: () => void): number => {
    if (typeof requestAnimationFrame === 'function') return requestAnimationFrame(() => callback())
    return setTimeout(callback, 16) as unknown as number
  }

  const cancelFrame = (id: number): void => {
    if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(id)
    else clearTimeout(id as unknown as ReturnType<typeof setTimeout>)
  }

  const observer = new MutationObserver(() => {
    if (frameId !== null) return
    frameId = requestFrame(() => {
      frameId = null
      tryPlace()
    })
  })

  // While the root is unknown the whole shell is watched; once found, observation
  // is narrowed to the sidebar root (plus its parent for column swaps) so chat
  // streaming mutations never reach this plugin.
  const observeNarrow = (target: HTMLElement): void => {
    observer.disconnect()
    observer.observe(target, { childList: true, subtree: true })
    if (target.parentElement !== null) observer.observe(target.parentElement, { childList: true })
    // Cheap shell-level catch: direct body children only, in case the whole
    // sidebar column is replaced without mutating the observed parent chain.
    observer.observe(document.body, { childList: true })
  }

  const observeBroad = (): void => {
    observer.disconnect()
    observer.observe(document.body, { childList: true, subtree: true })
  }

  const tryPlace = (): void => {
    if (root !== undefined && !root.isConnected) {
      root = undefined
      placed = false
    }
    if (placed) {
      if (document.body.contains(entry)) return
      placed = false
    }
    root ??= sidebarRoot()
    if (root === undefined) {
      observeBroad()
      return
    }
    placed = placeEntry(root, entry, options)
    if (placed) observeNarrow(root)
  }

  const unsubscribeActive = options.active === undefined ? undefined : (() => {
    const syncActive = (): void => {
      if (options.active!.isOpen()) entry.dataset.active = 'true'
      else delete entry.dataset.active
    }
    const unsubscribe = options.active.subscribe(syncActive)
    syncActive()
    return unsubscribe
  })()

  tryPlace()
  if (root === undefined) observeBroad()

  return () => {
    observer.disconnect()
    if (frameId !== null) {
      cancelFrame(frameId)
      frameId = null
    }
    unsubscribeActive?.()
    entry.remove()
  }
}
