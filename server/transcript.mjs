import fs from 'node:fs';

// Pages end on JSONL record boundaries. The cursor is a byte offset in an already
// indexed provider file, never a client-selected filesystem path.
export function readRecordPage(file, cursor, budget = 256 * 1024) {
  const fd = fs.openSync(file, 'r');
  try {
    const size = fs.fstatSync(fd).size;
    const end = cursor === undefined || cursor === null || cursor === '' ? size : Number(cursor);
    if (!Number.isSafeInteger(end) || end < 0 || end > size) throw new Error('Conversation changed. Reload its recent output.');
    let start, bytes, first;
    let length = Math.min(end, budget);
    do {
      start = end - length;
      bytes = Buffer.alloc(length);
      bytes = bytes.subarray(0, fs.readSync(fd, bytes, 0, length, start));
      first = start ? bytes.indexOf(10) : -1;
      if (!start || (first >= 0 && first < bytes.length - 1) || length >= 8 * 1024 * 1024) break;
      length = Math.min(end, length * 2);
    } while (true);
    const skippedLargeRecord = start > 0 && (first < 0 || first === bytes.length - 1);
    const offset = start && first >= 0 && !skippedLargeRecord ? first + 1 : 0;
    let position = start + offset;
    const records = skippedLargeRecord ? [] : bytes.subarray(offset).toString('utf8').split('\n').flatMap(line => {
      const recordOffset = position; position += Buffer.byteLength(line) + 1;
      try {
        const value = JSON.parse(line);
        if (!value || typeof value !== 'object') return [];
        Object.defineProperty(value, '_outputOffset', { value: recordOffset, enumerable: false });
        return [value];
      } catch { return []; }
    });
    const nextCursor = start + offset || null;
    return { records, nextCursor, coverage: { totalBytes: size, from: start + offset, to: end, skippedLargeRecord } };
  } finally { fs.closeSync(fd); }
}

const readable = value => typeof value === 'string' ? value : value == null ? '' : JSON.stringify(value, null, 2);
const textContent = value => Array.isArray(value) ? value.filter(c => ['text','input_text','output_text'].includes(c?.type)).map(c => c.text || '').join('\n') : readable(value);

// Preserve provider-visible commentary and tool traffic separately from the
// compact conversation used for model context. Never decode encrypted reasoning.
export function eventsFromRecords(provider, records) {
  const events = [];
  let ordinal = 0;
  const push = (record, role, kind, text, name) => {
    if (!text) return;
    const event = { role, kind, text: readable(text), timestamp: record.timestamp || record.ts || null, ...(name ? { name } : {}) };
    if (Number.isSafeInteger(record._outputOffset)) event.id = `${provider}:${record._outputOffset}:${ordinal++}`;
    events.push(event);
  };
  for (const r of records) {
    ordinal = 0;
    const p = r.payload || r;
    if (provider === 'codex') {
      if ((r.type === 'response_item' && p.type === 'message') || ['userMessage','agentMessage'].includes(p.type)) {
        const role = p.role || (p.type === 'userMessage' ? 'user' : 'assistant');
        if (['user','assistant'].includes(role)) push(r, role, p.channel === 'commentary' ? 'commentary' : 'message', p.text || textContent(p.content));
      } else if (['function_call','custom_tool_call','tool_call'].includes(p.type)) {
        push(r, 'tool', 'tool_call', p.arguments ?? p.input, p.name || p.call_id);
      } else if (['function_call_output','custom_tool_call_output','tool_result'].includes(p.type)) {
        push(r, 'tool', 'tool_result', textContent(p.output ?? p.content), p.name || p.call_id);
      } else if (p.type === 'commandExecution') {
        push(r, 'tool', 'tool_call', p.command, 'command');
        push(r, 'tool', 'tool_result', p.aggregatedOutput ?? p.output, 'command');
      } else if (p.type === 'fileChange') {
        push(r, 'tool', 'tool_result', p.changes, 'file changes');
      }
    } else {
      const role = r.type || r.role;
      if (!['user','assistant','tool'].includes(role) || r.isMeta) continue;
      const content = r.message?.content ?? r.content;
      if (Array.isArray(content)) {
        for (const c of content) {
          if (['text','input_text','output_text'].includes(c.type)) push(r, role, 'message', c.text);
          if (c.type === 'tool_use') push(r, 'tool', 'tool_call', c.input, c.name);
          if (c.type === 'tool_result') push(r, 'tool', 'tool_result', textContent(c.content), c.tool_use_id);
        }
      } else push(r, role, role === 'tool' ? 'tool_result' : 'message', content, r.name);
      for (const call of r.tool_calls || r.message?.tool_calls || []) push(r, 'tool', 'tool_call', call.function?.arguments, call.function?.name);
    }
  }
  return events;
}
