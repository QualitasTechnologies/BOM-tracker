const isDateOnly = value => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)
  && Number.isFinite(Date.parse(`${value}T00:00:00.000Z`))
  && new Date(`${value}T00:00:00.000Z`).toISOString().slice(0, 10) === value;

/**
 * Date-only values are calendar days. Preserve the encoded day in ISO strings,
 * even when their timezone offset crosses UTC midnight. Date and Timestamp
 * inputs follow the Pulse client convention and are interpreted as UTC days.
 */
const calendarDate = value => {
  if (isDateOnly(value)) return value;
  try {
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value)) {
      if (!Number.isFinite(Date.parse(value))) return null;
      const encodedDate = value.slice(0, 10);
      return isDateOnly(encodedDate) ? encodedDate : null;
    }
    const date = value instanceof Date ? value : value && typeof value.toDate === 'function' ? value.toDate()
      : typeof value === 'string' ? new Date(value) : null;
    return date && Number.isFinite(date.getTime()) ? date.toISOString().slice(0, 10) : null;
  } catch { return null; }
};

module.exports = { calendarDate, isDateOnly };
