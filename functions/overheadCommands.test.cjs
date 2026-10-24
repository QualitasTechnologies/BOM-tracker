const test = require('node:test');
const assert = require('node:assert/strict');
const { applyOverheadCommand, validateOverheadCommand, isOverheadFault } = require('./overheadCommands.cjs');

const now = new Date('2026-10-15T10:20:30.456Z');
const nowISO = now.toISOString();
const actor = { uid: 'u1', email: 'a@x.in', displayName: 'Asha' };
const project = { projectId: 'p1', projectName: 'Plant A' };
class Ts { constructor(seconds) { this.seconds = seconds; } toDate() { return new Date(this.seconds * 1000); } }
const deepFreeze = o => { if (o && typeof o === 'object' && !(o instanceof Ts)) { Object.values(o).forEach(deepFreeze); Object.freeze(o); } return o; };

const entryInput = (extra = {}) => ({ date: '2026-10-01', category: 'Training', description: ' Safety course ', amount: 1500.5, ...extra });
const expense = (extra = {}) => ({ id: 'e1', category: 'Transport', amount: 250, ...extra });
const visitInput = (extra = {}) => ({ startDate: '2026-10-01', endDate: '2026-10-03', attendees: ['u1', 'u2'], expenses: [expense()], ...extra });
const entryRow = (extra = {}) => ({ id: 'o1', date: '2026-09-01', category: 'Other', description: 'Old', amount: 10, createdAt: 'c0', createdBy: 'u0', ...extra });
const visitRow = (extra = {}) => ({ id: 'v1', startDate: '2026-09-01', endDate: '2026-09-02', attendees: ['u0'], expenses: [expense({ id: 'x1', amount: 5 })], totalCost: 5, reimbursementStatus: 'draft', createdAt: 'c0', createdBy: 'u0', ...extra });
const run = (command, overheads = { travelVisits: [], otherEntries: [] }) => applyOverheadCommand({ project, overheads, command, actor, now });
const fails = (command, code, overheads) => assert.throws(() => run(command, overheads), e => isOverheadFault(e) && (!code || e.code === code), code);

test('fault marker is private and only own faults match', () => {
  assert.equal(isOverheadFault(Object.assign(new Error('x'), { code: 'invalid_overhead_command', status: 400 })), false);
  assert.equal(isOverheadFault(null), false);
  assert.equal(isOverheadFault({ code: 'a' }), false);
  let own; try { run({ kind: 'nope' }); } catch (e) { own = e; }
  assert.equal(isOverheadFault(own), true);
  assert.equal(own.status, 400);
  assert.deepEqual(Object.getOwnPropertySymbols(own).filter(s => Object.keys(own).includes(s)), []);
});

test('add_entry derives server fields, trims, defaults missing arrays and preserves unknown doc fields', () => {
  const stamp = new Ts(5);
  const doc = deepFreeze({ legacyMeta: stamp, other: { a: 1 } });
  const out = applyOverheadCommand({ project, overheads: doc, actor, now, command: { kind: 'add_entry', record_id: 'o9', input: entryInput({ notes: ' n ' }) } });
  assert.deepEqual(out.overheads.otherEntries, [{ id: 'o9', date: '2026-10-01', category: 'Training', description: 'Safety course', amount: 1500.5, notes: 'n', createdAt: nowISO, createdBy: 'u1' }]);
  assert.deepEqual(out.overheads.travelVisits, []);
  assert.equal(out.overheads.legacyMeta, stamp);
  assert.ok(out.overheads.legacyMeta instanceof Ts);
  assert.deepEqual(out.result, { kind: 'add_entry', record_id: 'o9' });
  assert.equal(out.removed, undefined);
  assert.equal(out.notification, undefined);
  assert.notEqual(out.overheads, doc);
  assert.deepEqual(Object.keys(doc), ['legacyMeta', 'other']);
});

test('missing/null overheads document is accepted as empty', () => {
  for (const doc of [undefined, null]) {
    const out = run({ kind: 'add_entry', record_id: 'o1', input: entryInput() }, doc);
    assert.equal(out.overheads.otherEntries.length, 1);
    assert.deepEqual(out.overheads.travelVisits, []);
  }
});

test('add_entry accepts every category, omits empty notes, and rejects invalid inputs', () => {
  for (const category of ['Testing & Certification', 'Freight & Logistics', 'Admin & Documentation', 'Training', 'Other']) {
    const out = run({ kind: 'add_entry', record_id: 'o1', input: entryInput({ category, notes: '   ' }) });
    assert.equal(out.overheads.otherEntries[0].category, category);
    assert.equal('notes' in out.overheads.otherEntries[0], false);
  }
  const bad = [
    { category: 'Transport' }, { category: undefined }, { date: '2026-02-30' }, { date: '2026-1-1' }, { date: 20261001 },
    { description: '   ' }, { description: 5 }, { amount: 0 }, { amount: -1 }, { amount: NaN }, { amount: Infinity }, { amount: '5' },
    { notes: 5 }, { extra: 1 }, { createdBy: 'evil' }, { id: 'x' }, { description: 'a'.repeat(128 * 1024 + 1) },
  ];
  for (const patch of bad) fails({ kind: 'add_entry', record_id: 'o1', input: { ...entryInput(), ...patch } }, undefined);
  fails({ kind: 'add_entry', record_id: 'o1', input: { date: '2026-10-01', category: 'Other', description: 'x' } });
});

test('edit_entry preserves id/createdAt/createdBy/unknown fields, replaces known ones, clears notes, touches nothing else', () => {
  const stamp = new Ts(9);
  const other = entryRow({ id: 'o2', raw: stamp });
  const visits = [visitRow({ legacyTs: stamp })];
  const doc = deepFreeze({ travelVisits: visits, otherEntries: [entryRow({ notes: 'old', unknownX: stamp, createdBy: 'u0' }), other], extra: stamp });
  const out = run({ kind: 'edit_entry', record_id: 'o1', input: entryInput({ amount: 99 }) }, doc);
  const [edited, untouched] = out.overheads.otherEntries;
  assert.deepEqual(edited, { id: 'o1', date: '2026-10-01', category: 'Training', description: 'Safety course', amount: 99, createdAt: 'c0', createdBy: 'u0', unknownX: stamp });
  assert.equal(edited.unknownX, stamp);
  assert.equal(untouched, other);
  assert.equal(out.overheads.travelVisits[0], visits[0]);
  assert.equal(out.overheads.extra, stamp);
  assert.equal(out.removed, undefined);
});

test('edit/delete of unknown ids and add collisions fail', () => {
  const doc = { travelVisits: [visitRow()], otherEntries: [entryRow()] };
  fails({ kind: 'edit_entry', record_id: 'zz', input: entryInput() }, 'overhead_record_not_found', doc);
  fails({ kind: 'delete_entry', record_id: 'zz' }, 'overhead_record_not_found', doc);
  fails({ kind: 'add_entry', record_id: 'o1', input: entryInput() }, 'overhead_record_exists', doc);
  fails({ kind: 'edit_visit', record_id: 'zz', input: visitInput() }, 'overhead_record_not_found', doc);
  fails({ kind: 'delete_visit', record_id: 'zz' }, 'overhead_record_not_found', doc);
  fails({ kind: 'submit_visit', record_id: 'zz' }, 'overhead_record_not_found', doc);
  fails({ kind: 'review_visit', record_id: 'zz', status: 'approved' }, 'overhead_record_not_found', doc);
  fails({ kind: 'add_visit', record_id: 'v1', input: visitInput() }, 'overhead_record_exists', doc);
  // an entry id does not collide with a visit id and vice versa (separate arrays)
  assert.ok(run({ kind: 'add_visit', record_id: 'o1', input: visitInput() }, doc));
  assert.ok(run({ kind: 'add_entry', record_id: 'v1', input: entryInput() }, doc));
  // edit_entry cannot address a visit id
  fails({ kind: 'edit_entry', record_id: 'v1', input: entryInput() }, 'overhead_record_not_found', doc);
});

test('delete_entry returns the raw original and removes only that row', () => {
  const stamp = new Ts(3);
  const target = entryRow({ raw: stamp });
  const keep = entryRow({ id: 'o2' });
  const doc = deepFreeze({ otherEntries: [target, keep], travelVisits: [], z: 1 });
  const out = run({ kind: 'delete_entry', record_id: 'o1' }, doc);
  assert.equal(out.removed.type, 'entry');
  assert.equal(out.removed.id, 'o1');
  assert.equal(out.removed.record, target);
  assert.equal(out.removed.record.raw, stamp);
  assert.deepEqual(out.overheads.otherEntries, [keep]);
  assert.equal(out.overheads.z, 1);
  assert.deepEqual(out.result, { kind: 'delete_entry', record_id: 'o1' });
  assert.equal(out.notification, undefined);
});

test('add_visit is a draft, derives totals/ids server side and has no legacy date', () => {
  const out = run({ kind: 'add_visit', record_id: 'v9', input: visitInput({ location: ' Pune ', purpose: 'Site', notes: 'n', expenses: [expense({ amount: 100.25 }), expense({ id: 'e2', amount: 0.1 })] }) });
  const [visit] = out.overheads.travelVisits;
  assert.deepEqual(visit, {
    id: 'v9', startDate: '2026-10-01', endDate: '2026-10-03', attendees: ['u1', 'u2'], location: 'Pune', purpose: 'Site', notes: 'n',
    expenses: [{ id: 'e1', category: 'Transport', amount: 100.25 }, { id: 'e2', category: 'Transport', amount: 0.1 }],
    totalCost: 100.25 + 0.1, reimbursementStatus: 'draft', createdAt: nowISO, createdBy: 'u1',
  });
  assert.equal('date' in visit, false);
  assert.equal(out.notification, undefined);
  assert.deepEqual(out.overheads.otherEntries, []);
  assert.deepEqual(out.result, { kind: 'add_visit', record_id: 'v9' });
});

test('every expense category is accepted with its category-specific fields', () => {
  for (const category of ['Transport', 'Client Entertainment', 'Communication', 'Miscellaneous']) {
    const out = run({ kind: 'add_visit', record_id: 'v1', input: visitInput({ expenses: [expense({ category, description: ' d ', date: '2026-10-02' })] }) });
    assert.deepEqual(out.overheads.travelVisits[0].expenses[0], { id: 'e1', category, amount: 250, description: 'd', date: '2026-10-02' });
  }
  for (const mealType of ['Breakfast', 'Lunch', 'Dinner', 'Snacks', 'Other']) {
    const out = run({ kind: 'add_visit', record_id: 'v1', input: visitInput({ expenses: [expense({ category: 'Food & Per Diem', mealType, people: 3 })] }) });
    assert.deepEqual(out.overheads.travelVisits[0].expenses[0], { id: 'e1', category: 'Food & Per Diem', amount: 250, mealType, people: 3 });
  }
  const food = run({ kind: 'add_visit', record_id: 'v1', input: visitInput({ expenses: [expense({ category: 'Food & Per Diem' })] }) });
  assert.deepEqual(food.overheads.travelVisits[0].expenses[0], { id: 'e1', category: 'Food & Per Diem', amount: 250 });
});

test('accommodation amount is rooms*nights*rate, fractional allowed, peoplePerRoom display only and defaults to 1, no rounding', () => {
  const acc = (extra = {}) => ({ id: 'a1', category: 'Accommodation', rooms: 2, nights: 2.5, ratePerRoomPerNight: 1234.567, ...extra });
  const out = run({ kind: 'add_visit', record_id: 'v1', input: visitInput({ expenses: [acc({ peoplePerRoom: 4, amount: 1 })] }) });
  const row = out.overheads.travelVisits[0].expenses[0];
  assert.equal(row.amount, 2 * 2.5 * 1234.567);
  assert.equal(row.peoplePerRoom, 4);
  assert.equal(out.overheads.travelVisits[0].totalCost, 2 * 2.5 * 1234.567);
  const dflt = run({ kind: 'add_visit', record_id: 'v1', input: visitInput({ expenses: [acc()] }) });
  assert.equal(dflt.overheads.travelVisits[0].expenses[0].peoplePerRoom, 1);
  for (const patch of [{ rooms: 0 }, { nights: -1 }, { ratePerRoomPerNight: 0 }, { rooms: NaN }, { nights: Infinity }, { ratePerRoomPerNight: '5' }, { peoplePerRoom: 0 }, { rooms: undefined }, { ratePerRoomPerNight: 1e308, rooms: 10 }]) {
    fails({ kind: 'add_visit', record_id: 'v1', input: visitInput({ expenses: [{ ...acc(), ...patch }] }) });
  }
});

test('non-accommodation lines need a positive finite amount and reject foreign-category fields', () => {
  for (const patch of [{ amount: 0 }, { amount: -5 }, { amount: NaN }, { amount: Infinity }, { amount: '5' }, { amount: undefined }, { rooms: 1 }, { mealType: 'Lunch' }, { people: 2 }, { people: 0, category: 'Food & Per Diem' }, { people: NaN, category: 'Food & Per Diem' }, { mealType: 'Brunch', category: 'Food & Per Diem' }, { category: 'Bogus' }, { date: '2026-13-01' }, { description: '  ' }, { unknown: 1 }, { id: '' }, { id: 'a/b' }, { totalCost: 1 }]) {
    fails({ kind: 'add_visit', record_id: 'v1', input: visitInput({ expenses: [{ ...expense(), ...patch }] }) });
  }
});

test('visit input validation: dates, attendees, expenses, strict keys, text', () => {
  const bad = [
    { startDate: '2026-02-30' }, { endDate: '2026-09-30' }, { startDate: '2026-10-05' }, { startDate: undefined },
    { attendees: [] }, { attendees: ['u1', 'u1'] }, { attendees: ['u1', ''] }, { attendees: ['a/b'] }, { attendees: 'u1' }, { attendees: [5] }, { attendees: undefined },
    { expenses: [] }, { expenses: undefined }, { expenses: [expense(), expense()] }, { expenses: 'x' }, { expenses: [null] },
    { location: 5 }, { purpose: 5 }, { notes: 5 }, { location: 'a'.repeat(128 * 1024 + 1) },
    { totalCost: 1 }, { reimbursementStatus: 'approved' }, { createdBy: 'x' }, { id: 'v' },
  ];
  for (const patch of bad) fails({ kind: 'add_visit', record_id: 'v1', input: { ...visitInput(), ...patch } });
  const same = run({ kind: 'add_visit', record_id: 'v1', input: visitInput({ startDate: '2026-10-01', endDate: '2026-10-01' }) });
  assert.equal(same.overheads.travelVisits[0].endDate, '2026-10-01');
});

test('ids: safe, bounded, no slash/control/reserved', () => {
  for (const id of ['', ' ', 'a/b', 'a\nb', 'a\u0000b', '.', '..', '__x__', 'x'.repeat(513), 5, null, undefined]) {
    fails({ kind: 'add_entry', record_id: id, input: entryInput() });
  }
  assert.ok(run({ kind: 'add_entry', record_id: 'x'.repeat(512), input: entryInput() }));
  assert.ok(run({ kind: 'add_entry', record_id: '8f4c-uuid_1.2', input: entryInput() }));
});

test('edit_visit: draft/pending/rejected/missing preserve status; approved becomes pending with submitted notification', () => {
  for (const status of ['draft', 'pending', 'rejected']) {
    const out = run({ kind: 'edit_visit', record_id: 'v1', input: visitInput() }, { travelVisits: [visitRow({ reimbursementStatus: status })], otherEntries: [] });
    assert.equal(out.overheads.travelVisits[0].reimbursementStatus, status);
    assert.equal(out.notification, undefined);
  }
  const { reimbursementStatus, ...legacy } = visitRow();
  const missing = run({ kind: 'edit_visit', record_id: 'v1', input: visitInput() }, { travelVisits: [legacy], otherEntries: [] });
  assert.equal('reimbursementStatus' in missing.overheads.travelVisits[0], false);
  assert.equal(missing.notification, undefined);
  const approved = run({ kind: 'edit_visit', record_id: 'v1', input: visitInput() }, { travelVisits: [visitRow({ reimbursementStatus: 'approved' })], otherEntries: [] });
  assert.equal(approved.overheads.travelVisits[0].reimbursementStatus, 'pending');
  assert.equal(approved.notification.mode, 'submitted');
  assert.equal(approved.notification.visit, approved.overheads.travelVisits[0]);
});

test('edit_visit keeps legacy date/unknown fields/identity, merges expenses by id, clears omitted known optionals, drops removed expenses', () => {
  const stamp = new Ts(11);
  const oldExpense = { id: 'e1', category: 'Transport', amount: 7, date: '2026-09-01', description: 'old', receiptUrl: 'https://storage.example/r.pdf', receiptName: 'r.pdf', rooms: 3, unknownExp: stamp };
  const old = visitRow({ date: '2026-09-01', startDate: undefined, endDate: undefined, location: 'L', purpose: 'P', notes: 'N', unknownV: stamp, expenses: [oldExpense, { id: 'gone', category: 'Transport', amount: 1 }], totalCost: 8 });
  delete old.startDate; delete old.endDate;
  const doc = deepFreeze({ travelVisits: [old, visitRow({ id: 'v2' })], otherEntries: [entryRow()], docUnknown: stamp });
  const out = run({ kind: 'edit_visit', record_id: 'v1', input: { startDate: '2026-10-01', endDate: '2026-10-02', attendees: ['u0', 'u7'], expenses: [{ id: 'e1', category: 'Transport', amount: 20 }, expense({ id: 'new', amount: 30 })] } }, doc);
  const v = out.overheads.travelVisits[0];
  assert.equal(v.date, '2026-09-01');
  assert.equal(v.startDate, '2026-10-01');
  assert.equal(v.endDate, '2026-10-02');
  assert.equal(v.unknownV, stamp);
  assert.equal(v.createdAt, 'c0');
  assert.equal(v.createdBy, 'u0');
  assert.equal(v.id, 'v1');
  assert.deepEqual(v.attendees, ['u0', 'u7']);
  assert.equal('location' in v, false);
  assert.equal('purpose' in v, false);
  assert.equal('notes' in v, false);
  assert.deepEqual(v.expenses[0], { id: 'e1', category: 'Transport', amount: 20, unknownExp: stamp });
  assert.equal(v.expenses[0].unknownExp, stamp);
  assert.deepEqual(v.expenses[1], { id: 'new', category: 'Transport', amount: 30 });
  assert.equal(v.expenses.length, 2);
  assert.equal(v.totalCost, 50);
  assert.equal(out.overheads.travelVisits[1], doc.travelVisits[1]);
  assert.equal(out.overheads.otherEntries, doc.otherEntries);
  assert.equal(out.overheads.docUnknown, stamp);
  assert.equal(out.removed, undefined);
});

test('receipt URL: https only, no credentials, bounded; unchanged legacy URL preserved; receipt removable', () => {
  const withUrl = receiptUrl => ({ kind: 'add_visit', record_id: 'v1', input: visitInput({ expenses: [expense({ receiptUrl, receiptName: 'r.pdf' })] }) });
  assert.equal(run(withUrl('https://firebasestorage.googleapis.com/v0/b/x/o/r.pdf?alt=media&token=t')).overheads.travelVisits[0].expenses[0].receiptName, 'r.pdf');
  for (const url of ['http://x.example/r.pdf', 'javascript:alert(1)', 'data:text/plain,hi', 'https://user:pw@x.example/r', 'https://user@x.example/r', 'not a url', '', 5, 'https://x.example/' + 'a'.repeat(2100)]) fails(withUrl(url));
  fails({ kind: 'add_visit', record_id: 'v1', input: visitInput({ expenses: [expense({ receiptName: 'r.pdf' })] }) });
  fails({ kind: 'add_visit', record_id: 'v1', input: visitInput({ expenses: [expense({ receiptUrl: 'https://x.example/r', receiptName: 5 })] }) });
  const legacy = visitRow({ expenses: [{ id: 'e1', category: 'Transport', amount: 5, receiptUrl: 'http://old.example/r.pdf', receiptName: 'r.pdf' }] });
  const doc = { travelVisits: [legacy], otherEntries: [] };
  const kept = run({ kind: 'edit_visit', record_id: 'v1', input: visitInput({ expenses: [expense({ receiptUrl: 'http://old.example/r.pdf', receiptName: 'r.pdf' })] }) }, doc);
  assert.equal(kept.overheads.travelVisits[0].expenses[0].receiptUrl, 'http://old.example/r.pdf');
  fails({ kind: 'edit_visit', record_id: 'v1', input: visitInput({ expenses: [expense({ receiptUrl: 'http://other.example/r.pdf', receiptName: 'r.pdf' })] }) }, undefined, doc);
  fails({ kind: 'add_visit', record_id: 'v2', input: visitInput({ expenses: [expense({ receiptUrl: 'http://old.example/r.pdf', receiptName: 'r.pdf' })] }) }, undefined, doc);
  const removed = run({ kind: 'edit_visit', record_id: 'v1', input: visitInput() }, doc);
  assert.equal('receiptUrl' in removed.overheads.travelVisits[0].expenses[0], false);
  assert.equal('receiptName' in removed.overheads.travelVisits[0].expenses[0], false);
});

test('category change on an existing expense clears stale known optionals', () => {
  const doc = { travelVisits: [visitRow({ expenses: [{ id: 'e1', category: 'Accommodation', amount: 100, rooms: 1, nights: 1, peoplePerRoom: 2, ratePerRoomPerNight: 100, keepMe: 1 }] })], otherEntries: [] };
  const out = run({ kind: 'edit_visit', record_id: 'v1', input: visitInput() }, doc);
  assert.deepEqual(out.overheads.travelVisits[0].expenses[0], { id: 'e1', category: 'Transport', amount: 250, keepMe: 1 });
});

test('submit_visit only draft -> pending with submitted notification and no other change', () => {
  const stamp = new Ts(1);
  const old = visitRow({ totalCost: 12345, expenses: [{ id: 'x1', category: 'Transport', amount: 1 }], unknownV: stamp });
  const doc = deepFreeze({ travelVisits: [old], otherEntries: [] });
  const out = run({ kind: 'submit_visit', record_id: 'v1' }, doc);
  assert.deepEqual(out.overheads.travelVisits[0], { ...old, reimbursementStatus: 'pending' });
  assert.equal(out.overheads.travelVisits[0].totalCost, 12345);
  assert.equal(out.overheads.travelVisits[0].unknownV, stamp);
  assert.equal(out.notification.mode, 'submitted');
  assert.equal(out.notification.visit, out.overheads.travelVisits[0]);
  assert.deepEqual(out.result, { kind: 'submit_visit', record_id: 'v1' });
  const { reimbursementStatus, ...legacy } = visitRow();
  for (const row of [visitRow({ reimbursementStatus: 'pending' }), visitRow({ reimbursementStatus: 'approved' }), visitRow({ reimbursementStatus: 'rejected' }), legacy, visitRow({ reimbursementStatus: 'weird' })]) {
    fails({ kind: 'submit_visit', record_id: 'v1' }, 'invalid_visit_status', { travelVisits: [row], otherEntries: [] });
  }
});

test('review_visit: pending or legacy-missing -> approved/rejected; only status changes', () => {
  const { reimbursementStatus, ...legacy } = visitRow({ totalCost: 999 });
  for (const row of [visitRow({ reimbursementStatus: 'pending', totalCost: 999 }), legacy]) {
    for (const status of ['approved', 'rejected']) {
      const doc = deepFreeze({ travelVisits: [row, visitRow({ id: 'v2' })], otherEntries: [entryRow()] });
      const out = run({ kind: 'review_visit', record_id: 'v1', status }, doc);
      assert.deepEqual(out.overheads.travelVisits[0], { ...row, reimbursementStatus: status });
      assert.equal(out.overheads.travelVisits[0].totalCost, 999);
      assert.equal(out.overheads.travelVisits[0].expenses, row.expenses);
      assert.equal(out.notification.mode, status);
      assert.equal(out.notification.visit, out.overheads.travelVisits[0]);
      assert.equal(out.overheads.travelVisits[1], doc.travelVisits[1]);
    }
  }
  for (const s of ['draft', 'approved', 'rejected', 'weird', null]) {
    fails({ kind: 'review_visit', record_id: 'v1', status: 'approved' }, 'invalid_visit_status', { travelVisits: [visitRow({ reimbursementStatus: s })], otherEntries: [] });
  }
  for (const status of ['pending', 'draft', '', undefined, 'APPROVED']) fails({ kind: 'review_visit', record_id: 'v1', status });
});

test('delete_visit returns the raw original', () => {
  const stamp = new Ts(2);
  const target = visitRow({ date: '2026-09-01', raw: stamp });
  const keep = visitRow({ id: 'v2' });
  const out = run({ kind: 'delete_visit', record_id: 'v1' }, deepFreeze({ travelVisits: [target, keep], otherEntries: [entryRow()] }));
  assert.equal(out.removed.type, 'visit');
  assert.equal(out.removed.id, 'v1');
  assert.equal(out.removed.record, target);
  assert.equal(out.removed.record.raw, stamp);
  assert.deepEqual(out.overheads.travelVisits, [keep]);
  assert.equal(out.notification, undefined);
});

test('malformed or duplicate existing state fails intact', () => {
  const bads = [
    { travelVisits: 'x', otherEntries: [] }, { travelVisits: [], otherEntries: {} }, { travelVisits: null, otherEntries: [] },
    { travelVisits: [null], otherEntries: [] }, { travelVisits: [], otherEntries: [5] }, { travelVisits: [], otherEntries: [[]] },
    { travelVisits: [{ noId: 1 }], otherEntries: [] }, { travelVisits: [visitRow({ id: 5 })], otherEntries: [] }, { travelVisits: [visitRow({ id: 'a/b' })], otherEntries: [] },
    { travelVisits: [visitRow(), visitRow()], otherEntries: [] }, { travelVisits: [], otherEntries: [entryRow(), entryRow()] },
    [], 'x', 5,
  ];
  for (const doc of bads) fails({ kind: 'add_entry', record_id: 'new', input: entryInput() }, 'invalid_overhead_state', doc);
});

test('bad context: project, actor, now', () => {
  const base = { project, overheads: {}, actor, now, command: { kind: 'add_entry', record_id: 'o1', input: entryInput() } };
  for (const patch of [{ project: null }, { project: { projectId: '' } }, { project: { projectId: 'a/b' } }, { actor: null }, { actor: { uid: '', email: 'a' } }, { actor: { uid: 'u', email: 5 } }, { actor: { uid: 'u', email: 'a', displayName: 5 } }, { now: new Date('x') }, { now: '2026-01-01' }]) {
    assert.throws(() => applyOverheadCommand({ ...base, ...patch }), isOverheadFault);
  }
});

test('validateOverheadCommand: strict keys, kinds, oversize and non-plain', () => {
  assert.doesNotThrow(() => validateOverheadCommand({ kind: 'delete_entry', record_id: 'o1' }));
  assert.doesNotThrow(() => validateOverheadCommand({ kind: 'review_visit', record_id: 'v1', status: 'rejected' }));
  const cases = [
    null, [], 'x', { kind: 'bogus' }, {}, { kind: 'delete_entry' }, { kind: 'delete_entry', record_id: 'o1', extra: 1 }, { kind: 'delete_visit', record_id: 'v1', status: 'approved' },
    { kind: 'submit_visit', record_id: 'v1', status: 'pending' }, { kind: 'review_visit', record_id: 'v1' }, { kind: 'add_entry', record_id: 'o1' },
    { kind: 'add_entry', record_id: 'o1', input: entryInput(), createdBy: 'x' }, { kind: 'add_visit', record_id: 'v1', input: null },
    { kind: 'add_visit', record_id: 'v1', input: [] }, Object.create({ kind: 'delete_entry', record_id: 'o1' }),
    { kind: 'add_entry', record_id: 'o1', input: entryInput({ description: 'a'.repeat(300 * 1024) }) },
    { kind: 'add_visit', record_id: 'v1', input: visitInput({ expenses: Array.from({ length: 3000 }, (_, i) => expense({ id: `e${i}`, description: 'x'.repeat(100) })) }) },
  ];
  for (const c of cases) assert.throws(() => validateOverheadCommand(c), isOverheadFault);
  assert.throws(() => validateOverheadCommand({ kind: 'add_entry', record_id: 'o1', input: entryInput({ description: 'a'.repeat(300 * 1024) }) }), e => e.code === 'overhead_command_too_large' && e.status === 413);
  const cyc = { kind: 'delete_entry', record_id: 'o1' }; cyc.self = cyc;
  assert.throws(() => validateOverheadCommand(cyc), isOverheadFault);
});

test('inputs are never mutated and results do not alias mutable command input', () => {
  const command = deepFreeze({ kind: 'add_visit', record_id: 'v2', input: visitInput({ location: 'x' }) });
  const doc = deepFreeze({ travelVisits: [visitRow()], otherEntries: [entryRow()] });
  const out = run(command, doc);
  assert.notEqual(out.overheads.travelVisits[1].attendees, command.input.attendees);
  assert.notEqual(out.overheads.travelVisits[1].expenses[0], command.input.expenses[0]);
  assert.equal(doc.travelVisits.length, 1);
  assert.equal(out.overheads.travelVisits.length, 2);
});
