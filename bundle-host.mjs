// Dependency-free, auditable per-module TypeScript build. Only the new native
// path is shipped; legacy raw routes/providers are deliberately not reachable.
import { stripTypeScriptTypes } from 'node:module'
import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync } from 'node:fs'
import { join, dirname } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('.', import.meta.url))
const files = ['src/index.ts', ...readdirSync(join(root, 'src/harness')).filter(f => f.endsWith('.ts')).map(f => `src/harness/${f}`)]
for (const source of files) {
  const output = join(root, source.replace(/^src\//, 'lib/').replace(/\.ts$/, '.js'))
  const code = stripTypeScriptTypes(readFileSync(join(root, source), 'utf8'))
    .replace(/(from\s+['"]\.[^'"]*)\.ts(['"])/g, '$1.js$2').replace(/[\t ]+$/gm, '')
  mkdirSync(dirname(output), { recursive: true })
  if (!existsSync(output) || readFileSync(output, 'utf8') !== code) writeFileSync(output, code)
}
console.log(`Built ${files.length} Harness-native Host modules`)
