import { test } from 'node:test';
import assert from 'node:assert/strict';
import { writeFileSync, renameSync } from 'node:fs';
import { join } from 'node:path';
import { repository } from './tests/repository.mjs';
import { comparison } from './git.mjs';
import { inventory, selectFunctions } from './selection.mjs';
test('explicit revisions, merge base, paths with spaces and byte-identical renames', t=>{
 const r=repository(t,{'old name.ts':'export const f = () => 1;\n'});
 renameSync(join(r.cwd,'old name.ts'),join(r.cwd,'new name.ts'));
 const head=r.commit(); const result=comparison(r.cwd,r.base,head);
 assert.equal(result.base,r.base);assert.equal(result.head,head);
 assert.equal(result.files[0].oldPath,'old name.ts');assert.equal(result.files[0].path,'new name.ts');
 assert.equal(result.files[0].unchanged,true);
 assert.throws(()=>comparison(r.cwd,'missing',head));
 r.git('checkout','-qb','maintenance',r.base);
 writeFileSync(join(r.cwd,'maintenance.ts'),'export const maintenance = 1;');const maintenance=r.commit();
 assert.equal(comparison(r.cwd,maintenance,head).base,r.base);
});
test('inventory includes executable TS/JS function forms and nested ancestors',()=>{
 const source='function* f() { yield 1; }\nconst a = async (x: number): Promise<number> => x;\nconst b = function() {};\nclass C { constructor() {} get x() { return 1; } set x(v) {} m() { return [1].map(n => n+1); } }';
 assert.equal(inventory(source).length,8);
 const chosen=selectFunctions('',source,[{oldStart:0,oldCount:0,newStart:1,newCount:4}]);
 assert.equal(chosen.length,8);
 assert.throws(()=>inventory('function {'));
});
test('body/signature/format edits select containing functions but not shifted neighbors',()=>{
 const before='function outer() {\n  return [1].map(x => x + 1);\n}\nfunction neighbor() {\n  return 1;\n}\n';
 const after=before.replace('x + 1','x + 2');
 assert.deepEqual(selectFunctions(before,after,[{oldStart:2,oldCount:1,newStart:2,newCount:1}]).map(f=>f.name),['outer','<anonymous>']);
 const shifted='// heading\n'+before;
 assert.equal(selectFunctions(before,shifted,[{oldStart:0,oldCount:0,newStart:1,newCount:1}]).length,0);
 const signature=before.replace('outer()', 'outer(x: number)');
 assert.equal(selectFunctions(before,signature,[{oldStart:1,oldCount:1,newStart:1,newCount:1}])[0].name,'outer');
});
test('deletion-only maps survivors, removed nested functions affect outer, deleted siblings stay untouched',()=>{
 const before='function outer() {\n  const unused = () => 1;\n  console.log(1);\n  return 2;\n}\nfunction sibling() { return 3; }\n';
 const after=before.replace('  const unused = () => 1;\n','');
 assert.deepEqual(selectFunctions(before,after,[{oldStart:2,oldCount:1,newStart:1,newCount:0}]).map(f=>f.name),['outer']);
 const top='function gone() {\n  return 1;\n}\n'+before;
 assert.equal(selectFunctions(top,before,[{oldStart:1,oldCount:3,newStart:0,newCount:0}]).length,0);
 assert.equal(selectFunctions(before.replaceAll('\n','\r\n'),after.replaceAll('\n','\r\n'),[{oldStart:2,oldCount:1,newStart:1,newCount:0}]).length,1);
});
test('TypeScript angle assertions and TSX JSX are parsed according to the source extension',()=>{
 assert.equal(inventory('const f = <T>(value: T) => <T>value;','fixture.ts').length,1);
 assert.equal(inventory('const View = () => <div>Hello</div>;','fixture.tsx').length,1);
});
test('formatting, return-type edits, same-line functions, duplicate anonymous functions and moves stay conservative',()=>{
 const before='function typed(): number {\n  return 1;\n}\nconst a = () => 2; const b = () => 3;\n';
 assert.deepEqual(selectFunctions(before,before.replace(': number',': unknown'),[{oldStart:1,oldCount:1,newStart:1,newCount:1}]).map(f=>f.name),['typed']);
 assert.deepEqual(selectFunctions(before,before.replace('  return','    return'),[{oldStart:2,oldCount:1,newStart:2,newCount:1}]).map(f=>f.name),['typed']);
 assert.deepEqual(selectFunctions(before,before.replace('=> 2','=> 4'),[{oldStart:4,oldCount:1,newStart:4,newCount:1}]).map(f=>f.name),['a','b']);
 const moved='const a = () => 2; const b = () => 3;\nfunction typed(): number {\n  return 1;\n}\n';
 assert.equal(selectFunctions(before,moved,[{oldStart:1,oldCount:3,newStart:0,newCount:0},{oldStart:4,oldCount:0,newStart:2,newCount:3}]).filter(f=>f.name==='typed').length,1);
 const duplicates='const first = function() {\n return 1;\n};\nconst second = function() {\n return 1;\n};\n';
 assert.deepEqual(selectFunctions(duplicates,duplicates.replace(' return 1;\n',''),[{oldStart:2,oldCount:1,newStart:1,newCount:0}]).map(f=>f.name),['first']);
});
test('rename-plus-edit uses old source while copies at a destination count as additions',t=>{
 const r=repository(t,{'original.ts':'export const original = () => 1;\n'.repeat(5)});
 renameSync(join(r.cwd,'original.ts'),join(r.cwd,'renamed.ts'));
 writeFileSync(join(r.cwd,'renamed.ts'),'export const changed = () => 2;\n'+'export const original = () => 1;\n'.repeat(4));
 writeFileSync(join(r.cwd,'copy.ts'),'export const copied = () => 1;\n');const head=r.commit();
 const result=comparison(r.cwd,r.base,head);
 const renamed=result.files.find(f=>f.path==='renamed.ts');assert.equal(renamed.oldPath,'original.ts');assert.equal(renamed.unchanged,false);
 const copied=result.files.find(f=>f.path==='copy.ts');assert.equal(selectFunctions(copied.before,copied.after,copied.hunks).length,1);
});
test('array holes in valid production code do not break function inventory',()=>{
 assert.equal(inventory('export const hole = () => [1, , 3];').length,1);
});
