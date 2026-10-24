'use strict';

const ROOT_FIELDS = [
  'projectName', 'clientName', 'clientId', 'billingEntityId', 'description',
  'status', 'deadline', 'archivedAt', 'category', 'backfilledContactEmails',
];
const SUPPORT_FIELDS = [
  'machines', 'commissioningDate', 'machineSerialNumber', 'machineModel',
  'siteLocation', 'warrantyStartDate', 'warrantyEndDate', 'amcStatus',
  'amcStartDate', 'amcEndDate', 'amcContractNumber', 'responseCommitmentHours',
  'supportContactId', 'supportContacts', 'internalNotes',
];
const MACHINE_FIELDS = [
  'id', 'name', 'lineName', 'model', 'serialNumber', 'siteLocation',
  'commissioningDate', 'warrantyStartDate', 'warrantyEndDate', 'amcStatus',
  'amcStartDate', 'amcEndDate', 'amcContractNumber', 'status', 'notes',
];
const CONTACT_FIELDS = ['name', 'email', 'phone', 'designation'];
const PROJECT_STATUSES = ['Planning', 'Procurement', 'Ongoing', 'Delayed', 'Completed', 'Archived'];
const READ_STATE_ERROR = Symbol('project-read-state-error');
const SUPPORT_DATE_FIELDS = ['commissioningDate', 'warrantyStartDate', 'warrantyEndDate', 'amcStartDate', 'amcEndDate'];
const MACHINE_DATE_FIELDS = SUPPORT_DATE_FIELDS;

function readStateError(path, reason = 'invalid value') {
  const error = new Error(`Project read data integrity failure at ${path}: ${reason}`);
  error.code = 'invalid_project_read_state';
  error.status = 409;
  Object.defineProperty(error, READ_STATE_ERROR, { value: true });
  return error;
}

function isProjectReadStateError(error) {
  return Boolean(error && error[READ_STATE_ERROR] === true);
}

function isRecord(value) {
  if (value === null || typeof value !== 'object' || Array.isArray(value) || value instanceof Date) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

function assertRecord(value, path) {
  if (!isRecord(value)) throw readStateError(path, 'expected plain object');
}

function copyJson(value, path, seen = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw readStateError(path, 'expected finite number');
    return value;
  }
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) throw readStateError(path, 'invalid Date');
    return value.toISOString();
  }
  if (value === undefined || typeof value !== 'object') throw readStateError(path, 'not JSON-compatible');
  if (seen.has(value)) throw readStateError(path, 'cyclic value');
  seen.add(value);
  try {
    if (Array.isArray(value)) return value.map((item, index) => copyJson(item, `${path}[${index}]`, seen));

    // Firestore Timestamp is explicitly supported by its immutable seconds/nanoseconds shape.
    const proto = Object.getPrototypeOf(value);
    if (proto && proto.constructor && proto.constructor.name === 'Timestamp'
      && Number.isInteger(value.seconds) && Number.isInteger(value.nanoseconds)
      && value.nanoseconds >= 0 && value.nanoseconds < 1e9) {
      const milliseconds = value.seconds * 1000 + Math.floor(value.nanoseconds / 1e6);
      const date = new Date(milliseconds);
      if (!Number.isFinite(date.getTime())) throw readStateError(path, 'invalid Timestamp');
      return date.toISOString();
    }
    assertRecord(value, path);
    const result = {};
    for (const key of Object.keys(value)) {
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw readStateError(`${path}.${key}`, 'accessor properties are unsupported');
      Object.defineProperty(result, key, {
        value: copyJson(descriptor.value, `${path}.${key}`, seen), enumerable: true, writable: true, configurable: true,
      });
    }
    return result;
  } finally {
    seen.delete(value);
  }
}

function optionalString(source, key, path, { nullable = false } = {}) {
  if (!Object.hasOwn(source, key)) return undefined;
  const value = source[key];
  if (nullable && value === null) return null;
  if (typeof value !== 'string') throw readStateError(`${path}.${key}`, 'expected string');
  return value;
}

function validCalendarDate(value) {
  if (value === '') return true;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return Number.isFinite(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function optionalDate(source, key, path) {
  const value = optionalString(source, key, path, { nullable: true });
  if (value === null) return null;
  if (value !== undefined && !validCalendarDate(value)) throw readStateError(`${path}.${key}`, 'expected valid YYYY-MM-DD date or empty string');
  return value;
}

function optionalArchiveDate(source, key, path) {
  const value = optionalString(source, key, path, { nullable: true });
  if (value === undefined || value === null) return value;
  const datePart = value.slice(0, 10);
  if (!validCalendarDate(datePart) || !/^\d{4}-\d{2}-\d{2}(?:T.*)?$/.test(value)
    || (value.length > 10 && !Number.isFinite(Date.parse(value)))) {
    throw readStateError(`${path}.${key}`, 'expected valid ISO date/time or null');
  }
  return value;
}

function optionalEnum(source, key, path, values, { nullable = false } = {}) {
  if (!Object.hasOwn(source, key)) return undefined;
  const value = source[key];
  if (nullable && value === null) return null;
  if (!values.includes(value)) throw readStateError(`${path}.${key}`, `expected one of ${values.join(', ')}`);
  return value;
}

function optionalStringArray(source, key, path, { nullable = false } = {}) {
  if (!Object.hasOwn(source, key)) return undefined;
  const value = source[key];
  if (nullable && value === null) return null;
  if (!Array.isArray(value) || value.some(item => typeof item !== 'string')) throw readStateError(`${path}.${key}`, 'expected string array');
  return value.slice();
}

function projectSupportProfile(raw, path = 'supportProfile') {
  if (raw === null) return null;
  assertRecord(raw, path);
  const result = {};
  const stringFields = SUPPORT_FIELDS.filter(field => !['machines', 'supportContacts', 'responseCommitmentHours', 'amcStatus', ...SUPPORT_DATE_FIELDS].includes(field));
  for (const field of stringFields) {
    const value = optionalString(raw, field, path, { nullable: true });
    if (value !== undefined) result[field] = value;
  }
  for (const field of SUPPORT_DATE_FIELDS) {
    const value = optionalDate(raw, field, path);
    if (value !== undefined) result[field] = value;
  }
  const amcStatus = optionalEnum(raw, 'amcStatus', path, ['none', 'active', 'expired'], { nullable: true });
  if (amcStatus !== undefined) result.amcStatus = amcStatus;
  if (Object.hasOwn(raw, 'responseCommitmentHours')) {
    const hours = raw.responseCommitmentHours;
    // The current UI has no consumer or fallback for a null commitment value.
    if (hours !== null) {
      if (typeof hours !== 'number' || !Number.isFinite(hours)) throw readStateError(`${path}.responseCommitmentHours`, 'expected finite number');
      result.responseCommitmentHours = hours;
    }
  }
  if (Object.hasOwn(raw, 'supportContacts')) {
    if (raw.supportContacts === null) result.supportContacts = null;
    else if (!Array.isArray(raw.supportContacts)) throw readStateError(`${path}.supportContacts`, 'expected array');
    else result.supportContacts = raw.supportContacts.map((contact, index) => {
      const contactPath = `${path}.supportContacts[${index}]`;
      assertRecord(contact, contactPath);
      const projected = {};
      for (const field of CONTACT_FIELDS) {
        const value = optionalString(contact, field, contactPath, { nullable: field !== 'name' });
        if (value !== undefined) projected[field] = value;
      }
      if (typeof projected.name !== 'string') throw readStateError(`${contactPath}.name`, 'required string');
      return projected;
    });
  }
  if (Object.hasOwn(raw, 'machines')) {
    if (raw.machines === null) result.machines = null;
    else if (!Array.isArray(raw.machines)) throw readStateError(`${path}.machines`, 'expected array');
    else result.machines = raw.machines.map((machine, index) => {
      const machinePath = `${path}.machines[${index}]`;
      assertRecord(machine, machinePath);
      const projected = {};
      for (const field of MACHINE_FIELDS.filter(field => !['amcStatus', 'status', ...MACHINE_DATE_FIELDS].includes(field))) {
        const value = optionalString(machine, field, machinePath, { nullable: !['id', 'name', 'serialNumber'].includes(field) });
        if (value !== undefined) projected[field] = value;
      }
      for (const field of MACHINE_DATE_FIELDS) {
        const value = optionalDate(machine, field, machinePath);
        if (value !== undefined) projected[field] = value;
      }
      const status = optionalEnum(machine, 'amcStatus', machinePath, ['none', 'active', 'expired'], { nullable: true });
      const machineStatus = optionalEnum(machine, 'status', machinePath, ['active', 'inactive', 'decommissioned'], { nullable: true });
      if (status !== undefined) projected.amcStatus = status;
      if (machineStatus !== undefined) projected.status = machineStatus;
      for (const required of ['id', 'name', 'serialNumber']) {
        if (typeof projected[required] !== 'string') throw readStateError(`${machinePath}.${required}`, 'required string');
      }
      return projected;
    });
  }
  return result;
}

function supportProfileView(rawProfile) {
  if (rawProfile === undefined || rawProfile === null) return rawProfile;
  return projectSupportProfile(rawProfile);
}

function fullAccess(actor) {
  if (!actor || typeof actor !== 'object') return false;
  if (actor.customClaims?.role === 'admin') return true;
  return actor.emailVerified === true && typeof actor.email === 'string'
    && /@qualitastech\.com$/i.test(actor.email.trim());
}

function externalProjectView(projectId, rawProject, actor) {
  const result = { projectId };
  for (const field of ROOT_FIELDS) {
    let value;
    if (['projectName', 'clientName', 'description', 'clientId', 'billingEntityId'].includes(field)) {
      value = optionalString(rawProject, field, 'project');
    } else if (field === 'deadline') {
      value = optionalDate(rawProject, field, 'project');
    } else if (field === 'status') {
      value = optionalEnum(rawProject, field, 'project', PROJECT_STATUSES);
    } else if (field === 'category') {
      value = optionalEnum(rawProject, field, 'project', ['internal', 'customer']);
    } else if (field === 'archivedAt') {
      value = optionalArchiveDate(rawProject, field, 'project');
    } else if (field === 'backfilledContactEmails') {
      value = optionalStringArray(rawProject, field, 'project');
    }
    if (value !== undefined) result[field] = value;
  }
  if (Object.hasOwn(rawProject, 'memberIds')) result.memberIds = optionalStringArray(rawProject, 'memberIds', 'project', { nullable: true });
  if (Object.hasOwn(rawProject, 'members')) {
    if (!Array.isArray(rawProject.members)) throw readStateError('project.members', 'expected array');
    result.members = rawProject.members.map((member, index) => {
      const path = `project.members[${index}]`;
      assertRecord(member, path);
      const projected = {};
      for (const field of ['userId', 'displayName', 'email']) {
        const value = optionalString(member, field, path);
        if (value !== undefined) projected[field] = value;
      }
      if (typeof projected.userId !== 'string' || typeof projected.displayName !== 'string' || typeof projected.email !== 'string') {
        throw readStateError(path, 'roster entry requires userId, displayName and email');
      }
      if (member.userId === actor?.uid && Object.hasOwn(member, 'categoryScope')) {
        projected.categoryScope = optionalStringArray(member, 'categoryScope', path);
      }
      return projected;
    });
  }
  if (Object.hasOwn(rawProject, 'supportProfile')) result.supportProfile = supportProfileView(rawProject.supportProfile);
  return result;
}

function projectReadView(projectId, rawProject, actor) {
  // Serializer only: actor must be the freshly verified UserRecord from
  // currentNativeActor. The caller must authorize project access independently.
  assertRecord(rawProject, 'project');
  if (typeof projectId !== 'string' || !projectId) throw readStateError('projectId', 'required string');
  const externalView = externalProjectView(projectId, rawProject, actor);
  if (!fullAccess(actor)) return externalView;
  const result = copyJson(rawProject, 'project');
  result.projectId = projectId;
  return result;
}

module.exports = { projectReadView, supportProfileView, isProjectReadStateError };
