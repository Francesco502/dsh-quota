import test from 'node:test'
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { runInNewContext } from 'node:vm'

test('browser bundle registers and imports the quota plugin as a classic script', () => {
  const registrations = []
  const bundle = readFileSync(new URL('../lib/client.js', import.meta.url), 'utf8')
  runInNewContext(bundle, {
    window: { __ModuleLoader__: { load(entry) { registrations.push(entry) } } },
  }, { filename: 'client.js' })

  assert.equal(registrations.length, 1)
  const [registration] = registrations
  assert.equal(registration.id, '@francescoli/dsh-quota')
  const plugin = registration.factory(specifier => {
    assert.equal(specifier, 'react')
    return {}
  })
  assert.deepEqual(Array.from(plugin.inject), ['slots', 'sidebarRightTabs', 'locale'])
  assert.equal(typeof plugin.apply, 'function')
})
