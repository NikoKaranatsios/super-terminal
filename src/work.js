import './work.css';
export function createWorkUI(ui) {
  const { $, esc, api, toast, header, badge, providerNames, hostName, shortPath, relative, showDialog, dialogTop } = ui;
  const state = () => ui.state();
  const sessionFor = id => state().workSessions.find(s => s.id === id);
  const statusMark = status => status === 'done' ? '[x]' : status === 'doing' ? '[~]' : '[ ]';
  function members(scope) {
    return state().sessions.filter(a => a.kind === 'managed' && a.scope?.workSessionId === scope.workSessionId && (a.scope.projectId || null) === (scope.projectId || null) && (a.scope.goalId || null) === (scope.goalId || null));
  }
  function agentStrip(scope) {
    const encoded = esc(JSON.stringify(scope));
    return `<div class="scope-agents">${members(scope).map(a => `<button data-session="${esc(a.id)}" title="${esc(a.title)}">${badge(a.provider)}<span>${esc(a.role || providerNames[a.provider])}</span><i class="status-dot ${esc(a.status)}"></i></button>`).join('')}<button class="scope-add" data-scope-agent="${encoded}">＋ Agent</button></div>`;
  }
  function overview() {
    const sessions = state().workSessions.slice().reverse();
    $('#main').innerHTML = `${header('Working sessions', 'Your work, from first briefing to final handoff.', '<button class="primary" data-work-new="1">Start a working session ＋</button>')}
    <div class="work-scroll"><div class="work-intro"><div class="eyebrow">SESSIONS → PROJECTS → GOALS</div><h2>A little structure.<br>A clear place to pick things up.</h2><p>Bring a few big topics. Break them into project goals.<br>Give agents ownership at any level, and finish with a handoff for next time.</p></div>
    <div class="work-list">${sessions.map(s => `<button class="work-card" data-work="${esc(s.id)}"><div class="work-card-top"><span class="work-status ${s.status}">${s.status === 'wrapped' ? 'WRAPPED UP' : s.status.toUpperCase()}</span><time>${relative(s.endedAt || s.startedAt)}</time></div><h3>${esc(s.title)}</h3><p>${s.projects.map(p => esc(p.name)).join(' / ') || 'Add your first project'}</p><div class="work-card-bottom"><span>${s.projects.length} projects</span><span>${s.progress.done}/${s.progress.total} goals completed</span><span>${state().sessions.filter(a => a.scope?.workSessionId === s.id).length} assigned agents</span><b>↗</b></div></button>`).join('') || '<div class="work-first"><span>01 / start</span><p>Start a working session with the topics you want to tackle.<br>No AI request is needed to organize your work.</p><button class="primary" data-work-new="1">Start your first session →</button></div>'}</div></div>`;
  }
  function detail(id) {
    const s = sessionFor(id); if (!s) return ui.select('work');
    $('#main').innerHTML = `${header(s.title, `${new Date(s.startedAt).toLocaleString()} / ${s.status}`, `<button class="small-button" data-work-brief="${esc(id)}">Quick briefing ✳</button>${s.status === 'wrapped' ? `<button class="primary" data-work-new="1" data-carry="${esc(id)}">Start next session ↗</button>` : `<button class="primary" data-work-wrap="${esc(id)}">Wrap up session →</button>`}`)}
      <div class="work-scroll work-detail"><div class="session-phases"><span class="complete">01 / start</span><i>────</i><span class="${s.status !== 'wrapped' ? 'current' : 'complete'}">02 / progress</span><i>────</i><span class="${s.status === 'wrapped' ? 'complete' : ''}">03 / wrap up</span><button class="text-button" data-work-overview="1">All sessions ↗</button></div>
      <div class="work-summary-line"><div><div class="eyebrow">WORKING SESSION</div><h2>${esc(s.title)}</h2><p id="work-progress-text"></p></div><div id="work-session-agents">${agentStrip({workSessionId:id})}</div></div>
      ${s.status === 'wrapped' ? `<div class="wrap-result"><div class="eyebrow">HANDOFF FOR NEXT TIME</div><pre>${esc(s.summary)}</pre></div>` : s.status === 'paused' ? `<div class="transcript-notice">This session is paused. <button class="text-button" data-work-resume="${esc(id)}">Resume this working session →</button></div>` : ''}
      <div id="work-briefing">${latestBriefing(id)}</div><div id="work-outline"></div>
      <button class="add-project" data-work-project="${esc(id)}">＋ Add project</button>
      <form id="work-notes-form" data-id="${esc(id)}" class="work-notes"><div class="section-title"><h3>Notes for this working session</h3><button class="small-button" type="submit">Save notes</button></div><textarea name="notes" rows="3" maxlength="12000" placeholder="Decisions, blockers, and where to pick up next time…">${esc(s.notes)}</textarea></form></div>`;
    update();
  }
  function latestBriefing(id) {
    const report = state().coordinator.history.filter(c => c.workSessionId === id).at(-1);
    return report ? `<details class="session-briefing" open><summary>✳ Latest consolidation <span>${relative(report.createdAt)}</span></summary><div class="message-text">${esc(report.answer || 'Preparing briefing…')}</div><small>${report.usage ? `${report.usage.input_tokens} input / ${report.usage.output_tokens} output tokens` : report.status}</small></details>` : '';
  }
  function update() {
    const id = ui.selected().slice(5), s = sessionFor(id);
    if (!s || !$('#work-outline')) return;
    $('#work-progress-text').textContent = `${s.progress.done} completed · ${s.progress.doing} in progress · ${s.progress.open} open · ${s.projects.length} projects`;
    $('#work-session-agents').innerHTML = agentStrip({workSessionId:id});
    if (!state().coordinator.running) $('#work-briefing').innerHTML = latestBriefing(id);
    $('#work-outline').innerHTML = s.projects.map(p => {
      const scope = { workSessionId:id, projectId:p.id };
      return `<section class="project-outline"><div class="project-top"><span class="project-prefix">▾ project</span><h3>${esc(p.name)}</h3><button class="project-location" data-project-location="${esc(p.id)}" data-work-id="${esc(id)}">${esc(hostName(p.host))} · ${esc(shortPath(p.cwd))} ↗</button>${agentStrip(scope)}</div>
      <div class="goal-list">${p.goals.map(g => `<div class="goal-row ${esc(g.status)}"><button class="goal-check" data-goal-status="${esc(g.id)}" data-work-id="${esc(id)}" title="Cycle progress: open → in progress → completed" aria-label="${esc(g.title)}: ${g.status}. Change status">${statusMark(g.status)}</button><div class="goal-content"><button class="goal-title" data-goal-notes="${esc(g.id)}" data-work-id="${esc(id)}">${esc(g.title)}</button>${g.notes ? `<small>${esc(g.notes)}</small>` : ''}</div>${agentStrip({...scope,goalId:g.id})}</div>`).join('') || '<div class="empty-goals">Add the goal or task you want to tackle in this project.</div>'}</div><button class="add-goal" data-work-goal="${esc(p.id)}" data-work-id="${esc(id)}">＋ Add goal / task</button></section>`;
    }).join('') || '<div class="work-first compact"><span>›_ no projects yet</span><p>Add a project, then give it a goal or task.</p></div>';
  }
  function startDialog(carry = '') {
    const previous = carry ? sessionFor(carry) : state().workSessions.filter(s => s.status === 'wrapped').at(-1);
    showDialog(`<form id="work-start-form">${dialogTop('Start a working session', 'Drop in a few topics. You can refine the outline as you go.')}<label>Session name<input name="title" maxlength="200" placeholder="e.g. Tuesday build session"></label><label>Big topics<textarea name="topics" rows="6" maxlength="20000" placeholder="romagnolo: Finish the release flow&#10;fcp: Review onboarding&#10;Prepare the demo"></textarea></label><p class="form-note">One topic per line. Use <code>Project: goal</code> to group topics automatically. Other lines go into General.</p>${previous ? `<label class="inline-check"><input type="checkbox" name="carryFrom" value="${esc(previous.id)}" ${carry ? 'checked' : ''}> Carry ${previous.progress.open} unfinished goals from ${esc(previous.title)}</label>` : ''}<label class="inline-check"><input type="checkbox" name="briefing"> Give me a quick AI briefing after starting</label><div class="form-error" role="alert"></div><div class="dialog-footer"><span>Briefing is optional. No agents launch automatically.</span><button class="primary" type="submit">Start session →</button></div></form>`, true);
  }
  function projectDialog(workId, projectId = '') {
    const p = sessionFor(workId)?.projects.find(p => p.id === projectId);
    showDialog(`<form id="work-project-form" data-id="${esc(workId)}" data-project="${esc(projectId)}">${dialogTop(p ? 'Project location' : 'Add a project', 'Agents assigned here use this folder and host.')}<label>Project name<input name="name" required maxlength="120" value="${esc(p?.name || '')}" ${p ? 'disabled' : ''}></label><label>Location<select name="host"><option value="local">This Mac</option>${state().hosts.map(h => `<option value="${esc(h)}" ${p?.host === h ? 'selected' : ''}>${esc(hostName(h))}</option>`).join('')}</select></label><label>Working directory<input name="cwd" required value="${esc(p?.cwd || state().defaultCwd)}"></label><div class="form-error" role="alert"></div><div class="dialog-footer"><span></span><button class="primary" type="submit">${p ? 'Save location' : 'Add project'} →</button></div></form>`);
    $('#work-project-form [name=host]').addEventListener('change', e => { $('#work-project-form [name=cwd]').value = e.target.value === 'local' ? state().defaultCwd : '~'; });
  }
  async function briefing(id) {
    const current = ui.selected();
    if (current !== 'work:' + id) await ui.select('work:' + id);
    $('#work-briefing').innerHTML = '<div class="transcript-notice">✳ Preparing your optional briefing…</div>';
    await api('/coordinator', 'POST', {workSessionId:id,prompt:'Give me a quick working-session briefing. Where did I leave off? Summarize the previous wrap-up if available, current project goals, confirmed recent progress, and the next useful steps. Distinguish known facts from missing evidence. Keep it brief.'});
    await ui.refresh();
    if ($('#work-briefing') && ui.selected() === 'work:' + id) $('#work-briefing').innerHTML = latestBriefing(id);
  }
  async function click(b) {
    if (b.dataset.workNew) { startDialog(b.dataset.carry); return true; }
    if (b.dataset.work) { await ui.select('work:' + b.dataset.work); return true; }
    if (b.dataset.workOverview) { await ui.select('work'); return true; }
    if (b.dataset.workProject) { projectDialog(b.dataset.workProject); return true; }
    if (b.dataset.projectLocation) { projectDialog(b.dataset.workId,b.dataset.projectLocation); return true; }
    if (b.dataset.workResume) { await api('/work-sessions/' + b.dataset.workResume,'PATCH',{status:'active'}); await ui.refresh(); detail(b.dataset.workResume); return true; }
    if (b.dataset.workBrief) { await briefing(b.dataset.workBrief); return true; }
    if (b.dataset.workGoal) {
      showDialog(`<form id="work-goal-form" data-id="${esc(b.dataset.workId)}">${dialogTop('Add a goal or task')}<input type="hidden" name="projectId" value="${esc(b.dataset.workGoal)}"><label>Outcome<input name="title" required maxlength="800" placeholder="What should be true when this is done?"></label><div class="dialog-footer"><span></span><button type="submit" class="primary">Add goal →</button></div></form>`);
      return true;
    }
    if (b.dataset.goalStatus) {
      const s = sessionFor(b.dataset.workId), g = s.projects.flatMap(p=>p.goals).find(g=>g.id===b.dataset.goalStatus);
      const next = {todo:'doing',doing:'done',done:'todo'}[g.status];
      await api(`/work-sessions/${s.id}/goals/${g.id}`,'PATCH',{status:next}); await ui.refresh(); update(); return true;
    }
    if (b.dataset.goalNotes) {
      const g = sessionFor(b.dataset.workId).projects.flatMap(p=>p.goals).find(g=>g.id===b.dataset.goalNotes);
      showDialog(`<form id="work-goal-notes-form" data-id="${esc(b.dataset.workId)}" data-goal="${esc(g.id)}">${dialogTop('Goal progress',g.title)}<label>Status<select name="status">${['todo','doing','done'].map(s=>`<option value="${s}" ${s===g.status?'selected':''}>${{todo:'Open',doing:'In progress',done:'Completed'}[s]}</option>`).join('')}</select></label><label>Notes<textarea name="notes" rows="5" maxlength="6000" placeholder="Progress, blockers, or a completion note…">${esc(g.notes)}</textarea></label><div class="dialog-footer"><span></span><button type="submit" class="primary">Save progress</button></div></form>`);return true;
    }
    if (b.dataset.workWrap) {
      const s=sessionFor(b.dataset.workWrap);
      showDialog(`<form id="work-wrap-form" data-id="${esc(s.id)}">${dialogTop('Wrap up your working session',`${s.progress.done} completed · ${s.progress.open} unfinished goals`)}<div class="wrap-open-goals">${s.projects.flatMap(p=>p.goals.filter(g=>g.status!=='done').map(g=>`<p><code>${statusMark(g.status)}</code> <span>${esc(p.name)} / ${esc(g.title)}</span></p>`)).join('')||'<p>All goals completed.</p>'}</div><label>Where should you pick up next time?<textarea name="notes" rows="5" maxlength="12000" placeholder="Decisions, loose ends, and the next action…">${esc(s.notes)}</textarea></label><p class="form-note">This saves a session handoff. Agent terminals keep running until you close them. Unfinished goals can be carried into your next session.</p><div class="dialog-footer"><button class="text-button" type="button" data-action="close-dialog">Keep working</button><button class="primary" type="submit">Save wrap-up →</button></div></form>`,true);return true;
    }
    if (b.dataset.scopeAgent) {
      const scope=JSON.parse(b.dataset.scopeAgent), s=sessionFor(scope.workSessionId), p=s.projects.find(p=>p.id===scope.projectId), g=p?.goals.find(g=>g.id===scope.goalId);
      const candidates=state().sessions.filter(a=>a.kind==='managed');
      showDialog(`${dialogTop('Assign an agent',`Scope: ${s.title}${p?' / '+p.name:''}${g?' / '+g.title:''}`)}<div class="scope-launch-options">${['codex','claude','grok'].map(provider=>`<button class="launch-card" data-scope-launch="${esc(JSON.stringify(scope))}" data-scope-provider="${provider}">${badge(provider)}<span>Start ${providerNames[provider]}</span></button>`).join('')}</div><h3 class="dialog-section-title">Or assign an existing terminal</h3><div class="split-options">${candidates.map(a=>`<button class="recent-row" data-scope-existing="${esc(a.id)}" data-scope-value="${esc(JSON.stringify(scope))}">${badge(a.provider)}<span><strong>${esc(a.title)}</strong><small>${esc(a.group)}</small></span></button>`).join('')||'<p class="form-note">No managed terminals yet.</p>'}</div>`,true);return true;
    }
    if (b.dataset.scopeLaunch) { const scope=JSON.parse(b.dataset.scopeLaunch); $('#dialog').close(); ui.launch(b.dataset.scopeProvider,scope);return true; }
    if (b.dataset.scopeExisting) { await api('/sessions/'+b.dataset.scopeExisting,'PATCH',{scope:JSON.parse(b.dataset.scopeValue)});$('#dialog').close();await ui.refresh();update();toast('Agent assigned. Its scope was added to its inbox.');return true; }
    return false;
  }
  async function submit(form,data) {
    if (!form.id.startsWith('work-')) return false;
    if (form.id==='work-start-form') {
      const s=await api('/work-sessions','POST',data);$('#dialog').close();await ui.refresh();await ui.select('work:'+s.id);if(data.briefing)await briefing(s.id);
    } else if(form.id==='work-notes-form') {await api('/work-sessions/'+form.dataset.id,'PATCH',data);await ui.refresh();toast('Session notes saved.');}
    else if(form.id==='work-project-form') {await api('/work-sessions/'+form.dataset.id+'/projects'+(form.dataset.project?'/'+form.dataset.project:''),form.dataset.project?'PATCH':'POST',data);$('#dialog').close();await ui.refresh();update();}
    else if(form.id==='work-goal-form') {await api('/work-sessions/'+form.dataset.id+'/goals','POST',data);$('#dialog').close();await ui.refresh();update();}
    else if(form.id==='work-goal-notes-form') {await api(`/work-sessions/${form.dataset.id}/goals/${form.dataset.goal}`,'PATCH',data);$('#dialog').close();await ui.refresh();update();}
    else if(form.id==='work-wrap-form') {await api('/work-sessions/'+form.dataset.id,'PATCH',{...data,status:'wrapped'});$('#dialog').close();await ui.refresh();detail(form.dataset.id);}
    return true;
  }
  return {overview,detail,update,click,submit};
}
