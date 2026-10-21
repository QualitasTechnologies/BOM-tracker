const test = require('node:test');
const assert = require('node:assert/strict');
const { projectReadView, supportProfileView, isProjectReadStateError } = require('./projectReadView.cjs');

const external = { uid: 'partner-1', customClaims: { role: 'user' }, email: 'partner@example.com', emailVerified: false };

test('external project view scopes categories and excludes private root data', () => {
  const raw = {
    projectId: 'P1', projectName: 'Build', clientName: 'Client', clientId: 'C1',
    billingEntityId: 'BE1', description: '', status: 'Ongoing', deadline: '',
    archivedAt: null, category: 'customer', backfilledContactEmails: ['a@example.com'],
    members: [{ userId: 'partner-1', displayName: 'Pat', email: 'partner@example.com', categoryScope: ['Mechanical'], notificationsEnabled: false, privateThing: 1 },
      { userId: 'user-2', displayName: 'Lee', email: 'lee@example.com', categoryScope: ['Electrical'] }],
    memberIds: ['partner-1', 'user-2'], bomSnapshot: [{ secret: true }], bomSnapshotDate: '2025-01-01',
    poValue: 200, internalBudget: 100, externalRecipients: [{ email: 'hidden@example.com' }],
    secretRoot: 'omit',
  };
  const before = structuredClone(raw);
  const view = projectReadView('P1', raw, external);
  assert.deepEqual(view, {
    projectId: 'P1', projectName: 'Build', clientName: 'Client', clientId: 'C1',
    billingEntityId: 'BE1', description: '', status: 'Ongoing', deadline: '',
    archivedAt: null, category: 'customer', backfilledContactEmails: ['a@example.com'],
    memberIds: ['partner-1', 'user-2'],
    members: [
      { userId: 'partner-1', displayName: 'Pat', email: 'partner@example.com', categoryScope: ['Mechanical'] },
      { userId: 'user-2', displayName: 'Lee', email: 'lee@example.com' },
    ],
  });
  assert.deepEqual(raw, before);
  assert.notEqual(view.members, raw.members);
  assert.notEqual(view.backfilledContactEmails, raw.backfilledContactEmails);
});

test('internal and admin views retain JSON project history and safely serialize dates', () => {
  const raw = {
    projectId: 'P2', projectName: 'Archive', category: 'internal',
    bomSnapshot: [{ category: 'Old category', items: [{ name: 'Removed item' }] }],
    bomSnapshotDate: new Date('2024-05-06T00:00:00.000Z'), custom: { keep: true },
  };
  const view = projectReadView('P2', raw, { uid: 'a', customClaims: { role: 'admin' }, emailVerified: false });
  assert.deepEqual(view, { ...raw, bomSnapshotDate: '2024-05-06T00:00:00.000Z' });
  assert.notEqual(view.custom, raw.custom);
  assert.notEqual(view.bomSnapshot, raw.bomSnapshot);
});

test('Firestore Timestamp values are explicitly serialized as ISO dates', () => {
  class Timestamp { constructor(seconds, nanoseconds) { this.seconds = seconds; this.nanoseconds = nanoseconds; } }
  const view = projectReadView('P', { updatedAt: new Timestamp(1, 500000000) }, { customClaims: { role: 'admin' }, emailVerified: false });
  assert.equal(view.updatedAt, '1970-01-01T00:00:01.500Z');
});

test('verified Qualitas internal email and custom-claim admin get full view; fake top-level role does not elevate', () => {
  const raw = { projectId: 'P', projectName: 'X', internalBudget: 9, bomSnapshot: [] };
  assert.deepEqual(projectReadView('P', raw, { uid: 'u', email: 'x@qualitastech.com', emailVerified: true }), {
    projectId: 'P', projectName: 'X', internalBudget: 9, bomSnapshot: [],
  });
  const externalView = projectReadView('P', raw, { uid: 'u', email: 'x@qualitastech.com', emailVerified: false, customClaims: { role: 'user' } });
  assert.equal('internalBudget' in externalView, false);
  assert.equal('internalBudget' in projectReadView('P', raw, { uid: 'u', role: 'admin', email: 'p@other.com', emailVerified: false }), false);
});

test('legacy null memberIds and supportProfile remain null', () => {
  const view = projectReadView('P', { memberIds: null, supportProfile: null }, external);
  assert.equal(view.memberIds, null);
  assert.equal(view.supportProfile, null);
});

test('Support profile preserves null optional values used by current form and legacy machine fallbacks', () => {
  const profile = {
    machines: null, commissioningDate: null, machineSerialNumber: null, machineModel: null,
    siteLocation: null, warrantyStartDate: null, warrantyEndDate: null, amcStatus: null,
    amcStartDate: null, amcEndDate: null, amcContractNumber: null, supportContactId: null,
    supportContacts: null, internalNotes: null,
  };
  assert.deepEqual(supportProfileView(profile), profile);
  const project = projectReadView('P', { supportProfile: profile }, external);
  assert.deepEqual(project.supportProfile, profile);
  assert.deepEqual(supportProfileView({ responseCommitmentHours: null }), {});
  const machine = { id: 'm', name: 'Line', serialNumber: 'S', model: null, lineName: null, siteLocation: null,
    commissioningDate: null, warrantyStartDate: null, warrantyEndDate: null, amcStatus: null,
    amcStartDate: null, amcEndDate: null, amcContractNumber: null, status: null, notes: null };
  assert.deepEqual(supportProfileView({ machines: [machine] }).machines, [machine]);
  assert.deepEqual(supportProfileView({ supportContacts: [{ name: 'Legacy', email: null, phone: null, designation: null }] }), {
    supportContacts: [{ name: 'Legacy', email: null, phone: null, designation: null }],
  });
});

test('known date controls accept empty strings and valid calendar dates, reject invalid dates', () => {
  assert.equal(projectReadView('P', { deadline: '', supportProfile: { warrantyStartDate: '2024-02-29' } }, external).deadline, '');
  for (const raw of [
    { deadline: '2025-02-29' },
    { supportProfile: { commissioningDate: '2024-13-01' } },
    { supportProfile: { machines: [{ id: 'm', name: 'M', serialNumber: 'S', warrantyEndDate: '2024-02-30' }] } },
  ]) assert.throws(() => projectReadView('P', raw, external), error => isProjectReadStateError(error) && error.status === 409);
});

test('support profile preserves legacy scalar fields and projects current and legacy machines', () => {
  const raw = {
    commissioningDate: '', machineSerialNumber: 'OLD-1', machineModel: 'Legacy', siteLocation: 'Plant',
    warrantyStartDate: '', warrantyEndDate: '2026-12-31', amcStatus: 'active', amcStartDate: '2025-01-01',
    amcEndDate: '2026-01-01', amcContractNumber: 'AMC-1', responseCommitmentHours: 4,
    supportContactId: 'contact-1', supportContacts: [{ name: 'Old', email: 'o@example.com', phone: '', designation: 'Ops', extra: 1 }],
    internalNotes: 'Gate code', machines: [{ id: 'm1', name: 'Line', lineName: 'Line A', model: 'M', serialNumber: 'S',
      siteLocation: 'Plant', commissioningDate: '', warrantyStartDate: '2025-01-01', warrantyEndDate: '',
      amcStatus: 'none', amcStartDate: '', amcEndDate: '', amcContractNumber: '', status: 'active', notes: '', extra: 'omit' }],
    unknown: 'stored server-side',
  };
  const before = structuredClone(raw);
  const view = supportProfileView(raw);
  assert.deepEqual(view, {
    commissioningDate: '', machineSerialNumber: 'OLD-1', machineModel: 'Legacy', siteLocation: 'Plant',
    warrantyStartDate: '', warrantyEndDate: '2026-12-31', amcStatus: 'active', amcStartDate: '2025-01-01',
    amcEndDate: '2026-01-01', amcContractNumber: 'AMC-1', responseCommitmentHours: 4,
    supportContactId: 'contact-1', supportContacts: [{ name: 'Old', email: 'o@example.com', phone: '', designation: 'Ops' }],
    internalNotes: 'Gate code', machines: [{ id: 'm1', name: 'Line', lineName: 'Line A', model: 'M', serialNumber: 'S',
      siteLocation: 'Plant', commissioningDate: '', warrantyStartDate: '2025-01-01', warrantyEndDate: '',
      amcStatus: 'none', amcStartDate: '', amcEndDate: '', amcContractNumber: '', status: 'active', notes: '' }],
  });
  assert.deepEqual(raw, before);
});

test('null and absent optional Support values keep UI fallback behavior', () => {
  assert.equal(supportProfileView(null), null);
  assert.equal(supportProfileView(undefined), undefined);
  assert.deepEqual(supportProfileView({}), {});
});

test('known malformed root and Support fields fail with a stable integrity error', () => {
  for (const [raw, actor] of [
    [{ projectName: 42 }, external],
    [{ members: [{ userId: 'partner-1', displayName: 'U', email: 'u@x.com', categoryScope: 'all' }] }, external],
    [{ backfilledContactEmails: 'a@x.com' }, external],
    [{ supportProfile: { amcStatus: 'maybe' } }, external],
    [{ supportProfile: { responseCommitmentHours: Infinity } }, external],
    [{ supportProfile: { machines: [{ id: 'm', name: 'M', serialNumber: 'S', status: 'broken' }] } }, external],
    [{ supportProfile: { supportContacts: [{ name: 'A', phone: 1 }] } }, external],
  ]) {
    assert.throws(() => projectReadView('P', raw, actor), error => {
      assert.equal(isProjectReadStateError(error), true);
      assert.equal(error.code, 'invalid_project_read_state');
      assert.equal(error.status, 409);
      return true;
    });
  }
});

test('unsupported internal SDK values fail without invoking toJSON; unknown external profile fields are omitted', () => {
  let called = false;
  const unsafe = { toJSON() { called = true; return { credential: 'leak' }; } };
  assert.throws(() => projectReadView('P', { custom: unsafe }, { customClaims: { role: 'admin' }, emailVerified: false }), error => isProjectReadStateError(error));
  assert.equal(called, false);
  assert.deepEqual(projectReadView('P', { supportProfile: { internalNotes: 'ok', unknown: unsafe } }, external).supportProfile, { internalNotes: 'ok' });
});

test('full access validates known fields, preserves long strings and safely copies own __proto__ data', () => {
  const longNotes = 'n'.repeat(12000);
  assert.equal(projectReadView('P', { supportProfile: { internalNotes: longNotes } }, { customClaims: { role: 'admin' } }).supportProfile.internalNotes, longNotes);
  assert.throws(() => projectReadView('P', { deadline: 'not-a-date' }, { customClaims: { role: 'admin' } }), error => isProjectReadStateError(error));
  assert.throws(() => projectReadView('P', { supportProfile: { amcStatus: 'broken' } }, { customClaims: { role: 'admin' } }), error => isProjectReadStateError(error));
  const raw = JSON.parse('{"__proto__":{"polluted":true},"projectName":"Safe"}');
  const view = projectReadView('P', raw, { customClaims: { role: 'admin' } });
  assert.equal(Object.getPrototypeOf(view), Object.prototype);
  assert.equal(Object.hasOwn(view, '__proto__'), true);
  assert.deepEqual(view.__proto__, { polluted: true });
  assert.equal({}.polluted, undefined);
});

test('error recognition requires this module’s marker, not a matching public code alone', () => {
  assert.equal(isProjectReadStateError({ code: 'invalid_project_read_state', status: 409 }), false);
});
