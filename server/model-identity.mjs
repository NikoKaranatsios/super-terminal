// Display only provider-recorded identity. Never infer a model from CLI defaults,
// a project name, or user/tool text, and never call a model for discovery.
export function observedModel(provider, records) {
  let observed = {};
  for (const record of records) {
    if (!record || typeof record!=='object') continue;
    let model;
    if (provider === 'codex' && record.type === 'turn_context') model = record.payload?.model;
    if (provider === 'claude' && record.type === 'assistant') model = record.message?.model;
    if (provider === 'grok' && (record.role === 'assistant' || record.type === 'assistant')) model = record.model_id || record.model || record.message?.model;
    if (typeof model !== 'string' || !validModel(model)) continue;
    observed = {model, modelSource:'provider-output', modelObservedAt:typeof record.timestamp==='string' ? record.timestamp : null};
  }
  return observed;
}

export const validModel=value=>typeof value==='string' && /^[a-zA-Z0-9][a-zA-Z0-9._:/\[\]-]{0,127}$/.test(value);
