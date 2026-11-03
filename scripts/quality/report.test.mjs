import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { summary, writeReport, publishSummary } from './report.mjs';
test('reports retain SHAs, measurements, limits, baseline changes and scope',t=>{
 const report={status:'failed',base:'base-sha',target:'target-sha',head:'head-sha',selected:[],policyChanged:true,failures:[{path:'apps/f.ts',function:'f',rule:'complexity',line:3,measured:12,limit:10}],coverage:[{package:'@mudd/contracts',metric:'branches',measured:70,limit:80}],baselineChanges:[{before:1,after:2,failure:true}]};
 const text=summary(report);
 for(const expected of ['base-sha','head-sha','no applicable functions changed','complexity','"measured": 12','"limit": 10','BaselineChanges','Coverage']) assert.ok(text.includes(expected),expected);
 const cwd=mkdtempSync(join(tmpdir(),'quality-report-'));t.after(()=>rmSync(cwd,{recursive:true,force:true}));
 writeReport(report,join(cwd,'report.json'));publishSummary(report,join(cwd,'summary.md'));
 assert.deepEqual(JSON.parse(readFileSync(join(cwd,'report.json'))),report);
 assert.equal(readFileSync(join(cwd,'summary.md'),'utf8'),text);
});
