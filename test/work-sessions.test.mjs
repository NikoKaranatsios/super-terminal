import test from 'node:test';
import assert from 'node:assert/strict';
import { parseTopics, workProgress, carryProjects, mergeProjects, resolveScope, canCommunicate, wrapSummary, resolveLaunchLocation } from '../server/work-sessions.mjs';

test('big topics become grouped project goals without an AI call', () => {
  const projects = parseTopics('Atlas: Build API\nAtlas: Verify release\nPrepare demo', [{ group:'Atlas',cwd:'/work/atlas',repository:'/work/atlas' }]);
  assert.equal(projects.length,2);
  assert.equal(projects[0].cwd,'/work/atlas');
  assert.deepEqual(projects[0].goals.map(g=>g.title),['Build API','Verify release']);
  assert.equal(projects[1].name,'General');
});
test('launch scope preserves remote location and rejects conflicting project, host and folder', () => {
  const projects = parseTopics('Atlas: Verify', [{ group: 'Atlas', host: 'fixture-host', cwd: '/srv/atlas', owner: 'fixture-owner' }]);
  assert.equal(projects[0].host, 'fixture-host'); assert.equal(projects[0].owner, 'fixture-owner');
  projects[0].canonicalProjectId = 'canonical';
  const state = { projects: [{ id: 'canonical', name: 'Atlas', host: 'fixture-host', cwd: '/srv/atlas' }], teams: [], workSessions: [{ id: 's', projects }] };
  const scope = { workSessionId: 's', projectId: 'canonical' };
  const result = resolveLaunchLocation(state, { scope }, ['fixture-host']);
  assert.equal(result.host, 'fixture-host'); assert.equal(result.cwd, '/srv/atlas'); assert.equal(result.projectId, 'canonical');
  assert.equal(resolveLaunchLocation(state, { scope, cwd: '/srv/atlas/src' }, ['fixture-host']).cwd, '/srv/atlas/src');
  assert.throws(() => resolveLaunchLocation(state, { scope, host: 'local' }, ['fixture-host']), /conflicts/);
  assert.throws(() => resolveLaunchLocation(state, { scope, cwd: '/srv/other' }, ['fixture-host']), /outside/);
  assert.throws(() => resolveLaunchLocation(state, { scope }, []), /enabled/);
});
test('equal folder basenames do not silently grant cross-project mailbox peers', () => {
  assert.equal(canCommunicate({ group: 'app', host: 'local', cwd: '/first/app' }, { group: 'app', host: 'local', cwd: '/second/app' }), false);
  assert.equal(canCommunicate({ teamId: 'a', group: 'old' }, { teamId: 'a', group: 'new' }), true);
});
test('wrap-up and carry-forward retain unfinished goals and generate fresh identifiers', () => {
  const projects=parseTopics('Atlas: Finished\nAtlas: Still open');
  projects[0].goals[0].status='done';
  projects[0].goals[1].status='doing';
  const session={id:'session',title:'Monday',projects,notes:'Pick up at the API review.'};
  assert.deepEqual(workProgress(session),{total:2,done:1,doing:1,open:1});
  const next=carryProjects(session);
  assert.equal(next[0].goals.length,1);
  assert.equal(next[0].goals[0].status,'todo');
  assert.notEqual(next[0].goals[0].id,projects[0].goals[1].id);
  assert.match(wrapSummary(session),/\[x\] Finished/);
  assert.match(wrapSummary(session),/Pick up at the API review/);
  const merged=mergeProjects(next,parseTopics('atlas: New goal'));
  assert.equal(merged.length,1);
  assert.deepEqual(merged[0].goals.map(g=>g.title),['Still open','New goal']);
});
test('scope links must belong to the same working-session tree', () => {
  const session={id:'s',projects:parseTopics('Atlas: Build API\nBeta: Review')};
  const p=session.projects[0],g=p.goals[0];
  assert.deepEqual(resolveScope([session],{workSessionId:'s',projectId:p.id,goalId:g.id}),{workSessionId:'s',projectId:p.id,goalId:g.id});
  assert.throws(()=>resolveScope([session],{workSessionId:'s',projectId:session.projects[1].id,goalId:g.id}));
  assert.throws(()=>resolveScope([session],{workSessionId:'s',goalId:g.id}));
  assert.equal(canCommunicate({group:'a',scope:{workSessionId:'s'}},{group:'b',scope:{workSessionId:'s'}}),true);
  assert.equal(canCommunicate({group:'a',scope:{workSessionId:'s'}},{group:'b',scope:{workSessionId:'other'}}),false);
});
