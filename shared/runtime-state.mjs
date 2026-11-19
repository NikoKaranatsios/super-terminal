// Revoking platform access does not confirm that a container stopped. Reserve
// its slot until process termination is observed/confirmed, including failures.
export function occupiesRuntimeSlot(session){
  return !['stopped','exited'].includes(session.status)&&(session.execution?.kind==='container'||!session.enrollmentRevokedAt);
}
