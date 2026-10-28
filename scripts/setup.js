import { readFileSync, writeFileSync, existsSync, chmodSync } from 'node:fs';
import { resolve } from 'node:path';
import { randomBytes } from 'node:crypto';
import { projectRoot } from '../src/config.js';

if (!process.stdin.isTTY) { console.error('Uruchom npm run setup w swoim terminalu. Klucz jest wprowadzany bez wyświetlania.'); process.exit(1); }
console.log('Wklej klucz Garmin Personal API i naciśnij Enter (wpisywanie jest ukryte). Ctrl+C anuluje.');
process.stdin.setRawMode(true);
process.stdin.setEncoding('utf8');
process.stdin.resume();
let secret = '';
process.stdin.on('data', chunk => {
  for (const char of chunk) {
    if (char === '\u0003') { process.stdin.setRawMode(false); process.exit(130); }
    if (char === '\r' || char === '\n') {
      if (!/^GCDC_[A-Za-z0-9._-]{20,}$/.test(secret)) {
        secret = ''; console.error('Nieprawidłowy format klucza. Wklej sam klucz Garmin, bez spacji.'); return;
      }
      process.stdin.setRawMode(false);
      const path = resolve(projectRoot, '.env');
      let contents = existsSync(path) ? readFileSync(path, 'utf8') : readFileSync(resolve(projectRoot, '.env.example'), 'utf8');
      contents = contents.replace(/^GARMIN_API_KEY=.*$/m, `GARMIN_API_KEY=${secret}`);
      if (!/^GARMIN_API_KEY=/m.test(contents)) contents += `\nGARMIN_API_KEY=${secret}\n`;
      if (!/^MCP_ACCESS_TOKEN=.+$/m.test(contents)) {
        const line = `MCP_ACCESS_TOKEN=${randomBytes(32).toString('hex')}`;
        contents = /^MCP_ACCESS_TOKEN=/m.test(contents) ? contents.replace(/^MCP_ACCESS_TOKEN=.*$/m, line) : `${contents}\n${line}\n`;
      }
      writeFileSync(path, contents, { mode: 0o600 }); chmodSync(path, 0o600);
      secret = '';
      console.log('Zapisano .env z uprawnieniami 600. Gotowe: npm start lub npm run start:http.');
      process.exit(0);
    }
    if (char === '\u007f' || char === '\b') secret = secret.slice(0, -1);
    else if (char >= ' ' && secret.length < 2048) secret += char;
  }
});
