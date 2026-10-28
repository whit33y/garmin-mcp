import { readdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

function files(dir) {
  return readdirSync(dir, { withFileTypes: true }).flatMap(entry => entry.isDirectory() ? files(resolve(dir, entry.name)) : entry.name.endsWith('.js') ? [resolve(dir, entry.name)] : []);
}
let failed = false;
for (const path of ['src', 'scripts', 'test'].flatMap(files)) {
  const result = spawnSync(process.execPath, ['--check', path], { encoding: 'utf8' });
  if (result.status !== 0) { process.stderr.write(result.stderr); failed = true; }
}
if (failed) process.exit(1);
console.log('JavaScript syntax OK.');
