/**
 * Slot wiring tests. The host renders these seats, so the contract we pin here is
 * the registration shape: seat names, panel key, ids and the graceful fallback when
 * a host exposes no slots service.
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
    open() {
      this.opened += 1
    },
    getSnapshot() {
      return { alarms: [] }
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

test('registers main, panellist, badge and footer on a slots host', () => {
  const { slots, registrations } = captureSlots()
  const dispose = registerQuotaSlots(
    { slots },
    { react: fakeReact(), controller: fakeController(), t: (key) => String(key), selectPanel: () => {} },
  )

  const names = registrations.map((row) => row.spec.name)
  assert.deepEqual(names, ['main', 'sidebar.panellist', 'sidebar.toggle.badge', 'sidebar.footer.action'])

  const main = registrations.find((row) => row.spec.name === 'main')
  assert.equal(main.spec.key, PANEL_ID)
  assert.equal(main.spec.locale, LOCALE_NS)

  const panellist = registrations.find((row) => row.spec.name === 'sidebar.panellist')
  assert.equal(panellist.spec.id, PANEL_ID)
  assert.equal(panellist.spec.label(), 'entry')

  assert.equal(typeof dispose, 'function')
})

test('omits the footer shortcut when the layout service is unavailable', () => {
  const { slots, registrations } = captureSlots()
  registerQuotaSlots({ slots }, { react: fakeReact(), controller: fakeController(), t: (key) => String(key) })
  assert.ok(!registrations.some((row) => row.spec.name === 'sidebar.footer.action'))
})

test('the panellist component renders the gauge icon at the requested size', () => {
  const { slots, registrations } = captureSlots()
  registerQuotaSlots(
    { slots },
    { react: fakeReact(), controller: fakeController(), t: (key) => String(key), selectPanel: () => {} },
  )
  const icon = registrations.find((row) => row.spec.name === 'sidebar.panellist').component
  const tree = icon({ size: 16, active: true })
  assert.equal(tree.type, 'svg')
  assert.equal(tree.props.width, 16)
})

test('the badge renders nothing without alarms', () => {
  const { slots, registrations } = captureSlots()
  registerQuotaSlots(
    { slots },
    { react: fakeReact(), controller: fakeController(), t: (key) => String(key), selectPanel: () => {} },
  )
  const badge = registrations.find((row) => row.spec.name === 'sidebar.toggle.badge').component
  assert.equal(badge(), null)
})

test('the badge shows the alarm count when alarms exist', () => {
  const { slots, registrations } = captureSlots()
  const controller = fakeController()
  controller.getSnapshot = () => ({ alarms: [{}, {}, {}] })
  registerQuotaSlots(
    { slots },
    { react: fakeReact(), controller, t: (key) => String(key), selectPanel: () => {} },
  )
  const badge = registrations.find((row) => row.spec.name === 'sidebar.toggle.badge').component
  const tree = badge()
  assert.equal(tree.type, 'span')
  assert.equal(tree.children[0], '3')
})

test('disposer releases every registration', () => {
  const { slots, disposed } = captureSlots()
  const dispose = registerQuotaSlots(
    { slots },
    { react: fakeReact(), controller: fakeController(), t: (key) => String(key), selectPanel: () => {} },
  )
  dispose()
  assert.deepEqual(disposed.sort(), ['main', 'sidebar.footer.action', 'sidebar.panellist', 'sidebar.toggle.badge'].sort())
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
