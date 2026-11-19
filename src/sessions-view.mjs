import {html, agentTitle} from './work-views.mjs';

export function sessionIdentity(session, state) {
  const project=(state.projects || []).find(p=>p.id===(session.projectGroupId || session.projectId));
  const task=(state.tasks || []).find(t=>t.id===session.taskId || t.id===session.scope?.goalId || t.agentId===session.id);
  const history=(state.history || []).find(h=>h.id===session.historyId);
  const stale=!!session.connectionLost || !!session.sourceStale || ['unknown','disconnected'].includes(session.status) || session.kind==='enrolled';
  const terminal=['managed','tmux','remote'].includes(session.kind);
  const location=state.hostNames?.[session.host] || (session.host==='local'?'Local':session.host);
  return {
    title:task?.title || session.mission || history?.title || agentTitle(session,state),
    projectId:project?.id || null,
    checkout:session.worktreeRoot?('Worktree · '+(session.branch || session.worktreeRoot.split('/').at(-1))):session.branch?('Branch · '+session.branch):'',
    project:project?.name || session.repositoryRoot?.split('/').filter(Boolean).at(-1) || session.group || session.cwd?.split('/').filter(Boolean).at(-1) || 'Unassigned',
    model:session.provider==='shell'?'—':session.model || 'Model unknown',
    modelHint:session.model?`${session.modelStale?'Cached · ':''}${session.modelSource==='provider-index'?'Recorded in provider session metadata':'Last observed in provider output'}${session.modelObservedAt?' · '+session.modelObservedAt:''}`:'No model identity found in linked provider output.',
    location, identity:[session.owner,session.tty || session.pane || (session.pid?'PID '+session.pid:session.id.slice(-8))].filter(Boolean).join(' · '),
    state:stale?'Unverified':session.status==='paused'?'Paused':'Running',
    access:terminal?'Interactive':session.kind==='enrolled'?'MCP only':'View only',
    stale, terminal
  };
}

export function liveSessionRows(state, host='all', query='') {
  const terms=query.toLowerCase().split(/\s+/).filter(Boolean);
  return (state.sessions || []).filter(s=>!s.runtime && !s.enrollmentRevokedAt && !['stopped','exited'].includes(s.status) && (host==='all'||s.host===host))
    .map(session=>({session,...sessionIdentity(session,state)}))
    .filter(row=>terms.every(term=>[row.title,row.project,row.checkout,row.model,row.location,row.identity,row.session.provider,row.session.cwd].join(' ').toLowerCase().includes(term)))
    .sort((a,b)=>Number(a.stale)-Number(b.stale)||a.project.localeCompare(b.project)||a.location.localeCompare(b.location)||a.title.localeCompare(b.title)||a.session.id.localeCompare(b.session.id));
}

export function sessionsMarkup(state, host='all', query='') {
  const rows=liveSessionRows(state,host,query),live=rows.filter(r=>!r.stale),interactive=live.filter(r=>r.terminal&&r.state!=='Paused');
  const warnings=[...(state.localDiscovery?.healthy===false?['Local discovery is incomplete.']:[]),...(state.remote || []).filter(r=>r.error).map(r=>(state.hostNames?.[r.host] || r.host)+': discovery unavailable.')];
  return `<div class="sessions-heading"><div><h1>Sessions</h1><p>${live.length} live · ${interactive.length} interactive${rows.length-live.length?' · '+(rows.length-live.length)+' unverified':''}</p></div><button data-session-new>＋ New terminal</button></div>
    <p class="sessions-help">Select a session to open it. Type directly in interactive terminals. <span>Running describes the process; it does not imply task progress.</span></p>
    ${warnings.length?`<div class="sessions-warning" role="status">${warnings.map(html).join(' ')} Last known sessions remain visible as unverified.</div>`:''}
    <div class="sessions-table-wrap"><table class="sessions-table"><thead><tr><th scope="col">Project / session</th><th scope="col">Provider / model</th><th scope="col">Location / terminal</th><th scope="col">State / access</th></tr></thead><tbody>${rows.map(row=>`<tr class="${row.stale?'session-unverified':''}"><td><span class="session-project">${html(row.project)}</span><button data-id="${html(row.session.id)}" title="${html(row.title)}">${html(row.title)}</button>${row.checkout?`<small class="session-checkout">${html(row.checkout)}</small>`:''}<small title="${html(row.session.cwd)}">${html(row.session.cwd)}</small></td><td><span>${html(row.session.provider)}</span><small class="session-model" title="${html(row.modelHint)}">${html(row.model)}</small></td><td><span>${html(row.location)}</span><small>${html(row.identity)}</small></td><td><span class="session-state-label">${html(row.state)}</span><small>${html(row.access)}</small></td></tr>`).join('')}</tbody></table>${!rows.length?'<div class="empty">No live sessions match. Change the filter or start a terminal.</div>':''}</div>
    <p class="sessions-footnote">External terminals started outside tmux are view only. Start new sessions here for direct keyboard access. Saved conversations and background services are in More.</p>`;
}
