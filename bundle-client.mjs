// Inline the time helpers into the single client module: a dynamic browser
// entry cannot require a sibling module, so the helpers are concatenated.
import { stripTypeScriptTypes } from 'node:module'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { Script } from 'node:vm'

const root = fileURLToPath(new URL('.', import.meta.url))
const strip = file => stripTypeScriptTypes(readFileSync(join(root, file), 'utf8')).replace(/[\t ]+$/gm, '')

const helperModules = [['format-time', 'client-time'], ['peak-hours', 'client-peak-hours']]
const helperEsm = helperModules.map(([name]) => strip(`src/client/${name}.ts`))
const helpers = helperEsm.join('\n').replace(/^export (function|const) /gm, '$1 ')
const secure = strip('src/client/secure.ts')
  .replace(/^import \{ formatStamp, sinceUpdate, untilReset \}.*\n/m, '')
  .replace(/^import \{ beijingClock, isPeakTime \}.*\n/m, '')
  .replace(/^export /gm, '')
mkdirSync(join(root, 'lib'), { recursive: true })

const clientPath = join(root, 'lib/client.js')
const bundle = `window.__ModuleLoader__.load({\n  id: '@francescoli/dsh-quota',\n  factory(require) {\n${helpers}\n${secure}\n    return createClient(require)\n  }\n})\n`
new Script(bundle, { filename: clientPath })
if (!existsSync(clientPath) || readFileSync(clientPath, 'utf8') !== bundle) writeFileSync(clientPath, bundle)

// ESM copies of the same helpers, so the unit tests exercise shipped code.
for (const [index, [, output]] of helperModules.entries()) {
  const timePath = join(root, `lib/${output}.js`)
  if (!existsSync(timePath) || readFileSync(timePath, 'utf8') !== helperEsm[index]) writeFileSync(timePath, helperEsm[index])
}

console.log('Built safe Sidebar Client module')
