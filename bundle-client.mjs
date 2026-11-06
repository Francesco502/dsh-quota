/**
 * Client-side bundler: src/client/index.ts -> lib/client.js (classic script).
 *
 * The host loads plugin bundles with a plain `<script src>` and exposes exactly
 * one global entry, `window.__ModuleLoader__.load({ id, factory })`. Two rules
 * follow from that and are enforced by the gate at the bottom:
 *
 *  1. the whole bundle must stay inside an IIFE, so re-executing it (HMR,
 *     duplicate script tag, host retry) cannot redeclare top-level bindings;
 *  2. it must register exactly one canonical id, and stay inert when the host
 *     rejects a duplicate registration instead of aborting the batch.
 */
import { build } from 'esbuild'
import vm from 'node:vm'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const baseDir = fileURLToPath(new URL('.', import.meta.url))
const pkg = JSON.parse(readFileSync(join(baseDir, 'package.json'), 'utf8'))
const moduleId = pkg.name

mkdirSync(join(baseDir, 'lib'), { recursive: true })

const banner = `(function () {
var factory = (require) => {
var module = { exports: {} };
var exports = module.exports;
Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });
`

const footer = `
return module.exports;
};
if (typeof window !== 'undefined' && window.__ModuleLoader__) {
  try {
    window.__ModuleLoader__.load({ id: ${JSON.stringify(moduleId)}, factory: factory });
  } catch (error) {
    // A duplicate registration means this bundle already ran. Re-throwing would abort
    // the page's plugin sync with "loaded without registering", which is worse than
    // keeping the factory that is already registered.
    if (!/duplicate factory registration/.test(String(error && error.message))) throw error;
  }
}
})();
`

const result = await build({
  absWorkingDir: baseDir,
  entryPoints: ['src/client/index.ts'],
  outfile: 'lib/client.js',
  bundle: true,
  format: 'cjs',
  platform: 'browser',
  target: ['es2020'],
  sourcemap: 'external',
  // React is a seed word in the host module table; never inline it.
  external: ['react', 'react/jsx-runtime'],
  banner: { js: banner },
  footer: { js: footer },
  legalComments: 'none',
  charset: 'utf8',
  write: false,
  logLevel: 'warning',
})

const jsFile = result.outputFiles.find((f) => f.path.endsWith('.js'))
const mapFile = result.outputFiles.find((f) => f.path.endsWith('.map'))
if (jsFile === undefined) {
  console.error('[bundle-client] gate failed: esbuild produced no js output')
  process.exit(1)
}

// esbuild only appends the sourceMappingURL comment when it writes the file itself;
// with `write: false` we own the write, so add the trailer here.
const body = jsFile.text.endsWith('\n') ? jsFile.text : `${jsFile.text}\n`
const source = body.includes('sourceMappingURL=') ? body : `${body}//# sourceMappingURL=client.js.map\n`
writeFileSync(join(baseDir, 'lib/client.js'), source, 'utf8')
if (mapFile !== undefined) writeFileSync(join(baseDir, 'lib/client.js.map'), mapFile.text, 'utf8')

// ---------------------------------------------------------------- gate
const fail = (message) => {
  console.error(`[bundle-client] gate failed: ${message}`)
  process.exit(1)
}

try {
  new vm.Script(source, { filename: 'lib/client.js' })
} catch (error) {
  fail(`bundle is not a parseable classic script: ${error.message}`)
}

if (!source.trimStart().startsWith('(function () {')) fail('bundle must start with the IIFE wrapper')

const loads = source.match(/__ModuleLoader__\.load\(/g) ?? []
if (loads.length !== 1) fail(`expected exactly 1 registration, found ${loads.length}`)
if (!source.includes(`id: ${JSON.stringify(moduleId)}`)) fail(`registration id must be ${moduleId}`)

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
}
const context = vm.createContext(sandbox)
for (let run = 1; run <= 2; run += 1) {
  try {
    vm.runInContext(source, context, { filename: 'lib/client.js' })
  } catch (error) {
    fail(`execution #${run} threw: ${error.message}`)
  }
}
if (registrations.length !== 1) fail(`after two executions expected 1 registration, got ${registrations.length}`)
if (registrations[0].id !== moduleId) fail(`registered id ${registrations[0].id} !== ${moduleId}`)

const exported = registrations[0].factory((name) => {
  throw new Error(`unexpected require("${name}") during factory materialization`)
})
for (const field of ['apply', 'inject', 'VERSION']) {
  if (exported[field] === undefined) fail(`factory exports.${field} is missing`)
}
if (typeof exported.apply !== 'function') fail('factory exports.apply must be a function')

console.log(`Successfully built lib/client.js + map (v${pkg.version}, ${source.length} bytes)`)
