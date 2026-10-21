import { html, projectWork } from './work-views.mjs';

export function agentCapabilities(agent) {
  const supplied=agent.capabilities || {};
  const enrolled=agent.kind==='managed' && !agent.runtime && !agent.enrollmentRevokedAt && !['stopped','exited'].includes(agent.status);
  const terminal=['managed','tmux','remote'].includes(agent.kind) && !agent.runtime && !agent.connectionLost && !['paused','stopped','exited','disconnected'].includes(agent.status);
  return {
    mailbox:agent.contextIsolation==='restart-required'?false:supplied.mailbox ?? enrolled,
    terminalInput:terminal && (supplied.terminalInput ?? true),
    assignProject:supplied.assignProject ?? (!agent.runtime && ['managed','tmux','remote','external'].includes(agent.kind)),
    continuationHistoryId:agent.contextIsolation==='restart-required'?null:supplied.continuationHistoryId!==undefined?supplied.continuationHistoryId:(agent.kind==='history'?agent.id:agent.historyId || null)
  };
}

export function projectForAgent(agent,state) {
  const task=(state.tasks || []).find(t=>t.id===agent.taskId || t.id===agent.scope?.goalId || t.agentId===agent.id);
  const id=agent.projectAssignment ? agent.projectId : agent.projectId || task?.projectId;
  return projectWork(state).find(p=>p.id===id) || null;
}

export function projectOptions(state,selectedId,host) {
  return `<option value="">Unassigned</option>${projectWork(state).filter(p=>(!host||p.host===host)&&(p.status!=='archived'||p.id===selectedId)).map(p=>`<option value="${html(p.id)}"${p.id===selectedId?' selected':''}>${html(p.name)} · ${html(state.hostNames?.[p.host] || p.host || 'unassigned')}</option>`).join('')}`;
}

export function messageTransport(agent) {
  const capabilities=agentCapabilities(agent);
  if(agent.contextIsolation==='restart-required')return {mode:'copy',button:'Copy message',hint:'This agent retains its previous model context. Its platform mailbox and context are withheld. Start a fresh agent in the selected project to keep work separated; the existing terminal stays available.'};
  if(capabilities.mailbox)return {mode:'mailbox',button:'Queue message',hint:agent.status==='paused'?'The agent is paused. Messages wait in its mailbox until a checkpoint after it resumes.':'Queued to the agent mailbox. Read means the agent fetched it; it does not confirm acceptance or completion.'};
  if(capabilities.terminalInput)return {mode:'terminal',button:'Send to terminal',hint:'Writes your text and Enter to this live terminal. Check its current prompt before sending.'};
  return {mode:'copy',button:'Copy message',hint:agent.runtime?'This is a background service, not an interactive agent. Copy text for an agent terminal.':agent.kind==='history'?'This is a saved conversation. Copy text or explicitly continue it in a managed agent.':agent.kind==='external'?'This external terminal cannot safely receive keystrokes here. Copy your message and paste it into the original terminal.':'This terminal is paused, stopped or unavailable. Copy your draft, or reconnect or resume the process before sending.'};
}

export function messageReceiptMarkup(messages,agentId,lastReceipt) {
  const rows=(messages || []).filter(m=>m.to===agentId&&m.from==='you').slice(-3);
  if(lastReceipt?.id&&!rows.some(m=>m.id===lastReceipt.id))rows.push(lastReceipt);
  return rows.slice(-3).map(m=>`<div class="message-receipt"><span>${messageDeliveryLabel(m)}</span><span>${html(m.text || m.body || '')}</span></div>`).join('');
}
export function messageDeliveryLabel(message) { return message.delivery==='withdrawn'?'Withdrawn · assignment changed':message.read||message.delivery==='read'?'Read by agent':'Queued · awaiting read'; }
