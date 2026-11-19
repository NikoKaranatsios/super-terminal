import { terminalTheme } from './terminal-theme.mjs';
import { markdownText } from './markdown.mjs';

const escape = value => String(value ?? '').replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const colors = ['black','red','green','yellow','blue','magenta','cyan','white','brightBlack','brightRed','brightGreen','brightYellow','brightBlue','brightMagenta','brightCyan','brightWhite'].map(name => terminalTheme[name]);
const readable = value => typeof value === 'string' ? value : JSON.stringify(value, null, 2);

function indexedColor(n) {
  if (!Number.isInteger(n) || n < 0 || n > 255) return null;
  if (n < 16) return colors[n];
  if (n >= 232) return `rgb(${Array(3).fill(8+(n-232)*10).join(',')})`;
  const levels = [0,95,135,175,215,255]; n -= 16;
  return `rgb(${[levels[Math.floor(n/36)],levels[Math.floor(n/6)%6],levels[n%6]].join(',')})`;
}

function sgr(state, source) {
  const codes = source.split(';').map(n => n === '' ? 0 : Number(n));
  for (let i=0; i<codes.length; i++) {
    const n = codes[i];
    if (n === 0) { for (const key of Object.keys(state)) delete state[key]; }
    else if (n === 1) state.bold = true;
    else if (n === 2) state.dim = true;
    else if (n === 3) state.italic = true;
    else if (n === 4) state.underline = true;
    else if (n === 7) state.inverse = true;
    else if (n === 9) state.strike = true;
    else if (n === 22) { delete state.bold; delete state.dim; }
    else if (n === 23) delete state.italic;
    else if (n === 24) delete state.underline;
    else if (n === 27) delete state.inverse;
    else if (n === 29) delete state.strike;
    else if (n === 39) delete state.fg;
    else if (n === 49) delete state.bg;
    else if (n >= 30 && n <= 37) state.fg = colors[n-30];
    else if (n >= 90 && n <= 97) state.fg = colors[n-90+8];
    else if (n >= 40 && n <= 47) state.bg = colors[n-40];
    else if (n >= 100 && n <= 107) state.bg = colors[n-100+8];
    else if (n === 38 || n === 48) {
      const target = n === 38 ? 'fg' : 'bg';
      const mode = codes[++i];
      if (mode === 5) { const color = indexedColor(codes[++i]); if (color) state[target] = color; }
      else if (mode === 2) {
        const rgb = codes.slice(i+1,i+4); i += 3;
        if (rgb.length === 3 && rgb.every(c => Number.isInteger(c) && c >= 0 && c <= 255)) state[target] = `rgb(${rgb.join(',')})`;
      }
    }
  }
}

function ansiText(value, state) {
  // Only SGR styling is interpreted. Cursor, title, clipboard and link escape
  // sequences never become DOM commands or attributes in a saved transcript.
  const controls = /\x1b(?:\[[0-?]*[ -/]*[@-~]|\][^\x07\x1b]*(?:\x07|\x1b\\)|[@-_])|[\x00-\x08\x0b-\x1f\x7f]/g;
  const paint = text => {
    if (!text) return '';
    const style = [], classes = [];
    let fg = state.fg, bg = state.bg;
    if (state.inverse) [fg,bg] = [bg || terminalTheme.background,fg || terminalTheme.foreground];
    if (fg) style.push(`color:${fg}`);
    if (bg) style.push(`background-color:${bg}`);
    for (const key of ['bold','dim','italic','underline','strike']) if (state[key]) classes.push('ansi-'+key);
    return style.length || classes.length ? `<span${classes.length ? ` class="${classes.join(' ')}"` : ''}${style.length ? ` style="${style.join(';')}"` : ''}>${escape(text)}</span>` : escape(text);
  };
  let html = '', start = 0;
  for (const match of value.matchAll(controls)) {
    html += paint(value.slice(start,match.index)); start = match.index+match[0].length;
    const code = /^\x1b\[([\d;]*)m$/.exec(match[0]);
    if (code) sgr(state,code[1]);
  }
  return html+paint(value.slice(start));
}

export function consoleText(value, { markdown = false } = {}) {
  const text = String(value ?? '');
  return markdown ? markdownText(text,ansiText) : ansiText(text,{});
}

export function traceTone(event) {
  const kind = [event.kind,event.type,event.name,event.role].filter(Boolean).join(' ').toLowerCase();
  if (/error|fail/.test(kind+' '+(event.status || '')) || (event.exitCode != null && Number(event.exitCode) !== 0) || event.result?.error || event.result?.ok === false) return 'error';
  if (/warn|blocked|cancel|partial/.test(kind+' '+(event.status || '')) || event.result?.partial) return 'warning';
  if (/skill/.test(kind)) return 'skill';
  if (/command|tool_call|web_search|file_change/.test(kind) || event.command) return 'tool';
  if (/tool_result/.test(kind)) return 'result';
  if (/agent_message|commentary|assistant/.test(kind)) return 'commentary';
  if (/completed|success/.test(kind+' '+(event.status || ''))) return 'success';
  return 'meta';
}

export function traceMarkup(event) {
  if (typeof event === 'string') return `<div class="line trace-line console-meta"><div class="console-body">${consoleText(event)}</div></div>`;
  if (!event || typeof event !== 'object') return '';
  // Keep the complete structured transport available without duplicating a
  // JSON-escaped answer in the main reading flow. Commentary stays expanded.
  if (event.name === 'agent_message' && typeof event.text === 'string') {
    try {
      const payload = JSON.parse(event.text);
      if (typeof payload.answer === 'string' && Array.isArray(payload.actions) && Array.isArray(payload.assessments)) return `<details class="line trace-line console-meta console-payload" data-trace-id="${escape(JSON.stringify([event.at,event.itemId,event.seq]))}"><summary>Model response · structured data</summary><pre>${consoleText(event.text)}</pre></details>`;
    } catch {}
  }
  const tone = traceTone(event);
  const text = [event.text || event.message,event.output,event.result,event.usage].filter(value => value != null && value !== '').map(readable).join('\n');
  const label = event.kind || event.type || event.role || 'activity';
  return `<div class="line trace-line console-${tone}"><div class="console-label"><span class="console-marker" aria-hidden="true">${tone === 'error' ? '×' : tone === 'success' ? '✓' : '·'}</span><span>${escape(label)}${event.name ? ' · '+escape(event.name) : ''}</span><span class="console-meta">${escape([event.status,event.exitCode != null ? 'exit '+event.exitCode : '',event.at ? new Date(event.at).toLocaleTimeString() : ''].filter(Boolean).join(' · '))}</span></div>${event.command ? `<pre class="console-command"><span class="console-command-marker" aria-hidden="true">$ </span>${consoleText(event.command)}</pre>` : ''}${text || !event.command ? `<div class="console-body">${consoleText(text || JSON.stringify(event,null,2),{markdown:tone === 'commentary'})}</div>` : ''}</div>`;
}

function isEnvelope(event) {
  if(event.structuredResponse)return true;
  if(event.name!=='agent_message')return false;
  // Streamed/clipped structured responses must never become prose progress.
  if(/^\s*\{/.test(event.text || ''))return true;
  try{const p=JSON.parse(event.text);return typeof p.answer==='string'&&Array.isArray(p.actions)&&Array.isArray(p.assessments);}catch{return false;}
}
function eventSteps(events){
  const latest=new Map(),other=[];let run=0;
  for(const event of events){if(event.type==='thread.started')run++;if(isEnvelope(event))continue;if(event.itemId)latest.set(`${event.round ?? run}:${event.itemId}`,event);else other.push(event);}
  return [...other,...latest.values()].filter(e=>!['thread.started','turn.started','turn.completed'].includes(e.type)).sort((a,b)=>(a.seq||0)-(b.seq||0));
}
function workingDetails(events, key, actions=[],diagnostics='') {
  if(!events.length&&!actions.length&&!diagnostics)return '';
  return `<details class="working-details" data-detail-id="work:${escape(key)}"><summary data-detail-id="summary:${escape(key)}" tabindex="0">Working details · ${events.length+actions.length} steps</summary><div class="working-detail-content">${events.map(traceMarkup).join('')}${actions.map(a=>traceMarkup({kind:a.status==='failed'?'error':'action',name:a.action?.type,status:a.status,text:a.result?.error || a.result?.result || a.status,result:a.result})).join('')}${diagnostics}</div></details>`;
}
export function conductorTurnMarkup(turn) {
  const key=turn.id || turn.createdAt || turn.prompt;
  const raw=turn.events || turn.trace || [];
  const events=eventSteps(raw);
  const structured=raw.filter(isEnvelope);
  const diagnostics=structured.length?`<details class="response-data" data-detail-id="response:${escape(key)}"><summary>Response data</summary>${structured.map(e=>`<pre>${consoleText(e.text || '')}</pre>`).join('')}</details>`:'';
  const prompt=turn.automatic?'':`<div class="line console-user"><div class="console-label">You</div><div class="console-body">${consoleText(turn.prompt)}</div></div>`;
  const failures=[...events.filter(e=>traceTone(e)==='error').map(e=>e.text || e.message || (e.exitCode!=null?`Command returned exit ${e.exitCode}`:'A step failed')),...(turn.actions || []).filter(a=>['failed','not_run','uncertain'].includes(a.status)||a.result?.ok===false||a.result?.partial||a.result?.error).map(a=>a.result?.error || a.result?.result || 'An action was not completed')];
  const warning=failures.length?`<div class="turn-problem" role="note">${failures.length} step${failures.length===1?' needs':'s need'} attention: ${escape(failures.slice(-2).map(s=>String(s).slice(0,220)).join(' · '))}</div>`:'';
  const progress=turn.status==='running'?events.filter(e=>traceTone(e)==='commentary'&&!isEnvelope(e)).at(-1)?.text:null;
  const answer=turn.answer?`<div class="line console-answer console-message${turn.status==='error'?' console-error':''}"><div class="console-label">${turn.status==='error'?'Reply failed':'Conductor'}${turn.runtime?`<span class="console-meta">${escape(turn.runtime.model || 'CLI default')}</span>`:''}<button class="copy-message" data-copy-message aria-label="Copy Conductor reply">Copy</button></div><div class="console-body">${consoleText(turn.answer,{markdown:true})}</div></div>`:'';
  const body=prompt+(progress?`<div class="turn-progress">${consoleText(progress,{markdown:true})}</div>`:'')+warning+(turn.omitted?.conversation?`<div class="console-meta">${turn.omitted.conversation} earlier exchanges were outside this reply’s context limit.</div>`:'')+(turn.omitted?.conversationDetails?'<div class="console-meta">The preceding exchange was excerpted to fit this reply’s context limit.</div>':'')+workingDetails(events,key,turn.actions,diagnostics)+(turn.traceOmitted?`<div class="console-meta">Earlier working details omitted from this bounded trace.</div>`:'')+answer;
  const choices=(turn.createdScopes || []).map(created=>`<button data-ask-scope="${escape(JSON.stringify(created.scope))}">Open ${escape(created.label || 'created work')} in Conductor</button>`).join(' ');
  return turn.automatic?`<details class="automatic-turn" data-detail-id="automatic:${escape(key)}"><summary>Background update${turn.status==='error'?' · failed':failures.length?' · '+failures.length+(failures.length===1?' step needs attention':' steps need attention'):''}</summary>${body}</details>`:body+choices;
}

export function conversationRecords(events,provider,groups=new Map()) {
  const records=[],usedGroups=new Set();let activity=[];
  const flush=()=>{if(activity.length){let id=activity.map(e=>groups.get(e.id)).find(id=>id&&!usedGroups.has(id)) || 'work:'+activity[0].id;while(usedGroups.has(id))id+=':split';usedGroups.add(id);for(const e of activity)groups.set(e.id,id);records.push({id,html:workingDetails(activity.map(e=>({kind:e.kind,role:e.role,name:e.name,text:e.text,at:e.timestamp})),id)});activity=[];}};
  for(const [index,event] of events.entries()){
    const row={...event,id:event.id || `message:${index}`};
    if(row.role==='tool'||row.kind==='commentary'){activity.push(row);continue;}
    flush();const assistant=row.role==='assistant';
    records.push({id:row.id,source:row.text,html:`<div class="line console-message ${assistant?'console-answer':'console-user'}"><div class="console-label">${escape(assistant?provider:'You')}<button data-copy-message class="copy-message" aria-label="Copy message">Copy</button></div><div class="console-body">${consoleText(row.text,{markdown:assistant})}</div></div>`});
  }
  flush();return records;
}
