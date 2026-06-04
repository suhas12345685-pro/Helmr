import { readFile } from 'node:fs/promises';
const pkg = JSON.parse(await readFile('package.json','utf8'));
if (!pkg.version || !/^\d+\.\d+\.\d+/.test(pkg.version)) throw new Error('package.json version must be semver-like');
await readFile('CHANGELOG.md','utf8');
console.log(`Release metadata valid for helmr ${pkg.version}`);
