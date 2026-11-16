// Deterministic, isolated adapter for HTTP tests and the local demonstration.
// Production uses Mongoose and MongoDB transactions exclusively.
const copy = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
function values(object, path) {
  const [key, ...rest] = path.split('.');
  if (Array.isArray(object)) return object.flatMap(row => values(row, path));
  const value = object?.[key];
  return rest.length ? values(value, rest.join('.')) : [value];
}
function matches(row, filter) {
  return Object.entries(filter).every(([key, test]) => {
    const actual = values(row, key);
    if (test && typeof test === 'object') {
      if ('$ne' in test) return actual.every(v => String(v) !== String(test.$ne));
      if ('$exists' in test) return actual.some(v => v !== undefined) === test.$exists;
    }
    return actual.some(v => String(v) === String(test));
  });
}
function memoryStore() {
  let tables = { Purchase: [], Asset: [], Expense: [], Operation: [], Order: [] }, queue = Promise.resolve(), number = 2705000;
  function model(name) {
    function query(run) {
      return { session() { return this; }, lean() { return this; }, sort() { return this; }, limit() { return this; },
        then(yes, no) { return Promise.resolve().then(() => copy(run())).then(yes, no); } };
    }
    function insert(data) {
      const row = copy(data);
      if (tables[name].some(r => r._id === row._id || (row.key && r.key === row.key))) throw Object.assign(new Error('duplicate'), { code: 11000 });
      tables[name].push(row); return row;
    }
    function update(filter, change) {
      const row = tables[name].find(r => matches(r, filter));
      if (!row) return null;
      Object.assign(row, copy(change.$set || {}));
      for (const [key, value] of Object.entries(change.$inc || {})) row[key] = (row[key] || 0) + value;
      for (const [key, value] of Object.entries(change.$push || {})) { row[key] ||= []; row[key].push(copy(value)); }
      return row;
    }
    return {
      init: async () => {}, find: (filter = {}) => query(() => tables[name].filter(r => matches(r, filter))),
      findById: id => query(() => tables[name].find(r => r._id === String(id)) || null),
      findOne: filter => query(() => tables[name].find(r => matches(r, filter)) || null),
      create: async data => copy(Array.isArray(data) ? data.map(insert) : insert(data)),
      insertMany: async data => copy(data.map(insert)),
      updateOne: async (filter, change) => ({ modifiedCount: update(filter, change) ? 1 : 0 }),
      findOneAndUpdate: (filter, change) => query(() => update(filter, change)),
      findByIdAndUpdate: (id, change) => query(() => update({ _id: id }, change)),
    };
  }
  const allModels = Object.fromEntries(Object.keys(tables).map(name => [name, model(name)]));
  return { models: allModels, Order: allModels.Order, tables: () => copy(tables), nextOrderNumber: async () => ++number,
    mongoose: { startSession: async () => ({
      async withTransaction(fn) {
        const previous = queue; let release; queue = new Promise(resolve => { release = resolve; });
        await previous; const before = copy(tables);
        try { return await fn(); } catch (error) { tables = before; throw error; } finally { release(); }
      }, async endSession() {},
    }) },
  };
}
module.exports = { memoryStore };
