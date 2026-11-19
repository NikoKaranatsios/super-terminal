import test from 'node:test';
import assert from 'node:assert/strict';
import { visibleHistory, scopedHistory, readHistoryAction, readConductorHistory, conversationTurns } from '../server/conductor-history.mjs';
import { Coordinator, boundInput, MAX_INPUT_BYTES } from '../server/coordinator.mjs';

const context={key:'project:p',projectScoped:true,isolated:true,unknownSources:false,projectIds:['p']};
const scope={layer:'project',projectIds:['p'],agentIds:[],taskIds:[],workSessionIds:[]};
const reply=actions=>({answer:'Read the saved evidence.',memory:'',assessments:[],actions});
test('saved project history is available without live agents; unrelated, moved and mixed sources stay excluded',async()=>{
  const rows=[{id:'own',projectId:'p'},{id:'other',projectId:'q'},{id:'moved',projectId:'p',contentProjectIds:['q']},{id:'mixed',projectId:'p'},{id:'unknown'},{id:'isolated',projectId:'p',contextIsolation:'restart-required'}];
  const state={historyProvenance:{mixed:['p','q']}};
  assert.deepEqual(visibleHistory(state,rows,[],{scope}).map(r=>r.id),['own']);
  assert.deepEqual(visibleHistory(state,rows,[],{scope:{...scope,layer:'task'}}),[]);
  let reads=0;const reader=scopedHistory(state,{all:async()=>rows,transcript:async()=>{reads++;return {}; }},[],{scope});
  await assert.rejects(reader.transcript('other'),/outside/);assert.equal(reads,0);
  await reader.transcript('own');assert.equal(reads,1);
});
test('Conductor can search and read an inactive project history in successive action rounds',async()=>{
  const state={projects:[{id:'p',host:'local',cwd:process.cwd()}],tasks:[],sessions:[]};
  const history={all:async()=>[{id:'saved',projectId:'p',title:'Old requirements',cwd:process.cwd()}],transcript:async()=>({session:{title:'Old requirements'},messages:[{role:'user',text:'Required acceptance marker'}]})};
  const inputs=[];const c=new Coordinator({state,save(){}},{modelRunner:async input=>{inputs.push(input);return reply(inputs.length===1?[{type:'search_history',text:'requirements'}]:inputs.length===2?[{type:'read_conversation',target:'saved'}]:[]);}}).configure({history,liveReader:async()=>[]});
  const result=await c.ask('Read old requirements','',[],history,'',false,'local',{scope});
  assert.equal(result.status,'complete');assert.equal(result.coverage.indexed,1);assert.deepEqual(result.actions.map(a=>a.status),['executed','executed']);
  assert.match(JSON.stringify(inputs[2].actionResults),/Required acceptance marker/);
});
test('history searches paginate beyond the first page and transcript pages do not skip earlier projected messages',async()=>{
  const rows=Array.from({length:21},(_,i)=>({id:'h'+i,title:'Work',cwd:'/example'}));
  const reader={all:async()=>rows,transcript:async(_id,cursor)=>({session:{title:'Work'},messages:Array.from({length:11},(_,i)=>({role:'user',text:`${cursor===50?'older':'recent'}-${i}`})),nextCursor:cursor===50?null:50})};
  let cursor='',found=[];
  do {const result=await readHistoryAction({type:'search_history',text:'Work',cursor},reader);found.push(...result.conversations.map(r=>r.id));cursor=result.nextCursor;} while(cursor);
  assert.deepEqual(found,rows.map(r=>r.id));
  let messages=[];cursor='';
  do {const result=await readHistoryAction({type:'read_conversation',target:'h0',cursor},reader);messages.push(...result.messages.map(m=>m.text));cursor=result.nextCursor;} while(cursor);
  assert.equal(messages.length,22);assert.equal(new Set(messages).size,22);assert.ok(messages.includes('older-0'));
  await assert.rejects(readHistoryAction({type:'read_conversation',target:'different',cursor:Buffer.from(JSON.stringify({id:'h0',end:3})).toString('base64url')},reader),/Invalid/);
});
test('older direct exchanges remain searchable across restart with strict project partitions',()=>{
  const turns=Array.from({length:10},(_,i)=>({id:'t'+i,status:'complete',mode:'manual',prompt:'Requirement '+i,answer:'Evidence '+i,context}));
  turns.push({id:'global',status:'complete',prompt:'GLOBAL_SENTINEL',answer:'Global',context:{key:'global'}},{id:'q',status:'complete',prompt:'FOREIGN_SENTINEL',context:{key:'project:q',projectScoped:true,isolated:true,projectIds:['q']}});
  assert.equal(conversationTurns(turns,{key:'global'}).length,12);
  let cursor='',found=[];
  do {const result=readConductorHistory(structuredClone(turns),context,{cursor});assert.doesNotMatch(JSON.stringify(result),/SENTINEL/);found.push(...result.turns.map(t=>t.id));cursor=result.nextCursor;} while(cursor);
  assert.equal(found.length,10);assert.equal(found.at(-1),'t0');
  assert.equal(readConductorHistory(turns,context,{text:'Requirement 0'}).turns[0].id,'t0');
  assert.equal(readConductorHistory(turns,context,{target:'global'}).turns.length,0);
});
test('bounded input retains newest retrieved evidence and marks earlier receipts omitted',()=>{
  const results=Array.from({length:8},(_,i)=>({action:{type:'read_conversation',target:'h'+i},status:'executed',result:{messages:[{text:('x'+i).repeat(2500)}],nextCursor:'cursor'+i}}));
  const input=boundInput({userMessage:'Continue',conversation:[],snapshot:{},actionResults:results});
  assert.ok(Buffer.byteLength(JSON.stringify(input))<=MAX_INPUT_BYTES);assert.ok(input.omitted.actionDetails);assert.match(input.actionResults.at(-1).result.messages[0].text,/x7/);assert.equal(input.actionResults[0].result.nextCursor,'cursor0');
});
