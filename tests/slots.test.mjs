/**
 * Slot wiring tests. The host renders these seats, so the contract pinned here is
 * the registration shape: seat names, ids, main-panel key and the graceful
 * fallback when a host exposes no slots service.
 *
 * 0.4.4 promotes the dashboard from the conversation-column overlay to a
 * first-class panel: `sidebar.panellist` supplies the navigation row and the
 * keyed `main` seat supplies the content. The footer shortcut remains for hosts
 * that still render it (dsh-claude-style hides it), and panel selection goes
 * through `ctx.layout.selectPanel`.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import { PANEL_ID, registerQuotaSlots } from '../src/client/slots.ts'
import { LOCALE_NS, registerQuotaLocale } from '../src/client/locale.ts'

function fakeReact() {
  return {
    createElement: (type, props, ...children) => ({ type, props, children }),
    useRef: () => ({ current: null }),
    useEffect: () => {},
    useState: (initial) => [typeof initial === 'function' ? initial() : initial, () => {}],
  }
}

function fakeController() {
  return {
    opened: 0,
    closed: 0,
    panelOpen: false,
    open() {
      this.opened += 1
      this.panelOpen = true
    },
    close() {
      this.closed += 1
      this.panelOpen = false
    },
    toggle() {
      if (this.panelOpen) this.close()
      else this.open()
    },
    getSnapshot() {
      return { alarms: [], panelOpen: this.panelOpen }
    },
    subscribe() {
      return () => {}
    },
  }
}

function captureSlots() {
  const registrations = []
  const disposed = []
  const slots = {
    register(spec, component) {
      registrations.push({ spec, component })
      return () => disposed.push(spec.name)
    },
    inject(_name, callback) {
      const result = callback()
      return () => {
        if (typeof result === 'function') result()
      }
    },
  }
  return { slots, registrations, disposed }
}

test('does nothing when the host exposes no slots service', () => {
  const dispose = registerQuotaSlots({}, { react: fakeReact(), controller: fakeController(), t: (key) => String(key) })
  assert.equal(dispose, undefined)
})

test('registers the global panel row, main content, footer shortcut and alert badge', () => {
  const { slots, registrations } = captureSlots()
  const dispose = registerQuotaSlots(
    { slots },
    { react: fakeReact(), controller: fakeController(), t: (key) => String(key) },
  )

  assert.deepEqual(
    registrations.map((row) => row.spec.name),
    ['sidebar.panellist', 'main', 'sidebar.toggle.badge', 'sidebar.footer.action'],
  )

  const panel = registrations.find((row) => row.spec.name === 'sidebar.panellist')
  assert.equal(panel.spec.id, PANEL_ID)
  assert.equal(panel.spec.order, 10)
  assert.equal(panel.spec.locale, LOCALE_NS)
  assert.equal(panel.spec.label(), 'footer.open')

  const main = registrations.find((row) => row.spec.name === 'main')
  assert.equal(main.spec.key, PANEL_ID)

  const footer = registrations.find((row) => row.spec.name === 'sidebar.footer.action')
  assert.equal(footer.spec.id, 'dsh-quota-footer')
  assert.equal(footer.spec.locale, LOCALE_NS)
  assert.equal(typeof dispose, 'function')
})

test('the panel icon reuses the gauge glyph at the host-provided size', () => {
  const { slots, registrations } = captureSlots()
  registerQuotaSlots({ slots }, { react: fakeReact(), controller: fakeController(), t: (key) => String(key) })
  const icon = registrations.find((row) => row.spec.name === 'sidebar.panellist').component
  const tree = icon({ size: 20 })
  assert.equal(tree.type, 'svg')
  assert.equal(tree.props.width, 20)
  assert.equal(tree.props.height, 20)
})

test('the main panel renders the dashboard host div', () => {
  const { slots, registrations } = captureSlots()
  registerQuotaSlots({ slots }, { react: fakeReact(), controller: fakeController(), t: (key) => String(key) })
  const panel = registrations.find((row) => row.spec.name === 'main').component
  const tree = panel()
  assert.equal(tree.type, 'div')
  assert.equal(tree.props.className, 'dsh-quota-slot-panel')
  assert.ok(tree.props.ref && typeof tree.props.ref === 'object')
})

test('the footer shortcut selects the registered panel in slot mode', () => {
  const { slots, registrations } = captureSlots()
  const controller = fakeController()
  const selected = []
  registerQuotaSlots(
    { slots },
    {
      react: fakeReact(),
      controller,
      t: (key) => String(key),
      selectPanel: (id) => selected.push(id),
    },
  )

  const footer = registrations.find((row) => row.spec.name === 'sidebar.footer.action').component
  footer({ wide: true }).props.onClick()
  assert.deepEqual(selected, [PANEL_ID])
  assert.equal(controller.opened, 0, 'slot mode must not toggle the legacy overlay')
})

test('the footer shortcut keeps the legacy overlay toggle when no layout service exists', () => {
  const { slots, registrations } = captureSlots()
  const controller = fakeController()
  registerQuotaSlots({ slots }, { react: fakeReact(), controller, t: (key) => String(key) })

  const footer = registrations.find((row) => row.spec.name === 'sidebar.footer.action').component
  footer({ wide: true }).props.onClick()
  assert.equal(controller.opened, 1)
  footer({ wide: true }).props.onClick()
  assert.equal(controller.closed, 1)
})

test('the footer renders its label when wide and hides it on the rail', () => {
  const { slots, registrations } = captureSlots()
  registerQuotaSlots({ slots }, { react: fakeReact(), controller: fakeController(), t: (key) => String(key) })
  const footer = registrations.find((row) => row.spec.name === 'sidebar.footer.action').component
  assert.equal(footer({ wide: true }).props['data-wide'], 'true')
  assert.equal(footer({ wide: false }).props['data-wide'], 'false')
})

test('the badge renders nothing without alarms', () => {
  const { slots, registrations } = captureSlots()
  registerQuotaSlots({ slots }, { react: fakeReact(), controller: fakeController(), t: (key) => String(key) })
  const badge = registrations.find((row) => row.spec.name === 'sidebar.toggle.badge').component
  assert.equal(badge(), null)
})

test('the badge shows the alarm count when alarms exist', () => {
  const { slots, registrations } = captureSlots()
  const controller = fakeController()
  controller.getSnapshot = () => ({ alarms: [{}, {}, {}], panelOpen: false })
  registerQuotaSlots({ slots }, { react: fakeReact(), controller, t: (key) => String(key) })
  const badge = registrations.find((row) => row.spec.name === 'sidebar.toggle.badge').component
  const tree = badge()
  assert.equal(tree.type, 'span')
  assert.equal(tree.children[0], '3')
})

test('disposer releases every registration', () => {
  const { slots, disposed } = captureSlots()
  const dispose = registerQuotaSlots({ slots }, { react: fakeReact(), controller: fakeController(), t: (key) => String(key) })
  dispose()
  assert.deepEqual(
    disposed.sort(),
    ['sidebar.panellist', 'main', 'sidebar.toggle.badge', 'sidebar.footer.action'].sort(),
  )
})

test('locale registers both baseline dictionaries and returns a bound translator', () => {
  const registered = []
  const ctx = {
    locale: {
      register(ns, dict) {
        registered.push({ ns, dict })
      },
      bind() {
        return (key, params) => `${key}:${params?.count ?? ''}`
      },
    },
  }
  const t = registerQuotaLocale(ctx)
  assert.equal(registered.length, 1)
  assert.equal(registered[0].ns, LOCALE_NS)
  assert.ok(registered[0].dict.zh && registered[0].dict.en)
  assert.equal(t('entry'), 'entry:')
})

test('locale falls back to English when the host has no locale service', () => {
  const t = registerQuotaLocale({})
  assert.equal(t('entry'), 'Quota Monitor')
  assert.equal(t('badge.alarmsCount', { count: 3 }), '3 quota alerts')
})
