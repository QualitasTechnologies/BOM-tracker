'use strict';

const COMMAND_ERROR = Symbol('invalid-support-profile-command');
const STATE_ERROR = Symbol('invalid-support-profile-state');
const PROFILE_STRINGS = new Set([
  'commissioningDate', 'machineSerialNumber', 'machineModel', 'siteLocation',
  'warrantyStartDate', 'warrantyEndDate', 'amcStartDate', 'amcEndDate',
  'amcContractNumber', 'supportContactId', 'internalNotes',
]);
const PROFILE_DATES = new Set(['commissioningDate', 'warrantyStartDate', 'warrantyEndDate', 'amcStartDate', 'amcEndDate']);
const MACHINE_STRINGS = new Set([
  'name', 'lineName', 'model', 'serialNumber', 'siteLocation', 'commissioningDate',
  'warrantyStartDate', 'warrantyEndDate', 'amcStartDate', 'amcEndDate',
  'amcContractNumber', 'notes',
]);
const MACHINE_DATES = new Set(['commissioningDate', 'warrantyStartDate', 'warrantyEndDate', 'amcStartDate', 'amcEndDate']);
const AMC_STATES = new Set(['none', 'active', 'expired']);
const MACHINE_STATES = new Set(['active', 'inactive', 'decommissioned']);
const PROFILE_FIELDS = new Set([...PROFILE_STRINGS, 'amcStatus', 'responseCommitmentHours']);
const MACHINE_FIELDS = new Set([...MACHINE_STRINGS, 'amcStatus', 'status']);
const LEGACY_MACHINE_FIELDS = ['machineSerialNumber', 'machineModel', 'siteLocation', 'commissioningDate'];

function commandError(path, reason = 'invalid command') {
  const error = new Error(`Invalid Support profile command at ${path}: ${reason}`);
  error.code = 'invalid_support_profile_command';
  error.status = 400;
  Object.defineProperty(error, COMMAND_ERROR, { value: true });
  return error;
}

function stateError(path, reason = 'invalid stored state') {
  const error = new Error(`Invalid Support profile state at ${path}: ${reason}`);
  error.code = 'invalid_support_profile_state';
  error.status = 409;
  Object.defineProperty(error, STATE_ERROR, { value: true });
  return error;
}

function isSupportProfileCommandError(error) { return Boolean(error && error[COMMAND_ERROR] === true); }
function isSupportProfileStateError(error) { return Boolean(error && error[STATE_ERROR] === true); }

function isPlainObject(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || value instanceof Date) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function ownDataEntries(value, path, errorFactory) {
  if (!isPlainObject(value)) throw errorFactory(path, 'expected plain object');
  const entries = [];
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || (key === '__proto__' && errorFactory !== stateError)) {
      throw errorFactory(path, 'unsupported property key');
    }
    const descriptor = Object.getOwnPropertyDescriptor(value, key);
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw errorFactory(`${path}.${key}`, 'accessors are not allowed');
    entries.push([key, descriptor.value]);
  }
  return entries;
}

function strictObject(value, path, allowed, errorFactory) {
  const entries = ownDataEntries(value, path, errorFactory);
  const result = new Map();
  for (const [key, item] of entries) {
    if (!allowed.has(key)) throw errorFactory(`${path}.${key}`, 'unknown field');
    result.set(key, item);
  }
  return result;
}

function plainArray(value, path, errorFactory) {
  if (!Array.isArray(value)) throw errorFactory(path, 'expected array');
  const result = [];
  for (let index = 0; index < value.length; index += 1) {
    const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
    if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw errorFactory(`${path}[${index}]`, 'expected own data element');
    result.push(descriptor.value);
  }
  return result;
}

function validDate(value) {
  if (value === '' || value === null) return true;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value;
}

function validateScalar(key, value, path, command) {
  const fail = command ? commandError : stateError;
  if (PROFILE_STRINGS.has(key) || MACHINE_STRINGS.has(key)) {
    if (value !== null && typeof value !== 'string') throw fail(path, 'expected string or null');
    if (PROFILE_DATES.has(key) || MACHINE_DATES.has(key)) {
      if (value !== null && !validDate(value)) throw fail(path, 'expected valid YYYY-MM-DD date, empty string or null');
    }
    return;
  }
  if (key === 'amcStatus') {
    if (value !== null && !AMC_STATES.has(value)) throw fail(path, 'invalid AMC status');
    return;
  }
  if (key === 'status') {
    if (value !== null && !MACHINE_STATES.has(value)) throw fail(path, 'invalid machine status');
    return;
  }
  if (key === 'responseCommitmentHours') {
    if (value !== null && (typeof value !== 'number' || !Number.isFinite(value))) throw fail(path, 'expected finite number or null');
  }
}

function inspectMachine(machine, path, errorFactory) {
  const values = new Map(ownDataEntries(machine, path, errorFactory));
  for (const [key, value] of values) {
    if (MACHINE_FIELDS.has(key)) validateScalar(key, value, `${path}.${key}`, errorFactory === commandError);
  }
  for (const required of ['id', 'name', 'serialNumber']) {
    const value = values.get(required);
    if (typeof value !== 'string') throw errorFactory(`${path}.${required}`, 'required string');
  }
  return values;
}

function inspectProfile(profile) {
  const values = new Map(ownDataEntries(profile, 'supportProfile', stateError));
  for (const [key, value] of values) {
    if (PROFILE_FIELDS.has(key)) validateScalar(key, value, `supportProfile.${key}`, false);
  }
  let machines = [];
  if (values.has('machines') && values.get('machines') !== null) {
    machines = plainArray(values.get('machines'), 'supportProfile.machines', stateError);
    const ids = new Set();
    machines.forEach((machine, index) => {
      const fields = inspectMachine(machine, `supportProfile.machines[${index}]`, stateError);
      const id = fields.get('id');
      if (ids.has(id)) throw stateError(`supportProfile.machines[${index}].id`, 'duplicate machine ID');
      ids.add(id);
    });
  }
  return { values, machines };
}

function copyWithChanges(source, changes) {
  const result = {};
  for (const key of Reflect.ownKeys(source)) {
    if (typeof key === 'string') {
      const descriptor = Object.getOwnPropertyDescriptor(source, key);
      Object.defineProperty(result, key, { value: descriptor.value, enumerable: descriptor.enumerable, configurable: true, writable: true });
    }
  }
  for (const [key, value] of changes) Object.defineProperty(result, key, { value, enumerable: true, configurable: true, writable: true });
  return result;
}

function hasLegacyMachineFallback(values) {
  return LEGACY_MACHINE_FIELDS.some(field => values.get(field));
}

function applySupportProfileCommand(rawProfile, command) {
  const raw = rawProfile === undefined || rawProfile === null ? {} : rawProfile;
  const inspected = inspectProfile(raw), rawValues = inspected.values;
  let originalMachines = inspected.machines;
  const commandFields = strictObject(command, 'command', new Set(['kind', 'patch', 'machines']), commandError);
  if (commandFields.get('kind') !== 'support_profile') throw commandError('command.kind', 'expected support_profile');
  if (!commandFields.has('patch') && !commandFields.has('machines')) throw commandError('command', 'empty command');

  const profilePatch = commandFields.has('patch')
    ? strictObject(commandFields.get('patch'), 'command.patch', PROFILE_FIELDS, commandError)
    : new Map();
  if (profilePatch.has('machines') || profilePatch.has('supportContacts')) throw commandError('command.patch', 'machines and supportContacts cannot be replaced');
  for (const [key, value] of profilePatch) validateScalar(key, value, `command.patch.${key}`, true);

  const operations = commandFields.has('machines')
    ? plainArray(commandFields.get('machines'), 'command.machines', commandError)
    : [];
  const legacy = (!rawValues.has('machines') || rawValues.get('machines') === null) && hasLegacyMachineFallback(rawValues);
  const migration = isPlainObject(operations[0]) && operations[0].kind === 'migrate_legacy';
  if (migration) {
    if (!legacy) throw commandError('command.machines', 'no legacy fallback to migrate');
    const machine = { id: 'legacy-primary-machine', name: rawValues.get('machineModel') || 'Primary machine', serialNumber: rawValues.get('machineSerialNumber') || 'Not recorded', status: 'active' };
    for (const [from, to] of [['machineModel', 'model'], ...['siteLocation', 'commissioningDate', 'warrantyStartDate', 'warrantyEndDate', 'amcStatus', 'amcStartDate', 'amcEndDate', 'amcContractNumber'].map(field => [field, field])]) {
      if (rawValues.has(from)) machine[to] = rawValues.get(from);
    }
    originalMachines = [machine];
  }
  if (operations.length > 0 && legacy && !migration) {
    throw commandError('command.machines', 'legacy machine fallback requires explicit migration');
  }
  const existingById = new Map(originalMachines.map(machine => [new Map(ownDataEntries(machine, 'machine', stateError)).get('id'), machine]));
  const seenTargets = new Set();
  const machinePatches = new Map();
  const removals = new Set();
  const additions = [];
  const changes = migration ? [['supportProfile.machines', originalMachines]] : [];

  for (let index = 0; index < operations.length; index += 1) {
    const path = `command.machines[${index}]`;
    const operation = strictObject(operations[index], path, new Set(['kind', 'id', 'patch', 'machine']), commandError);
    const kind = operation.get('kind');
    if (kind === 'migrate_legacy') {
      if (!migration || index !== 0 || operation.size !== 1) throw commandError(path, 'invalid legacy migration');
    } else if (kind === 'patch') {
      if (!operation.has('id') || !operation.has('patch') || operation.has('machine')) throw commandError(path, 'invalid patch operation');
      const id = operation.get('id');
      if (typeof id !== 'string' || !existingById.has(id)) throw commandError(`${path}.id`, 'unknown machine ID');
      if (seenTargets.has(id)) throw commandError(`${path}.id`, 'duplicate machine operation');
      seenTargets.add(id);
      const patch = strictObject(operation.get('patch'), `${path}.patch`, MACHINE_FIELDS, commandError);
      if (patch.size === 0) throw commandError(`${path}.patch`, 'empty patch');
      const current = new Map(ownDataEntries(existingById.get(id), 'machine', stateError));
      const effective = new Map();
      for (const [key, value] of patch) {
        validateScalar(key, value, `${path}.patch.${key}`, true);
        if (['name', 'serialNumber'].includes(key) && (typeof value !== 'string' || value.trim() === '')) {
          throw commandError(`${path}.patch.${key}`, 'required field must be nonblank');
        }
        if (!Object.is(current.get(key), value)) effective.set(key, value);
      }
      if (effective.size === 0) throw commandError(path, 'no effective changes');
      machinePatches.set(id, effective);
    } else if (kind === 'remove') {
      if (!operation.has('id') || operation.has('patch') || operation.has('machine')) throw commandError(path, 'invalid remove operation');
      const id = operation.get('id');
      if (typeof id !== 'string' || !existingById.has(id)) throw commandError(`${path}.id`, 'unknown machine ID');
      if (seenTargets.has(id)) throw commandError(`${path}.id`, 'duplicate machine operation');
      seenTargets.add(id);
      removals.add(id);
    } else if (kind === 'add') {
      if (!operation.has('machine') || operation.has('id') || operation.has('patch')) throw commandError(path, 'invalid add operation');
      const machine = operation.get('machine');
      const fields = strictObject(machine, `${path}.machine`, new Set(['id', ...MACHINE_FIELDS]), commandError);
      for (const [key, value] of fields) if (key !== 'id') validateScalar(key, value, `${path}.machine.${key}`, true);
      for (const required of ['id', 'name', 'serialNumber']) {
        const value = fields.get(required);
        if (typeof value !== 'string' || value.trim() === '') throw commandError(`${path}.machine.${required}`, 'required nonblank string');
      }
      const id = fields.get('id');
      if (existingById.has(id) || seenTargets.has(id)) throw commandError(`${path}.machine.id`, 'duplicate or colliding machine ID');
      seenTargets.add(id);
      additions.push(machine);
    } else {
      throw commandError(`${path}.kind`, 'expected patch, add or remove');
    }
  }

  for (const [key, value] of profilePatch) {
    if (!rawValues.has(key) || !Object.is(rawValues.get(key), value)) changes.push([`supportProfile.${key}`, value]);
  }
  for (const [id, patch] of machinePatches) {
    for (const key of patch.keys()) changes.push([`supportProfile.machines.${id}.${key}`, patch.get(key)]);
  }
  for (const id of removals) changes.push([`supportProfile.machines.${id}`, null]);
  for (const machine of additions) changes.push([`supportProfile.machines.${new Map(ownDataEntries(machine, 'machine', commandError)).get('id')}`, machine]);
  if (changes.length === 0) throw commandError('command', 'no effective changes');

  const profileChanges = changes.filter(([path]) => !path.startsWith('supportProfile.machines.'));
  const result = copyWithChanges(raw, profileChanges.map(([path, value]) => [path.slice('supportProfile.'.length), value]));
  if (operations.length > 0) {
    const nextMachines = [];
    for (const machine of originalMachines) {
      const id = new Map(ownDataEntries(machine, 'machine', stateError)).get('id');
      if (removals.has(id)) continue;
      nextMachines.push(machinePatches.has(id) ? copyWithChanges(machine, machinePatches.get(id)) : machine);
    }
    nextMachines.push(...additions);
    Object.defineProperty(result, 'machines', { value: nextMachines, enumerable: true, configurable: true, writable: true });
  }
  return { profile: result, changedPaths: changes.map(([path]) => path) };
}

module.exports = {
  applySupportProfileCommand,
  isSupportProfileCommandError,
  isSupportProfileStateError,
};



