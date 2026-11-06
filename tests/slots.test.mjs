/**
 * Slot wiring tests. The host renders these seats, so the contract pinned here is
 * the registration shape: seat names, ids and the graceful fallback when a host
 * exposes no slots service.
 *
 * The dashboard itself keeps the overlay mount (a main-panel seat was evaluated
 * and rejected: the host kept its container hidden, so a panellist entry would
 * open a blank area). The seats we ship are the footer shortcut and the badge.
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

test('registers the footer shortcut and the alert badge', () => {
  const { slots, registrations } = captureSlots()
  const dispose = registerQuotaSlots(
    { slots },
    { react: fakeReact(), controller: fakeController(), t: (key) => String(key) },
  )

  assert.deepEqual(
    registrations.map((row) => row.spec.name),
    ['sidebar.toggle.badge', 'sidebar.footer.action'],
  )
  const footer = registrations.find((row) => row.spec.name === 'sidebar.footer.action')
  assert.equal(footer.spec.id, 'dsh-quota-footer')
  assert.equal(footer.spec.locale, LOCALE_NS)
  assert.equal(typeof dispose, 'function')
})

test('the footer shortcut toggles the overlay panel', () => {
  const { slots, registrations } = captureSlots()
  const controller = fakeController()
  registerQuotaSlots({ slots }, { react: fakeReact(), controller, t: (key) => String(key) })

  const footer = registrations.find((row) => row.spec.name === 'sidebar.footer.action').component
  const tree = footer({ wide: true })
  tree.props.onClick()
  assert.equal(controller.opened, 1)
  tree.props.onClick()
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
  assert.deepEqual(disposed.sort(), ['sidebar.footer.action', 'sidebar.toggle.badge'].sort())
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
