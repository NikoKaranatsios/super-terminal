export const isEnrolled = agent => ['managed', 'enrolled'].includes(agent?.kind);
export function enrollmentPresence(agent, now = Date.now()) {
  const at = Date.parse(agent.lastContactAt || '');
  return { enrollment: agent.enrollmentRevokedAt ? 'revoked' : 'active', lastContactAt: agent.lastContactAt || null,
    freshness: agent.enrollmentRevokedAt ? 'revoked' : !Number.isFinite(at) ? 'never' : now - at <= 120000 ? 'recent' : 'stale',
    processState: 'unknown' };
}
