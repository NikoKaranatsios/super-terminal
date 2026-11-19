import os from 'node:os';
import path from 'node:path';
import { inspectWorkspaceRecovery } from '../server/workspace-recovery.mjs';

const args = process.argv.slice(2);
if (args.length > 1 || args[0]?.startsWith('-')) {
  console.error('Usage: npm run recovery:inspect -- [data-directory]. Read-only; no apply operation is available.');
  process.exitCode = 1;
} else {
  try {
    const root = path.resolve(args[0] || process.env.SUPER_TERMINAL_DATA || path.join(os.homedir(), '.super-terminal'));
    console.log(JSON.stringify(inspectWorkspaceRecovery(root), null, 2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
