import { test } from 'node:test';
import assert from 'node:assert/strict';
import { pruneSites } from './pruning.mjs';
test('site pruning removes obsolete occurrences and cannot add a new allowance',()=>{
 const site={path:'f.mjs',rule:'smell',line:1,column:1,anchor:'bad();',context:'bad();'};
 const removed={...site,rule:'fixed'};
 const ledger={version:1,revision:'original',sites:[site,removed]};
 const context={comparison:{files:[{path:'f.mjs',oldPath:'f.mjs',before:'bad();\n',after:'bad();\n',hunks:[]}]}};
 assert.deepEqual(pruneSites(ledger,[site,{...site,rule:'new'}],context).sites,[site]);
 assert.deepEqual(pruneSites(ledger,[],context).sites,[]);
});
