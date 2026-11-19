const time=value=>Date.parse(value || '') || 0;
const recent=(at,now)=>time(at)>0&&now-time(at)>=-60000&&now-time(at)<10*60*1000;
export function sessionSignal(session,state,now=Date.now()){
  const tasks=(state.tasks || []).filter(t=>t.agentId===session.id || t.id===session.taskId || t.id===session.scope?.goalId);
  const task=tasks.find(t=>t.id===session.taskId)||tasks.find(t=>t.status==='doing'||t.status==='blocked')||tasks.at(-1);
  const history=(state.history || []).find(h=>h.id===session.historyId || (session.kind==='history'&&h.id===session.id));
  const observed=session.agentActivity || history?.agentActivity;
  const report=tasks.filter(t=>t.lastReport).sort((a,b)=>time(b.lastReport.at)-time(a.lastReport.at))[0];
  const base={task:task?.title || '',progress:tasks.length?`${tasks.filter(t=>t.status==='done').length}/${tasks.length} reported tasks done`:'',detail:'No current activity evidence',at:null,source:'unknown'};
  if(session.sourceStale||session.connectionLost||observed?.stale||['unknown','disconnected'].includes(session.status))return {...base,key:'unknown',label:'Unverified',detail:'The source is unavailable; last known activity may be stale.'};
  if(session.status==='paused')return {...base,key:'paused',label:'Paused',detail:'Process paused'};
  let value=observed;
  if(report&&time(report.lastReport.at)>=time(observed?.at))value={state:report.status==='blocked'?'blocked':report.status==='doing'?'working':report.status==='done'?'finished':report.status==='stopped'?'idle':'unknown',at:report.lastReport.at,detail:report.lastReport.blocker || report.lastReport.summary,source:'task-report'};
  if(!value&&task&&['doing','blocked'].includes(task.status))value={state:task.status==='doing'?'working':'blocked',at:task.updatedAt,detail:task.lastReport?.blocker || 'Recorded task state',source:'task-record'};
  if(!value)return {...base,key:'unknown',label:'Activity unknown'};
  const key=value.state==='finished'&&!recent(value.at,now)?'idle':value.state==='working'&&!recent(value.at,now)?'unknown':value.state;
  const labels={working:'Working',waiting:'Needs input',question:'Question in reply',blocked:'Blocked',finished:'Just finished',idle:'Idle',unknown:'Activity unknown'};
  return {...base,key,label:labels[key] || 'Activity unknown',detail:value.question || (key==='unknown'?'Last activity is old; current work is unknown.':value.detail) || base.detail,question:value.question || '',at:value.at,source:value.source,lastFinishedAt:value.state==='finished'?value.at:null};
}

// Native children can share a parent process. Their saved output is navigable,
// but a history record never becomes proof of a separate running process.
export function graphSessions(state){
  const rows=(state.sessions || []).filter(s=>!s.runtime&&!s.enrollmentRevokedAt&&!['stopped','exited'].includes(s.status)).map(s=>({...s}));
  const history=state.history || [],byHistory=new Map();
  for(const session of rows){const record=history.find(h=>h.id===session.historyId);if(record)byHistory.set(`${record.host}\0${record.provider}\0${record.sessionId}`,session);}
  let remaining=history.filter(h=>h.parentSessionId);
  for(let depth=0;depth<16&&remaining.length;depth++){
    const next=[];let added=0;
    for(const child of remaining){
      const parent=byHistory.get(`${child.host}\0${child.provider}\0${child.parentSessionId}`);if(!parent){next.push(child);continue;}
      const key=`${child.host}\0${child.provider}\0${child.sessionId}`,existing=byHistory.get(key);
      if(existing){if(existing.id!==parent.id&&!existing.parentAgentId)existing.parentAgentId=parent.id;continue;}
      const row={...child,parentAgentId:parent.id,historyId:child.id,projectGroupId:child.projectGroupId || child.projectId || parent.projectGroupId || parent.projectId,kind:'history',status:'observed',nativeSubagent:true,sourceStale:!!child.sourceStale || !!parent.sourceStale || !!parent.connectionLost};
      rows.push(row);byHistory.set(key,row);added++;
    }
    remaining=next;if(!added)break;
  }
  return rows;
}
