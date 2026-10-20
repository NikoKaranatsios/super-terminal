import path from 'node:path';
import { parseTopics, carryProjects, mergeProjects, wrapSummary, resolveScope } from './work-sessions.mjs';
import { randomUUID } from 'node:crypto';
import { run, env, quote, tmuxRun, text, localDirectory, validHost } from './core.mjs';

const states = new Set(['running','paused','stopped']);
export async function performAction(action, context) {
  const { store, liveSessions, createSession, allowedHosts, sendMessage, history } = context;
  const live = await liveSessions();
  const target = live.find(s => s.id === action.target);
  const project = store.state.projects?.find(p => p.id === action.projectId);
  const team = store.state.teams.find(t => t.id === action.teamId);
  const host = action.host || project?.host || team?.host || 'local';
  if (host !== 'local' && !allowedHosts.includes(validHost(host))) throw new Error('Environment is not enabled.');
  const cwd = action.cwd || project?.cwd || team?.cwd || (host === 'local' ? path.join(process.env.HOME,'Projects') : '~');
  if (action.type === 'search_history') {
    const query=String(action.text || '').toLowerCase().split(/\s+/).filter(Boolean);
    return (await history.all()).filter(r => (!action.host || r.host===action.host) && query.every(word=>(r.title+' '+r.cwd).toLowerCase().includes(word))).slice(0,60).map(({id,title,host,cwd,provider,updatedAt})=>({id,title,host,cwd,provider,updatedAt}));
  }
  if(action.type==='start_work_session') {
    store.state.workSessions ||= [];
    let projects=parseTopics(action.text || '',await history.all());
    const prior=store.state.workSessions.find(s=>s.id===action.target);
    if(prior) projects=mergeProjects(carryProjects(prior),projects);
    for(const s of store.state.workSessions) if(s.status==='active') s.status='paused';
    const session={id:randomUUID(),title:action.name || 'Working session',status:'active',startedAt:new Date().toISOString(),endedAt:null,notes:'',summary:'',projects};
    store.state.workSessions.push(session);store.save();return {result:'Working session started',session};
  }
  if(action.type==='work_session_state') {
    const s=store.state.workSessions?.find(s=>s.id===action.target);if(!s)throw new Error('Working session not found.');
    if(!['active','paused','wrapped'].includes(action.state))throw new Error('Working-session state must be active, paused, or wrapped.');
    if(action.text)s.notes=String(action.text).slice(0,12000);
    if(action.state==='active')for(const other of store.state.workSessions)if(other.status==='active')other.status='paused';
    s.status=action.state;s.endedAt=action.state==='wrapped'?new Date().toISOString():null;
    if(action.state==='wrapped')s.summary=wrapSummary(s);
    store.save();return {result:'Working session updated',session:s};
  }
  if(action.type==='goal_progress') {
    const goal=store.state.workSessions?.flatMap(s=>s.projects.flatMap(p=>p.goals)).find(g=>g.id===action.target);
    if(!goal || !['todo','doing','done'].includes(action.state))throw new Error('Choose an existing goal and todo, doing, or done.');
    if(action.state==='done' && !action.text?.trim())throw new Error('Include the evidence for completion.');
    goal.status=action.state;if(action.text)goal.notes=String(action.text).slice(0,6000);store.save();return {result:'Goal updated',goal};
  }
  const scope=action.workSessionId?resolveScope(store.state.workSessions || [],{workSessionId:action.workSessionId,projectId:action.projectId || null,goalId:action.goalId || null}):null;
  if (action.type === 'read_conversation') {
    const transcript = await history.transcript(action.target);
    return { title: transcript.session.title, messages: transcript.messages.slice(-16).map(m => ({role:m.role,text:m.text.slice(-1800)})), note:transcript.note };
  }
  if(action.type==='resume_conversation') {
    const existing=live.find(s=>s.historyId===action.target && !['stopped','exited','disconnected'].includes(s.status));
    if(existing)return {result:'Already running; select this agent in the terminal list.',id:existing.id,title:existing.title};
    const original=await history.get(action.target);if(!original)throw new Error('Conversation not found.');
    const session=await createSession({historyId:original.id,host:original.host,task:action.text || ''});
    return {result:'Conversation resumed',id:session.id,title:session.title};
  }
  if (action.type === 'start_agent') {
    const session = await createSession({ provider: action.provider || 'codex', host, cwd, title: action.name || undefined, task: action.text, scope, group: team?.name || project?.name, projectId: project?.id });
    return { result: 'Started', id: session.id, title: session.title, host: session.host };
  }
  if (action.type === 'start_team') {
    if (!Array.isArray(action.members) || action.members.length < 1 || action.members.length > 6) throw new Error('A team needs 1–6 agents.');
    if (!action.text?.trim() || !action.name?.trim()) throw new Error('A team needs a name and mission.');
    if (store.state.teams.some(t => t.name.toLowerCase() === action.name.toLowerCase())) throw new Error('That team already exists. Add agents to it instead.');
    const created = { id:randomUUID(), name:text(action.name,120), mission:String(action.text).slice(0,12000), scope, host, cwd, projectId:project?.id || null, createdAt:new Date().toISOString() };
    store.state.teams.push(created); store.save();
    const started=[], errors=[];
    for(const member of action.members) {
      try {
        const s=await createSession({provider:member.provider,host,cwd,group:created.name,scope,projectId:project?.id,title:`${created.name} / ${member.role}`,role:member.role,task:`Team mission: ${created.mission}\nYour role: ${member.role}. ${member.task}\nCoordinate with peers through the mailbox; share progress and ownership before overlapping edits.`});
        started.push({id:s.id,title:s.title});
      } catch(e) {errors.push({role:member.role,error:e.message});}
    }
    return {team:created.name,teamId:created.id,started,errors};
  }
  if (action.type === 'message_agent') {
    const recipient = store.state.sessions.find(s=>s.id===action.target);
    if (!recipient) throw new Error('This external agent does not have a platform mailbox. Its conversation can be read, but it has not been enrolled for team messaging.');
    const message=sendMessage('conductor',recipient.id,action.text,recipient.group);
    return {result:'Queued in the agent mailbox. The agent reads it at its next inbox check; no keystrokes were injected.',messageId:message.id};
  }
  if (action.type === 'create_project') {
    const name=text(action.name,120); if(!name) throw new Error('Project name required.');
    store.state.projects ||= [];
    if(store.state.projects.some(p=>p.name.toLowerCase()===name.toLowerCase() && p.host===host)) throw new Error('That project already exists in this environment.');
    const created={id:randomUUID(),name,host,cwd:host==='local'?localDirectory(cwd):text(cwd,2000),notes:String(action.text || '').slice(0,6000),status:'active',createdAt:new Date().toISOString()};
    store.state.projects.push(created); store.save(); return {result:'Project saved',project:created};
  }
  if (action.type === 'update_project') {
    const p=store.state.projects?.find(p=>p.id===action.target); if(!p) throw new Error('Project not found.');
    if(action.name) p.name=text(action.name,120);
    if(action.text) p.notes=String(action.text).slice(0,6000);
    if(action.state) {if(!['active','archived'].includes(action.state)) throw new Error('Project status must be active or archived.');p.status=action.state;}
    store.save();return {result:'Project updated',project:p};
  }
  if (action.type === 'assign_agent') {
    if(!target) throw new Error('Agent not found.');
    if(!project && !team && !scope) throw new Error('Choose an existing project or team.');
    const managed=store.state.sessions.find(s=>s.id===target.id);
    if(managed) {managed.projectId=project?.id || team?.projectId || null; managed.group=team?.name || project?.name || managed.group; if(scope)managed.scope=scope;}
    else {store.state.assignments ||= {};store.state.assignments[target.id]={projectId:project?.id || team?.projectId || null,group:team?.name || project?.name || target.group,scope};}
    store.save(); return {result:managed?'Assigned. Mailbox peers now share the assignment.':'Assigned for tracking. This external process has no platform mailbox.',id:target.id};
  }
  if (action.type === 'cleanup') {
    const stopped=live.filter(s=>s.kind==='managed' && ['stopped','exited','disconnected'].includes(s.status) && (!action.target || s.id===action.target) && (!action.host || s.host===action.host));
    for(const s of stopped) {if(['exited','disconnected'].includes(s.status)) try{await tmuxRun(['kill-session','-t',s.tmuxName]);}catch{} }
    const ids=new Set(stopped.map(s=>s.id)); store.state.sessions=store.state.sessions.filter(s=>!ids.has(s.id)); store.save();
    return {result:`Removed ${ids.size} stopped terminal entries. Provider conversation histories and project files were kept.`};
  }
  if(action.type==='session_state') {
    if(!target || !states.has(action.state)) throw new Error('Choose an existing session and running, paused, or stopped.');
    if(target.runtime) throw new Error('This process is a shared provider service. Stop or pause its individual agent in the original provider app; stopping the service could interrupt unrelated agents.');
    if(['stopped','exited'].includes(target.status)) throw new Error('That terminal has already stopped. Start or resume a conversation instead.');
    const signal={running:'CONT',paused:'STOP',stopped:'TERM'}[action.state];
    if(target.kind==='managed' && action.state==='stopped') {
      if(target.host!=='local' && !target.connectionLost) await run('ssh',['-o','BatchMode=yes','-o','ConnectTimeout=6',target.host,`${target.remoteUser ? 'sudo -n -u '+quote(target.remoteUser)+' ' : ''}tmux kill-session -t ${quote(target.tmuxName)}`],{env,timeout:10000});
      await tmuxRun(['kill-session','-t',target.tmuxName]);
    } else {
      if(target.connectionLost) throw new Error('SSH has ended; stop this local recovery terminal or open a new SSH session.');
      let pid=target.pid, processGroup=null;
      let tty=target.tty;
      if(target.kind==='managed' || target.kind==='tmux' || target.kind==='remote') {
        // Re-resolve the foreground process by TTY immediately before signalling.
        if(target.host!=='local' && target.kind==='managed') {
          const {stdout}=await run('ssh',['-o','BatchMode=yes','-o','ConnectTimeout=6',target.host,`${target.remoteUser ? 'sudo -n -u '+quote(target.remoteUser)+' ' : ''}tmux list-panes -t ${quote(target.tmuxName)} -F '#{pane_tty}'`],{env,timeout:10000});tty=stdout.trim().split('\n')[0];
        }
        if(!tty) throw new Error('Cannot identify the foreground process for this terminal.');
        const command=['ps','-t',tty.replace('/dev/',''),'-o','pid=,pgid=,stat='];
        const {stdout}=target.host==='local'?await run(command[0],command.slice(1),{env,timeout:3000}):await run('ssh',['-o','BatchMode=yes',target.host,command.map(quote).join(' ')],{env,timeout:10000});
        const records=stdout.trim().split('\n').map(l=>l.trim().split(/\s+/));
        const foreground=records.filter(r=>r[2]?.includes('+')).at(-1);
        const stopped=records.filter(r=>r[2]?.startsWith('T')).at(-1);
        const process=action.state==='running'?stopped || foreground:foreground;
        if(!process) throw new Error('No foreground process found.');
        pid=Number(process[0]); processGroup=Number(process[1]);
      }
      if(!Number.isInteger(pid) || pid<=1) throw new Error('Invalid process.');
      if(target.kind==='external') {
        const args=['-p',String(pid),'-o','comm='];
        const {stdout}=target.host==='local'?await run('ps',args,{env,timeout:3000}):await run('ssh',['-o','BatchMode=yes',target.host,['ps',...args].map(quote).join(' ')],{env,timeout:10000});
        if(path.basename(stdout.trim())!==target.provider) throw new Error('Process identity changed; refresh before controlling it.');
      }
      const signalTarget=processGroup>1 ? -processGroup : pid;
      if(target.host==='local') {if(signal==='TERM' && target.status==='paused') process.kill(signalTarget,'SIGCONT'); process.kill(signalTarget,'SIG'+signal);} 
      else await run('ssh',['-o','BatchMode=yes','-o','ConnectTimeout=6',target.host,`${target.requiresSudo || target.remoteUser ? 'sudo -n ' : ''}kill -${signal} -- ${signalTarget}`],{env,timeout:10000});
    }
    store.state.lifecycle ||= {};store.state.lifecycle[target.id]=action.state;
    store.save();context.invalidate?.();return {result:`${action.state==='running'?'Resumed':action.state==='paused'?'Paused':'Stopped'} ${target.title}`,id:target.id};
  }
  throw new Error('Unsupported Conductor action.');
}
