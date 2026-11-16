/**
 * Slot wiring tests. The host renders these seats, so the contract pinned here is
 * the registration shape: seat names, ids, main-panel key and the graceful
 * fallback when a host exposes no slots service.
 *
 * 0.4.4 promotes the dashboard from the conversation-column overlay to a
 * first-class panel: `sidebar.panellist` supplies the navigation row and the
 * keyed `main` seat supplies the content. Footer actions are deliberately not
 * registered (v0.4.5): the panel row already reaches the dashboard.
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

test('registers the global panel row, main content and alert badge', () => {
  const { slots, registrations } = captureSlots()
  const dispose = registerQuotaSlots(
    { slots },
    { react: fakeReact(), controller: fakeController(), t: (key) => String(key) },
  )

  assert.deepEqual(
    registrations.map((row) => row.spec.name),
    ['sidebar.panellist', 'main', 'sidebar.toggle.badge'],
  )

  const panel = registrations.find((row) => row.spec.name === 'sidebar.panellist')
  assert.equal(panel.spec.id, PANEL_ID)
  assert.equal(panel.spec.order, 10)
  assert.equal(panel.spec.locale, LOCALE_NS)
  assert.equal(panel.spec.label(), 'footer.open')

  const main = registrations.find((row) => row.spec.name === 'main')
  assert.equal(main.spec.key, PANEL_ID)

  assert.equal(registrations.some((row) => row.spec.name === 'sidebar.footer.action'), false)
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
    ['sidebar.panellist', 'main', 'sidebar.toggle.badge'].sort(),
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

test('locale keeps Chinese when a reloaded namespace rejects duplicate registration', () => {
  // v0.4.6: the host owns locale namespaces per page; a re-applied plugin gets
  // "already has locale" from register. That must not strand the zh dictionary
  // and surface "Quota Monitor" in a Chinese shell.
  const ctx = {
    locale: {
      register() {
        throw new Error('locale namespace "dsh-quota" already has locale "zh"')
      },
      bind() {
        // The host's own translate falls back to English per key; the plugin's
        // zh dictionary is authoritative for our own strings.
        return (key) => (key === 'footer.open' ? 'Quota Monitor' : key)
      },
      getSnapshot() {
        return { active: 'zh' }
      },
    },
  }
  const t = registerQuotaLocale(ctx)
  assert.equal(t('footer.open'), '额度监控')
  assert.equal(t('entry'), '额度监控')
})

test('locale follows the host when it renders English', () => {
  const ctx = {
    locale: {
      register() {},
      bind() {
        return (key) => (key === 'footer.open' ? 'Quota Monitor' : key)
      },
      getSnapshot() {
        return { active: 'en' }
      },
    },
  }
  const t = registerQuotaLocale(ctx)
  assert.equal(t('footer.open'), 'Quota Monitor')
})

test('locale falls back to English when the host has no locale service', () => {
  const t = registerQuotaLocale({})
  assert.equal(t('entry'), 'Quota Monitor')
  assert.equal(t('badge.alarmsCount', { count: 3 }), '3 quota alerts')
})
