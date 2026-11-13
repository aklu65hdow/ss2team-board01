// Документное хранилище поверх таблицы public.docs в Supabase.
// Повторяет интерфейс, на котором написана доска: doc(path).get/set/update/delete/onSnapshot,
// collection(path).doc/add/orderBy/onSnapshot. Живые обновления идут через Supabase Realtime,
// а после каждой своей записи коллекция перечитывается, чтобы экран обновлялся сразу.

const collOf = (p) => p.slice(0, p.lastIndexOf("/"));
const idOf = (p) => p.slice(p.lastIndexOf("/") + 1);
const newId = () => (crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + Math.random()).replace(/-/g, "").slice(0, 20);

function wrap(error) {
  const msg = (error && error.message) || "ошибка";
  const denied = /row-level security|permission|42501/i.test(msg + " " + (error && error.code));
  return { code: denied ? "invalid_argument" : "unavailable", message: msg };
}
function snapDoc(id, data) {
  return { id, exists: data != null, data: () => (data == null ? undefined : data), metadata: { fromCache: false, hasPendingWrites: false } };
}

export function createStore(sb) {
  const watchers = new Map(); // coll -> Set(reload fn)
  const reloadColl = (coll) => { const set = watchers.get(coll); if (set) set.forEach((fn) => fn()); };

  async function loadColl(coll) {
    const { data, error } = await sb.from("docs").select("doc_id,data").eq("coll", coll);
    if (error) throw wrap(error);
    return new Map(data.map((r) => [r.doc_id, r.data]));
  }

  function watchColl(coll, cb, err) {
    let map = new Map();
    let alive = true;
    const reload = () => loadColl(coll).then((m) => { if (alive) { map = m; cb(map); } }).catch((e) => err && err(e));
    if (!watchers.has(coll)) watchers.set(coll, new Set());
    watchers.get(coll).add(reload);
    const ch = sb
      .channel("docs:" + coll + ":" + newId())
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "docs", filter: "coll=eq." + coll }, (p) => { map.set(p.new.doc_id, p.new.data); cb(map); })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "docs", filter: "coll=eq." + coll }, (p) => { map.set(p.new.doc_id, p.new.data); cb(map); })
      .on("postgres_changes", { event: "DELETE", schema: "public", table: "docs" }, (p) => {
        const op = p.old && p.old.path;
        if (op && collOf(op) === coll && map.has(idOf(op))) { map.delete(idOf(op)); cb(map); }
      })
      .subscribe();
    reload();
    return () => { alive = false; watchers.get(coll).delete(reload); sb.removeChannel(ch); };
  }

  function docRef(path) {
    const coll = collOf(path), id = idOf(path);
    return {
      id, path,
      async get() {
        const { data, error } = await sb.from("docs").select("data").eq("path", path).maybeSingle();
        if (error) throw wrap(error);
        return snapDoc(id, data ? data.data : null);
      },
      async set(d) {
        const { error } = await sb.from("docs").upsert({ path, coll, doc_id: id, data: d, updated_at: new Date().toISOString() });
        if (error) throw wrap(error);
        reloadColl(coll);
      },
      async update(d) {
        const { error } = await sb.rpc("doc_merge", { p_path: path, p_patch: d });
        if (error) throw wrap(error);
        reloadColl(coll);
      },
      async delete() {
        const { error } = await sb.from("docs").delete().eq("path", path);
        if (error) throw wrap(error);
        reloadColl(coll);
      },
      onSnapshot(next, err) { return watchColl(coll, (m) => next(snapDoc(id, m.has(id) ? m.get(id) : null)), err); },
      collection(sub) { return collRef(path + "/" + sub); },
    };
  }

  function collRef(path, order) {
    const sorted = (m) => {
      const arr = [...m.entries()];
      if (order) {
        const k = order.dir === "desc" ? -1 : 1;
        arr.sort((a, b) => { const x = a[1][order.f], y = b[1][order.f]; if (x == null) return 1; if (y == null) return -1; return (x < y ? -1 : x > y ? 1 : 0) * k; });
      } else arr.sort((a, b) => (a[0] < b[0] ? -1 : 1));
      return arr;
    };
    const toSnap = (m) => {
      const docs = sorted(m).map(([id, d]) => snapDoc(id, d));
      return { docs, size: docs.length, empty: !docs.length, metadata: { fromCache: false, hasPendingWrites: false }, docChanges: () => [] };
    };
    const q = {
      path,
      doc(id) { return docRef(path + "/" + (id || newId())); },
      async add(d) { const r = q.doc(); await r.set(d); return r; },
      orderBy(f, dir = "asc") { return collRef(path, { f, dir }); },
      async get() { return toSnap(await loadColl(path)); },
      onSnapshot(next, err) { return watchColl(path, (m) => next(toSnap(m)), err); },
    };
    return q;
  }

  return { doc: docRef, collection: (p) => collRef(p) };
}

// Аватар-заглушка с инициалами для людей без фото.
const COLORS = ["#2f54e0", "#1f8a55", "#b26b00", "#c2362f", "#7a4cd9", "#0e7c86", "#a23d8a"];
export function initialsAvatar(name, id) {
  const ini = (name || "?").trim().split(/\s+/).slice(0, 2).map((w) => w[0] || "").join("").toUpperCase() || "?";
  let h = 0; for (const c of String(id || name)) h = (h * 31 + c.charCodeAt(0)) >>> 0;
  const bg = COLORS[h % COLORS.length];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64"><rect width="64" height="64" fill="${bg}"/><text x="32" y="41" font-family="Arial,sans-serif" font-size="26" font-weight="700" fill="#fff" text-anchor="middle">${ini.replace(/[<&>"]/g, "")}</text></svg>`;
  return "data:image/svg+xml;charset=utf-8," + encodeURIComponent(svg);
}
