const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const { applyMilestoneCommand, milestoneDelayRecord, isMilestoneFault } = require('./milestoneCommands.cjs');

const now = new Date('2026-10-15T10:20:30.456Z');
const nowISO = now.toISOString();
const actor = { uid: 'u1', email: 'a@x.in', displayName: 'Asha' };
const reason = 'Client approval arrived two weeks late';
const sha = value => crypto.createHash('sha256').update(JSON.stringify(value)).digest('hex');
const project = (extra = {}) => ({ projectId: 'p1', deadline: '2027-01-31', ...extra });
const ms = (id, data = {}) => ({ id, data: { name: `Milestone ${id}`, currentPlannedEndDate: '2026-11-01', status: 'not-started', order: 1, createdAt: 'c', createdBy: 'u0', updatedAt: 'u', ...data } });
const run = (over = {}) => applyMilestoneCommand({ project: project(), milestones: [], actor, now, operationId: 'op1', command: { kind: 'baseline_lock' }, ...over });
const fails = (over, code) => assert.throws(() => run(over), e => isMilestoneFault(e) && (!code || e.code === code));
const deepFreeze = o => { if (o && typeof o === 'object') { Object.values(o).forEach(deepFreeze); Object.freeze(o); } return o; };
test('new template rows on an already baselined project retain the same original-date rule as individual adds',()=>{
  const plan=run({project:project({isBaselined:true}),command:{kind:'template'}});
  for(const row of plan.upserts)assert.equal(row.data.originalPlannedEndDate,row.data.currentPlannedEndDate);
});
test('a bounded schedule cannot add a row that makes the next native opening unreadable',()=>{
  const milestones=Array.from({length:400},(_,index)=>ms(`m${index}`));
  fails({milestones,command:{kind:'add',milestone_id:'overflow',input:{name:'Overflow',currentPlannedEndDate:'2026-12-01'}}},'milestone_schedule_too_large');
});

test('fault marker is private and only own faults match', () => {
  assert.equal(isMilestoneFault(Object.assign(new Error('x'), { code: 'invalid_milestone_command', status: 400 })), false);
  assert.equal(isMilestoneFault({ code: 'a', status: 400 }), false);
  assert.equal(isMilestoneFault(null), false);
  let own; try { run({ command: { kind: 'nope' } }); } catch (e) { own = e; }
  assert.equal(isMilestoneFault(own), true);
  assert.equal(own.status, 400);
  assert.deepEqual(Object.getOwnPropertySymbols(own).filter(s => Object.getOwnPropertyDescriptor(own, s).enumerable), []);
  assert.equal(isMilestoneFault(Object.assign(new Error('x'), { ...own })), false);
});

test('inputs are never mutated and results are fresh', () => {
  const input = deepFreeze({ project: project({ isBaselined: true, originalDeadline: '2027-01-01' }), milestones: [ms('m1', { extra: { deep: [1] } })], actor, now, operationId: 'op', command: { kind: 'edit', milestone_id: 'm1', patch: { name: 'Renamed', currentPlannedEndDate: '2026-11-09' }, delay: { reason, attribution: 'external-client' } } });
  const out = applyMilestoneCommand(input);
  assert.equal(out.upserts[0].data.extra.deep !== input.milestones[0].data.extra.deep, true);
});

test('add: new milestone, order max+1, trimmed, status default, no original before baseline', () => {
  const out = run({ milestones: [ms('a', { order: 2 }), ms('b', { order: 5 })], command: { kind: 'add', milestone_id: 'new1', input: { name: '  Fabrication  ', description: '  weld  ', currentPlannedEndDate: '2026-12-01' } } });
  assert.deepEqual(out.projectPatch, {});
  assert.deepEqual(out.upserts, [{ id: 'new1', data: { name: 'Fabrication', description: 'weld', currentPlannedEndDate: '2026-12-01', status: 'not-started', order: 6, createdAt: nowISO, createdBy: 'u1', updatedAt: nowISO } }]);
  assert.deepEqual(out.result, { kind: 'add', milestone_id: 'new1' });
  assert.deepEqual([out.deletes, out.delayLogs, out.archives], [[], [], []]);
});

test('add: first order is 1, blank description omitted, status honoured, baselined copies current to original', () => {
  const out = run({ project: project({ isBaselined: true }), command: { kind: 'add', milestone_id: 'n', input: { name: 'Abc', description: '   ', currentPlannedEndDate: '2026-12-01', status: 'blocked' } } });
  assert.equal(out.upserts[0].data.order, 1);
  assert.equal('description' in out.upserts[0].data, false);
  assert.equal(out.upserts[0].data.status, 'blocked');
  assert.equal(out.upserts[0].data.originalPlannedEndDate, '2026-12-01');
  assert.deepEqual(out.delayLogs, []);
});

test('add: id collision, no recycled ids through order, invalid inputs', () => {
  const add = input => ({ kind: 'add', milestone_id: 'n', input });
  fails({ milestones: [ms('n')], command: add({ name: 'Abc', currentPlannedEndDate: '2026-12-01' }) }, 'milestone_exists');
  fails({ command: add({ name: 'ab', currentPlannedEndDate: '2026-12-01' }) }, 'invalid_milestone_command');
  fails({ command: add({ name: 'x'.repeat(101), currentPlannedEndDate: '2026-12-01' }) });
  fails({ command: add({ name: 'Abc', currentPlannedEndDate: '2026-02-30' }) });
  fails({ command: add({ name: 'Abc', currentPlannedEndDate: '2026-12-01T00:00:00Z' }) });
  fails({ command: add({ name: 'Abc', currentPlannedEndDate: '2026-12-01', status: 'done' }) });
  fails({ command: add({ name: 'Abc', currentPlannedEndDate: '2026-12-01', order: 3 }) });
  fails({ command: add({ name: 'Abc', description: 'd'.repeat(128 * 1024 + 1), currentPlannedEndDate: '2026-12-01' }) });
  fails({ command: { kind: 'add', input: { name: 'Abc', currentPlannedEndDate: '2026-12-01' } } });
  fails({ command: { kind: 'add', milestone_id: 'n', input: { name: 'Abc', currentPlannedEndDate: '2026-12-01' }, extra: 1 } });
});

test('ids: slash, control, dot, dot-dot, reserved, empty, too long rejected', () => {
  for (const id of ['', 'a/b', 'a\nb', '.', '..', '__x__', 'x'.repeat(513), 5, null]) {
    fails({ command: { kind: 'delete', milestone_id: id } }, 'invalid_milestone_command');
  }
  assert.doesNotThrow(() => run({ milestones: [ms('x'.repeat(512))], command: { kind: 'delete', milestone_id: 'x'.repeat(512) } }));
});

test('edit: only selected fields change, unknown fields and exact strings preserved', () => {
  const row = ms('m1', { description: 'old', futureField: { keep: [1, 2] }, originalPlannedEndDate: '2026-10-01', actualEndDate: '2026-10-02T00:00:00Z', currentPlannedEndDate: '2026-11-01 ' });
  const out = run({ milestones: [row], command: { kind: 'edit', milestone_id: 'm1', patch: { name: ' New name ', status: 'completed' } } });
  assert.deepEqual(out.upserts, [{ id: 'm1', data: { ...row.data, name: 'New name', status: 'completed', updatedAt: nowISO } }]);
  assert.deepEqual(out.delayLogs, []);
  assert.deepEqual(out.result, { kind: 'edit', milestone_id: 'm1' });
});

test('edit: plain status edit does not touch actualEndDate/progress (original behaviour)', () => {
  const out = run({ milestones: [ms('m1')], command: { kind: 'edit', milestone_id: 'm1', patch: { status: 'completed' } } });
  assert.equal('actualEndDate' in out.upserts[0].data, false);
  assert.equal('lastProgressDate' in out.upserts[0].data, false);
});

test('edit: description clear to null, string trimmed to null, missing patch/unknown keys rejected', () => {
  assert.equal(run({ milestones: [ms('m1', { description: 'x' })], command: { kind: 'edit', milestone_id: 'm1', patch: { description: null } } }).upserts[0].data.description, null);
  assert.equal(run({ milestones: [ms('m1', { description: 'x' })], command: { kind: 'edit', milestone_id: 'm1', patch: { description: '   ' } } }).upserts[0].data.description, null);
  fails({ milestones: [ms('m1')], command: { kind: 'edit', milestone_id: 'm1', patch: {} } });
  for (const key of ['order', 'originalPlannedEndDate', 'actualEndDate', 'createdBy', 'id']) fails({ milestones: [ms('m1')], command: { kind: 'edit', milestone_id: 'm1', patch: { [key]: '2026-01-01' } } });
  fails({ milestones: [ms('m1')], command: { kind: 'edit', milestone_id: 'm1', patch: { name: 'ab' } } });
  fails({ milestones: [ms('zz')], command: { kind: 'edit', milestone_id: 'm1', patch: { name: 'Abc' } } }, 'milestone_not_found');
});

test('edit date on baselined project requires reason and attribution; creates ONE deterministic log', () => {
  const p = project({ isBaselined: true, originalDeadline: '2027-01-01', deadline: '2027-01-11' });
  const base = { project: p, milestones: [ms('m1')] };
  const cmd = delay => ({ kind: 'edit', milestone_id: 'm1', patch: { currentPlannedEndDate: '2026-11-11' }, ...(delay ? { delay } : {}) });
  fails({ ...base, command: cmd() }, 'delay_required');
  fails({ ...base, command: cmd({ reason: 'too short', attribution: 'internal-team' }) }, 'invalid_milestone_command');
  fails({ ...base, command: cmd({ reason: ` ${'x'.repeat(19)} `, attribution: 'internal-team' }) });
  fails({ ...base, command: cmd({ reason, attribution: 'internal' }) });
  fails({ ...base, command: cmd({ reason, attribution: 'internal-team', extra: 1 }) });
  const out = run({ ...base, command: cmd({ reason: `  ${reason}  `, attribution: 'external-client' }) });
  assert.equal(out.delayLogs.length, 1);
  assert.deepEqual(out.delayLogs[0], {
    id: `delay-${sha(['p1', 'op1', 'delay', 'milestone', 'm1'])}`,
    data: { id: `delay-${sha(['p1', 'op1', 'delay', 'milestone', 'm1'])}`, entityType: 'milestone', entityId: 'm1', entityName: 'Milestone m1', previousDate: '2026-11-01', newDate: '2026-11-11', delayDays: 10, reason, attribution: 'external-client', cumulativeProjectDelay: 10, loggedAt: nowISO, loggedBy: 'u1', loggedByName: 'Asha' },
  });
  assert.equal(out.upserts[0].data.currentPlannedEndDate, '2026-11-11');
  assert.deepEqual(out.projectPatch, {});
  const again = run({ ...base, command: cmd({ reason, attribution: 'external-client' }) });
  assert.equal(again.delayLogs[0].id, out.delayLogs[0].id);
  assert.notEqual(run({ ...base, operationId: 'op2', command: cmd({ reason, attribution: 'external-client' }) }).delayLogs[0].id, out.delayLogs[0].id);
});

test('edit date: log uses pre-edit name, acceleration negative, same date or non-baselined invents nothing', () => {
  const p = project({ isBaselined: true, originalDeadline: '2027-01-31', deadline: '2027-01-21' });
  const d = { reason, attribution: 'internal-process' };
  const out = run({ project: p, milestones: [ms('m1')], command: { kind: 'edit', milestone_id: 'm1', patch: { name: 'Renamed', currentPlannedEndDate: '2026-10-30' }, delay: d } });
  assert.equal(out.delayLogs[0].data.entityName, 'Milestone m1');
  assert.equal(out.delayLogs[0].data.delayDays, -2);
  assert.equal(out.delayLogs[0].data.cumulativeProjectDelay, -10);
  assert.deepEqual(run({ project: p, milestones: [ms('m1')], command: { kind: 'edit', milestone_id: 'm1', patch: { currentPlannedEndDate: '2026-11-01', name: 'Same date' } } }).delayLogs, []);
  assert.deepEqual(run({ milestones: [ms('m1')], command: { kind: 'edit', milestone_id: 'm1', patch: { currentPlannedEndDate: '2026-11-20' }, delay: d } }).delayLogs, []);
});

test('date command mirrors edit semantics', () => {
  const p = project({ isBaselined: true, originalDeadline: '2027-01-31' });
  fails({ project: p, milestones: [ms('m1')], command: { kind: 'date', milestone_id: 'm1', new_date: '2026-11-05' } }, 'delay_required');
  const out = run({ project: p, milestones: [ms('m1', { x: 1 })], command: { kind: 'date', milestone_id: 'm1', new_date: '2026-11-05', delay: { reason, attribution: 'external-vendor' } } });
  assert.equal(out.delayLogs.length, 1);
  assert.equal(out.delayLogs[0].data.delayDays, 4);
  assert.equal(out.upserts[0].data.x, 1);
  assert.deepEqual(out.result, { kind: 'date', milestone_id: 'm1' });
  assert.deepEqual(run({ project: p, milestones: [ms('m1')], command: { kind: 'date', milestone_id: 'm1', new_date: '2026-11-01' } }).delayLogs, []);
  assert.equal(run({ milestones: [ms('m1')], command: { kind: 'date', milestone_id: 'm1', new_date: '2026-11-05' } }).delayLogs.length, 0);
  fails({ milestones: [ms('m1')], command: { kind: 'date', milestone_id: 'm1', new_date: '2026-13-05' } });
});

test('milestoneDelayRecord: project vs milestone cumulative and validation', () => {
  const p = project({ originalDeadline: '2027-01-01', deadline: '2027-01-05' });
  const args = { project: p, entityType: 'project', entityId: 'p1', entityName: 'Proj', previousDate: '2027-01-05', newDate: '2027-01-20', reason, attribution: 'external-other', actor: { uid: 'u1', email: 'a@x.in' }, now, operationId: 'op9' };
  const rec = milestoneDelayRecord(args);
  assert.equal(rec.data.cumulativeProjectDelay, 19);
  assert.equal(rec.data.delayDays, 15);
  assert.equal(rec.data.loggedByName, 'a@x.in');
  assert.equal(rec.id, rec.data.id);
  assert.equal(milestoneDelayRecord({ ...args, entityType: 'milestone', entityId: 'm' }).data.cumulativeProjectDelay, 4);
  assert.equal(milestoneDelayRecord({ ...args, project: project() }).data.cumulativeProjectDelay, 0);
  assert.throws(() => milestoneDelayRecord({ ...args, reason: 'short' }), isMilestoneFault);
  assert.throws(() => milestoneDelayRecord({ ...args, attribution: 'x' }), isMilestoneFault);
  assert.throws(() => milestoneDelayRecord({ ...args, entityType: 'task' }), isMilestoneFault);
  assert.throws(() => milestoneDelayRecord({ ...args, newDate: 'nope' }), isMilestoneFault);
});

test('status: completed sets UTC date, progress note trimmed, reopen keeps actualEndDate', () => {
  const row = ms('m1', { unknown: 'keep' });
  const done = run({ milestones: [row], command: { kind: 'status', milestone_id: 'm1', status: 'completed', progress_note: '  all good  ' } });
  assert.deepEqual(done.upserts[0].data, { ...row.data, status: 'completed', actualEndDate: '2026-10-15', lastProgressNote: 'all good', lastProgressDate: nowISO, updatedAt: nowISO });
  const reopened = run({ milestones: [ms('m1', { status: 'completed', actualEndDate: '2026-10-01' })], command: { kind: 'status', milestone_id: 'm1', status: 'in-progress' } });
  assert.equal(reopened.upserts[0].data.actualEndDate, '2026-10-01');
  assert.equal('lastProgressDate' in reopened.upserts[0].data, false);
  const blank = run({ milestones: [ms('m1', { lastProgressNote: 'old' })], command: { kind: 'status', milestone_id: 'm1', status: 'blocked', progress_note: '  ' } });
  assert.equal(blank.upserts[0].data.lastProgressNote, null);
  assert.equal(blank.upserts[0].data.lastProgressDate, nowISO);
  const late = run({ now: new Date('2026-10-15T23:59:59.999Z'), milestones: [ms('m1')], command: { kind: 'status', milestone_id: 'm1', status: 'completed' } });
  assert.equal(late.upserts[0].data.actualEndDate, '2026-10-15');
  fails({ milestones: [ms('m1')], command: { kind: 'status', milestone_id: 'm1', status: 'done' } });
  fails({ milestones: [ms('m1')], command: { kind: 'status', milestone_id: 'm1', status: 'completed', progress_note: 'n'.repeat(128 * 1024 + 1) } });
  fails({ milestones: [ms('m1')], command: { kind: 'status', milestone_id: 'm1', status: 'completed', actualEndDate: '2020-01-01' } });
});

test('delete: full protected archive, delete id, no history deletion', () => {
  const row = ms('m1', { originalPlannedEndDate: '2026-10-01', weird: { a: [1] } });
  const out = run({ project: project({ isBaselined: true }), milestones: [row, ms('m2')], command: { kind: 'delete', milestone_id: 'm1' } });
  assert.deepEqual(out.deletes, ['m1']);
  assert.deepEqual(out.upserts, []);
  assert.deepEqual(out.delayLogs, []);
  assert.deepEqual(out.archives, [{ id: 'm1', data: { record: row.data, id: 'm1', deletedBy: 'u1', deletedAt: nowISO } }]);
  assert.notEqual(out.archives[0].data.record, row.data);
  assert.deepEqual(out.result, { kind: 'delete', milestone_id: 'm1' });
  fails({ command: { kind: 'delete', milestone_id: 'gone' } }, 'milestone_not_found');
});

test('reorder: exact permutation only, order 1..n and updatedAt', () => {
  const rows = [ms('a', { order: 1, k: 1 }), ms('b', { order: 2 }), ms('c', { order: 3 })];
  const out = run({ milestones: rows, command: { kind: 'reorder', milestone_ids: ['c', 'a', 'b'] } });
  assert.deepEqual(out.upserts.map(u => [u.id, u.data.order, u.data.updatedAt]), [['c', 1, nowISO], ['a', 2, nowISO], ['b', 3, nowISO]]);
  assert.equal(out.upserts[1].data.k, 1);
  assert.deepEqual(out.result, { kind: 'reorder' });
  for (const ids of [['a', 'b'], ['a', 'b', 'c', 'd'], ['a', 'a', 'b'], ['a', 'b', 'x'], [], 'abc']) fails({ milestones: rows, command: { kind: 'reorder', milestone_ids: ids } });
});

test('baseline_lock: atomic project + every milestone original, no overwrite after', () => {
  const rows = [ms('a', { currentPlannedEndDate: '2026-11-01' }), ms('b', { currentPlannedEndDate: '2026-12-01', originalPlannedEndDate: 'stale', z: 1 })];
  const p = project();
  const out = run({ project: p, milestones: rows, command: { kind: 'baseline_lock' } });
  assert.deepEqual(out.projectPatch, { originalDeadline: '2027-01-31', isBaselined: true, baselinedAt: nowISO, baselinedBy: 'u1' });
  assert.deepEqual(out.upserts.map(u => [u.id, u.data.originalPlannedEndDate, u.data.updatedAt]), [['a', '2026-11-01', nowISO], ['b', '2026-12-01', nowISO]]);
  assert.equal(out.upserts[1].data.z, 1);
  assert.deepEqual(out.result, { kind: 'baseline_lock' });
  fails({ project: project({ isBaselined: true }), milestones: rows, command: { kind: 'baseline_lock' } }, 'already_baselined');
  fails({ milestones: [], command: { kind: 'baseline_lock' } }, 'no_milestones');
  fails({ milestones: [ms('a', { name: ' ab ' })], command: { kind: 'baseline_lock' } });
  fails({ milestones: [ms('a', { currentPlannedEndDate: '' })], command: { kind: 'baseline_lock' } });
  fails({ milestones: [ms('a', { currentPlannedEndDate: '2026-02-31' })], command: { kind: 'baseline_lock' } });
  fails({ project: project({ deadline: undefined }), milestones: rows, command: { kind: 'baseline_lock' } });
  fails({ milestones: rows, command: { kind: 'baseline_lock', milestone_ids: [] } });
});

test('edit/status/date/reorder never modify baseline fields', () => {
  const row = ms('a', { originalPlannedEndDate: '2026-10-01' });
  const p = project({ isBaselined: true, originalDeadline: '2027-01-31' });
  const d = { reason, attribution: 'internal-team' };
  for (const command of [
    { kind: 'edit', milestone_id: 'a', patch: { currentPlannedEndDate: '2026-12-12' }, delay: d },
    { kind: 'status', milestone_id: 'a', status: 'completed' },
    { kind: 'date', milestone_id: 'a', new_date: '2026-12-12', delay: d },
    { kind: 'reorder', milestone_ids: ['a'] },
  ]) {
    const out = run({ project: p, milestones: [row], command });
    assert.equal(out.upserts[0].data.originalPlannedEndDate, '2026-10-01');
    assert.deepEqual(out.projectPatch, {});
  }
});

test('template: default four steps, math from today, deterministic ids, order, actor', () => {
  const out = run({ project: project({ deadline: '2027-01-24' }), command: { kind: 'template' } });
  // 2026-10-15T10:20:30.456Z -> 2027-01-24T00:00Z is 100 days minus a partial day -> ceil 100? computed below
  const spanDays = Math.ceil((new Date('2027-01-24').getTime() - now.getTime()) / 86400000);
  const expectDate = pct => { const d = new Date(now); d.setUTCDate(d.getUTCDate() + Math.round(spanDays * pct / 100)); return d.toISOString().slice(0, 10); };
  assert.deepEqual(out.upserts.map(u => [u.data.name, u.data.description, u.data.currentPlannedEndDate, u.data.order]), [
    ['Planning & Design', 'Requirements gathering, engineering design, BOM finalization', expectDate(25), 1],
    ['Procurement', 'Vendor selection, PO creation, materials ordering', expectDate(50), 2],
    ['Build & Test', 'Assembly, integration, quality testing', expectDate(80), 3],
    ['Delivery', 'Final inspection, shipping, installation, handover', expectDate(100), 4],
  ]);
  out.upserts.forEach((u, i) => {
    assert.equal(u.id, `mile-${sha(['p1', 'op1', i])}`);
    assert.deepEqual(Object.keys(u.data).sort(), ['createdAt', 'createdBy', 'currentPlannedEndDate', 'description', 'name', 'order', 'status', 'updatedAt']);
    assert.equal(u.data.status, 'not-started');
    assert.equal(u.data.createdBy, 'u1');
    assert.equal(u.data.createdAt, nowISO);
  });
  assert.deepEqual(out.projectPatch, {});
  assert.deepEqual(out.result, { kind: 'template' });
  assert.equal(new Set(run({ operationId: 'op2', project: project({ deadline: '2027-01-24' }), command: { kind: 'template' } }).upserts.map(u => u.id)).size, 4);
});

test('template: baselined empty schedule captures originals for newly created rows', () => {
  const out = run({ project: project({ isBaselined: true, originalDeadline: '2027-01-01' }), command: { kind: 'template' } });
  assert.equal(out.upserts.every(u => u.data.originalPlannedEndDate === u.data.currentPlannedEndDate), true);
});

test('template: requires empty schedule and future valid deadline', () => {
  fails({ milestones: [ms('a')], command: { kind: 'template' } }, 'schedule_not_empty');
  fails({ project: project({ deadline: '2026-10-15' }), command: { kind: 'template' } }, 'deadline_not_future');
  fails({ project: project({ deadline: '2020-01-01' }), command: { kind: 'template' } }, 'deadline_not_future');
  fails({ project: project({ deadline: 'garbage' }), command: { kind: 'template' } });
  fails({ project: project({ deadline: undefined }), command: { kind: 'template' } });
  fails({ command: { kind: 'template', template: [] } });
});

test('size limits: >400 milestones and >256KiB command fail intact', () => {
  const many = Array.from({ length: 401 }, (_, i) => ms(`m${i}`));
  fails({ milestones: many, command: { kind: 'status', milestone_id: 'm0', status: 'blocked' } }, 'milestone_schedule_too_large');
  assert.doesNotThrow(() => run({ milestones: many.slice(0, 400), command: { kind: 'status', milestone_id: 'm0', status: 'blocked' } }));
  fails({ command: { kind: 'add', milestone_id: 'n', input: { name: 'Abc', description: 'd'.repeat(300 * 1024), currentPlannedEndDate: '2026-12-01' } } }, 'milestone_command_too_large');
});

test('context validation: actor, now, operationId, project, milestone rows', () => {
  const cmd = { kind: 'baseline_lock' };
  const rows = [ms('a')];
  fails({ milestones: rows, actor: { uid: '', email: 'e' }, command: cmd });
  fails({ milestones: rows, actor: null, command: cmd });
  fails({ milestones: rows, now: new Date('x'), command: cmd });
  fails({ milestones: rows, now: '2026-01-01', command: cmd });
  fails({ milestones: rows, operationId: '', command: cmd });
  fails({ milestones: rows, operationId: 'a/b', command: cmd });
  fails({ milestones: rows, project: null, command: cmd });
  fails({ milestones: rows, project: { deadline: '2027-01-01' }, command: cmd });
  fails({ milestones: [ms('a'), ms('a')], command: cmd });
  fails({ milestones: [{ id: 'a', data: null }], command: cmd });
  fails({ milestones: [{ id: 'a/b', data: {} }], command: cmd });
  fails({ milestones: 'x', command: cmd });
  fails({ milestones: rows, command: null });
  fails({ milestones: rows, command: { kind: 'fly' } });
  assert.doesNotThrow(() => run({ milestones: rows, actor: { uid: 'u', email: 'e' }, command: cmd }));
});

test('helper invents no permission: no role or access input is read or returned', () => {
  const out = run({ milestones: [ms('a')], actor: { uid: 'u1', email: 'a@x.in', role: 'none', isAdmin: false }, command: { kind: 'baseline_lock' } });
  assert.deepEqual(Object.keys(out).sort(), ['archives', 'delayLogs', 'deletes', 'projectPatch', 'result', 'upserts']);
});
