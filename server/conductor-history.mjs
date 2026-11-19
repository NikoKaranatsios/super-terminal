// Conductor reads are bounded evidence. Tracking labels and working-session
// membership must not grant access to another project's conversation contents.
export const HISTORY_ACTIONS = new Set(['search_history', 'read_conversation', 'read_conductor_history']);
const words = value => String(value || '').toLowerCase().split(/\s+/u).filter(Boolean);
const matches = (value, query) => words(query).every(word => value.toLowerCase().includes(word));
const excerpt = (value, bytes = 1200) => {
  const text = String(value || '');
  if (Buffer.byteLength(text) <= bytes) return text;
  return Buffer.from(text).subarray(0, bytes).toString('utf8').replace(/\uFFFD$/, '') + '\n[excerpt; remaining text omitted]';
};

export function visibleHistory(state, rows, live, {scope, workSessionId='', group='', autonomous=false} = {}) {
  const scoped = !!scope || !!workSessionId || !!group || autonomous;
  if (!scoped) return rows;
  const projects = new Set(scope?.projectIds || []);
  const agents = live.filter(a => scope ? scope.agentIds?.includes(a.id) : a.scope?.workSessionId === workSessionId && !!workSessionId || a.group === group && !!group);
  const linked = new Set(agents.map(a => a.historyId).filter(Boolean));
  return rows.filter(row => {
    if (scope?.layer !== 'project' || autonomous) {
      if (!linked.has(row.id)) return false;
    } else if (!projects.has(row.projectId) && !linked.has(row.id)) return false;
    if (!['project','task'].includes(scope?.layer)) return true;
    const sources = new Set([row.projectId, ...(row.contentProjectIds || []), ...(state.historyProvenance?.[row.id] || [])].filter(Boolean));
    const associated = [...live, ...(state.sessions || [])].filter(a => a.historyId === row.id);
    if (row.contextIsolation || associated.some(a => a.contextIsolation)) return false;
    for (const agent of associated) for (const id of [agent.contextProjectId || agent.projectId, ...(agent.contentProjectIds || [])]) if (id) sources.add(id);
    return sources.size > 0 && [...sources].every(id => projects.has(id));
  });
}

export function scopedHistory(state, history, live, options) {
  const all = async () => visibleHistory(state, await history.all(), live, options);
  return { all, get:async id => (await all()).find(row => row.id === id), async transcript(id, cursor) {
    if (!(await all()).some(row => row.id === id)) throw new Error('Conversation is outside the selected context or is no longer indexed. Use the global Conductor overview for other projects.');
    return history.transcript(id, cursor);
  }};
}

export function conversationTurns(turns, context, excludeId) {
  return turns.filter(t => t.id !== excludeId && t.status === 'complete' && t.mode !== 'autonomous' && !t.automatic && (!context?.projectScoped ||
    t.context?.key === context.key && t.context?.isolated === context.isolated && !t.context?.unknownSources &&
    JSON.stringify([...(t.context?.projectIds || [])].sort()) === JSON.stringify([...(context.projectIds || [])].sort())));
}

function before(rows, cursor) {
  if (!cursor) return rows;
  const at = rows.findIndex(r => r.id === cursor);
  if (at < 0) throw new Error('History cursor is no longer in this context. Search again without a cursor.');
  return rows.slice(at + 1);
}

export function readConductorHistory(turns, context, action, excludeId) {
  const eligible = conversationTurns(turns, context, excludeId).slice().reverse();
  const filtered = eligible.filter(t => (!action.target || t.id === action.target) && matches(`${t.prompt}\n${t.answer}`, action.text));
  const remaining = before(filtered, action.cursor);
  const page = remaining.slice(0, action.target ? 1 : 2);
  return { turns:page.map(t => ({id:t.id,createdAt:t.createdAt,user:excerpt(t.prompt, action.target ? 2200 : 700),conductor:excerpt(t.answer, action.target ? 3000 : 1200)})),
    total:filtered.length, nextCursor:remaining.length > page.length ? page.at(-1).id : null,
    access:context?.projectScoped ? 'selected project context' : 'all direct Conductor exchanges', note:'Saved direct exchanges; excerpts are marked. Project context excludes global and other-project exchanges.' };
}

export async function readHistoryAction(action, history) {
  if (action.type === 'search_history') {
    const rows = (await history.all()).filter(r => (!action.host || r.host === action.host) && matches(`${r.title} ${r.cwd}`, action.text));
    const remaining = before(rows, action.cursor), page = remaining.slice(0, 8);
    return { conversations:page.map(({id,title,host,cwd,provider,updatedAt}) => ({id,title:excerpt(title,180),host,cwd:excerpt(cwd,240),provider,updatedAt})),
      total:rows.length, nextCursor:remaining.length > page.length ? page.at(-1).id : null, note:'Search matches indexed titles and directories within the selected context, not full transcript text.' };
  }
  let providerCursor, end;
  if (action.cursor) {
    let parsed;
    try { if (action.cursor.length > 2000) throw new Error(); parsed = JSON.parse(Buffer.from(action.cursor,'base64url').toString('utf8')); } catch { throw new Error('Invalid conversation cursor.'); }
    if (parsed.id !== action.target || !Number.isSafeInteger(parsed.end) || parsed.end < 0 || parsed.page != null && (!Number.isSafeInteger(parsed.page) || parsed.page < 0)) throw new Error('Invalid conversation cursor.');
    providerCursor = parsed.page; end = parsed.end;
  }
  const transcript = await history.transcript(action.target, providerCursor);
  const messages = transcript.messages || [];
  end = end === undefined ? messages.length : Math.min(end, messages.length);
  const start = Math.max(0,end - 4);
  const next = start > 0 ? {id:action.target,page:providerCursor ?? null,end:start} : transcript.nextCursor != null ? {id:action.target,page:Number(transcript.nextCursor),end:Number.MAX_SAFE_INTEGER} : null;
  return { id:action.target,title:excerpt(transcript.session?.title,180),messages:messages.slice(start,end).map(m => ({role:m.role,text:excerpt(m.text,1000)})),
    nextCursor:next ? Buffer.from(JSON.stringify(next)).toString('base64url') : null,availability:transcript.availability,note:excerpt(transcript.note,300), excerpts:true };
}
