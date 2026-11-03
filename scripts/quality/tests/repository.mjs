import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';
export function repository(t, files) {
 const cwd=mkdtempSync(join(tmpdir(),'quality-'));
 t.after(()=>rmSync(cwd,{recursive:true,force:true}));
 const git=(...args)=>execFileSync('git',args,{cwd,encoding:'utf8'}).trim();
 git('init','-q'); git('config','user.name','Quality fixtures'); git('config','user.email','quality@example.invalid');
 for(const [path,content] of Object.entries(files)) writeFileSync(join(cwd,path),content);
 const commit=()=>{git('add','.');git('commit','-qm','fixture');return git('rev-parse','HEAD');};
 return {cwd,git,commit,base:commit()};
}
