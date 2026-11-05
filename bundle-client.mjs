import { stripTypeScriptTypes } from 'node:module'
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
const root = fileURLToPath(new URL('.', import.meta.url))
const code = stripTypeScriptTypes(readFileSync(join(root, 'src/client/secure.ts'), 'utf8')).replace(/^export /gm, '').replace(/[\t ]+$/gm, '')
mkdirSync(join(root, 'lib'), { recursive: true })
const output = join(root, 'lib/client.js')
const bundle = `window.__ModuleLoader__.load({\n  id: '@francescoli/dsh-quota',\n  factory(require) {\n${code}\n    return createClient(require)\n  }\n})\n`
if (!existsSync(output) || readFileSync(output, 'utf8') !== bundle) writeFileSync(output, bundle)
console.log('Built safe Sidebar Client module')
