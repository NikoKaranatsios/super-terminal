import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import buildIdentityModule from '../shared/build-identity.cjs';
import { applyWorkspaceRecovery, previewWorkspaceRecovery } from '../server/workspace-reconcile.mjs';
import { installDesktop, APP_ID } from './desktop-install.mjs';
import { withOfflineService } from './recover-workspace.mjs';

const pause = ms => new Promise(resolve => setTimeout(resolve, ms));
const runtime = bundle => path.join(bundle, 'Contents/Resources/app');
const bundleId = bundle => execFileSync('/usr/libexec/PlistBuddy', ['-c', 'Print CFBundleIdentifier', path.join(bundle, 'Contents/Info.plist')], { encoding: 'utf8' }).trim();
const running = bundle => execFileSync('/bin/ps', ['-axo', 'comm='], { encoding: 'utf8' }).split('\n').map(line => line.trim()).includes(path.join(bundle, 'Contents/MacOS/Super Terminal'));
const sourceRoot = path.resolve(new URL('..', import.meta.url).pathname);
export function recoveryToolIdentity() {
  const digest = createHash('sha256');
  for (const file of ['scripts/finish-recovery-upgrade.mjs', 'scripts/recover-workspace.mjs', 'scripts/desktop-install.mjs']) digest.update(file).update(fs.readFileSync(path.join(sourceRoot, file)));
  return digest.digest('hex');
}

export function validateUpgradeManifest(config) {
  for (const key of ['dataDir', 'archiveParent', 'sourceBundle', 'appFolder', 'trash']) {
    if (typeof config[key] !== 'string' || !path.isAbsolute(config[key])) throw new Error(`The upgrade manifest needs an absolute ${key}.`);
  }
  if (!/^[a-f0-9]{64}$/.test(config.buildId || '')) throw new Error('The upgrade manifest needs an exact build identity.');
  if (!/^[a-f0-9]{64}$/.test(config.toolHash || '')) throw new Error('The upgrade manifest needs an exact recovery tool identity.');
  if (!Number.isInteger(config.port) || config.port < 1024 || config.port > 65535) throw new Error('Invalid upgrade service port.');
  if (typeof config.ownerRequest !== 'string' || !config.ownerRequest.trim() || config.ownerRequest.length > 6000 || !config.projectId || !config.teamId) throw new Error('The upgrade needs the original owner request and existing project/team identities.');
  return config;
}
async function appClient(config, expectedBuild) {
  const origin = `http://127.0.0.1:${config.port}`;
  const response = await fetch(origin + '/desktop-health', { signal: AbortSignal.timeout(5000) });
  const health = await response.json();
  const dataKey = createHash('sha256').update(path.resolve(config.dataDir)).digest('hex');
  if (!response.ok || health.product !== 'super-terminal' || health.protocol !== 2 || health.dataKey !== dataKey || (expectedBuild && health.buildId !== expectedBuild)) throw new Error('The running service has a different identity. It was left untouched.');
  const html = await (await fetch(origin + '/', { signal: AbortSignal.timeout(5000) })).text();
  const token = html.match(/<meta name="super-terminal-token" content="([a-f0-9]{64})">/)?.[1];
  if (!token) throw new Error('Cannot authenticate the local app.');
  return async (endpoint, body, timeout = 10000) => {
    const result = await fetch(origin + endpoint, { method: body ? 'POST' : 'GET',
      headers: { 'x-super-terminal': token, ...(body ? { 'content-type': 'application/json' } : {}) },
      ...(body ? { body: JSON.stringify(body) } : {}), signal: AbortSignal.timeout(timeout) });
    const value = await result.json();
    if (!result.ok) throw new Error(value.error || 'The app rejected the request.');
    return value;
  };
}
export async function submitActivationOnce({ receipt, save, request, config }) {
  if (receipt.activation) throw new Error('Activation was already submitted or its outcome is uncertain. Inspect the saved Conductor turn; do not blindly resubmit.');
  receipt.activation = { status: 'submitting' }; save();
  try {
    // The original user request enters the ordinary owner chat. That chat must
    // generate structured actions and fresh project dispatch; there is no direct
    // agent launch, team creation, copied global prompt or privacy override here.
    const turn = await request('/api/coordinator', { prompt: config.ownerRequest, projectId: config.projectId,
      environment: 'local', settingsSessionId: config.settingsSessionId || '', automatic: false }, 30 * 60 * 1000);
    receipt.activation = { status: 'responded', turnId: turn.id, turn }; save();
    return turn;
  } catch (error) {
    receipt.activation.status = 'uncertain'; receipt.activation.error = error.message; save();
    throw new Error('Activation outcome is uncertain. Check Conductor in the reopened app before any retry.', { cause: error });
  }
}
export function teamProcessReport(state, teamId) {
  const team = state.teams.find(t => t.id === teamId);
  if (!team || !Array.isArray(team.roster)) throw new Error('The recovered saved team or roster is missing.');
  return team.roster.map(role => {
    const sessions = state.sessions.filter(s => s.teamId === teamId && s.role?.toLowerCase() === role.role.toLowerCase());
    const live = sessions.filter(s => s.status === 'running' && s.launchState === 'cli-running');
    return { role: role.role, provider: role.provider, cliRunning: live.length === 1,
      duplicateLiveMembers: live.length > 1, observed: sessions.map(s => ({ id: s.id, status: s.status, launchState: s.launchState })), taskAcceptance: 'unverified' };
  });
}
async function main() {
  if (process.platform !== 'darwin') throw new Error('This installation command requires macOS.');
  const [manifest, flag, ...extra] = process.argv.slice(2);
  if (!manifest || flag !== '--apply' || extra.length) throw new Error('Usage: node scripts/finish-recovery-upgrade.mjs PRIVATE_MANIFEST --apply');
  const config = validateUpgradeManifest(JSON.parse(fs.readFileSync(manifest, 'utf8')));
  if (config.dataDir !== path.join(os.homedir(), '.super-terminal') || config.appFolder !== path.join(os.homedir(), 'Applications') || config.port !== 4317) throw new Error('The integrated finisher supports the default personal installation only. Use the separate offline recovery command for a custom installation.');
  if (buildIdentityModule.buildIdentity(sourceRoot) !== config.buildId || recoveryToolIdentity() !== config.toolHash) throw new Error('The prepared source/tools changed. Re-verify the upgrade before running it.');
  const target = path.join(config.appFolder, 'Super Terminal.app');
  const receiptFile = path.resolve(manifest) + '.receipt.json';
  if (fs.existsSync(receiptFile)) throw new Error(`This upgrade already has a receipt. Inspect it before retrying: ${receiptFile}`);
  const candidate = fs.existsSync(config.sourceBundle) ? config.sourceBundle : target;
  if (bundleId(candidate) !== APP_ID || buildIdentityModule.buildIdentity(runtime(candidate)) !== config.buildId) throw new Error('The prepared app has changed. Rebuild and verify it before installation.');
  execFileSync('/usr/bin/codesign', ['--verify', '--deep', '--strict', candidate], { stdio: 'pipe' });
  // Do this before quitting, so starting the command from an active Conductor
  // chat refuses instead of killing the process which must save that chat.
  const preview = previewWorkspaceRecovery(config.dataDir);
  if (!preview.ready) throw new Error(`Finish the current Conductor conversation first. Recovery blockers: ${preview.blockers.join(', ')}.`);
  if (running(target)) {
    const request = await appClient(config);
    if ((await request('/api/state')).coordinator.running) throw new Error('Conductor is still replying. Run this command after the reply finishes.');
    console.log('Closing the app for its update; existing agent terminals remain running.');
    execFileSync('/usr/bin/osascript', ['-e', `tell application id "${APP_ID}" to quit`], { timeout: 15000, stdio: 'pipe' });
    for (let i = 0; i < 50 && running(target); i++) await pause(200);
    if (running(target)) throw new Error('The app did not quit. No recovery was applied.');
  }
  const receipt = { version: 1, phase: 'starting', buildId: config.buildId };
  fs.writeFileSync(receiptFile, JSON.stringify(receipt, null, 2), { flag: 'wx', mode: 0o600, flush: true });
  const save = () => fs.writeFileSync(receiptFile, JSON.stringify(receipt, null, 2), { mode: 0o600, flush: true });
  try {
    await withOfflineService(config.port, assertOffline => {
      // Install first: if recovery then refuses, the new app retains its guard.
      // Installing an old app against recovered data would recreate the split.
      if (!fs.existsSync(target) || buildIdentityModule.buildIdentity(runtime(target)) !== config.buildId) {
        receipt.phase = 'installing'; save();
        receipt.installation = installDesktop({ source: config.sourceBundle, folder: config.appFolder, trash: config.trash,
          copy: (from, to) => execFileSync('/usr/bin/ditto', [from, to]), readBundleId: bundleId, isRunning: running });
        if (buildIdentityModule.buildIdentity(runtime(target)) !== config.buildId) throw new Error('Installed runtime verification failed.');
      }
      receipt.phase = 'recovering'; receipt.archive = path.join(config.archiveParent, `applied-${randomUUID()}`); save();
      receipt.recovery = applyWorkspaceRecovery(config.dataDir, receipt.archive, { assertOffline });
      receipt.phase = 'recovered'; save();
    });
    console.log('App installed and workspace recovered. Opening the app.');
    execFileSync('/usr/bin/open', ['-a', target]);
    let request;
    for (let i = 0; i < 60; i++) {
      try { request = await appClient(config, config.buildId); break; } catch { await pause(1000); }
    }
    if (!request) throw new Error('The installed app did not become healthy. No activation request was sent.');
    let state = await request('/api/state');
    if (!state.projects.some(p => p.id === config.projectId) || !state.teams.some(t => t.id === config.teamId && t.projectId === config.projectId)) throw new Error('Recovered project/team identity verification failed.');
    for (let i = 0; state.coordinator.running && i < 120; i++) { await pause(1000); state = await request('/api/state'); }
    if (state.coordinator.running) throw new Error('Conductor is busy; no activation request was sent.');
    receipt.phase = 'activating'; save();
    console.log('Submitting the original activation request through Conductor and its project privacy checks.');
    const turn = await submitActivationOnce({ receipt, save, request, config });
    receipt.roles = teamProcessReport(await request('/api/state'), config.teamId);
    for (let i = 0; i < 15 && !receipt.roles.every(r => r.cliRunning); i++) {
      await pause(1000); receipt.roles = teamProcessReport(await request('/api/state'), config.teamId);
    }
    receipt.phase = receipt.roles.every(r => r.cliRunning) ? 'team-processes-running' : 'activation-needs-review'; save();
    console.log(turn.answer || 'Conductor finished; inspect its action receipts in the app.');
    for (const role of receipt.roles) console.log(`${role.role}: ${role.cliRunning ? 'provider CLI running; task acceptance unverified' : 'not confirmed running; inspect Conductor/terminal'}`);
    if (receipt.phase !== 'team-processes-running') process.exitCode = 2;
  } catch (error) {
    receipt.error = error.message; save();
    throw new Error(`${error.message}\nRecovery/upgrade receipt: ${receiptFile}`, { cause: error });
  }
}
if (process.argv[1] && path.resolve(process.argv[1]) === new URL(import.meta.url).pathname) main().catch(error => {
  console.error(error.message); process.exitCode = 1;
});
