// Pure overhead/travel-cost commands. No Firestore, Auth or network: the caller owns access, reviewer policy, versions, audit, archive and writes.
// Existing documents hold real Firestore types (Timestamp...), so they are only ever shallow-copied or selectively replaced, never cloned.

const FAULT = Symbol('overheadFault');
const fault = (code, status = 400) => {
  const error = Object.assign(new Error(code), { code, status });
  Object.defineProperty(error, FAULT, { value: true, enumerable: false });
  return error;
};
const isOverheadFault = error => error !== null && typeof error === 'object' && error[FAULT] === true;

const MAX_INPUT_BYTES = 256 * 1024;
const MAX_TEXT_BYTES = 128 * 1024;
const MAX_URL_LENGTH = 2048;
// Mirrors src/types/overhead.ts.
const OTHER_CATEGORIES = ['Testing & Certification', 'Freight & Logistics', 'Admin & Documentation', 'Training', 'Other'];
const EXPENSE_CATEGORIES = ['Transport', 'Accommodation', 'Food & Per Diem', 'Client Entertainment', 'Communication', 'Miscellaneous'];
const MEAL_TYPES = ['Breakfast', 'Lunch', 'Dinner', 'Snacks', 'Other'];
const KNOWN_EXPENSE_FIELDS = ['category', 'date', 'description', 'amount', 'receiptUrl', 'receiptName', 'rooms', 'nights', 'peoplePerRoom', 'ratePerRoomPerNight', 'mealType', 'people'];
const KNOWN_VISIT_OPTIONAL = ['location', 'purpose', 'notes'];

const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value) && [Object.prototype, null].includes(Object.getPrototypeOf(value));
const validId = value => typeof value === 'string' && !!value.trim() && value.length <= 512 && !/[\/\x00-\x1f\x7f]/.test(value) && !['.', '..'].includes(value) && !/^__.*__$/.test(value);
const calendarDate = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) && new Date(value).toISOString().slice(0, 10) === value;
const boundedText = value => typeof value === 'string' && Buffer.byteLength(value, 'utf8') <= MAX_TEXT_BYTES;
const positive = value => typeof value === 'number' && Number.isFinite(value) && value > 0;
const invalid = () => fault('invalid_overhead_command');
const invalidState = () => fault('invalid_overhead_state', 409);
const present = (value, key) => Object.hasOwn(value, key) && value[key] !== undefined;
const exact = (value, required, optional = []) => {
  if (!plain(value)) throw invalid();
  const allowed = [...required, ...optional];
  if (Object.keys(value).some(key => value[key] !== undefined && !allowed.includes(key)) || required.some(key => !present(value, key))) throw invalid();
};

function checkEntryInput(input) {
  exact(input, ['date', 'category', 'description', 'amount'], ['notes']);
  if (!calendarDate(input.date) || !OTHER_CATEGORIES.includes(input.category) || !boundedText(input.description) || !input.description.trim() || !positive(input.amount)) throw invalid();
  if (present(input, 'notes') && !boundedText(input.notes)) throw invalid();
}

const COMMON_EXPENSE = ['id', 'category'];
const COMMON_EXPENSE_OPTIONAL = ['date', 'receiptUrl', 'receiptName'];
function checkExpense(row) {
  if (!plain(row) || !EXPENSE_CATEGORIES.includes(row.category)) throw invalid();
  const accommodation = row.category === 'Accommodation';
  const food = row.category === 'Food & Per Diem';
  if (accommodation) exact(row, [...COMMON_EXPENSE, 'rooms', 'nights', 'ratePerRoomPerNight'], [...COMMON_EXPENSE_OPTIONAL, 'peoplePerRoom', 'amount']);
  else if (food) exact(row, [...COMMON_EXPENSE, 'amount'], [...COMMON_EXPENSE_OPTIONAL, 'description', 'mealType', 'people']);
  else exact(row, [...COMMON_EXPENSE, 'amount'], [...COMMON_EXPENSE_OPTIONAL, 'description']);
  if (!validId(row.id)) throw invalid();
  if (present(row, 'date') && !calendarDate(row.date)) throw invalid();
  if (present(row, 'description') && (!boundedText(row.description) || !row.description.trim())) throw invalid();
  if (present(row, 'receiptName') && (!present(row, 'receiptUrl') || typeof row.receiptName !== 'string' || !row.receiptName.trim() || row.receiptName.length > 512)) throw invalid();
  if (present(row, 'receiptUrl') && (typeof row.receiptUrl !== 'string' || !row.receiptUrl || row.receiptUrl.length > MAX_URL_LENGTH)) throw invalid();
  if (accommodation) {
    if (!positive(row.rooms) || !positive(row.nights) || !positive(row.ratePerRoomPerNight) || present(row, 'peoplePerRoom') && !positive(row.peoplePerRoom)) throw invalid();
    if (!positive(row.rooms * row.nights * row.ratePerRoomPerNight)) throw invalid();
  } else {
    if (!positive(row.amount)) throw invalid();
    if (food && (present(row, 'mealType') && !MEAL_TYPES.includes(row.mealType) || present(row, 'people') && !positive(row.people))) throw invalid();
  }
}

function checkVisitInput(input) {
  exact(input, ['startDate', 'endDate', 'attendees', 'expenses'], ['location', 'purpose', 'notes']);
  if (!calendarDate(input.startDate) || !calendarDate(input.endDate) || input.endDate < input.startDate) throw invalid();
  const { attendees, expenses } = input;
  if (!Array.isArray(attendees) || !attendees.length || attendees.some(id => !validId(id)) || new Set(attendees).size !== attendees.length) throw invalid();
  if (!Array.isArray(expenses) || !expenses.length) throw invalid();
  expenses.forEach(checkExpense);
  if (new Set(expenses.map(row => row.id)).size !== expenses.length) throw invalid();
  for (const key of KNOWN_VISIT_OPTIONAL) if (present(input, key) && !boundedText(input[key])) throw invalid();
}

function validateOverheadCommand(command) {
  let bytes;
  try { bytes = Buffer.byteLength(JSON.stringify(command) ?? '', 'utf8'); } catch { throw invalid(); }
  if (bytes > MAX_INPUT_BYTES) throw fault('overhead_command_too_large', 413);
  if (!plain(command)) throw invalid();
  const id = () => { if (!validId(command.record_id)) throw invalid(); };
  switch (command.kind) {
    case 'add_entry': case 'edit_entry': exact(command, ['kind', 'record_id', 'input']); id(); checkEntryInput(command.input); break;
    case 'add_visit': case 'edit_visit': exact(command, ['kind', 'record_id', 'input']); id(); checkVisitInput(command.input); break;
    case 'delete_entry': case 'delete_visit': case 'submit_visit': exact(command, ['kind', 'record_id']); id(); break;
    case 'review_visit':
      exact(command, ['kind', 'record_id', 'status']); id();
      if (!['approved', 'rejected'].includes(command.status)) throw invalid();
      break;
    default: throw invalid();
  }
}

function checkActor(actor) {
  if (!plain(actor) || typeof actor.uid !== 'string' || !actor.uid || typeof actor.email !== 'string' || actor.displayName !== undefined && typeof actor.displayName !== 'string') throw invalid();
}

// Rows are validated for identity only; every other field (including real Firestore types) is left untouched.
function readArray(overheads, key) {
  const rows = overheads[key];
  if (rows === undefined) return [];
  if (!Array.isArray(rows)) throw invalidState();
  const seen = new Set();
  for (const row of rows) {
    if (!plain(row) || !validId(row.id) || seen.has(row.id)) throw invalidState();
    seen.add(row.id);
  }
  return rows;
}

// A receipt URL is accepted only as bounded HTTPS without credentials, or unchanged from the stored legacy value. The server never fetches it.
function checkReceiptUrl(url, previous) {
  if (previous !== undefined && url === previous) return;
  let parsed;
  try { parsed = new URL(url); } catch { throw invalid(); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password) throw invalid();
}

function normalizeExpense(row, previousRow) {
  const merged = plain(previousRow) ? { ...previousRow } : {};
  for (const key of KNOWN_EXPENSE_FIELDS) delete merged[key];
  merged.id = row.id;
  merged.category = row.category;
  if (present(row, 'date')) merged.date = row.date;
  if (present(row, 'receiptUrl')) {
    checkReceiptUrl(row.receiptUrl, plain(previousRow) ? previousRow.receiptUrl : undefined);
    merged.receiptUrl = row.receiptUrl;
    if (present(row, 'receiptName')) merged.receiptName = row.receiptName;
  }
  if (row.category === 'Accommodation') {
    merged.rooms = row.rooms;
    merged.nights = row.nights;
    merged.peoplePerRoom = present(row, 'peoplePerRoom') ? row.peoplePerRoom : 1;
    merged.ratePerRoomPerNight = row.ratePerRoomPerNight;
    merged.amount = row.rooms * row.nights * row.ratePerRoomPerNight;
  } else {
    merged.amount = row.amount;
    if (present(row, 'description')) merged.description = row.description.trim();
    if (row.category === 'Food & Per Diem') {
      if (present(row, 'mealType')) merged.mealType = row.mealType;
      if (present(row, 'people')) merged.people = row.people;
    }
  }
  return merged;
}

function buildVisit(input, old, { id, actor, now }) {
  const previousExpenses = new Map((old && Array.isArray(old.expenses) ? old.expenses : []).filter(plain).map(row => [row.id, row]));
  const expenses = input.expenses.map(row => normalizeExpense(row, previousExpenses.get(row.id)));
  const totalCost = expenses.reduce((sum, row) => sum + row.amount, 0);
  if (!Number.isFinite(totalCost)) throw invalid();
  const visit = old
    ? { ...old }
    : { id, reimbursementStatus: 'draft', createdAt: now.toISOString(), createdBy: actor.uid };
  for (const key of KNOWN_VISIT_OPTIONAL) delete visit[key];
  visit.startDate = input.startDate;
  visit.endDate = input.endDate;
  visit.attendees = [...input.attendees];
  visit.expenses = expenses;
  visit.totalCost = totalCost;
  for (const key of KNOWN_VISIT_OPTIONAL) if (present(input, key) && input[key].trim()) visit[key] = input[key].trim();
  if (old && old.reimbursementStatus === 'approved') visit.reimbursementStatus = 'pending';
  return visit;
}

function buildEntry(input, old, { id, actor, now }) {
  const entry = old ? { ...old } : { id, createdAt: now.toISOString(), createdBy: actor.uid };
  delete entry.notes;
  entry.date = input.date;
  entry.category = input.category;
  entry.description = input.description.trim();
  entry.amount = input.amount;
  if (present(input, 'notes') && input.notes.trim()) entry.notes = input.notes.trim();
  return entry;
}

function applyOverheadCommand({ project, overheads, command, actor, now }) {
  validateOverheadCommand(command);
  if (!plain(project) || !validId(project.projectId)) throw invalid();
  checkActor(actor);
  if (!(now instanceof Date) || Number.isNaN(now.getTime())) throw invalid();
  if (overheads !== undefined && overheads !== null && !plain(overheads)) throw invalidState();
  const doc = overheads ?? {};
  const travelVisits = readArray(doc, 'travelVisits');
  const otherEntries = readArray(doc, 'otherEntries');

  const isEntry = command.kind.endsWith('_entry');
  const key = isEntry ? 'otherEntries' : 'travelVisits';
  const rows = isEntry ? otherEntries : travelVisits;
  const id = command.record_id;
  const index = rows.findIndex(row => row.id === id);
  const old = index >= 0 ? rows[index] : undefined;
  const ctx = { id, actor, now };
  const result = { kind: command.kind, record_id: id };
  const output = nextRows => ({ ...doc, travelVisits, otherEntries, [key]: nextRows });
  const replace = row => rows.map((existing, position) => position === index ? row : existing);

  if (command.kind.startsWith('add_')) {
    if (old) throw fault('overhead_record_exists', 409);
    const row = isEntry ? buildEntry(command.input, undefined, ctx) : buildVisit(command.input, undefined, ctx);
    return { overheads: output([...rows, row]), result };
  }
  if (!old) throw fault('overhead_record_not_found', 404);

  switch (command.kind) {
    case 'edit_entry': return { overheads: output(replace(buildEntry(command.input, old, ctx))), result };
    case 'edit_visit': {
      const visit = buildVisit(command.input, old, ctx);
      const out = { overheads: output(replace(visit)), result };
      if (old.reimbursementStatus === 'approved') out.notification = { mode: 'submitted', visit };
      return out;
    }
    case 'delete_entry': case 'delete_visit':
      return { overheads: output(rows.filter((_, position) => position !== index)), removed: { type: isEntry ? 'entry' : 'visit', id, record: old }, result };
    case 'submit_visit': {
      if (old.reimbursementStatus !== 'draft') throw fault('invalid_visit_status', 409);
      const visit = { ...old, reimbursementStatus: 'pending' };
      return { overheads: output(replace(visit)), notification: { mode: 'submitted', visit }, result };
    }
    case 'review_visit': {
      // A legacy visit without a status is displayed as pending, so it is reviewable as pending.
      if (old.reimbursementStatus !== undefined && old.reimbursementStatus !== 'pending') throw fault('invalid_visit_status', 409);
      const visit = { ...old, reimbursementStatus: command.status };
      return { overheads: output(replace(visit)), notification: { mode: command.status, visit }, result };
    }
    default: throw invalid();
  }
}

module.exports = { applyOverheadCommand, validateOverheadCommand, isOverheadFault };
