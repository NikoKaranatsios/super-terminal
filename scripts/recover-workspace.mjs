import path from 'node:path';
import net from 'node:net';
import { execFileSync } from 'node:child_process';
import { applyWorkspaceRecovery, previewWorkspaceRecovery } from '../server/workspace-reconcile.mjs';

export function assertNoAppWriters() {
  const rows = execFileSync('/bin/ps', ['-axo', 'pid=,command='], { encoding: 'utf8', maxBuffer: 16 * 1024 * 1024 });
  const active = rows.split('\n').some(row => {
    const match = row.match(/^\s*(\d+)\s+(.*)$/);
    if (!match || Number(match[1]) === process.pid) return false;
    const command = match[2];
    return /^\S.*Super Terminal\.app\/Contents\/MacOS\/Super Terminal(?:\s|$)/.test(command)
      || /^(?:\S*\/)?(?:node|electron)\s+(?:\S+\s+)*\S*server\/index\.mjs(?:\s|$)/.test(command);
  });
  if (active) throw new Error('Quit Super Terminal and its development servers before recovery. Agent terminals must remain running.');
}

export async function withOfflineService(port, run) {
  assertNoAppWriters();
  const server = net.createServer(socket => socket.destroy());
  await new Promise((resolve, reject) => {
    server.once('error', () => reject(new Error('The service port is in use; no recovery was applied.')));
    server.listen({ port, host: '127.0.0.1', exclusive: true }, resolve);
  });
  try { assertNoAppWriters(); return await run(assertNoAppWriters); }
  finally { await new Promise(resolve => server.close(resolve)); }
}

async function main() {
  const [operation, directory, archive, policy, ...extra] = process.argv.slice(2);
  if (operation === 'preview' && directory && !archive) {
    console.log(JSON.stringify(previewWorkspaceRecovery(path.resolve(directory)), null, 2)); return;
  }
  if (operation !== 'apply' || !directory || !archive || policy !== '--keep-current-project-fields' || extra.length) {
    throw new Error('Usage: node scripts/recover-workspace.mjs preview DATA_DIRECTORY\nOr, outside Super Terminal after quitting it: node scripts/recover-workspace.mjs apply DATA_DIRECTORY NEW_PRIVATE_ARCHIVE --keep-current-project-fields');
  }
  const port = Number(process.env.PORT || 4317);
  if (!Number.isInteger(port) || port < 1024 || port > 65535) throw new Error('Invalid service port.');
  const result = await withOfflineService(port, assertOffline => applyWorkspaceRecovery(directory, archive, { assertOffline }));
  console.log(JSON.stringify(result, null, 2));
}
if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) main().catch(error => {
  console.error(error.message); process.exitCode = 1;
});
