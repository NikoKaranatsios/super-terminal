export function notificationTarget(state,event={}) {
  const id=event.target || 'activity';
  if(['conductor','activity','settings','docs','overview','teams'].includes(id)||id.startsWith('messages:'))return {id};
  if(id.startsWith('task:')&&(state.tasks || []).some(t=>t.id===id.slice(5)))return {id};
  if(id.startsWith('project:')&&(state.projects || []).some(p=>p.id===id.slice(8)))return {id};
  const agent=(state.sessions || []).find(s=>s.id===id);
  const history=(state.history || []).find(h=>h.id===(agent?.historyId || event.historyId || id));
  if(agent&&!['stopped','exited'].includes(agent.status)&&!agent.connectionLost)return {id:agent.id};
  if(history)return {id:history.id};
  return {id:'activity',unavailable:true,message:'This notification’s target is no longer available. No linked saved conversation is currently indexed. The original event remains in Activity.',eventId:event.id};
}
