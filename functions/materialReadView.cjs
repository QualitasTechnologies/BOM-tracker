const fault = () => Object.assign(new Error('materials_data_integrity'), { code: 'materials_data_integrity', status: 409 });
const plain = value => value !== null && typeof value === 'object' && !Array.isArray(value)
  && [Object.prototype, null].includes(Object.getPrototypeOf(value));

function timestampDate(value) {
  const prototype = Object.getPrototypeOf(value);
  const constructor = prototype && Object.getOwnPropertyDescriptor(prototype, 'constructor')?.value;
  if (constructor?.name !== 'Timestamp' || typeof value.toDate !== 'function') return null;
  let date;
  try { date = value.toDate(); } catch { throw fault(); }
  if (!(date instanceof Date) || !Number.isFinite(date.getTime())) throw fault();
  return date.toISOString();
}

function safeJson(value, seen = new Set()) {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number') { if (Number.isFinite(value)) return value; throw fault(); }
  if (typeof value !== 'object') throw fault();
  if (value instanceof Date) {
    if (!Number.isFinite(value.getTime())) throw fault();
    return value.toISOString();
  }
  const timestamp = timestampDate(value);
  if (timestamp !== null) return timestamp;
  if (!Array.isArray(value) && !plain(value)) throw fault();
  if (seen.has(value)) throw fault();
  seen.add(value);
  try {
    if (Array.isArray(value)) {
      const keys = Reflect.ownKeys(value);
      if (keys.some(key => typeof key === 'symbol' || key !== 'length' && !/^(0|[1-9]\d*)$/.test(key) || key !== 'length' && Number(key) >= value.length)) throw fault();
      const result = [];
      for (let index = 0; index < value.length; index += 1) {
        const descriptor = Object.getOwnPropertyDescriptor(value, String(index));
        if (!descriptor || !Object.hasOwn(descriptor, 'value')) throw fault();
        result.push(safeJson(descriptor.value, seen));
      }
      return result;
    }
    const result = {};
    for (const key of Reflect.ownKeys(value)) {
      if (typeof key === 'symbol') throw fault();
      const descriptor = Object.getOwnPropertyDescriptor(value, key);
      if (!descriptor || !descriptor.enumerable || !Object.hasOwn(descriptor, 'value')) throw fault();
      Object.defineProperty(result, key, { value: safeJson(descriptor.value, seen), enumerable: true, writable: true, configurable: true });
    }
    return result;
  } finally { seen.delete(value); }
}

function materialReadView(categories) {
  if (!Array.isArray(categories)) throw fault();
  return categories.map(category => {
    if (!plain(category) || typeof category.name !== 'string' || !category.name.trim() || !Array.isArray(category.items)) throw fault();
    const safe = safeJson(category);
    for (const item of category.items) if (!plain(item) || typeof item.id !== 'string' || !item.id.trim()) throw fault();
    return safe;
  });
}

module.exports = { materialReadView, materialValueView: safeJson };
