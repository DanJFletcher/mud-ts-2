import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, mkdtempSync, writeFileSync, mkdirSync, rmSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve } from 'node:path';
import { tmpdir } from 'node:os';
test('every workspace adapter emits json-summary and includes untouched production',()=>{
 for(const path of ['packages/engine-core','packages/client-sdk','packages/world-demo','packages/world-orraveth','packages/plugins','packages/ui','apps/server','apps/web']) {
  const config=readFileSync(path+'/vitest.config.ts','utf8');
  assert.match(config,/json-summary/,path);
  assert.match(config,/include: \['src\/\*\*/);
  assert.match(config,/\.d\.ts/);
 }
 const contracts=JSON.parse(readFileSync('engine-contracts/package.json'));
 assert.match(contracts.scripts['test:coverage'],/c8.*--all.*json-summary/);
});
test('c8 and Vitest include an unimported production file with all four metrics',t=>{
 const cwd=mkdtempSync(join(tmpdir(),'quality-coverage-'));
 t.after(()=>rmSync(cwd,{recursive:true,force:true}));
 mkdirSync(join(cwd,'src'));
 writeFileSync(join(cwd,'src','used.js'),'export const used = () => 1;\n');
 writeFileSync(join(cwd,'src','unimported.js'),'export const unused = () => 2;\n');
 writeFileSync(join(cwd,'package.json'),'{"type":"module"}');
 writeFileSync(join(cwd,'check.test.js'),'import {used} from "./src/used.js"; if(used()!==1) throw new Error("fixture");');
 execFileSync(process.execPath,[resolve('node_modules/c8/bin/c8.js'),'--all','--src','src','--include','src/**/*.js','--reporter=json-summary',process.execPath,'--test','check.test.js'],{cwd,stdio:'pipe'});
 const check=()=>{
  const summary=JSON.parse(readFileSync(join(cwd,'coverage/coverage-summary.json')));
  assert.ok(Object.keys(summary).some(path=>path.endsWith('unimported.js')));
  for(const metric of ['lines','branches','functions','statements']) assert.equal(typeof summary.total[metric].pct,'number');
  assert.ok(summary.total.functions.pct<100);
 };
 check();
 writeFileSync(join(cwd,'check.test.js'),'import { test, expect } from "vitest"; import {used} from "./src/used.js"; test("used",()=>expect(used()).toBe(1));');
 // The repository dependency path is explicit; no fixture package installation.
 writeFileSync(join(cwd,'vitest.config.mjs'),`export default { test: { coverage: { provider: 'v8', include: ['src/**/*.js'], reporter: ['json-summary'] } } };`);
 execFileSync(process.execPath,[resolve('node_modules/vitest/vitest.mjs'),'run','--coverage'],{cwd,env:{...process.env,NODE_PATH:resolve('node_modules')},stdio:'pipe'});
 check();
});
