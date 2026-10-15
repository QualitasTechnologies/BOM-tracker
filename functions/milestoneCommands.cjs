// Pure schedule (milestone) commands. No Firestore, Auth or network: the caller owns reads, access, budget and writes.
const crypto = require('node:crypto');

const FAULT = Symbol('milestoneFault');
const fault = (code, status = 400) => {
  const error = Object.assign(new Error(code), { code, status });
  Object.defineProperty(error, FAULT, { value: true, enumerable: false });
  return error;
};
const isMilestoneFault = error => error !== null && typeof error === 'object' && error[FAULT] === true;

const MAX_MILESTONES = 400;
const MAX_INPUT_BYTES = 256 * 1024;
const MAX_TEXT_BYTES = 128 * 1024;
const STATUSES = ['not-started', 'in-progress', 'completed', 'blocked'];
const ATTRIBUTIONS = ['internal-team', 'internal-process', 'external-client', 'external-vendor', 'external-other'];
// Mirrors DEFAULT_MILESTONE_TEMPLATE in src/utils/milestoneFirestore.ts.
const DEFAULT_TEMPLATE = [
  { name: 'Planning & Design', description: 'Requirements gathering, engineering design, BOM finalization', percentageOfTimeline: 25 },
  { name: 'Procurement', description: 'Vendor selection, PO creation, materials ordering', percentageOfTimeline: 50 },
  { name: 'Build & Test', description: 'Assembly, integration, quality testing', percentageOfTimeline: 80 },
  { name: 'Delivery', description: 'Final inspection, shipping, installation, handover', percentageOfTimeline: 100 },
];
const DAY_MS = 24 * 60 * 60 * 1000;

const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const validId = value => typeof value === 'string' && !!value.trim() && value.length <= 512 && !/[\/\x00-\x1f\x7f]/.test(value) && !['.', '..'].includes(value) && !/^__.*__$/.test(value);
const calendarDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const validName = value => typeof value === 'string' && value.trim().length >= 3 && value.trim().length <= 100;
const boundedText = value => typeof value === 'string' && Buffer.byteLength(value, 'utf8') <= MAX_TEXT_BYTES;
const invalid = () => fault('invalid_milestone_command');
const exact = (value, required, optional = []) => {
  if (!plain(value) || Object.keys(value).some(key => ![...required, ...optional].includes(key)) || required.some(key => !Object.hasOwn(value, key))) throw invalid();
};
const clone = value => structuredClone(value);
const hash = parts => crypto.createHash('sha256').update(JSON.stringify(parts)).digest('hex');
const roundDays = (from, to) => { const days = Math.round((new Date(to).getTime() - new Date(from).getTime()) / DAY_MS); return days === 0 ? 0 : days; };

function checkDelay(delay) {
  exact(delay, ['reason', 'attribution']);
  if (!boundedText(delay.reason) || delay.reason.trim().length < 20 || !ATTRIBUTIONS.includes(delay.attribution)) throw invalid();
}
function checkActor(actor) {
  if (!plain(actor) || typeof actor.uid !== 'string' || !actor.uid || typeof actor.email !== 'string' || actor.displayName !== undefined && typeof actor.displayName !== 'string') throw invalid();
}

function milestoneDelayRecord({ project, entityType, entityId, entityName, previousDate, newDate, reason, attribution, actor, now, operationId }) {
  if (!plain(project) || !validId(project.projectId) || !['project', 'milestone'].includes(entityType) || !validId(entityId) || typeof entityName !== 'string'
    || !validId(operationId) || !(now instanceof Date) || Number.isNaN(now.getTime())) throw invalid();
  checkActor(actor);
  checkDelay({ reason, attribution });
  if (!Number.isFinite(Date.parse(previousDate)) || !calendarDate(newDate) && !Number.isFinite(Date.parse(newDate))) throw invalid();
  const original = project.originalDeadline;
  const current = entityType === 'project' ? newDate : project.deadline;
  const cumulative = original && current && Number.isFinite(Date.parse(original)) && Number.isFinite(Date.parse(current)) ? roundDays(original, current) : 0;
  const id = `delay-${hash([project.projectId, operationId, 'delay', entityType, entityId])}`;
  return {
    id,
    data: {
      id, entityType, entityId, entityName, previousDate, newDate,
      delayDays: roundDays(previousDate, newDate),
      reason: reason.trim(), attribution, cumulativeProjectDelay: cumulative,
      loggedAt: now.toISOString(), loggedBy: actor.uid, loggedByName: actor.displayName || actor.email,
    },
  };
}

function validateCommand(command) {
  let bytes;
  try { bytes = Buffer.byteLength(JSON.stringify(command) ?? '', 'utf8'); } catch { throw invalid(); }
  if (bytes > MAX_INPUT_BYTES) throw fault('milestone_command_too_large');
  if (!plain(command)) throw invalid();
  const id = () => { if (!validId(command.milestone_id)) throw invalid(); };
  switch (command.kind) {
    case 'add': {
      exact(command, ['kind', 'milestone_id', 'input']); id();
      const input = command.input;
      exact(input, ['name', 'currentPlannedEndDate'], ['description', 'status']);
      if (!validName(input.name) || !calendarDate(input.currentPlannedEndDate)) throw invalid();
      if (input.description !== undefined && !boundedText(input.description)) throw invalid();
      if (input.status !== undefined && !STATUSES.includes(input.status)) throw invalid();
      break;
    }
    case 'edit': {
      exact(command, ['kind', 'milestone_id', 'patch'], ['delay']); id();
      const patch = command.patch;
      if (!plain(patch) || !Object.keys(patch).length) throw invalid();
      exact(patch, [], ['name', 'description', 'currentPlannedEndDate', 'status']);
      if (patch.name !== undefined && !validName(patch.name)) throw invalid();
      if (patch.description !== undefined && patch.description !== null && !boundedText(patch.description)) throw invalid();
      if (patch.currentPlannedEndDate !== undefined && !calendarDate(patch.currentPlannedEndDate)) throw invalid();
      if (patch.status !== undefined && !STATUSES.includes(patch.status)) throw invalid();
      if (command.delay !== undefined) checkDelay(command.delay);
      break;
    }
    case 'status':
      exact(command, ['kind', 'milestone_id', 'status'], ['progress_note']); id();
      if (!STATUSES.includes(command.status) || command.progress_note !== undefined && !boundedText(command.progress_note)) throw invalid();
      break;
    case 'date':
      exact(command, ['kind', 'milestone_id', 'new_date'], ['delay']); id();
      if (!calendarDate(command.new_date)) throw invalid();
      if (command.delay !== undefined) checkDelay(command.delay);
      break;
    case 'delete': exact(command, ['kind', 'milestone_id']); id(); break;
    case 'reorder':
      exact(command, ['kind', 'milestone_ids']);
      if (!Array.isArray(command.milestone_ids) || !command.milestone_ids.length || command.milestone_ids.some(value => !validId(value)) || new Set(command.milestone_ids).size !== command.milestone_ids.length) throw invalid();
      break;
    case 'template':
      exact(command,['kind'],['time_zone']);
      if(command.time_zone!==undefined){if(typeof command.time_zone!=='string'||command.time_zone.length>100)throw invalid();try{new Intl.DateTimeFormat('en-GB',{timeZone:command.time_zone});}catch{throw invalid();}}
      break;
    case 'baseline_lock': exact(command, ['kind']); break;
    default: throw invalid();
  }
}

// Equivalent to the original browser Date.setDate calendar addition, including
// DST folds/gaps, without changing the server process's timezone for other users.
function browserCalendarDate(now,days,timeZone){
  const formatter=new Intl.DateTimeFormat('en-GB',{timeZone,year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',minute:'2-digit',second:'2-digit',hourCycle:'h23'});
  const wall=ms=>{
    const parts=Object.fromEntries(formatter.formatToParts(new Date(ms)).filter(row=>row.type!=='literal').map(row=>[row.type,Number(row.value)]));
    return Date.UTC(parts.year,parts.month-1,parts.day,parts.hour,parts.minute,parts.second,((ms%1000)+1000)%1000);
  };
  const desired=wall(now.getTime())+days*DAY_MS;
  const offsets=new Set([-2,-1,0,1,2].map(delta=>{const instant=desired+delta*DAY_MS;return wall(instant)-instant;}));
  const candidates=[...offsets].map(offset=>desired-offset),exact=candidates.filter(instant=>wall(instant)===desired);
  // Date chooses the earlier instant in a repeated hour; in a gap it advances by the gap.
  const chosen=exact.length?Math.min(...exact):candidates.filter(instant=>wall(instant)>=desired).sort((a,b)=>wall(a)-wall(b)||a-b)[0];
  if(!Number.isFinite(chosen))throw invalid();
  return new Date(chosen).toISOString().slice(0,10);
}

function validateContext({ project, milestones, actor, now, operationId }) {
  if (!plain(project) || !validId(project.projectId)) throw fault('invalid_milestone_state', 409);
  checkActor(actor);
  if (!(now instanceof Date) || Number.isNaN(now.getTime()) || !validId(operationId)) throw invalid();
  if (!Array.isArray(milestones)) throw fault('invalid_milestone_state', 409);
  if (milestones.length > MAX_MILESTONES) throw fault('milestone_schedule_too_large', 413);
  const seen = new Set();
  for (const row of milestones) {
    if (!plain(row) || !validId(row.id) || !plain(row.data) || seen.has(row.id)) throw fault('invalid_milestone_state', 409);
    seen.add(row.id);
  }
}

function dateChange({ project, milestone, newDate, delay, actor, now, operationId }) {
  const previous = milestone.data.currentPlannedEndDate;
  if (!project.isBaselined || newDate === previous) return [];
  if (!delay) throw fault('delay_required');
  if (typeof previous !== 'string' || !Number.isFinite(Date.parse(previous))) throw fault('invalid_milestone_state', 409);
  return [milestoneDelayRecord({
    project, entityType: 'milestone', entityId: milestone.id, entityName: milestone.data.name,
    previousDate: previous, newDate, reason: delay.reason, attribution: delay.attribution, actor, now, operationId,
  })];
}

function applyMilestoneCommand(input) {
  if (!plain(input)) throw invalid();
  validateCommand(input.command);
  const project = clone(input.project), milestones = clone(input.milestones), command = clone(input.command);
  const { actor, now, operationId } = input;
  validateContext({ project, milestones, actor, now, operationId });
  const nowISO = now.toISOString();
  const out = { projectPatch: {}, upserts: [], deletes: [], delayLogs: [], archives: [], result: { kind: command.kind } };
  const find = () => {
    const row = milestones.find(item => item.id === command.milestone_id);
    if (!row) throw fault('milestone_not_found', 404);
    return row;
  };

  switch (command.kind) {
    case 'add': {
      if(milestones.length>=MAX_MILESTONES)throw fault('milestone_schedule_too_large',413);
      if (milestones.some(item => item.id === command.milestone_id)) throw fault('milestone_exists', 409);
      const orders = milestones.map(item => item.data.order).filter(value => typeof value === 'number' && Number.isFinite(value));
      const data = {
        name: command.input.name.trim(), currentPlannedEndDate: command.input.currentPlannedEndDate,
        status: command.input.status || 'not-started', order: (orders.length ? Math.max(...orders) : 0) + 1,
        createdAt: nowISO, createdBy: actor.uid, updatedAt: nowISO,
      };
      if (command.input.description?.trim()) data.description = command.input.description.trim();
      if (project.isBaselined) data.originalPlannedEndDate = command.input.currentPlannedEndDate;
      out.upserts.push({ id: command.milestone_id, data });
      out.result.milestone_id = command.milestone_id;
      break;
    }
    case 'edit': {
      const row = find(), patch = command.patch, data = { ...row.data };
      if (patch.name !== undefined) data.name = patch.name.trim();
      if (patch.description !== undefined) data.description = patch.description?.trim() || null;
      if (patch.status !== undefined) data.status = patch.status;
      if (patch.currentPlannedEndDate !== undefined) {
        out.delayLogs.push(...dateChange({ project, milestone: row, newDate: patch.currentPlannedEndDate, delay: command.delay, actor, now, operationId }));
        data.currentPlannedEndDate = patch.currentPlannedEndDate;
      }
      data.updatedAt = nowISO;
      out.upserts.push({ id: row.id, data });
      out.result.milestone_id = row.id;
      break;
    }
    case 'date': {
      const row = find();
      out.delayLogs.push(...dateChange({ project, milestone: row, newDate: command.new_date, delay: command.delay, actor, now, operationId }));
      out.upserts.push({ id: row.id, data: { ...row.data, currentPlannedEndDate: command.new_date, updatedAt: nowISO } });
      out.result.milestone_id = row.id;
      break;
    }
    case 'status': {
      const row = find(), data = { ...row.data, status: command.status, updatedAt: nowISO };
      if (command.status === 'completed') data.actualEndDate = nowISO.slice(0, 10);
      if (command.progress_note !== undefined) { data.lastProgressNote = command.progress_note.trim() || null; data.lastProgressDate = nowISO; }
      out.upserts.push({ id: row.id, data });
      out.result.milestone_id = row.id;
      break;
    }
    case 'delete': {
      const row = find();
      out.deletes.push(row.id);
      out.archives.push({ id: row.id, data: { record: row.data, id: row.id, deletedBy: actor.uid, deletedAt: nowISO } });
      out.result.milestone_id = row.id;
      break;
    }
    case 'reorder': {
      const byId = new Map(milestones.map(item => [item.id, item]));
      if (command.milestone_ids.length !== milestones.length || command.milestone_ids.some(id => !byId.has(id))) throw fault('invalid_milestone_order', 409);
      command.milestone_ids.forEach((id, index) => out.upserts.push({ id, data: { ...byId.get(id).data, order: index + 1, updatedAt: nowISO } }));
      break;
    }
    case 'baseline_lock': {
      if (project.isBaselined) throw fault('already_baselined', 409);
      if (!milestones.length) throw fault('no_milestones', 409);
      if (typeof project.deadline !== 'string' || !project.deadline) throw fault('invalid_milestone_state', 409);
      if (milestones.some(item => typeof item.data.name !== 'string' || !validName(item.data.name) || !calendarDate(item.data.currentPlannedEndDate))) throw fault('invalid_baseline_milestones', 409);
      out.projectPatch = { originalDeadline: project.deadline, isBaselined: true, baselinedAt: nowISO, baselinedBy: actor.uid };
      for (const item of milestones) out.upserts.push({ id: item.id, data: { ...item.data, originalPlannedEndDate: item.data.currentPlannedEndDate, updatedAt: nowISO } });
      break;
    }
    case 'template': {
      if (milestones.length) throw fault('schedule_not_empty', 409);
      const end = new Date(project.deadline);
      if (typeof project.deadline !== 'string' || Number.isNaN(end.getTime())) throw fault('invalid_milestone_state', 409);
      if (end <= now) throw fault('deadline_not_future', 409);
      const spanDays = Math.ceil((end.getTime() - now.getTime()) / DAY_MS);
      DEFAULT_TEMPLATE.forEach((item, index) => {
        const date = browserCalendarDate(now,Math.round((spanDays * item.percentageOfTimeline) / 100),command.time_zone||'UTC');
        out.upserts.push({
          id: `mile-${hash([project.projectId, operationId, index])}`,
          data: { name: item.name, description: item.description, currentPlannedEndDate: date,...(project.isBaselined?{originalPlannedEndDate:date}:{}),status: 'not-started', order: index + 1, createdAt: nowISO, createdBy: actor.uid, updatedAt: nowISO },
        });
      });
      break;
    }
  }
  return out;
}

module.exports = { applyMilestoneCommand, milestoneDelayRecord, isMilestoneFault,validateMilestoneCommand:validateCommand };
