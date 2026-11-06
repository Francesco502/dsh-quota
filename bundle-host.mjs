/**
 * Host-side bundler: src/host-entry.ts -> lib/index.js (ESM, Node).
 *
 * esbuild replaces the old hand-concatenation (regex import stripping +
 * stripTypeScriptTypes). The bundle keeps every named export the tests and
 * downstream tooling import, and emits a source map next to it.
 */
import { build } from 'esbuild'
import { mkdirSync, readFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const baseDir = fileURLToPath(new URL('.', import.meta.url))
mkdirSync(join(baseDir, 'lib'), { recursive: true })

const pkg = JSON.parse(readFileSync(join(baseDir, 'package.json'), 'utf8'))

await build({
  absWorkingDir: baseDir,
  entryPoints: ['src/host-entry.ts'],
  outfile: 'lib/index.js',
  bundle: true,
  format: 'esm',
  platform: 'node',
  target: ['node22'],
  sourcemap: 'external',
  external: ['node:*'],
  legalComments: 'none',
  charset: 'utf8',
  logLevel: 'warning',
  define: {
    __DSH_QUOTA_VERSION__: JSON.stringify(pkg.version),
  },
})

// Gate: the bundle must still be valid ESM with the public exports.
const bundle = readFileSync(join(baseDir, 'lib/index.js'), 'utf8')
for (const name of ['apply', 'VERSION', 'QuotaManager', 'CustomApiProvider']) {
  if (!new RegExp(`\\b${name}\\b`).test(bundle)) {
    console.error(`[bundle-host] gate failed: missing export "${name}"`)
    process.exit(1)
  }
}

console.log(`Successfully built lib/index.js + map (v${pkg.version})`)
