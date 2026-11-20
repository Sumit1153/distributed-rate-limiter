import { readFileSync } from 'node:fs';

/** Small .env loader for a zero-dependency local Node.js setup. Existing shell variables win. */
export function loadDotEnv(file = '.env', env = process.env) {
  let content;
  try { content = readFileSync(file, 'utf8'); }
  catch (error) { if (error.code === 'ENOENT') return; throw error; }
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith('#')) continue;
    const separator = trimmed.indexOf('=');
    if (separator < 1) continue;
    const key = trimmed.slice(0, separator).trim();
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(key) || env[key] !== undefined) continue;
    let value = trimmed.slice(separator + 1).trim();
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1,-1);
    env[key] = value;
  }
}
