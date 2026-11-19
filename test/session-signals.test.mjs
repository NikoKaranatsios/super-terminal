import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import {execFileSync} from 'node:child_process';
import {observedSession} from '../server/session-observation.mjs';import {sessionSignal,graphSessions} from '../shared/session-signals.mjs';import {sessionGraph} from '../src/session-graph.mjs';
const at='2026-01-01T12:00:00Z',now=Date.parse(at);
const event=(type,extra={})=>({type:'event_msg',timestamp:at,payload:{type,...extra}});
const call=(name,id,args)=>({type:'response_item',timestamp:at,payload:{type:'function_call',name,call_id:id,arguments:JSON.stringify(args)}});
const output=id=>({type:'response_item',timestamp:at,payload:{type:'function_call_output',call_id:id,output:'answer'}});
const codex=[event('task_started'),call('request_user_input','q',{questions:[{question:'Choose a branch?'}]}),call('exec_command','cmd',{cmd:'true'}),output('cmd')];
const claude=[{type:'assistant',timestamp:at,message:{content:[{type:'tool_use',id:'q',name:'AskUserQuestion',input:{questions:[{question:'Which option?'}]}}]}}];
test('provider evidence distinguishes work, pending questions, answers and turn completion',()=>{
 assert.equal(observedSession('codex',[call('request_user_input_async','q',{questions:[{question:'Pick a branch?'}]}),output('q')]).agentActivity.state,'waiting','async acknowledgment is not a user answer');
 assert.equal(observedSession('codex',codex).agentActivity.state,'waiting');assert.equal(observedSession('codex',[...codex,output('q')]).agentActivity.state,'working');assert.equal(observedSession('codex',[...codex,output('q'),event('task_complete')]).agentActivity.state,'finished');
 assert.equal(observedSession('codex',[event('task_complete',{last_agent_message:'Would you like a test? '})]).agentActivity.state,'question');
 assert.equal(observedSession('codex',[event('task_started'),event('turn_aborted')]).agentActivity.state,'idle');
 assert.equal(observedSession('claude',claude).agentActivity.state,'waiting');
 assert.equal(observedSession('claude',[...claude,{type:'user',timestamp:at,message:{content:'Use the first option.'}}]).agentActivity.state,'working');
 assert.equal(observedSession('claude',[...claude,{type:'user',timestamp:at,message:{content:[{type:'tool_result',tool_use_id:'q',content:'yes'}]}},{type:'assistant',timestamp:at,message:{content:[{type:'text',text:'Done.'}],stop_reason:'end_turn'}}]).agentActivity.state,'finished');
 assert.equal(observedSession('grok',[{type:'turn_ended',timestamp:at,outcome:'completed'}]).agentActivity.state,'finished');
 assert.deepEqual(observedSession('codex',[{type:'response_item',payload:{type:'reasoning',text:'unrelated'}}]),{});
});
test('remote observations match local evidence and native parent identity',()=>{
 const script=fs.readFileSync('server/remote-reader.py','utf8').split('result=discover()')[0];
 const fixtures=[['codex',[{type:'session_meta',payload:{source:{subagent:{thread_spawn:{parent_thread_id:'parent'}}},agent_role:'reviewer'}},...codex]],['claude',claude],['grok',[{type:'turn_ended',timestamp:at,outcome:'completed'}]]];
 const actual=JSON.parse(execFileSync('python3',['-c',script+'\nfixtures=json.loads(sys.argv[1]); print(json.dumps([observed_session(p,rs) for p,rs in fixtures]))',JSON.stringify(fixtures)],{encoding:'utf8'}));
 assert.deepEqual(actual,fixtures.map(([p,rs])=>observedSession(p,rs)));
});
test('process state never substitutes for work and old output cannot look freshly active',()=>{
 const s={id:'agent',status:'running'};assert.equal(sessionSignal(s,{},now).key,'unknown');
 assert.equal(sessionSignal({...s,agentActivity:{state:'finished',at}}, {},now).key,'finished');
 assert.equal(sessionSignal({...s,agentActivity:{state:'finished',at}}, {},now+11*60*1000).key,'idle');
 assert.equal(sessionSignal({...s,agentActivity:{state:'working',at}}, {},now+11*60*1000).key,'unknown');
 assert.equal(sessionSignal({...s,sourceStale:true,agentActivity:{state:'waiting',at}}, {},now).key,'unknown');
 assert.equal(sessionSignal({...s,status:'paused'}, {},now).key,'paused');
 const tasks=[{id:'task',agentId:'agent',title:'Review',status:'blocked',lastReport:{at,blocker:'Need credentials',summary:'Waiting'}}];const signal=sessionSignal(s,{tasks},now);assert.equal(signal.key,'blocked');assert.equal(signal.detail,'Need credentials');assert.equal(signal.progress,'0/1 reported tasks done');
});
test('graph connects known native and managed children, retains parents when filtering and never guesses from cwd',()=>{
 const state={sessions:[{id:'parent',historyId:'h1',provider:'codex',host:'local',cwd:'/project',kind:'tmux',status:'running',projectId:'p'},{id:'managed',parentAgentId:'parent',provider:'claude',host:'local',cwd:'/project',kind:'managed',status:'running',projectId:'p'}],history:[{id:'h1',sessionId:'native-parent',host:'local',provider:'codex'},{id:'child',sessionId:'native-child',parentSessionId:'native-parent',host:'local',provider:'codex',cwd:'/project',kind:'history',title:'Inspect tests',agentActivity:{state:'waiting',at,question:'Which tests?'}},{id:'unrelated',sessionId:'other',host:'local',provider:'codex',cwd:'/project',kind:'history'}],projects:[{id:'p',name:'Project',host:'local',cwd:'/project'}]};
 const rows=graphSessions(state);assert.equal(rows.length,3);assert.equal(rows.find(r=>r.id==='child').parentAgentId,'parent');assert.equal(rows.find(r=>r.id==='child').kind,'history');
 const graph=sessionGraph(state,'all','Which tests');assert.equal(graph.sessions,2);assert.ok(graph.edges.some(e=>e.from==='parent'&&e.to==='child'&&e.kind==='child'));
 assert.equal(graph.nodes.find(n=>n.id==='child').signal.key,'waiting');assert.equal(graph.nodes.find(n=>n.id==='parent').children,2);
 state.sessions[0].sourceStale=true;assert.equal(sessionSignal(graphSessions(state).find(r=>r.id==='child'),state).key,'unknown');
});
test('older saved subagents fold under their parent but questions, active work and search remain visible',()=>{
 const now=new Date().toISOString(),state={projects:[],sessions:[{id:'p',provider:'codex',host:'local',kind:'tmux',status:'running',cwd:'/project',historyId:'h'}],history:[{id:'h',sessionId:'p-native',provider:'codex',host:'local'},...['idle','waiting','working'].map((status,i)=>({id:'child-'+i,sessionId:'c'+i,parentSessionId:'p-native',provider:'codex',host:'local',kind:'history',cwd:'/project',title:'child '+i,agentActivity:{state:status,at:now}}))]};
 assert.equal(sessionGraph(state).sessions,3);assert.equal(sessionGraph(state).savedChildren,3);assert.equal(sessionGraph(state).liveSessions,1);assert.equal(sessionGraph(state).nodes.find(n=>n.id==='p').hiddenChildren,1);
 assert.equal(sessionGraph(state,'all','','',1,true,'',new Set(['p'])).sessions,4);
 assert.equal(sessionGraph(state,'all','child 0').sessions,2,'search reveals the matching folded child and its parent');
});
