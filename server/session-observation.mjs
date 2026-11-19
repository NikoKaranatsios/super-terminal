// Bounded provider-visible evidence only. Process liveness is tracked separately.
const short=value=>typeof value==='string'?value.replace(/\s+/g,' ').trim().slice(0,240):'';
const content=value=>typeof value==='string'?value:Array.isArray(value)?value.filter(c=>['text','output_text','input_text'].includes(c?.type)).map(c=>c.text || '').join('\n'):'';
const object=value=>{if(value&&typeof value==='object')return value;try{return JSON.parse(value);}catch{return {};}};
export function observedSession(provider,records){
  let activity=null,parentSessionId=null,agentRole=null;const pending=new Map(),asynchronous=new Set();
  const set=(state,r,detail='',question='')=>activity={state,at:r.timestamp || r.ts || null,source:'provider-output',detail:short(detail),...(question?{question:short(question)}:{})};
  const reply=(r,value)=>{const text=content(value),last=text.trim().split(/\n\s*\n/).at(-1) || '';set(/\?\s*$/.test(last)?'question':'finished',r,/\?\s*$/.test(last)?'Question detected in the last reply; waiting is not confirmed.':'Provider finished a turn.',/\?\s*$/.test(last)?last:'');};
  const ask=(r,id,args)=>{const value=object(args);const question=(Array.isArray(value?.questions)?value.questions:[]).map(q=>q?.question || q?.title || q?.header).filter(Boolean).join(' · ') || value?.question || 'The agent requested your input.';pending.set(id,question);set('waiting',r,'Explicit input request',question);};
  for(const r of records){
    if(!r||typeof r!=='object')continue;const p=r.payload || {},message=r.message || {};
    if(provider==='codex'){
      if(r.type==='session_meta'){const spawn=p.source?.subagent?.thread_spawn;parentSessionId=spawn?.parent_thread_id || parentSessionId;agentRole=p.agent_role || spawn?.agent_role || p.agent_nickname || agentRole;}
      if(r.type==='event_msg'){
        if(['task_started','user_message'].includes(p.type)){pending.clear();set('working',r,'Turn started');}
        if(p.type==='task_complete'){if(!pending.size){if(p.last_agent_message)reply(r,p.last_agent_message);else if(activity?.state!=='question')set('finished',r,'Provider finished a turn.');}}
        if(['turn_aborted','task_cancelled'].includes(p.type)){pending.clear();set('idle',r,'Turn interrupted');}
      }
      if(r.type==='response_item'){
        if(['function_call','custom_tool_call','tool_call'].includes(p.type)){
          if(/(?:^|\.)request_user_input(?:_async)?$/.test(p.name || '')){ask(r,p.call_id,p.arguments || p.input);if(p.name.endsWith('_async'))asynchronous.add(p.call_id);}else if(!pending.size)set('working',r,'Tool: '+(p.name || 'running'));
        }
        if(['function_call_output','custom_tool_call_output','tool_result'].includes(p.type)){
          const answered=!asynchronous.has(p.call_id)&&pending.delete(p.call_id);if(answered&&!pending.size)set('working',r,'Input received');
          // Other tool output must not erase an outstanding question.
        }
        if(p.type==='message'&&p.role==='user'){pending.clear();set('working',r,'User input received');}
        if(p.type==='message'&&p.role==='assistant'&&(p.channel==='final'||p.phase==='final_answer')&&!pending.size)reply(r,p.content);
      }
    }else if(provider==='claude'){
      const blocks=Array.isArray(message.content)?message.content:[];
      if(r.type==='user'&&!r.isMeta){
        if(content(message.content).trim())pending.clear();
        for(const block of blocks)if(block?.type==='tool_result')pending.delete(block.tool_use_id);
        if(!pending.size)set('working',r,'Input or tool result received');
      }
      if(r.type==='assistant'&&!r.isApiErrorMessage){
        for(const block of blocks)if(block?.type==='tool_use'){if(block.name==='AskUserQuestion')ask(r,block.id,block.input);else if(!pending.size)set('working',r,'Tool: '+block.name);}
        if(message.stop_reason==='end_turn'&&!pending.size)reply(r,message.content);
      }
    }else if(provider==='grok'){
      if(r.type==='turn_started')set('working',r,'Turn started');
      if(r.type==='turn_ended')set(['completed','success'].includes(r.outcome)?'finished':'idle',r,'Provider turn '+r.outcome);
    }
  }
  return {...(activity?{agentActivity:activity}:{}),...(typeof parentSessionId==='string'?{parentSessionId}:{}),...(typeof agentRole==='string'?{agentRole:short(agentRole)}:{})};
}
