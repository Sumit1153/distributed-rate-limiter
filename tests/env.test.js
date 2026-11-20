import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { loadDotEnv } from '../src/env.js';

test('loads simple .env values and strips comments', () => {
 const dir=mkdtempSync(join(tmpdir(), 'limiter-env-'));
 try {
   const path=join(dir,'.env');
   writeFileSync(path,'# comment\nPORT=9000\nREDIS_URL="redis://127.0.0.1:6379"\n\n');
   const env={};
   loadDotEnv(path, env);
   assert.equal(env.PORT,'9000');
   assert.equal(env.REDIS_URL,'redis://127.0.0.1:6379');
 } finally { rmSync(dir,{recursive:true,force:true}); }
});
test('shell environment has precedence over dotenv', () => {
 const dir=mkdtempSync(join(tmpdir(), 'limiter-env-'));
 try {
   const path=join(dir,'.env');writeFileSync(path,'PORT=7000\n');
   const env={PORT:'8000'};loadDotEnv(path,env);
   assert.equal(env.PORT,'8000');
 } finally { rmSync(dir,{recursive:true,force:true}); }
});
test('missing .env is allowed', () => assert.doesNotThrow(() => loadDotEnv('/nonexistent/dotenv/config',{})));
