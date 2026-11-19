import test from 'node:test';
import assert from 'node:assert/strict';
import { submitActivationOnce, teamProcessReport, validateUpgradeManifest } from '../scripts/finish-recovery-upgrade.mjs';

test('upgrade validates exact prepared identity, paths, selected team and original owner intent', () => {
  const config = { dataDir: '/data', archiveParent: '/private', sourceBundle: '/build/app', appFolder: '/apps', trash: '/trash', buildId: 'a'.repeat(64), toolHash: 'b'.repeat(64), port: 4317, ownerRequest: 'Activate the saved team.', projectId: 'p', teamId: 't' };
  assert.equal(validateUpgradeManifest(config), config);
  for (const patch of [{ port: 0 }, { buildId: 'version-only' }, { archiveParent: 'relative' }, { ownerRequest: '' }, { teamId: null }]) assert.throws(() => validateUpgradeManifest({ ...config, ...patch }));
});
test('activation enters owner chat exactly once with original user text, without global drafts or direct launch APIs', async () => {
  const receipt = {}, saved = [], calls = [];
  const config = { ownerRequest: 'Activate the existing team.', projectId: 'p', teamId: 't', settingsSessionId: 'w', globalDraft: 'DO_NOT_COPY' };
  const request = async (endpoint, body) => { calls.push({ endpoint, body }); return { id: 'turn', status: 'complete', answer: 'Reported result' }; };
  await submitActivationOnce({ receipt, config, save: () => saved.push(structuredClone(receipt)), request });
  assert.equal(calls.length, 1); assert.equal(calls[0].endpoint, '/api/coordinator');
  assert.deepEqual(calls[0].body, { prompt: config.ownerRequest, projectId: 'p', environment: 'local', settingsSessionId: 'w', automatic: false });
  assert.doesNotMatch(JSON.stringify(calls), /DO_NOT_COPY/);
  assert.equal(saved[0].activation.status, 'submitting'); assert.equal(receipt.activation.turnId, 'turn');
  await assert.rejects(submitActivationOnce({ receipt, config, save() {}, request }), /already submitted/);
  assert.equal(calls.length, 1);
});
test('a lost activation response is retained as uncertain and cannot trigger a duplicate request', async () => {
  const receipt = {}; let calls = 0;
  const args = { receipt, config: { ownerRequest: 'Activate.', projectId: 'p' }, save() {}, request: async () => { calls++; throw new Error('connection lost'); } };
  await assert.rejects(submitActivationOnce(args), /uncertain/);
  assert.equal(receipt.activation.status, 'uncertain');
  await assert.rejects(submitActivationOnce(args), /already submitted/); assert.equal(calls, 1);
});
test('team report distinguishes transport, live CLI, duplicate roles and task acceptance', () => {
  const state = { teams: [{ id: 't', roster: ['Design', 'Core', 'Integration', 'Publication'].map(role => ({ role, provider: 'codex' })) }],
    sessions: [{ id: 'a', teamId: 't', role: 'Design', status: 'running', launchState: 'cli-running' },
      { id: 'b', teamId: 't', role: 'Core', status: 'running', launchState: 'transport-ready' },
      { id: 'c', teamId: 't', role: 'Integration', status: 'running', launchState: 'cli-running' },
      { id: 'd', teamId: 't', role: 'Integration', status: 'running', launchState: 'cli-running' },
      { id: 'other', teamId: 'other-team', role: 'Publication', status: 'running', launchState: 'cli-running' }] };
  const rows = teamProcessReport(state, 't');
  assert.deepEqual(rows.map(r => r.cliRunning), [true, false, false, false]);
  assert.equal(rows[2].duplicateLiveMembers, true); assert.equal(rows[3].observed.length, 0);
  assert.ok(rows.every(r => r.taskAcceptance === 'unverified'));
});
