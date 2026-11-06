/**
 * Bundle contract tests (node --test).
 *
 * These exist because 0.4.0 shipped a client bundle that broke on re-execution:
 * classic scripts share one global lexical scope, so a top-level `const factory`
 * anywhere in the batch makes the second execution a SyntaxError, and the host
 * reports "loaded without registering". Everything here is asserted against the
 * built artifact, not against source text.
 */
import test from 'node:test'
import assert from 'node:assert/strict'
import vm from 'node:vm'
import { readFileSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const clientPath = join(root, 'lib/client.js')
const mapPath = join(root, 'lib/client.js.map')
const hostPath = join(root, 'lib/index.js')

const MODULE_ID = '@francescoli/dsh-quota'

function loadClassic(source) {
  const registrations = []
  const sandbox = {
    window: {
      __ModuleLoader__: {
        load({ id, factory }) {
          if (registrations.some((row) => row.id === id)) {
            throw new Error(`client-modules: duplicate factory registration for "${id}" (bundle executed twice without invalidate?)`)
          }
          registrations.push({ id, factory })
        },
      },
    },
    console,
    setTimeout,
    clearTimeout,
    document: {
      createElement: () => ({ style: {}, setAttribute() {}, appendChild() {}, remove() {} }),
      getElementById: () => null,
      querySelector: () => null,
      head: { appendChild() {} },
      body: { appendChild() {}, contains: () => false },
      addEventListener() {},
      removeEventListener() {},
    },
  }
  sandbox.globalThis = sandbox
  const context = vm.createContext(sandbox)
  return { context, registrations }
}

const clientSource = readFileSync(clientPath, 'utf8')

test('client bundle is a parseable classic script wrapped in an IIFE', () => {
  assert.ok(clientSource.trimStart().startsWith('(function () {'), 'must start with the IIFE wrapper')
  assert.doesNotThrow(() => new vm.Script(clientSource, { filename: 'lib/client.js' }))
})

test('client bundle registers exactly one canonical id', () => {
  const { context, registrations } = loadClassic(clientSource)
  vm.runInContext(clientSource, context, { filename: 'lib/client.js' })
  assert.equal(registrations.length, 1)
  assert.equal(registrations[0].id, MODULE_ID)
})

test('client bundle survives a second classic-script execution', () => {
  const { context, registrations } = loadClassic(clientSource)
  assert.doesNotThrow(() => vm.runInContext(clientSource, context), 'first execution')
  assert.doesNotThrow(() => vm.runInContext(clientSource, context), 'second execution must stay inert')
  assert.equal(registrations.length, 1, 're-execution must not register a second id')
})

test('factory materializes apply/inject/VERSION', () => {
  const { context, registrations } = loadClassic(clientSource)
  vm.runInContext(clientSource, context)
  const mod = registrations[0].factory((name) => {
    throw new Error(`unexpected runtime dependency "${name}"`)
  })
  assert.equal(typeof mod.apply, 'function')
  assert.ok(Array.isArray(mod.inject))
  assert.match(String(mod.VERSION), /^\d+\.\d+\.\d+$/)
})

test('client bundle ships a source map with embedded sources', () => {
  assert.ok(existsSync(mapPath), 'lib/client.js.map must exist')
  const map = JSON.parse(readFileSync(mapPath, 'utf8'))
  assert.equal(map.version, 3)
  assert.ok(map.sources.length >= 5)
  assert.ok(Array.isArray(map.sourcesContent) && map.sourcesContent.length === map.sources.length)
  const viewIndex = map.sources.findIndex((source) => source.endsWith('view.ts'))
  assert.ok(viewIndex >= 0, 'source map must include view.ts')
  assert.ok(clientSource.includes('sourceMappingURL=client.js.map'))
})

test('host bundle keeps the public API surface', async () => {
  assert.ok(existsSync(hostPath), 'lib/index.js must exist')
  const mod = await import(hostPath)
  for (const name of [
    'apply',
    'inject',
    'VERSION',
    'QuotaManager',
    'fetchWithProxy',
    'CustomApiProvider',
    'isQuantified',
  ]) {
    assert.ok(name in mod, `lib/index.js must export ${name}`)
  }
  assert.equal(typeof mod.apply, 'function')
})
