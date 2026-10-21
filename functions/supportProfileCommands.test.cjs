const test = require('node:test');
const assert = require('node:assert/strict');
const { applySupportProfileCommand, isSupportProfileCommandError, isSupportProfileStateError } = require('./supportProfileCommands.cjs');

const failCommand = fn => assert.throws(fn, e => isSupportProfileCommandError(e) && e.code === 'invalid_support_profile_command' && e.status === 400);
const failState = fn => assert.throws(fn, e => isSupportProfileStateError(e) && e.code === 'invalid_support_profile_state' && e.status === 409);

test('patches explicit profile and machine fields immutably while retaining unknown raw identities', () => {
  class Timestamp { constructor(seconds) { this.seconds = seconds; } }
  class GeoPoint { constructor(latitude, longitude) { this.latitude = latitude; this.longitude = longitude; } }
  class Reference { constructor(path) { this.path = path; } }
  const timestamp = new Timestamp(10), reference = new Reference('projects/P'), geoPoint = new GeoPoint(1, 2), bytes = Buffer.from([1, 2]);
  const untouched = { id: 'm2', name: 'Other', serialNumber: 'S2', vendorRaw: reference };
  const profile = { unknown: reference, geoPoint, supportContacts: [{ name: 'Old' }], timestamp, machines: [
    { id: 'm1', name: 'Line', serialNumber: 'S1', unknown: bytes }, untouched,
  ] };
  const protoValue = new Reference('raw-own-proto');
  Object.defineProperty(profile, '__proto__', { value: protoValue, enumerable: true, configurable: true });
  const result = applySupportProfileCommand(profile, {
    kind: 'support_profile', patch: { internalNotes: 'New', supportContactId: null },
    machines: [{ kind: 'patch', id: 'm1', patch: { notes: 'X' } }],
  });
  assert.deepEqual(result.changedPaths, ['supportProfile.internalNotes', 'supportProfile.supportContactId', 'supportProfile.machines.m1.notes']);
  assert.equal(result.profile.unknown, reference);
  assert.equal(result.profile.timestamp, timestamp);
  assert.equal(result.profile.geoPoint, geoPoint);
  assert.equal(Object.hasOwn(result.profile, '__proto__'), true);
  assert.equal(result.profile.__proto__, protoValue);
  assert.equal(Object.getPrototypeOf(result.profile), Object.prototype);
  assert.equal(result.profile.supportContacts, profile.supportContacts);
  assert.notEqual(result.profile, profile);
  assert.notEqual(result.profile.machines, profile.machines);
  assert.notEqual(result.profile.machines[0], profile.machines[0]);
  assert.equal(result.profile.machines[0].unknown, bytes);
  assert.equal(result.profile.machines[1], untouched);
  assert.deepEqual(profile.machines[0], { id: 'm1', name: 'Line', serialNumber: 'S1', unknown: bytes });
});

test('appends and explicitly removes machines while retaining order and stable caller IDs', () => {
  const raw = { machines: [
    { id: 'a', name: 'A', serialNumber: '1' }, { id: 'b', name: 'B', serialNumber: '2' },
  ] };
  const command = { kind: 'support_profile', machines: [
    { kind: 'remove', id: 'a' }, { kind: 'add', machine: { id: 'c', name: 'C', serialNumber: '3' } },
  ] };
  const first = applySupportProfileCommand(raw, command);
  const retry = applySupportProfileCommand(raw, command);
  assert.deepEqual(first.profile.machines.map(m => m.id), ['b', 'c']);
  assert.deepEqual(retry.profile.machines.map(m => m.id), ['b', 'c']);
  assert.equal(first.profile.machines[0], raw.machines[1]);
});

test('allows null to clear optional fields and accepts valid calendar dates', () => {
  const result = applySupportProfileCommand({ warrantyEndDate: '2026-12-31' }, {
    kind: 'support_profile', patch: { warrantyEndDate: null, amcStatus: 'active', commissioningDate: '2024-02-29' },
  });
  assert.deepEqual(result.profile, { warrantyEndDate: null, amcStatus: 'active', commissioningDate: '2024-02-29' });
});

test('rejects empty commands, unknown keys, malformed objects, accessors and prototype keys', () => {
  failCommand(() => applySupportProfileCommand({}, { kind: 'support_profile' }));
  failCommand(() => applySupportProfileCommand({}, { kind: 'support_profile', extra: true, patch: { internalNotes: 'x' } }));
  const dangerous = {};
  Object.defineProperty(dangerous, '__proto__', { value: { polluted: true }, enumerable: true });
  failCommand(() => applySupportProfileCommand({}, { kind: 'support_profile', patch: dangerous }));
  const accessor = {};
  Object.defineProperty(accessor, 'internalNotes', { enumerable: true, get() { throw new Error('must not run'); } });
  failCommand(() => applySupportProfileCommand({}, { kind: 'support_profile', patch: accessor }));
  failCommand(() => applySupportProfileCommand({}, { kind: 'support_profile', patch: Object.create({ internalNotes: 'x' }) }));
  failState(() => applySupportProfileCommand([], { kind: 'support_profile', patch: { internalNotes: 'x' } }));
});

test('rejects invalid fields, required-field clears, bad dates, enums and non-finite numbers', () => {
  for (const patch of [
    { machines: [] }, { supportContacts: [] }, { id: 'x' },
    { warrantyEndDate: '2025-02-29' }, { amcStatus: 'maybe' }, { responseCommitmentHours: Infinity },
    { internalNotes: 3 },
  ]) failCommand(() => applySupportProfileCommand({}, { kind: 'support_profile', patch }));
  failCommand(() => applySupportProfileCommand({ machines: [{ id: 'm', name: 'M', serialNumber: 'S' }] }, {
    kind: 'support_profile', machines: [{ kind: 'patch', id: 'm', patch: { name: '   ' } }],
  }));
  failCommand(() => applySupportProfileCommand({}, { kind: 'support_profile', machines: [{ kind: 'add', machine: { id: 'm', name: ' ', serialNumber: 'S' } }] }));
});

test('rejects duplicate or colliding machine IDs, unknown targets and duplicate operations', () => {
  const duplicate = { machines: [{ id: 'm', name: 'M', serialNumber: 'S' }, { id: 'm', name: 'M2', serialNumber: 'S2' }] };
  failState(() => applySupportProfileCommand(duplicate, { kind: 'support_profile', patch: { internalNotes: 'x' } }));
  const raw = { machines: [{ id: 'm', name: 'M', serialNumber: 'S' }] };
  failCommand(() => applySupportProfileCommand(raw, { kind: 'support_profile', machines: [{ kind: 'add', machine: { id: 'm', name: 'Other', serialNumber: 'S2' } }] }));
  failCommand(() => applySupportProfileCommand(raw, { kind: 'support_profile', machines: [{ kind: 'remove', id: 'gone' }] }));
  failCommand(() => applySupportProfileCommand(raw, { kind: 'support_profile', machines: [{ kind: 'remove', id: 'm' }, { kind: 'remove', id: 'm' }] }));
});

test('legacy machine fallback requires explicit migration before any machine command', () => {
  for (const raw of [
    { machineSerialNumber: 'OLD' }, { machines: null, machineModel: 'Legacy' },
  ]) failCommand(() => applySupportProfileCommand(raw, {
    kind: 'support_profile', machines: [{ kind: 'add', machine: { id: 'new', name: 'New', serialNumber: 'N' } }],
  }));
  const result = applySupportProfileCommand({ machineSerialNumber: 'OLD' }, { kind: 'support_profile', patch: { internalNotes: 'Keep' } });
  assert.equal(result.profile.machineSerialNumber, 'OLD');
});

test('rejects malformed state and does not invoke toJSON or mutate the input', () => {
  let called = false;
  const profile = { machines: [{ id: 'm', name: 'M', serialNumber: 'S', toJSON() { called = true; } }] };
  const before = profile.machines[0];
  const result = applySupportProfileCommand(profile, { kind: 'support_profile', patch: { internalNotes: 'x' } });
  assert.equal(called, false);
  assert.equal(result.profile.machines[0], before);
  failState(() => applySupportProfileCommand({ machines: 'bad' }, { kind: 'support_profile', patch: { internalNotes: 'x' } }));
  failState(() => applySupportProfileCommand({ machines: [{ id: 'm', name: 7, serialNumber: 'S' }] }, { kind: 'support_profile', patch: { internalNotes: 'x' } }));
  const legacyBlank = applySupportProfileCommand({ machines: [{ id: 'm', name: '', serialNumber: 'S' }] }, { kind: 'support_profile', patch: { internalNotes: 'x' } });
  assert.equal(legacyBlank.profile.machines[0].name, '');
});





