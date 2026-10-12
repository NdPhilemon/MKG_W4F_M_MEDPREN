// Shared by the browser and the server. No session data belongs here.
(() => {
  const lists = ['shops', 'users', 'products', 'ads', 'sales', 'orders', 'notifications'];
  const fields = ['rate', 'mainCurrency', 'hideMoney', 'shopSettings', 'adminProfile'];
  const copy = value => value === undefined ? undefined : JSON.parse(JSON.stringify(value));
  const equal = (a, b) => JSON.stringify(a) === JSON.stringify(b);
  function diff(base, next) {
    const changes = [];
    for (const key of fields) if (!equal(base[key], next[key])) changes.push({key, before: base[key] ?? null, after: next[key] ?? null});
    for (const key of lists) {
      const old = new Map((base[key] || []).map(x => [x.id, x]));
      const fresh = new Map((next[key] || []).map(x => [x.id, x]));
      for (const id of new Set([...old.keys(), ...fresh.keys()])) {
        if (!equal(old.get(id), fresh.get(id))) changes.push({key, id, before: old.get(id) || null, after: fresh.get(id) || null});
      }
    }
    return copy(changes);
  }
  function merge(current, changes, strict = true) {
    const out = copy(current);
    const conflict = key => { throw Object.assign(new Error(`Conflit sur ${key} : modification locale conservée.`), {status:409, code:'SYNC_CONFLICT'}); };
    for (const change of changes) {
      const {key, id, before, after} = change;
      if (!lists.includes(key) && !fields.includes(key)) throw Object.assign(new Error('Champ interdit'), {status:400});
      if (!lists.includes(key)) {
        if (strict && !equal(out[key] ?? null, before) && !equal(out[key] ?? null, after)) conflict(key);
        out[key] = copy(after); continue;
      }
      const rows = out[key] ||= [], index = rows.findIndex(x => x.id === id), actual = rows[index] || null;
      if (!after) {
        if (strict && actual && !equal(actual, before)) conflict(`${key}/${id}`);
        if (index >= 0) rows.splice(index, 1);
        continue;
      }
      let value = copy(after);
      if (actual && before) {
        value = {...actual};
        for (const field of new Set([...Object.keys(before), ...Object.keys(after)])) {
          if (['__proto__', 'constructor', 'prototype'].includes(field)) throw Object.assign(new Error('Champ interdit'), {status:400});
          if (equal(before[field], after[field])) continue;
          if (field === 'messages') {
            value.messages = [...new Map([...(actual.messages || []), ...(after.messages || [])].map(m => [m.id, m])).values()];
          } else if (key === 'products' && field === 'stock') {
            value.stock = Number(actual.stock) + Number(after.stock) - Number(before.stock);
            if (strict && (!Number.isFinite(value.stock) || value.stock < 0)) conflict(`${key}/${id}/stock`);
          } else {
            if (strict && field !== 'updatedAt' && !equal(actual[field], before[field]) && !equal(actual[field], after[field])) conflict(`${key}/${id}/${field}`);
            if (after[field] === undefined) delete value[field]; else value[field] = copy(after[field]);
          }
        }
      } else if (strict && !equal(actual, before) && !equal(actual, after)) conflict(`${key}/${id}`);
      if (index < 0) rows.push(value); else rows[index] = value;
    }
    return out;
  }
  globalThis.MkgSync = {diff, merge, lists, fields};
})();
