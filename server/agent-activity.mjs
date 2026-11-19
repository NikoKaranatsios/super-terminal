// Volatile transport observations, not process-liveness or task-completion claims.
// Request bodies, credentials and returned content are deliberately not retained.
export class AgentActivity {
  constructor(now = () => Date.now()) { this.now = now; this.clients = new Map(); }
  begin(agentId, payload = {}) {
    const at = new Date(this.now()).toISOString();
    const command = String(payload.command || 'unknown').replace(/[^a-z_]/g, '').slice(0, 40);
    const client = this.clients.get(agentId) || { agentId, requests: 0, active: 0 };
    Object.assign(client, { lastStartedAt: at, command, transport: ['mcp','runtime'].includes(payload.transport) ? payload.transport : 'helper', active: client.active + 1, requests: client.requests + 1 });
    this.clients.set(agentId, client);
    let finished = false;
    return statusCode => {
      if (finished) return;
      finished = true;
      Object.assign(client, { active: Math.max(0, client.active - 1), lastFinishedAt: new Date(this.now()).toISOString(), lastStatus: statusCode >= 400 || !statusCode ? 'failed' : 'responded', statusCode });
    };
  }
  snapshot(agentIds) { return [...this.clients.values()].filter(c => agentIds.has(c.agentId)).map(c => ({ ...c })); }
}

// Agent-facing status contains no owner prompt, global trace or foreign messages.
export function conductorContact(status, state, agent) {
  const messages = state.messages.filter(m => m.from === agent.id && ['coordinator', 'conductor'].includes(m.to));
  return { id: 'coordinator', loop: status.loop?.state || 'unknown', replying: !!status.running,
    lastRoundAt: status.loop?.lastRoundAt || null, nextRoundAt: status.loop?.nextRoundAt || null,
    messages: messages.slice(-20).map(({id, text, delivery, createdAt}) => ({id, text, delivery, createdAt})), omitted: Math.max(0, messages.length - 20),
    workflow: 'Coordinate in this terminal: st_context, st_graph, st_tasks, st_report, st_send to coordinator, then st_inbox and st_ack at checkpoints. Conductor reviews authorized active work when background coordination is running. Sending queues task data; it does not start an owner chat, resume a paused loop or grant new authority. Ask the owner for decisions beyond your assignment.' };
}
