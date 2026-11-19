import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {classifyProjects,discoverRepositoryDetails} from '../server/project-classification.mjs';
import {sessionIdentity} from '../src/sessions-view.mjs';
function fixture(t){
  const base=fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(),'st-worktree-')));t.after(()=>fs.rmSync(base,{recursive:true,force:true}));
  const main=path.join(base,'project'),tree=path.join(base,'outside-worktree'),git=path.join(main,'.git'),metadata=path.join(git,'worktrees','review');
  fs.mkdirSync(path.join(git,'objects'),{recursive:true});fs.writeFileSync(path.join(git,'HEAD'),'ref: refs/heads/main\n');fs.mkdirSync(metadata,{recursive:true});fs.writeFileSync(path.join(metadata,'HEAD'),'ref: refs/heads/feature/review\n');fs.writeFileSync(path.join(metadata,'commondir'),'../..\n');fs.mkdirSync(path.join(tree,'src'),{recursive:true});fs.mkdirSync(path.join(main,'src'));
  fs.writeFileSync(path.join(tree,'.git'),'gitdir: '+metadata+'\n');
  return {main,tree,base};
}
const row=(id,cwd,extra={})=>({id,cwd,host:'local',kind:'external',provider:'codex',status:'external',...extra});
test('main checkout, subfolders and outside worktrees share a project while branches remain visible',t=>{
  const {main,tree}=fixture(t),state={projects:[{id:'main',cwd:main,name:'Project',host:'local'},{id:'old-worktree',cwd:tree,name:'Old worktree',host:'local'}]};
  const result=classifyProjects(state,{sessions:[row('main',main),row('sub',path.join(main,'src')),row('tree',path.join(tree,'src'))]},{discover:true});
  assert.deepEqual(result.sessions.map(s=>s.projectId),['main','main','main']);assert.equal(result.createdProjects.length,0);
  assert.equal(result.sessions[2].worktreeRoot,tree);assert.equal(result.sessions[2].branch,'feature/review');assert.equal(result.sessions[2].cwd,path.join(tree,'src'));assert.equal(state.projects.length,2,'historical project records are retained');
  assert.equal(sessionIdentity(result.sessions[2],state).project,'Project');assert.match(sessionIdentity(result.sessions[2],state).checkout,/Worktree.*feature\/review/);
  const nested=path.join(main,'nested');fs.mkdirSync(path.join(nested,'.git','objects'),{recursive:true});fs.writeFileSync(path.join(nested,'.git','HEAD'),'ref: refs/heads/other');
  assert.notEqual(classifyProjects(state,{sessions:[row('nested',nested)]},{discover:true}).sessions[0].projectId,'main','an independent nested repository remains distinct');
});
test('worktree display grouping does not rewrite a managed task or enrollment boundary',t=>{
  const {main,tree}=fixture(t),managed=row('managed',tree,{kind:'managed',projectId:'old',taskId:'task',scope:{projectId:'old'},teamId:'team'});
  const state={projects:[{id:'main',cwd:main,name:'Project',host:'local'},{id:'old',cwd:tree,name:'Review checkout',host:'local'}],sessions:[managed]};const before=JSON.stringify(state);
  const result=classifyProjects(state,{sessions:[managed]}).sessions[0];
  assert.equal(result.projectId,'old');assert.equal(result.projectGroupId,'main');assert.equal(result.taskId,'task');assert.deepEqual(result.scope,{projectId:'old'});assert.equal(JSON.stringify(state),before);assert.equal(sessionIdentity(result,state).project,'Project');
});
test('remote Git metadata produces the same worktree grouping without trusting unverified claims',t=>{
  const {main,tree}=fixture(t),script=fs.readFileSync('server/remote-reader.py','utf8').split('result=discover()')[0];
  const metadata=JSON.parse(execFileSync('python3',['-c',script+'\nprint(json.dumps(repository_metadata(sys.argv[1])))',path.join(tree,'src')],{encoding:'utf8',timeout:3000}));
  assert.equal(metadata.repositoryProjectRoot,main);assert.equal(metadata.worktreeRoot,tree);assert.equal(metadata.branch,discoverRepositoryDetails(tree).branch);
  const state={projects:[{id:'main',host:'remote',cwd:main},{id:'old',host:'remote',cwd:tree}]},agent=row('remote',path.join(tree,'src'),{host:'remote',...metadata});
  assert.equal(classifyProjects(state,{sessions:[agent]}).sessions[0].projectId,'main');
  assert.equal(classifyProjects(state,{sessions:[{...agent,repositoryGroupVerified:false}]}).sessions[0].projectId,'old');
});
test('remote agents use their own checkout when the containing shell stays elsewhere',async()=>{
  const {scanRemote}=await import('../server/discovery.mjs');
  const result=await scanRemote('fixture',false,async()=>({panes:[{pane:'%1',owner:'user',tty:'/dev/pts/1',cwd:'/home/user',command:'bash',repositoryVerified:false}],processes:[{pid:321,provider:'codex',owner:'user',tty:'pts/1',cwd:'/repo-review/src',canonicalCwd:'/repo-review/src',repository:'/repo-review',repositoryVerified:true,repositoryProjectRoot:'/repo',repositoryGroupVerified:true,worktreeRoot:'/repo-review',branch:'review'}]}));
  assert.equal(result.sessions[0].cwd,'/repo-review/src');
  assert.equal(classifyProjects({projects:[{id:'main',host:'fixture',cwd:'/repo'}]},{sessions:result.sessions}).sessions[0].projectId,'main');
  assert.equal(result.processes.length,0,'the same agent is not duplicated outside its pane');
});
