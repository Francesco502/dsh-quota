import { stripTypeScriptTypes } from 'node:module'
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'

const baseDir = fileURLToPath(new URL('.', import.meta.url))
const files = [
  'src/client/sidebar-entry-core.ts',
  'src/client/sidebar-entry.ts',
  'src/client/api.ts',
  'src/client/controller.ts',
  'src/client/view.ts',
  'src/client/hud.ts',
  'src/client/mount.ts',
  'src/client/index.ts',
]

let combined = ''
for (const f of files) {
  let content = readFileSync(join(baseDir, f), 'utf8')
  // remove import statements
  content = content.replace(/import\s+[^;]+from\s+['"][^'"]+['"];?/g, '')
  // remove export statements but keep declarations
  content = content.replace(/export\s+(class|function|const|let|var|type|interface)\s+/g, '$1 ')
  combined += '\n' + content
}

const cleanJs = stripTypeScriptTypes(combined)

const bundle = `window.__ModuleLoader__.load({
  id: "dsh-quota",
  factory: (require) => {
    var module = { exports: {} };
    var exports = module.exports;
    Object.defineProperty(exports, Symbol.toStringTag, { value: "Module" });

${cleanJs}

    exports.apply = apply;
    exports.VERSION = VERSION;
    return module.exports;
  }
});`

mkdirSync(join(baseDir, 'lib'), { recursive: true })
writeFileSync(join(baseDir, 'lib/client.js'), bundle, 'utf8')
console.log('Successfully built updated client.js bundle!')
