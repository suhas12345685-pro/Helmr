import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';
const suspicious = /(sk-[A-Za-z0-9_-]{20,}|anthropic[_-]?api[_-]?key\s*=\s*[^\s]+)/i;
const skip = new Set(['.git','node_modules','dist','.next']);
let failed = false;
async function walk(dir) {
  for (const entry of await readdir(dir)) {
    if (skip.has(entry)) continue;
    const path = join(dir, entry);
    const s = await stat(path);
    if (s.isDirectory()) await walk(path);
    else if (/\.(ts|js|json|md|yml|yaml|env|txt)$/.test(entry)) {
      const text = await readFile(path, 'utf8').catch(() => '');
      if (suspicious.test(text)) { console.error(`possible secret in ${path}`); failed = true; }
    }
  }
}
await walk('.');
process.exit(failed ? 1 : 0);
