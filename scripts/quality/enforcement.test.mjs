import { test } from 'node:test';
import assert from 'node:assert/strict';
import { numericFindings } from './analysis.mjs';
import { selectFunctions } from './selection.mjs';
import { budgetChanges, siteAllowed } from './baselines.mjs';
import { coverageResults } from './coverage.mjs';
const policy={functions:{complexity:10,cognitive:10,depth:3,lines:5,parameters:4}};
test('unsuppressed numeric findings attach to whole selected function, not diagnostic changed lines',async()=>{
 const source='/* eslint-disable */\nfunction legacy(x) {\n'+Array.from({length:11},(_,i)=>`  if (x === ${i}) return ${i};`).join('\n')+'\n}\nfunction untouched() {\n'+ '  console.log(1);\n'.repeat(8)+'}\n';
 const selected=selectFunctions(source.replace('return 0','return -1'),source,[{oldStart:3,oldCount:1,newStart:3,newCount:1}]);
 const failures=await numericFindings(source,selected,policy,'fixture.ts');
 assert.ok(failures.some(f=>f.rule==='complexity'&&f.measured===12&&f.limit===10&&f.function==='legacy'));
 assert.ok(failures.every(f=>f.function==='legacy'));
 assert.ok(failures.some(f=>f.rule==='max-lines-per-function'));
});
test('budget additions/increases fail, decreases pass, identical renames preserve allowances',()=>{
 const before={'old.ts':{complexity:{count:2}}};
 assert.equal(budgetChanges(before,{'old.ts':{complexity:{count:3}}},[]).filter(c=>c.failure).length,1);
 assert.equal(budgetChanges(before,{'old.ts':{complexity:{count:1}}},[]).filter(c=>c.failure).length,0);
 assert.equal(budgetChanges(before,{'new.ts':{complexity:{count:2}}},[{oldPath:'old.ts',path:'new.ts',unchanged:true}]).filter(c=>c.failure).length,0);
 assert.equal(budgetChanges(before,{'new.ts':{complexity:{count:2}}},[{oldPath:'old.ts',path:'new.ts',unchanged:false}]).filter(c=>c.failure).length,1);
});
test('suppression counts follow an import-only rename whose dependency keeps its identity',()=>{
 const before={'apps/old.ts':{'max-lines-per-function':{count:2}}};
 const after={'apps/world/new.ts':{'max-lines-per-function':{count:2}}};
 const source='import { value } from "./helper.js";\nexport const current = () => value;\n';
 const files=[{status:'R090',oldPath:'apps/old.ts',path:'apps/world/new.ts',unchanged:false,
  before:source,after:source.replace('./helper.js','../helper.js')}];
 const trees={beforePaths:new Set(['apps/old.ts','apps/helper.ts']),afterPaths:new Set(['apps/world/new.ts','apps/helper.ts'])};
 assert.deepEqual(budgetChanges(before,after,files,trees),[]);
});
test('site allowances require unchanged one-to-one source occurrence and cannot hide copies',()=>{
 const base='const a = x - x;\nconst b = 1;\n';
 const site={rule:'sonarjs/no-identical-expressions',path:'f.ts',line:1,column:11,anchor:'const a = x - x;'};
 assert.equal(siteAllowed(site,{...site},{before:base,after:base,hunks:[]}),true);
 assert.equal(siteAllowed(site,{...site,line:3},{before:base,after:base+'const a = x - x;\n',hunks:[{oldStart:2,oldCount:0,newStart:3,newCount:1}]}),false);
 assert.equal(siteAllowed(site,{...site},{before:base,after:base.replace('a','c'),hunks:[{oldStart:1,oldCount:1,newStart:1,newCount:1}]}),false);
});
test('all package metrics required, inclusive floors, invalid and missing summaries fail',()=>{
 const coverage={a:{path:'a',lines:80,branches:70,functions:60,statements:80},b:{path:'b',lines:80,branches:70,functions:60,statements:80}};
 const total={lines:{pct:80},branches:{pct:70},functions:{pct:60},statements:{pct:80}};
 assert.equal(coverageResults(coverage,{a:{total},b:{total}}).filter(r=>r.failure).length,0);
 assert.ok(coverageResults(coverage,{a:{total:{...total,lines:{pct:79}}},b:{total}}).some(r=>r.failure&&r.package==='a'));
 for(const reports of [{},{a:{total:{}}},{a:{total:{...total,lines:{pct:'Unknown'}}}}]) assert.ok(coverageResults(coverage,reports).some(r=>r.failure));
});
test('an unchanged diagnostic line cannot retain an allowance after its owning function changes', async()=>{
 const {siteRecord}=await import('./baselines.mjs');
 const before='function f(x) {\n  return x - x;\n}\n';
 const after=before.replace('x - x','x - x + 1');
 const message={ruleId:'sonarjs/no-identical-functions',line:1,column:1};
 const old=siteRecord('f.ts',message,before),current=siteRecord('f.ts',message,after);
 assert.equal(siteAllowed(old,current,{before,after,hunks:[{oldStart:2,oldCount:1,newStart:2,newCount:1}]}),false);
});
test('unavailable diff hunks cannot silently exempt a changed production file',async()=>{
 const {checkChangedFunctions}=await import('./gate-source.mjs');
 await assert.rejects(checkChangedFunctions({files:[{path:'apps/f.ts',before:'const f = () => 1;',after:'const f = () => 2;',hunks:[],unchanged:false}]},policy),/hunk/i);
});
test('site ledger decreases are reported without failing the gate',async()=>{
 const {siteChanges}=await import('./gate-sites.mjs');
 const site={rule:'smell',path:'f.ts',line:1,column:1,anchor:'f();'};
 const changes=siteChanges([site],[]);
 assert.equal(changes.length,1);assert.equal(changes[0].failure,false);assert.equal(changes[0].change,'removed');
});
test('nesting and parameter failures expose actual measurements; 20-to-12 cognitive improvement still fails',async()=>{
 const {inventory}=await import('./selection.mjs');
 const nested='function f(a) { if(a) { if(a.b) { if(a.b.c) { if(a.b.c.d) { return 1; } } } } }';
 const depth=await numericFindings(nested,inventory(nested),policy,'fixture.ts');
 assert.ok(depth.some(f=>f.rule==='max-depth'&&f.measured===4&&f.limit===3));
 const args='const f = (a,b,c,d,e) => [a,b,c,d,e];';
 assert.ok((await numericFindings(args,inventory(args),policy,'fixture.ts')).some(f=>f.rule==='max-params'&&f.measured===5));
 const make=count=>'function f(x) {\n'+Array.from({length:count},(_,i)=>` if(x === ${i}) return ${i};`).join('\n')+'\n}';
 const after=make(12),before=make(20),selected=selectFunctions(before,after,[{oldStart:14,oldCount:8,newStart:13,newCount:0}]);
 assert.ok((await numericFindings(after,selected,policy,'fixture.ts')).some(f=>f.rule==='sonarjs/cognitive-complexity'&&f.measured===12&&f.limit===10));
});
test('same-count replacement cannot transfer a legacy numeric allowance to a new function',async()=>{
 const body='  console.log(1);\n'.repeat(8);
 const before='function oldFunction() {\n'+body+'}\n';
 const after='function newFunction() {\n'+body+'}\n';
 const selected=selectFunctions(before,after,[{oldStart:1,oldCount:1,newStart:1,newCount:1}]);
 const findings=await numericFindings(after,selected,policy,'fixture.ts');
 assert.ok(findings.some(f=>f.function==='newFunction'&&f.rule==='max-lines-per-function'&&f.measured===10));
});
test('ambiguous duplicate legacy occurrences fail with explicit inspect/prune guidance',async t=>{
 const {mkdtempSync,writeFileSync,rmSync}=await import('node:fs');const {tmpdir}=await import('node:os');const {join}=await import('node:path');
 const {checkSites}=await import('./gate-sites.mjs');const {siteRecord}=await import('./baselines.mjs');
 const cwd=mkdtempSync(join(tmpdir(),'quality-ambiguous-'));t.after(()=>rmSync(cwd,{recursive:true,force:true}));
 const source='export const f = x => x - x;\n',message={ruleId:'sonarjs/no-identical-expressions',line:1,column:source.indexOf('x - x')+1};
 writeFileSync(join(cwd,'f.mjs'),source);const site=siteRecord('f.mjs',message,source);
 const results=checkSites([{filePath:join(cwd,'f.mjs'),messages:[message]}],{cwd,comparison:{files:[{path:'f.mjs',oldPath:'f.mjs',before:source,after:source,hunks:[]}]},sites:[site,site],headSites:[site,site]});
 assert.equal(results.length,1);assert.match(results[0].message,/ambiguous.*prune/i);
});
