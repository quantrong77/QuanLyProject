'use strict';
/* Web App hiện trường – Thay thế MBA AT1 TBA 500kV Di Linh */

const CFG = window.APP_CONFIG || {};
const DEMO = !CFG.API_URL;
const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const ROLES = { admin: 'Quản trị', manager: 'Giám sát / BQLDA', contractor: 'Đơn vị thi công', viewer: 'Chỉ xem' };
const USER_STATUS = { pending: 'Chờ duyệt', active: 'Hoạt động', disabled: 'Đã khóa' };
const TASK_STATUS = ['Chưa bắt đầu', 'Đang thi công', 'Tạm dừng', 'Hoàn thành'];
const CLS = {
  done: { label: 'Hoàn thành', v: '--ok' },
  doing: { label: 'Đang thi công', v: '--doing' },
  late: { label: 'Chậm tiến độ', v: '--late' },
  paused: { label: 'Tạm dừng', v: '--paused' },
  todo: { label: 'Chưa đến hạn', v: '--todo' },
  unplanned: { label: 'Chưa có kế hoạch', v: '--unplanned' },
};

const S = {
  token: null, profile: null, user: null, config: {}, units: [], projects: [], packages: [], projectId: null, tasks: [], updates: [], users: [],
  view: 'dashboard', adminTab: 'projects', logDate: null, ganttPx: 34, ganttHideUnplanned: true,
  filters: { q: '', pkg: '', unit: '', phase: '', section: '', cls: '' }, charts: {}, photos: {},
};

/* ============================ DATES ============================ */
const DAY = 864e5;
const pad = (n) => String(n).padStart(2, '0');
const dstr = (d) => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
const dtstr = (d) => `${dstr(d)}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
const today = () => dstr(new Date());
function parseD(s) {
  const m = String(s || '').match(/^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2}))?/);
  return m ? new Date(+m[1], m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0)) : null;
}
function fmtD(s, time = true) {
  const d = parseD(s);
  if (!d) return '—';
  let r = `${pad(d.getDate())}/${pad(d.getMonth() + 1)}`;
  if (time && (d.getHours() || d.getMinutes())) r += ` ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  return r;
}
function fmtTs(s) {
  const d = parseD(s);
  return d ? `${pad(d.getHours())}:${pad(d.getMinutes())} · ${pad(d.getDate())}/${pad(d.getMonth() + 1)}` : '';
}
const dayStart = (d) => new Date(d.getFullYear(), d.getMonth(), d.getDate());

/* ============================ DOMAIN ============================ */
function planEnd(t) {
  const s = parseD(t.plan_start), e = parseD(t.plan_end);
  if (!s) return null;
  return !e || e <= s ? new Date(s.getTime() + DAY) : e;
}
function klass(t, now = new Date()) {
  const p = +t.progress || 0;
  if (p >= 100) return 'done';
  if (t.status === 'Tạm dừng') return 'paused';
  const s = parseD(t.plan_start), e = planEnd(t);
  if (e && now > e) return 'late';
  if (p > 0 || t.actual_start || t.status === 'Đang thi công') return 'doing';
  if (!s) return 'unplanned';
  return now >= s ? 'late' : 'todo';
}
const weight = (t) => (+t.plan_days > 0 ? +t.plan_days : 1);
function planFrac(t, d) {
  const s = parseD(t.plan_start), e = planEnd(t);
  if (!s) return null;
  if (d <= s) return 0;
  if (d >= e) return 1;
  return (d - s) / (e - s);
}
function weightedPct(tasks, fn) {
  let w = 0, v = 0;
  tasks.forEach((t) => { const x = fn(t); if (x == null) return; w += weight(t); v += weight(t) * x; });
  return w ? (v / w) * 100 : 0;
}
function canEdit(t) {
  const u = S.user;
  if (!u) return false;
  if (u.role === 'admin' || u.role === 'manager') return true;
  return u.role === 'contractor' && !!t.unit && t.unit === u.unit;
}
const isManager = () => S.user && (S.user.role === 'admin' || S.user.role === 'manager');
const taskById = (id) => S.tasks.find((t) => t.id === id);
const curProject = () => S.projects.find((p) => p.id === S.projectId) || null;
const projPackages = () => S.packages.filter((k) => k.project_id === S.projectId).sort((a, b) => (+a.order || 0) - (+b.order || 0));
const pkgById = (id) => S.packages.find((k) => k.id === id);
const pkgCode = (t) => { const k = pkgById(t?.package_id); return k ? k.code || k.name : ''; };
const inPkg = (t, pkg = S.filters.pkg) => !pkg || (pkg === '__none' ? !t?.package_id : t?.package_id === pkg);
const pkgOptions = (sel, empty) => `<option value="">${empty}</option>` + projPackages().map((k) => `<option value="${k.id}" ${k.id === sel ? 'selected' : ''}>${esc(k.code ? k.code + ' – ' : '')}${esc(k.name)}</option>`).join('');
/** Đầu việc của dự án đang mở, sắp theo thứ tự hạng mục chính rồi thứ tự đầu việc. */
function projTasks() {
  const ord = new Map(projPackages().map((k, i) => [k.id, i]));
  return S.tasks.filter((t) => t.project_id === S.projectId)
    .sort((a, b) => (ord.get(a.package_id) ?? 999) - (ord.get(b.package_id) ?? 999) || (+a.order || 0) - (+b.order || 0));
}
const projectUnitCodes = (p) => String(p?.units || '').split(',').map((c) => c.trim()).filter(Boolean);
/** Nhà thầu tham gia dự án đang mở (dự án không khai báo => tất cả). */
function projUnitList() {
  const codes = projectUnitCodes(curProject());
  return codes.length ? S.units.filter((u) => codes.includes(u.code)) : S.units;
}
function setProject(id) {
  S.projectId = id;
  S.filters.section = '';
  S.filters.pkg = '';
  try { if (id) localStorage.setItem('dl_project', id); } catch { /* ignore */ }
}
const fmtDate = (s) => (s ? `${fmtD(s, false)}/${String(s).slice(0, 4)}` : '—');
const taskLabel = (t) => (t ? `${projPackages().length > 1 && pkgCode(t) ? pkgCode(t) + ' · ' : ''}${t.wbs}${t.phase ? ' · Pha ' + t.phase : ''}` : '');
const unitName = (c) => (S.units.find((u) => u.code === c) || {}).name || c;
const sections = () => [...new Set(projTasks().filter((t) => inPkg(t)).map((t) => t.section).filter(Boolean))];
const updatesOf = (id) => S.updates.filter((u) => u.task_id === id).sort((a, b) => (a.ts < b.ts ? 1 : -1));

function filtered(extra = {}) {
  const f = { ...S.filters, ...extra };
  const q = f.q.trim().toLowerCase();
  return projTasks().filter((t) =>
    (!f.unit || (f.unit === '__none' ? !t.unit : t.unit === f.unit)) &&
    (!f.phase || String(t.phase).includes(f.phase)) &&
    inPkg(t, f.pkg) &&
    (!f.section || t.section === f.section) &&
    (!f.cls || klass(t) === f.cls) &&
    (!q || `${t.wbs} ${t.name} ${t.group} ${t.subgroup} ${t.note}`.toLowerCase().includes(q)));
}

/* ============================ API ============================ */
let tokenWaiter = null;
function jwtPayload(tok) {
  try {
    const b = tok.split('.')[1].replace(/-/g, '+').replace(/_/g, '/');
    return JSON.parse(decodeURIComponent([...atob(b)].map((c) => '%' + c.charCodeAt(0).toString(16).padStart(2, '0')).join('')));
  } catch { return null; }
}
function freshToken() {
  const p = S.token && jwtPayload(S.token);
  if (p && p.exp * 1000 - Date.now() > 60000) return Promise.resolve(S.token);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { tokenWaiter = null; reject(new Error('AUTH: Phiên đăng nhập hết hạn')); }, 20000);
    tokenWaiter = (tok) => { clearTimeout(timer); resolve(tok); };
    window.google?.accounts.id.prompt();
  });
}
const READ_ACTIONS = new Set(['me', 'bootstrap', 'getPhoto']);
const SESSION_EXPIRED = 'Phiên đăng nhập đã hết hạn (sau khoảng 1 giờ). Đăng nhập lại để tiếp tục – dữ liệu đã lưu không bị mất.';
async function api(action, data = {}) {
  const write = !READ_ACTIONS.has(action);
  const restore = write && lastBtn?.isConnected && Date.now() - lastBtnAt < 1500 ? markBusy(lastBtn) : null;
  setLoading(1);
  try {
    const res = await apiCall(action, data);
    if (write) S.writes = (S.writes || 0) + 1;
    return res;
  } finally {
    setLoading(-1);
    if (restore) restore();
  }
}
async function apiCall(action, data) {
  if (DEMO) return Demo.call(action, JSON.parse(JSON.stringify(data)));
  let idToken;
  try { idToken = await freshToken(); } catch (e) { showLogin(SESSION_EXPIRED, 'warn'); throw e; }
  let j;
  try {
    const r = await fetch(CFG.API_URL, {
      method: 'POST', redirect: 'follow',
      headers: { 'Content-Type': 'text/plain;charset=utf-8' },
      body: JSON.stringify({ action, data, idToken }),
    });
    j = await r.json();
  } catch {
    throw new Error(navigator.onLine ? 'Không kết nối được máy chủ. Thử lại sau ít phút.' : 'Mất kết nối mạng. Kiểm tra 4G hoặc Wi-Fi rồi thử lại.');
  }
  if (!j.ok) {
    if (/^AUTH:/.test(j.error)) showLogin(/hết hạn/.test(j.error) ? SESSION_EXPIRED : j.error.replace(/^AUTH:\s*/, ''), 'warn');
    const err = new Error(j.error.replace(/^[A-Z_]+:\s*/, ''));
    err.code = (j.error.match(/^([A-Z_]+):/) || [])[1];
    throw err;
  }
  return j.data;
}

/* ============================ DEMO BACKEND ============================ */
const Demo = {
  KEY: 'dilinh_demo_v5',
  db: null,
  async load() {
    try { this.db = JSON.parse(localStorage.getItem(this.KEY) || 'null'); } catch { this.db = null; }
    if (!this.db) {
      const seed = await fetch('demo-data.json').then((r) => r.json());
      this.db = { ...seed, users: [{ email: 'demo@dilinh.vn', name: 'Người dùng demo', phone: '', unit: 'PTC3', role: 'admin', status: 'active', created_at: dtstr(new Date()), last_login: '' },
        { email: 'tvgs.pecc4@example.com', name: 'Kỹ sư TVGS PECC4', phone: '0900000001', unit: 'PECC4', role: 'admin', status: 'pending', created_at: dtstr(new Date()), last_login: '' }] };
      this.save();
    }
  },
  save() { try { localStorage.setItem(this.KEY, JSON.stringify(this.db)); } catch { /* bộ nhớ đầy: bỏ qua */ } },
  reset() { try { localStorage.removeItem(this.KEY); } catch { /* ignore */ } location.reload(); },
  me() { return this.db.users[0]; },
  call(action, d) {
    const db = this.db, me = this.me();
    const res = (() => {
      switch (action) {
        case 'me': return { profile: { email: me.email, name: me.name, picture: '' }, user: me, config: db.config, units: db.units };
        case 'bootstrap': return { user: me, config: db.config, units: db.units, projects: db.projects, packages: db.packages, tasks: db.tasks, updates: db.updates, users: me.role === 'admin' ? db.users : undefined };
        case 'updateTask': {
          const t = db.tasks.find((x) => x.id === d.task_id);
          if (!canEdit(t)) throw new Error('Công việc này thuộc đơn vị khác, bạn không được cập nhật');
          const progress = d.progress === '' || d.progress == null ? +t.progress || 0 : Math.max(0, Math.min(100, +d.progress));
          let status = TASK_STATUS.includes(d.status) ? d.status : t.status;
          if (progress >= 100) status = 'Hoàn thành';
          else if (status === 'Hoàn thành') status = 'Đang thi công';
          else if (progress > 0 && !status) status = 'Đang thi công';
          Object.assign(t, {
            progress, status,
            actual_start: d.actual_start || t.actual_start || (progress > 0 ? today() : ''),
            actual_end: progress >= 100 ? d.actual_end || t.actual_end || today() : '',
            delay_days: d.delay_days === '' || d.delay_days == null ? t.delay_days : +d.delay_days,
            updated_by: me.email, updated_at: dtstr(new Date()),
          });
          const ids = (d.photos || []).map((p, i) => { const id = 'demo' + Date.now() + i; S.photos[id] = `data:${p.mime};base64,${p.data}`; return id; });
          const up = { id: 'U' + Date.now().toString(36), ts: dtstr(new Date()), report_date: d.report_date || today(), task_id: t.id, email: me.email, user_name: me.name, unit: me.unit, progress, status, actual_start: t.actual_start, actual_end: t.actual_end, delay_days: t.delay_days, note: d.note || '', photos: ids.join(',') };
          db.updates.push(up);
          return { task: t, update: up };
        }
        case 'getPhoto': {
          const u = S.photos[d.id];
          if (!u) throw new Error('Ảnh demo chỉ lưu tạm trong phiên làm việc');
          return { mime: 'image/jpeg', data: u.split(',')[1] };
        }
        case 'saveTask': {
          let t = db.tasks.find((x) => x.id === d.id);
          if (!t) {
            if (!db.projects.some((p) => p.id === d.project_id)) throw new Error('Vui lòng chọn dự án hợp lệ');
            t = { id: nextId('T', db.tasks), project_id: d.project_id, progress: 0, status: '', order: Math.max(0, ...db.tasks.filter((x) => x.project_id === d.project_id).map((x) => +x.order || 0)) + 1 };
            db.tasks.push(t);
          }
          if (!(d.name ?? t.name)) throw new Error('Vui lòng nhập tên công việc');
          Object.assign(t, d, { id: t.id, updated_by: me.email, updated_at: dtstr(new Date()) });
          return { task: t };
        }
        case 'importTasks': {
          if (!db.projects.some((p) => p.id === d.project_id)) throw new Error('Vui lòng chọn dự án hợp lệ');
          let order = Math.max(0, ...db.tasks.filter((x) => x.project_id === d.project_id).map((x) => +x.order || 0));
          const out = d.tasks.map((r, i) => {
            if (!r.name) throw new Error(`Dòng ${i + 2}: Vui lòng nhập tên công việc`);
            const t = { ...r, id: nextId('T', db.tasks), project_id: d.project_id, progress: 0, status: '', order: ++order, updated_by: me.email, updated_at: dtstr(new Date()) };
            if (t.plan_start && t.plan_end && !t.plan_days) t.plan_days = +((parseD(t.plan_end) - parseD(t.plan_start)) / DAY).toFixed(2);
            db.tasks.push(t);
            return t;
          });
          return { tasks: out };
        }
        case 'deleteTasks': db.tasks = db.tasks.filter((x) => !d.ids.includes(x.id)); return { ids: d.ids };
        case 'bulkAssignUnit': db.tasks.forEach((t) => { if (d.task_ids.includes(t.id)) t.unit = d.unit; }); return { count: d.task_ids.length };
        case 'bulkUpdateTasks': db.tasks.forEach((t) => {
          if (!d.task_ids.includes(t.id)) return;
          if (d.package_id !== undefined) t.package_id = d.package_id;
          if (d.unit !== undefined) t.unit = d.unit;
        }); return { count: d.task_ids.length };
        case 'savePackage': {
          let k = db.packages.find((x) => x.id === d.id);
          const pid = k ? k.project_id : d.project_id;
          if (d.code && db.packages.some((x) => x.id !== d.id && x.project_id === pid && String(x.code).toLowerCase() === d.code.toLowerCase())) throw new Error(`Mã hạng mục "${d.code}" đã có trong dự án`);
          if (!k) { k = { id: nextId('H', db.packages), project_id: pid, status: 'Chuẩn bị', order: Math.max(0, ...db.packages.filter((x) => x.project_id === pid).map((x) => +x.order || 0)) + 1, created_by: me.email, created_at: dtstr(new Date()) }; db.packages.push(k); }
          Object.assign(k, d, { id: k.id, project_id: pid, updated_at: dtstr(new Date()) });
          if (!k.name) throw new Error('Vui lòng nhập tên hạng mục chính');
          return { package: k };
        }
        case 'deletePackage': {
          const n = db.tasks.filter((t) => t.package_id === d.id).length;
          if (n && !d.cascade) throw new Error(`Hạng mục còn ${n} đầu việc. Xác nhận xóa kèm đầu việc.`);
          db.tasks = db.tasks.filter((t) => t.package_id !== d.id);
          db.packages = db.packages.filter((k) => k.id !== d.id);
          return { id: d.id, deletedTasks: n };
        }
        case 'saveUser': { const u = db.users.find((x) => x.email === d.email); Object.assign(u, d); return { user: u }; }
        case 'saveProject': {
          let p = db.projects.find((x) => x.id === d.id);
          if (d.code && db.projects.some((x) => x.id !== d.id && String(x.code).toLowerCase() === d.code.toLowerCase())) throw new Error(`Mã dự án "${d.code}" đã tồn tại`);
          if (!p) { p = { id: nextId('P', db.projects), created_by: me.email, created_at: dtstr(new Date()) }; db.projects.push(p); }
          Object.assign(p, d, { id: p.id, units: Array.isArray(d.units) ? d.units.join(',') : (d.units ?? p.units), updated_at: dtstr(new Date()) });
          if (!p.name) throw new Error('Vui lòng nhập tên dự án');
          return { project: p };
        }
        case 'deleteProject': {
          const n = db.tasks.filter((t) => t.project_id === d.id).length;
          if (n && !d.cascade) throw new Error(`Dự án còn ${n} công việc. Xác nhận xóa kèm công việc.`);
          db.tasks = db.tasks.filter((t) => t.project_id !== d.id);
          db.packages = db.packages.filter((k) => k.project_id !== d.id);
          db.projects = db.projects.filter((p) => p.id !== d.id);
          return { id: d.id, deletedTasks: n };
        }
        case 'saveUnit': {
          const code = String(d.code || '').toUpperCase().replace(/[^A-Z0-9Đ_-]/g, '');
          if (!code) throw new Error('Mã nhà thầu không hợp lệ');
          let u = db.units.find((x) => x.code === code);
          if (u && d.isNew) throw new Error(`Mã nhà thầu "${code}" đã tồn tại`);
          if (!u) { u = { code }; db.units.push(u); }
          Object.assign(u, d, { code });
          delete u.isNew;
          if (!u.name) u.name = code;
          return { unit: u, units: db.units };
        }
        case 'deleteUnit': {
          const nT = db.tasks.filter((t) => t.unit === d.code).length, nU = db.users.filter((x) => x.unit === d.code).length;
          if (nT || nU) throw new Error(`Không thể xóa: nhà thầu còn ${nT} công việc và ${nU} người dùng. Hãy chuyển sang nhà thầu khác trước.`);
          db.units = db.units.filter((u) => u.code !== d.code);
          db.projects.forEach((p) => { p.units = String(p.units || '').split(',').filter((c) => c && c !== d.code).join(','); });
          return { code: d.code, units: db.units };
        }
        case 'saveProfile': Object.assign(me, { name: d.name || me.name, phone: d.phone || '' }); return { user: me };
      }
      throw new Error('Hành động không hợp lệ');
    })();
    this.save();
    return new Promise((r) => setTimeout(() => r(JSON.parse(JSON.stringify(res))), 120));
  },
};

const nextId = (prefix, list) => prefix + String(Math.max(0, ...list.map((x) => +String(x.id).replace(/\D/g, '') || 0)) + 1).padStart(3, '0');

/* ============================ UI HELPERS ============================ */
const cssVar = (v) => getComputedStyle(document.documentElement).getPropertyValue(v).trim();
const pill = (c) => `<span class="pill c-${c}">${CLS[c].label}</span>`;
const unitOptions = (sel, empty = 'Tất cả đơn vị', list = S.units) =>
  `<option value="">${empty}</option>` + list.map((u) => `<option value="${esc(u.code)}" ${u.code === sel ? 'selected' : ''}>${esc(u.code)} – ${esc(u.name)}</option>`).join('');
function openDialog(html) {
  $('#dlgBody').innerHTML = html;
  const d = $('#dlg');
  if (!d.open) d.showModal();
  return d;
}
const closeDialog = () => $('#dlg').close();
function destroyCharts() { Object.values(S.charts).forEach((c) => c.destroy()); S.charts = {}; }

function filterBar({ q = true, pkg = true, unit = true, phase = true, section = true, cls = true, extra = '' } = {}) {
  const f = S.filters;
  return `<div class="filters">
    ${q ? `<input type="search" class="grow" data-filter="q" placeholder="Tìm đầu việc, phần việc…" value="${esc(f.q)}">` : ''}
    ${pkg && projPackages().length ? `<select data-filter="pkg" aria-label="Hạng mục chính">${pkgOptions(f.pkg, 'Tất cả hạng mục chính')}${projTasks().some((t) => !t.package_id) ? `<option value="__none" ${f.pkg === '__none' ? 'selected' : ''}>(Chưa phân hạng mục chính)</option>` : ''}</select>` : ''}
    ${unit ? `<select data-filter="unit" aria-label="Nhà thầu">${unitOptions(f.unit, 'Tất cả nhà thầu', projUnitList())}<option value="__none" ${f.unit === '__none' ? 'selected' : ''}>(Chưa gán nhà thầu)</option></select>` : ''}
    ${section ? `<select data-filter="section" aria-label="Phần việc"><option value="">Tất cả phần việc</option>${sections().map((s) => `<option ${s === f.section ? 'selected' : ''}>${esc(s)}</option>`).join('')}</select>` : ''}
    ${phase ? `<select data-filter="phase" aria-label="Pha"><option value="">Tất cả pha</option>${['A', 'B', 'C'].map((p) => `<option value="${p}" ${p === f.phase ? 'selected' : ''}>Pha ${p}</option>`).join('')}</select>` : ''}
    ${cls ? `<select data-filter="cls" aria-label="Tình trạng"><option value="">Mọi tình trạng</option>${Object.entries(CLS).map(([k, v]) => `<option value="${k}" ${k === f.cls ? 'selected' : ''}>${v.label}</option>`).join('')}</select>` : ''}
    ${extra}
  </div>`;
}

/* ============================ AUTH FLOW ============================ */
/* ============================ PHẢN HỒI: thông báo, tiến trình, xác nhận ============================ */
const TOAST_ICON = {
  ok: '<path d="M9 16.2 4.8 12l-1.4 1.4L9 19 21 7l-1.4-1.4z"/>',
  err: '<path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20m1 15h-2v-2h2zm0-4h-2V7h2z"/>',
  info: '<path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20m1 15h-2v-6h2zm0-8h-2V7h2z"/>',
};
/** type: 'ok' | 'info' | 'err' (true = 'err' để tương thích lời gọi cũ). */
function toast(msg, type = 'ok', action = null) {
  if (type === true) type = 'err';
  else if (type === false || !TOAST_ICON[type]) type = 'ok';
  const box = $('#toast');
  const el = document.createElement('div');
  el.className = `t t-${type}`;
  el.setAttribute('role', type === 'err' ? 'alert' : 'status');
  el.innerHTML = `<svg viewBox="0 0 24 24" aria-hidden="true">${TOAST_ICON[type]}</svg><span></span><button type="button" class="t-x" aria-label="Đóng thông báo">×</button>`;
  el.querySelector('span').textContent = msg;
  const close = () => { el.classList.add('out'); setTimeout(() => el.remove(), 200); };
  el.querySelector('.t-x').onclick = close;
  if (action) {
    const a = document.createElement('button');
    a.type = 'button'; a.className = 't-act'; a.textContent = action.label;
    a.onclick = () => { close(); action.onClick(); };
    el.querySelector('span').appendChild(a);
  }
  box.appendChild(el);
  while (box.children.length > 3) box.firstElementChild.remove();
  setTimeout(close, action ? 9000 : { ok: 3200, info: 5000, err: 7000 }[type]);
}

// Thanh tiến trình trên cùng: chỉ hiện khi lời gọi máy chủ kéo dài quá 150ms
let pendingCalls = 0, progTimer = null;
function setLoading(delta) {
  pendingCalls = Math.max(0, pendingCalls + delta);
  clearTimeout(progTimer);
  if (pendingCalls) progTimer = setTimeout(() => document.body.classList.add('loading'), 150);
  else document.body.classList.remove('loading');
}

// Nút vừa bấm sẽ hiện vòng xoay trong lúc chờ máy chủ xử lý
let lastBtn = null, lastBtnAt = 0;
document.addEventListener('click', (e) => { const b = e.target.closest('button'); if (b) { lastBtn = b; lastBtnAt = Date.now(); } }, true);
function markBusy(btn) {
  if (!btn || btn.classList.contains('busy') || btn.hasAttribute('data-own-busy')) return null;
  btn.classList.add('busy');
  btn.setAttribute('aria-busy', 'true');
  const wasDisabled = btn.disabled;
  btn.disabled = true;
  return () => {
    btn.classList.remove('busy');
    btn.removeAttribute('aria-busy');
    if (!wasDisabled) btn.disabled = false;
  };
}

/** Hộp xác nhận thay cho confirm()/prompt() của trình duyệt. requireText: phải gõ đúng chuỗi này mới cho xác nhận. */
function confirmBox({ title, message = '', ok = 'Đồng ý', danger = false, requireText = '' }) {
  return new Promise((resolve) => {
    const d = $('#confirmDlg');
    d.innerHTML = `<form class="cf">
      <h2>${esc(title)}</h2>${message ? `<p>${esc(message)}</p>` : ''}
      ${requireText ? `<label class="field"><span>Gõ <b>${esc(requireText)}</b> để xác nhận</span><input type="text" id="cfInput" autocomplete="off" spellcheck="false"></label>` : ''}
      <div class="cf-actions"><button type="button" class="btn ghost" id="cfNo">Hủy</button><button type="submit" class="btn ${danger ? 'danger' : ''}" id="cfOk" ${requireText ? 'disabled' : ''}>${esc(ok)}</button></div>
    </form>`;
    const done = (v) => { if (d.open) d.close(); resolve(v); };
    $('#cfNo', d).onclick = () => done(false);
    $('form', d).onsubmit = (e) => { e.preventDefault(); if (!$('#cfOk', d).disabled) done(true); };
    d.oncancel = (e) => { e.preventDefault(); done(false); };
    const inp = $('#cfInput', d);
    if (inp) inp.oninput = () => { $('#cfOk', d).disabled = inp.value.trim() !== requireText; };
    d.showModal();
    (inp || (danger ? $('#cfNo', d) : $('#cfOk', d))).focus();
  });
}

// Mất / có lại kết nối mạng
function netStatus() { $('#netbar').hidden = navigator.onLine; }
window.addEventListener('offline', netStatus);
window.addEventListener('online', () => { netStatus(); if (S.user) { toast('Đã có mạng trở lại – đang đồng bộ dữ liệu', 'info'); sync(false); } });

/* ============================ KHỞI ĐỘNG ============================ */
const BOOT_STEPS = [['connect', 'Kết nối máy chủ'], ['auth', 'Xác thực tài khoản Google'], ['data', 'Tải dữ liệu dự án']];
let slowTimer = null;
const xfSymbol = (cls = '') => `<svg class="xf ${cls}" viewBox="0 0 132 64" role="img" aria-label="Ký hiệu máy biến áp">
  <path class="bus" d="M2 32H38M94 32H130"/><path class="flow" d="M2 32H38M94 32H130"/>
  <circle class="w w1" cx="54" cy="32" r="18"/><circle class="w w2" cx="78" cy="32" r="18"/></svg>`;
function showBoot(step) {
  if (!$('#boot')) {
    $('#main').innerHTML = `<section class="boot" id="boot" aria-live="polite" aria-busy="true">${xfSymbol('energize')}
      <div class="boot-title">Tiến độ hiện trường</div>
      <ol class="boot-steps">${BOOT_STEPS.map(([k, l]) => `<li data-step="${k}">${l}</li>`).join('')}</ol>
      <p class="boot-hint" id="bootHint"></p></section>`;
  }
  if (!slowTimer) {
    slowTimer = setTimeout(() => {
      const h = $('#bootHint');
      if (h) h.textContent = 'Máy chủ Google đang khởi động. Lần mở đầu tiên trong ngày có thể mất 10–20 giây.';
    }, 6000);
  }
  const i = BOOT_STEPS.findIndex(([k]) => k === step);
  $$('#boot li').forEach((li, j) => { li.className = j < i ? 'done' : j === i ? 'now' : ''; });
}
function endBoot() { clearTimeout(slowTimer); slowTimer = null; }
function showBootError(err) {
  endBoot();
  const offline = !navigator.onLine;
  $('#main').innerHTML = `<section class="boot">${xfSymbol()}
    <div class="boot-error" role="alert"><h2>${offline ? 'Chưa có kết nối mạng' : 'Không mở được dữ liệu'}</h2>
      <p>${esc(offline ? 'Kiểm tra 4G hoặc Wi-Fi rồi thử lại.' : err.message)}</p>
      <button class="btn" data-act="retry">Thử lại</button></div></section>`;
}

/* ============================ ĐĂNG NHẬP / ĐĂNG XUẤT ============================ */
/** kind: 'warn' (hết phiên), 'ok' (đã đăng xuất), 'err' (lỗi). */
function showLogin(notice = '', kind = 'warn') {
  endBoot();
  S.token = null;
  try { sessionStorage.removeItem('idt'); } catch { /* ignore */ }
  setChrome(false);
  $('#userBox').hidden = true;
  destroyCharts();
  $('#main').innerHTML = `<section class="login${inAppBrowser() ? ' is-inapp' : ''}">
    <div class="login-id">
      ${xfSymbol('energize')}
      <h1>Tiến độ hiện trường</h1>
      <p>Cập nhật tiến độ thi công ngay tại công trường.</p>
    </div>
    <div class="login-form">
      <h2>Xin chào!</h2>
      <p>Đăng nhập bằng tài khoản Google để bắt đầu.</p>
      ${notice ? `<div class="notice ${kind}" role="${kind === 'err' ? 'alert' : 'status'}">${esc(notice)}</div>` : ''}
      ${inAppBrowser() ? inAppNotice(inAppBrowser()) + '<p class="inapp-try">Vẫn muốn thử đăng nhập ngay tại đây:</p>' : ''}
      <div id="gbtn"></div>
      ${!CFG.GOOGLE_CLIENT_ID ? '<div class="notice err">Chưa cấu hình GOOGLE_CLIENT_ID trong config.js.</div>' : ''}
      <p class="login-privacy">Ứng dụng chỉ đọc tên, email và ảnh đại diện Google của bạn.</p>
      <div class="login-help"><button type="button" class="linkish" data-act="help">Lần đầu sử dụng? Xem hướng dẫn</button><span>Cần hỗ trợ: liên hệ PTC3 hoặc Tư vấn giám sát.</span></div>
    </div>
  </section>`;
  if (window.google?.accounts?.id) {
    google.accounts.id.renderButton($('#gbtn'), { theme: 'filled_blue', size: 'large', shape: 'pill', text: 'signin_with', locale: 'vi', width: 280 });
  }
}
/* ---------- Trình duyệt nhúng (Zalo, Messenger…): Google chặn đăng nhập ---------- */
/** Trả về { name, os } nếu đang mở trong trình duyệt nhúng của một ứng dụng, ngược lại null. */
function inAppBrowser(ua = navigator.userAgent) {
  const os = /iPhone|iPad|iPod/i.test(ua) ? 'ios' : /Android/i.test(ua) ? 'android' : 'other';
  const known = [
    [/Zalo/i, 'Zalo'], [/MessengerForiOS|FB_IAB\/MESSENGER|Messenger/i, 'Messenger'], [/FBAN|FBAV|FB_IAB|FBIOS/i, 'Facebook'],
    [/Instagram/i, 'Instagram'], [/musical_ly|BytedanceWebview|TikTok/i, 'TikTok'], [/\bLine\//i, 'LINE'],
  ];
  for (const [re, name] of known) if (re.test(ua)) return { name, os };
  if (os === 'android' && /; wv\)/.test(ua)) return { name: '', os };
  if (os === 'ios' && !/Safari\//.test(ua)) return { name: '', os };
  return null;
}
const appUrl = () => location.href.split('#')[0].split('?')[0];
function inAppNotice(b) {
  const url = appUrl(), ios = b.os === 'ios', where = b.name || 'một ứng dụng khác';
  const steps = ios
    ? '<li>Bấm <b>⋯</b> hoặc biểu tượng la bàn ở góc màn hình</li><li>Chọn <b>Mở bằng Safari</b> (hoặc <b>Mở trong trình duyệt</b>)</li><li>Không thấy mục đó? Bấm <b>Sao chép link</b> rồi dán vào Safari</li>'
    : '<li>Bấm <b>⋮</b> ở góc trên bên phải</li><li>Chọn <b>Mở bằng trình duyệt</b> (hoặc <b>Mở trong Chrome</b>)</li><li>Hoặc bấm <b>Mở bằng Chrome</b> bên dưới</li>';
  const chrome = `intent://${url.replace(/^https?:\/\//, '')}#Intent;scheme=https;package=com.android.chrome;end`;
  return `<div class="inapp" role="alert">
    <h3>Mở bằng ${ios ? 'Safari' : 'Chrome'} để đăng nhập</h3>
    <p>Bạn đang mở link trong ${esc(where)}. Google không cho đăng nhập trong trình duyệt của ${b.name ? esc(b.name) : 'ứng dụng này'}.</p>
    <ol>${steps}</ol>
    <div class="inapp-actions">${ios ? '' : `<a class="btn" href="${esc(chrome)}">Mở bằng Chrome</a>`}<button type="button" class="btn ${ios ? '' : 'ghost'}" data-act="copy-link">Sao chép link</button></div>
    <input class="inapp-url" type="text" value="${esc(url)}" readonly aria-label="Link ứng dụng">
  </div>`;
}
async function copyLink() {
  const url = appUrl();
  let ok = false;
  try { await navigator.clipboard.writeText(url); ok = true; } catch { /* trình duyệt nhúng thường chặn clipboard API */ }
  if (!ok) {
    const i = $('.inapp-url');
    if (i) { i.focus(); i.select(); i.setSelectionRange(0, url.length); try { ok = document.execCommand('copy'); } catch { ok = false; } }
  }
  toast(ok ? 'Đã sao chép link – mở Chrome hoặc Safari và dán vào thanh địa chỉ' : 'Nhấn giữ vào ô link để sao chép', ok ? 'ok' : 'info');
}

function onCredential(resp) {
  S.token = resp.credential;
  try { sessionStorage.setItem('idt', S.token); } catch { /* ignore */ }
  if (tokenWaiter) { const w = tokenWaiter; tokenWaiter = null; w(S.token); return; }
  S.loginKind = 'fresh';
  startSession();
}
function loadGoogle() {
  return new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://accounts.google.com/gsi/client';
    s.async = true;
    s.onload = resolve;
    s.onerror = () => reject(new Error('Không tải được dịch vụ đăng nhập Google. Kiểm tra mạng rồi tải lại trang.'));
    document.head.appendChild(s);
  });
}

async function boot() {
  netStatus();
  showBoot('connect');
  if (DEMO) {
    try { await Demo.load(); } catch (e) { return showBootError(e); }
    S.token = 'demo';
    S.loginKind = 'demo';
    $('#demoPill').hidden = false;
    $('#demoTools').hidden = false;
    return startSession();
  }
  try { await loadGoogle(); } catch (e) { return showLogin(e.message, 'err'); }
  google.accounts.id.initialize({ client_id: CFG.GOOGLE_CLIENT_ID, callback: onCredential, auto_select: true, cancel_on_tap_outside: false, use_fedcm_for_prompt: true });
  let saved = null;
  try { saved = sessionStorage.getItem('idt'); } catch { /* ignore */ }
  const p = saved && jwtPayload(saved);
  if (p && p.exp * 1000 - Date.now() > 120000) { S.token = saved; S.loginKind = 'restore'; return startSession(); }
  showLogin();
  if (!inAppBrowser()) google.accounts.id.prompt(); // trong Zalo/Messenger Google sẽ từ chối, không tự bật
}

function welcome() {
  const u = S.user, name = u.name || S.profile?.name || u.email;
  if (S.justRegistered) { S.justRegistered = false; S.loginKind = ''; return toast(`Chào mừng ${name}! Bạn đã sẵn sàng cập nhật tiến độ.`, 'ok', { label: 'Xem hướng dẫn 1 phút', onClick: () => openGuide() }); }
  if (S.loginKind === 'fresh') toast(`Đã đăng nhập: ${name} (${u.email}) – ${ROLES[u.role] || u.role}${u.unit ? ', ' + u.unit : ''}`, 'ok');
  else if (S.loginKind === 'restore') toast(`Chào mừng trở lại, ${name}`, 'info');
  else if (S.loginKind === 'demo') toast('Bản demo: dữ liệu chỉ lưu trên trình duyệt này. Đổi vai trò ở menu tài khoản để xem thử phân quyền.', 'info');
  S.loginKind = '';
}

async function startSession() {
  showBoot('auth');
  try {
    const me = await api('me');
    S.profile = me.profile; S.config = me.config || {}; S.units = me.units || [];
    applyConfig();
    if (!me.user) { endBoot(); return showRegister(); }
    S.user = me.user;
    if (me.user.status !== 'active') { endBoot(); return showPending(); }
    showBoot('data');
    await reload();
    endBoot();
    renderUser();
    setChrome(true);
    go(S.view);
    startAutoSync();
    welcome();
  } catch (e) {
    endBoot();
    if (e.code === 'NOT_REGISTERED') return showRegister();
    if (e.code === 'NOT_ACTIVE') return showPending();
    if (!/AUTH/.test(e.code || e.message)) showBootError(e);
  }
}

function setChrome(on) {
  $('#tabs').hidden = !on;
  $('#projSel').hidden = !on;
  $('#userBox').hidden = !on && !S.profile;
}


/* ============================ ĐỒNG BỘ ============================ */
const SYNC_MS = 5 * 60 * 1000; // tự động đồng bộ mỗi 5 phút khi đang mở app
let syncing = false, syncTimer = null;
function hashStr(str) {
  let h = 5381;
  for (let i = 0; i < str.length; i++) h = ((h << 5) + h + str.charCodeAt(i)) | 0;
  return h;
}
const dataSig = () => hashStr(JSON.stringify([S.projects, S.packages, S.tasks, S.units, S.users, S.user, S.updates.length, S.updates[S.updates.length - 1]]));
function renderSync() {
  const d = S.lastSync;
  if (!d) return;
  $('#syncTime').textContent = `${pad(d.getHours())}:${pad(d.getMinutes())}`;
  if (!$('#syncBtn').classList.contains('err')) {
    $('#syncBtn').title = `Đồng bộ dữ liệu từ Google Sheet – lần cuối ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}, tự động mỗi ${SYNC_MS / 60000} phút`;
  }
}
/** Người dùng đang thao tác dở (nhập liệu, mở hộp thoại, đang chọn dòng) – không tự làm mới để tránh mất dữ liệu. */
function userBusy() {
  if ($('#dlg').open || $('#lightbox').open || !$('#userMenu').hidden) return true;
  const a = document.activeElement;
  if (a && a.matches('input, textarea, select') && a.closest('#main')) return true;
  return $$('.sel:checked').length > 0;
}
async function sync(manual = false) {
  if (syncing || !S.user || S.user.status !== 'active') return;
  if (!manual && userBusy()) return;
  syncing = true;
  const btn = $('#syncBtn');
  btn.classList.add('spin');
  try {
    const w = S.writes;
    let changed = await reload();
    // có thao tác ghi xong trong lúc đang tải => tải lại để không hiển thị dữ liệu cũ
    if (S.writes !== w) changed = (await reload()) || changed;
    btn.classList.remove('err');
    renderUser();
    renderSync();
    if (changed || manual) {
      const y = window.scrollY;
      rerender();
      window.scrollTo({ top: y });
    }
    if (manual) toast(changed ? 'Đã đồng bộ – có dữ liệu mới từ Google Sheet' : 'Đã đồng bộ – dữ liệu không thay đổi');
    else if (changed) toast('Dữ liệu vừa được cập nhật từ Google Sheet');
  } catch (e) {
    btn.classList.add('err');
    btn.title = 'Lỗi đồng bộ: ' + e.message;
    if (e.code === 'NOT_ACTIVE') return showPending();
    if (manual) toast(e.message, true);
  } finally {
    syncing = false;
    btn.classList.remove('spin');
  }
}
function startAutoSync() {
  if (syncTimer) return;
  syncTimer = setInterval(() => { if (document.visibilityState === 'visible') sync(false); }, SYNC_MS);
}
function stopAutoSync() { clearInterval(syncTimer); syncTimer = null; }
// quay lại tab app sau một lúc => đồng bộ ngay
document.addEventListener('visibilitychange', () => {
  if (syncTimer && document.visibilityState === 'visible' && S.lastSync && Date.now() - S.lastSync > 60000) sync(false);
});

/** Tải toàn bộ dữ liệu; trả về true nếu dữ liệu khác lần tải trước. */
async function reload() {
  const b = await api('bootstrap');
  Object.assign(S, { user: b.user, config: b.config || {}, units: b.units || [], projects: b.projects || [], packages: b.packages || [], tasks: b.tasks || [], updates: b.updates || [], users: b.users || [], dbUrl: b.dbUrl || '' });
  if (!curProject()) {
    let saved = null;
    try { saved = localStorage.getItem('dl_project'); } catch { /* ignore */ }
    const act = S.projects.find((p) => p.status === 'Đang thực hiện');
    setProject((S.projects.find((p) => p.id === saved) || act || S.projects[0] || {}).id || null);
  }
  renderProjSel();
  S.tasks.forEach((t) => { t.progress = +t.progress || 0; });
  applyConfig();
  const pend = S.users.filter((u) => u.status === 'pending').length;
  $('#pendingBadge').hidden = !pend;
  $('#pendingBadge').textContent = pend;
  $('#tabAdmin').hidden = !isManager();
  S.lastSync = new Date();
  const sig = dataSig(), changed = S.sig !== undefined && sig !== S.sig;
  S.sig = sig;
  renderSync();
  return changed;
}
function applyConfig() { /* tên dự án hiển thị qua bộ chọn dự án */ }
function renderProjSel() {
  const sel = $('#projSel');
  sel.innerHTML = (S.projects.length ? S.projects.map((p) => `<option value="${p.id}" ${p.id === S.projectId ? 'selected' : ''}>${esc(p.name)}${p.status !== 'Đang thực hiện' ? ' (' + esc(p.status) + ')' : ''}</option>`).join('') : '<option value="">(Chưa có dự án)</option>')
    + (S.user?.role === 'admin' ? '<option value="__new">＋ Tạo dự án mới…</option>' : '');
  sel.title = curProject()?.name || '';
  document.title = (curProject()?.code || 'Hiện trường') + ' – Tiến độ hiện trường';
}
function noProjectHtml() {
  return `<div class="card auth-card" style="text-align:center"><h2>Chưa có dự án</h2><p class="muted">${S.user?.role === 'admin' ? 'Tạo dự án đầu tiên, sau đó thêm nhà thầu và đầu việc.' : 'Chưa có dự án nào. Liên hệ quản trị viên.'}</p>${S.user?.role === 'admin' ? '<button class="btn" data-act="new-project">＋ Tạo dự án</button>' : ''}</div>`;
}
function renderUser() {
  const u = S.user, p = S.profile || {};
  $('#userBox').hidden = false;
  $('#userName').textContent = u?.name || p.name || p.email;
  $('#userRole').textContent = u ? `${ROLES[u.role] || u.role}${u.unit ? ' · ' + u.unit : ''}` : '';
  $('#menuEmail').textContent = p.email || u?.email || '';
  const av = $('#userAvatar');
  if (p.picture) av.src = p.picture; else av.removeAttribute('src');
  if (DEMO) {
    $('#demoRole').value = u.role;
    $('#demoUnit').innerHTML = unitOptions(u.unit, '(Không)');
  }
}

function showRegister() {
  setChrome(false);
  renderUser();
  const p = S.profile || {};
  const first = String(p.name || '').trim().split(/\s+/).pop();
  $('#main').innerHTML = `<form class="card auth-card" id="regForm">
    <h2>Chào ${esc(first || 'bạn')}! Còn một bước nữa</h2>
    <p class="muted">Cho biết đơn vị của bạn để ứng dụng hiện đúng công việc cần cập nhật.</p>
    <label class="field"><span>Họ và tên</span><input type="text" name="name" required maxlength="100" value="${esc(p.name)}" autocomplete="name"></label>
    <label class="field"><span>Số điện thoại <small>(không bắt buộc)</small></span><input type="tel" name="phone" maxlength="30" placeholder="09xx xxx xxx" autocomplete="tel"></label>
    <label class="field"><span>Đơn vị</span><select name="unit">${unitOptions('', 'Không thuộc đơn vị nào (chỉ xem)')}</select></label>
    <div class="note-box" id="regNote">${regNote('')}</div>
    <button class="btn block" type="submit">Bắt đầu sử dụng</button>
    <p class="reg-alt">Đang dùng <b>${esc(p.email)}</b> · <button type="button" class="linkish" data-act="logout">Dùng tài khoản khác</button></p>
  </form>`;
}
const isAdminUnit = (u) => !!u && (S.config.ADMIN_UNITS || []).includes(u);
function regNote(unit) {
  if (isAdminUnit(unit)) return `<b>${esc(unit)}</b> là đơn vị quản trị dự án: tài khoản nhận quyền <b>Quản trị</b> và cần quản trị viên hiện có duyệt trước khi sử dụng.`;
  return S.config.AUTO_APPROVE ? 'Tài khoản được kích hoạt ngay sau khi đăng ký.' : 'Sau khi đăng ký, quản trị viên sẽ duyệt tài khoản trước khi bạn có thể cập nhật số liệu.';
}
function showPending() {
  setChrome(false);
  renderUser();
  $('#main').innerHTML = `<div class="card auth-card">
    <h2>Đã nhận đăng ký của bạn</h2>
    <p class="muted">Tài khoản quản trị cần được duyệt trước khi dùng. Báo quản trị viên PTC3 hoặc Tư vấn giám sát, sau đó bấm “Kiểm tra lại”.</p>
    <button class="btn block" data-act="retry">Kiểm tra lại</button>
    <button class="btn ghost block" data-act="logout">Đăng xuất</button>
  </div>`;
}

async function logout() {
  $('#userMenu').hidden = true;
  if (DEMO) return toast('Bản demo không có đăng nhập – dữ liệu được lưu trên trình duyệt này.', 'info');
  if (!(await confirmBox({ title: 'Đăng xuất?', message: 'Bạn cần đăng nhập Google lại để tiếp tục xem và cập nhật tiến độ.', ok: 'Đăng xuất' }))) return;
  const name = S.user?.name || S.profile?.name || '';
  window.google?.accounts.id.disableAutoSelect();
  stopAutoSync();
  S.user = S.profile = null;
  S.sig = undefined;
  showLogin(`Đã đăng xuất${name ? ' tài khoản ' + name : ''}. Đăng nhập lại để tiếp tục.`, 'ok');
  toast('Đã đăng xuất', 'ok');
}

/* ============================ GIỚI THIỆU & HƯỚNG DẪN ============================ */
const appVersion = () => (document.querySelector('script[src*="app.js"]')?.src.match(/[?&]v=([\w-]+)/) || [])[1] || 'bản cục bộ';
const GUIDE = [
  { id: 'start', title: 'Đăng nhập lần đầu', body: `
    <ol>
      <li>Mở link bằng <b>Chrome</b> (Android) hoặc <b>Safari</b> (iPhone). Không mở trong Zalo, Messenger: Google sẽ chặn đăng nhập.</li>
      <li>Bấm <b>Đăng nhập bằng Google</b> và chọn tài khoản.</li>
      <li>Điền họ tên, số điện thoại, chọn đơn vị rồi bấm <b>Bắt đầu sử dụng</b>.</li>
    </ol>
    <p class="tip">Mở nhanh như ứng dụng: Chrome › <b>⋮</b> › <i>Thêm vào màn hình chính</i>; Safari › <b>Chia sẻ</b> › <i>Thêm vào MH chính</i>.</p>` },
  { id: 'update', title: 'Cập nhật tiến độ', body: `
    <ol>
      <li>Vào tab <b>Cập nhật</b>. Nhà thầu bấm <b>Chỉ việc của …</b> để chỉ thấy việc của đơn vị mình.</li>
      <li>Bấm vào đầu việc cần báo cáo.</li>
      <li>Kéo thanh <b>%</b> hoặc bấm nhanh 25 · 50 · 75 · 100.</li>
      <li>Ghi tình hình hiện trường, chụp hoặc chọn ảnh (tối đa 6).</li>
      <li>Bấm <b>Lưu cập nhật</b>.</li>
    </ol>
    <p class="tip">Đạt 100% thì đầu việc tự chuyển sang <i>Hoàn thành</i>. Việc của đơn vị khác chỉ xem được, không sửa được.</p>` },
  { id: 'report', title: 'Xem tiến độ và báo cáo', body: `
    <ul>
      <li><b>Dashboard</b>: tiến độ thực tế so với kế hoạch, việc chậm, kế hoạch hôm nay. Bấm thẻ hạng mục chính để xem riêng hạng mục đó.</li>
      <li><b>Cập nhật</b>: đổi kiểu xem Danh sách · Ô · Chi tiết · Nội dung; sắp xếp theo <i>Ngày sửa đổi</i> để thấy việc vừa được cập nhật.</li>
      <li><b>Tiến độ</b>: biểu đồ Gantt kế hoạch và thực tế, vạch đỏ là hôm nay.</li>
      <li><b>Nhật ký</b>: chọn ngày để xem ai đã cập nhật gì, bấm <i>In báo cáo ngày</i> hoặc <i>Xuất Excel</i>.</li>
    </ul>` },
  { id: 'admin', title: 'Quản trị (PTC3, Tư vấn giám sát)', body: `
    <ol>
      <li><b>Dự án</b>: tạo dự án, chọn nhà thầu tham gia.</li>
      <li><b>Hạng mục chính</b>: thêm các hạng mục, ví dụ Thay MBA AT1, AT2.</li>
      <li><b>Đầu việc</b>: bấm <i>File mẫu</i>, điền danh sách, rồi <i>Nhập từ Excel</i>; hoặc thêm từng việc.</li>
      <li><b>Người dùng</b>: duyệt tài khoản, đổi vai trò và đơn vị, khóa tài khoản không còn dùng.</li>
    </ol>` },
  { id: 'faq', title: 'Gặp sự cố', body: `
    <dl>
      <dt>Bấm đăng nhập không được trong Zalo?</dt><dd>Mở link bằng Chrome hoặc Safari: bấm ⋮ hoặc ⋯ › <i>Mở bằng trình duyệt</i>.</dd>
      <dt>Số liệu chưa thấy mới?</dt><dd>Bấm nút ⟳ ở góc trên. App cũng tự đồng bộ 5 phút một lần.</dd>
      <dt>Bị yêu cầu đăng nhập lại?</dt><dd>Phiên Google kéo dài khoảng 1 giờ. Đăng nhập lại là xong, dữ liệu đã lưu không mất.</dd>
      <dt>Không thấy nút Lưu cập nhật?</dt><dd>Đầu việc thuộc đơn vị khác hoặc tài khoản chỉ có quyền xem. Liên hệ quản trị viên để được phân công.</dd>
    </dl>` },
];
function guideOpenId() {
  const r = S.user?.role;
  if (!S.user || $('.login, #regForm')) return 'start'; // mở từ màn đăng nhập / đăng ký
  return r === 'admin' || r === 'manager' ? 'admin' : r === 'viewer' ? 'report' : 'update';
}
function openGuide(tab = 'guide') {
  const open = guideOpenId();
  const cp = typeof curProject === 'function' ? curProject() : null;
  openDialog(`
    <div class="dlg-head"><div><h2>Tiến độ hiện trường</h2><small>Giới thiệu và hướng dẫn sử dụng</small></div><button class="x" data-act="close" aria-label="Đóng">×</button></div>
    <div class="dlg-body guide">
      <div class="subtabs" role="tablist">
        <button type="button" role="tab" data-gtab="guide" aria-selected="${tab === 'guide'}" class="${tab === 'guide' ? 'on' : ''}">Hướng dẫn</button>
        <button type="button" role="tab" data-gtab="about" aria-selected="${tab === 'about'}" class="${tab === 'about' ? 'on' : ''}">Giới thiệu</button>
      </div>
      <div data-gpanel="guide" ${tab === 'guide' ? '' : 'hidden'}>
        ${GUIDE.filter((g) => g.id !== 'admin' || !S.user || isManager()).map((g) => `<details ${g.id === open ? 'open' : ''}><summary>${g.title}</summary><div class="g-body">${g.body}</div></details>`).join('')}
      </div>
      <div data-gpanel="about" ${tab === 'about' ? '' : 'hidden'}>
        <p>Ứng dụng giúp các đơn vị tham gia dự án lưới điện truyền tải báo cáo tiến độ thi công ngay tại công trường, thay cho việc gửi file Excel qua lại.</p>
        <ul>
          <li><b>Nhà thầu</b> cập nhật % hoàn thành, ghi chú và ảnh cho đầu việc của đơn vị mình.</li>
          <li><b>PTC3 và Tư vấn giám sát</b> theo dõi dashboard, Gantt, nhật ký; quản lý dự án, nhà thầu, đầu việc.</li>
          <li>Dữ liệu lưu trên Google Sheet của dự án. Ảnh hiện trường lưu trong Google Drive, chỉ người đã đăng nhập mới xem được.</li>
        </ul>
        <dl class="about-meta">
          ${cp ? `<dt>Dự án đang mở</dt><dd>${esc(cp.name)}</dd>` : ''}
          ${S.user ? `<dt>Tài khoản</dt><dd>${esc(S.user.name)} – ${esc(ROLES[S.user.role] || S.user.role)}${S.user.unit ? ', ' + esc(S.user.unit) : ''}</dd>` : ''}
          <dt>Hỗ trợ</dt><dd>Quản trị viên PTC3 hoặc Tư vấn giám sát của dự án</dd>
          <dt>Phiên bản</dt><dd>${esc(appVersion())}</dd>
        </dl>
      </div>
    </div>
    <div class="dlg-foot"><button class="btn" data-act="close">Đã hiểu</button></div>`);
  $$('#dlgBody [data-gtab]').forEach((b) => {
    b.onclick = () => {
      $$('#dlgBody [data-gtab]').forEach((x) => { const on = x === b; x.classList.toggle('on', on); x.setAttribute('aria-selected', on); });
      $$('#dlgBody [data-gpanel]').forEach((p) => { p.hidden = p.dataset.gpanel !== b.dataset.gtab; });
    };
  });
}

/* ============================ BÁO CÁO TIẾN ĐỘ (DOCX) – chỉ Quản trị ============================ */
const DOCX_URL = 'https://cdn.jsdelivr.net/npm/docx@8.5.0/build/index.umd.js';
let docxLoading = null;
function loadDocx() {
  if (window.docx) return Promise.resolve(window.docx);
  docxLoading ||= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = DOCX_URL;
    s.onload = () => (window.docx ? resolve(window.docx) : reject(new Error('Thư viện DOCX không khởi tạo được')));
    s.onerror = () => { docxLoading = null; reject(new Error('Không tải được thư viện tạo file Word. Kiểm tra mạng rồi thử lại.')); };
    document.head.appendChild(s);
  });
  return docxLoading;
}

// Mở/ẩn nút Báo cáo: bấm 3 lần liên tiếp vào tên tab Quản trị (chỉ tài khoản Quản trị)
let adminTabClicks = [];
document.addEventListener('click', (e) => {
  if (!e.target.closest('#tabAdmin') || S.user?.role !== 'admin') return;
  const now = Date.now();
  adminTabClicks = adminTabClicks.filter((x) => now - x < 900).concat(now);
  if (adminTabClicks.length >= 3) {
    adminTabClicks = [];
    S.reportUnlocked = !S.reportUnlocked;
    toast(S.reportUnlocked ? 'Đã mở chức năng Báo cáo tiến độ' : 'Đã ẩn chức năng Báo cáo', 'info');
    setTimeout(() => { if (S.view === 'admin') rerender(); }, 0);
  }
});

/* ---------- Tính trạng thái tại thời điểm báo cáo ---------- */
const effTime = (u) => (u.report_date && u.report_date < String(u.ts).slice(0, 10) ? `${u.report_date}T23:59` : String(u.ts).slice(0, 16));
/** Đầu việc "như tại thời điểm cut" (chuỗi yyyy-mm-ddThh:mm). */
function taskAsOf(t, cut, hist) {
  const h = (hist.get(t.id) || []).filter((u) => effTime(u) <= cut);
  const withP = h.filter((u) => u.progress !== '' && u.progress != null);
  let progress;
  if (withP.length) progress = +withP[withP.length - 1].progress || 0;
  else if (t.actual_end && t.actual_end <= cut) progress = 100;
  else if (t.actual_start && t.actual_start <= cut) {
    // không có lịch sử % (dữ liệu nhập từ Excel): đã xong sau thời điểm báo cáo -> ước tính tuyến tính
    const s0 = parseD(t.actual_start), e0 = parseD(t.actual_end), c0 = parseD(cut);
    progress = +t.progress >= 100 && e0 && e0 > s0 ? Math.min(99, Math.round(((c0 - s0) / (e0 - s0)) * 100)) : +t.progress || 0;
  } else progress = 0;
  const last = h[h.length - 1];
  return {
    ...t, progress,
    status: last?.status || (progress >= 100 ? 'Hoàn thành' : progress > 0 ? 'Đang thi công' : ''),
    actual_start: t.actual_start && t.actual_start <= cut ? t.actual_start : (progress > 0 ? t.actual_start : ''),
    actual_end: progress >= 100 && t.actual_end && t.actual_end <= cut ? t.actual_end : '',
    lastNote: [...h].reverse().find((u) => u.note)?.note || '',
  };
}
function buildReport(opt) {
  const cut = opt.cut, cutD = parseD(cut);
  const hist = new Map();
  [...S.updates].sort((a, b) => (effTime(a) < effTime(b) ? -1 : 1)).forEach((u) => { if (!hist.has(u.task_id)) hist.set(u.task_id, []); hist.get(u.task_id).push(u); });
  const all = projTasks().filter((t) => inPkg(t, opt.pkg)).map((t) => taskAsOf(t, cut, hist));
  const planned = all.filter((t) => t.plan_start);
  const cls = (t) => klass(t, cutD);
  const sum = (list) => {
    const c = Object.fromEntries(Object.keys(CLS).map((k) => [k, 0]));
    list.forEach((t) => c[cls(t)]++);
    return {
      n: list.length, c,
      actual: weightedPct(list, (t) => t.progress / 100),
      plan: weightedPct(list.filter((t) => t.plan_start), (t) => planFrac(t, cutD)),
      actualPlanned: weightedPct(list.filter((t) => t.plan_start), (t) => t.progress / 100),
    };
  };
  const groupBy = (keyFn, labelFn) => {
    const m = new Map();
    all.forEach((t) => { const k = keyFn(t); if (!m.has(k)) m.set(k, []); m.get(k).push(t); });
    return [...m].map(([k, list]) => ({ label: labelFn(k), ...sum(list) }));
  };
  const late = all.filter((t) => cls(t) === 'late').map((t) => ({ t, over: planEnd(t) && cutD > planEnd(t) ? Math.ceil((cutD - planEnd(t)) / DAY) : 0 })).sort((a, b) => b.over - a.over);
  const from = opt.logDays > 0 ? dtstr(new Date(cutD.getTime() - opt.logDays * DAY)) : null;
  const ids = new Set(all.map((t) => t.id));
  const log = from ? S.updates.filter((u) => ids.has(u.task_id) && effTime(u) > from && effTime(u) <= cut).sort((a, b) => (effTime(a) < effTime(b) ? -1 : 1)) : [];
  const p = curProject(), k = opt.pkg ? pkgById(opt.pkg) : null;
  return {
    project: p, pkg: k, cut, created: new Date(), author: S.user?.name || '', total: sum(all), planned: planned.length,
    byPkg: projPackages().length && !opt.pkg ? groupBy((t) => t.package_id || '', (id) => (pkgById(id) ? `${pkgById(id).code} – ${pkgById(id).name}` : '(Chưa phân hạng mục)')) : [],
    bySec: groupBy((t) => `${pkgCode(t)}|${t.section || 'Khác'}`, (key) => { const [pc, s] = key.split('|'); return (pc && !opt.pkg ? pc + ' › ' : '') + s; }),
    byUnit: groupBy((t) => t.unit || '', (u) => u || '(Chưa gán nhà thầu)'),
    late, log, tasks: all, opt,
  };
}

/* ---------- Xem trước (HTML) ---------- */
const pct = (x) => `${(+x).toFixed(1)}%`;
const dev = (r) => { const d = r.actualPlanned - r.plan; return `${d >= 0 ? '+' : ''}${d.toFixed(1)}%`; };
const fmtFull = (s) => { const d = parseD(s); return d ? `${pad(d.getHours())}:${pad(d.getMinutes())} ngày ${pad(d.getDate())}/${pad(d.getMonth() + 1)}/${d.getFullYear()}` : ''; };
function reportSections(R) {
  const o = R.opt, sec = [];
  sec.push({ title: 'Tổng quan', kind: 'summary' });
  if (R.byPkg.length) sec.push({ title: 'Tiến độ theo hạng mục chính', kind: 'groups', rows: R.byPkg });
  if (o.secGroups) sec.push({ title: 'Tiến độ theo phần việc', kind: 'groups', rows: R.bySec });
  if (o.secUnits) sec.push({ title: 'Tiến độ theo nhà thầu', kind: 'groups', rows: R.byUnit });
  if (o.secLate) sec.push({ title: `Đầu việc chậm tiến độ (${R.late.length})`, kind: 'late' });
  if (o.secDetail) sec.push({ title: 'Chi tiết tiến độ từng đầu việc', kind: 'detail' });
  if (o.logDays > 0) sec.push({ title: `Nhật ký hiện trường ${o.logDays} ngày gần nhất (${R.log.length} lượt)`, kind: 'log' });
  const ROMAN = ['I', 'II', 'III', 'IV', 'V', 'VI', 'VII', 'VIII'];
  return sec.map((s, i) => ({ ...s, no: ROMAN[i] }));
}
const GROUP_HEAD = ['Hạng mục', 'Số việc', 'KH đến kỳ', 'Thực tế', 'Chênh lệch', 'Hoàn thành', 'Chậm'];
const groupRow = (g) => [g.label, g.n, pct(g.plan), pct(g.actual), dev(g), g.c.done, g.c.late];
const LATE_HEAD = ['WBS', 'Pha', 'Đầu việc', 'Nhà thầu', 'KT kế hoạch', '% TT', 'Quá hạn', 'Ghi chú gần nhất'];
const lateRow = ({ t, over }) => [t.wbs, t.phase, t.name, t.unit || '—', fmtD(t.plan_end), `${t.progress}%`, over ? `${over} ngày` : 'Chưa triển khai', t.lastNote];
const DETAIL_HEAD = ['WBS', 'Pha', 'Đầu việc', 'Nhà thầu', 'BĐ KH', 'KT KH', 'BĐ TT', 'KT TT', '%', 'Tình trạng'];
const detailRow = (t, cutD) => [t.wbs, t.phase, t.name, t.unit || '—', fmtD(t.plan_start), fmtD(t.plan_end), fmtD(t.actual_start, false), fmtD(t.actual_end, false), `${t.progress}%`, CLS[klass(t, cutD)].label];
const LOG_HEAD = ['Thời điểm', 'Đầu việc', 'Đơn vị', 'Người cập nhật', '%', 'Nội dung'];
const logRow = (u) => { const t = taskById(u.task_id); return [fmtTs(u.ts), t ? `${taskLabel(t)} ${t.name}` : u.task_id, u.unit || t?.unit || '', u.user_name || u.email, u.progress === '' || u.progress == null ? '' : `${u.progress}%`, u.note]; };
function detailGroups(R) {
  const m = new Map();
  R.tasks.forEach((t) => { const k = `${pkgCode(t)}|${t.section || 'Khác'}`; if (!m.has(k)) m.set(k, []); m.get(k).push(t); });
  return [...m].map(([k, list]) => { const [pc, s] = k.split('|'); return { label: (pc && !R.pkg ? pc + ' › ' : '') + s, list }; });
}
function reportHtml(R) {
  const cutD = parseD(R.cut);
  const tbl = (head, rows, cls = '') => `<table class="rp-t ${cls}"><thead><tr>${head.map((h) => `<th>${esc(h)}</th>`).join('')}</tr></thead><tbody>${rows.map((r) => `<tr>${r.map((c) => `<td>${esc(c)}</td>`).join('')}</tr>`).join('') || `<tr><td colspan="${head.length}" class="rp-empty">Không có</td></tr>`}</tbody></table>`;
  const body = reportSections(R).map((s) => {
    let h = `<h2>${s.no}. ${esc(s.title)}</h2>`;
    if (s.kind === 'summary') {
      const T = R.total;
      h += `<p>Tính đến ${esc(fmtFull(R.cut))}, ${esc(R.pkg ? 'hạng mục ' + R.pkg.name : 'dự án')} có <b>${T.n}</b> đầu việc (${R.planned} việc có kế hoạch). Tiến độ thực tế đạt <b>${pct(T.actual)}</b>; với các việc có kế hoạch, thực tế <b>${pct(T.actualPlanned)}</b> so với kế hoạch đến kỳ <b>${pct(T.plan)}</b> (chênh lệch <b>${dev(T)}</b>).</p>`;
      h += tbl(['Hoàn thành', 'Đang thi công', 'Chậm tiến độ', 'Tạm dừng', 'Chưa đến hạn', 'Chưa có kế hoạch'], [[T.c.done, T.c.doing, T.c.late, T.c.paused, T.c.todo, T.c.unplanned]]);
    } else if (s.kind === 'groups') h += tbl(GROUP_HEAD, s.rows.map(groupRow));
    else if (s.kind === 'late') h += tbl(LATE_HEAD, R.late.map(lateRow), 'rp-small');
    else if (s.kind === 'detail') h += detailGroups(R).map((g) => `<h3>${esc(g.label)}</h3>${tbl(DETAIL_HEAD, g.list.map((t) => detailRow(t, cutD)), 'rp-small')}`).join('');
    else if (s.kind === 'log') h += tbl(LOG_HEAD, R.log.map(logRow), 'rp-small');
    return h;
  }).join('');
  return `<article class="rp-page">
    <header class="rp-head"><div>${esc(R.project?.owner || '')}</div><div>Ngày lập: ${pad(R.created.getDate())}/${pad(R.created.getMonth() + 1)}/${R.created.getFullYear()}</div></header>
    <h1>BÁO CÁO TIẾN ĐỘ THI CÔNG</h1>
    <p class="rp-sub">Dự án: <b>${esc(R.project?.name || '')}</b>${R.pkg ? `<br>Hạng mục chính: <b>${esc(R.pkg.code)} – ${esc(R.pkg.name)}</b>` : ''}<br>Số liệu tính đến: <b>${esc(fmtFull(R.cut))}</b></p>
    ${body}
    <table class="rp-sign"><tr><td><b>NGƯỜI LẬP</b><br><br><br><br>${esc(R.author)}</td><td><b>XÁC NHẬN</b><br><br><br><br>&nbsp;</td></tr></table>
  </article>`;
}

/* ---------- Tạo DOCX ---------- */
async function reportDocx(R) {
  const d = await loadDocx();
  const { Document, Packer, Paragraph, TextRun, Table, TableRow, TableCell, WidthType, AlignmentType, HeadingLevel, PageOrientation, BorderStyle, ShadingType, Header, Footer, PageNumber } = d;
  const cutD = parseD(R.cut);
  const F = 'Times New Roman';
  const P = (text, o = {}) => new Paragraph({ alignment: o.align, spacing: { after: o.after ?? 120, before: o.before ?? 0 }, heading: o.heading,
    children: (Array.isArray(text) ? text : [text]).map((x) => (typeof x === 'string' ? new TextRun({ text: x, font: F, size: o.size || 24, bold: o.bold }) : x)) });
  const B = (text) => new TextRun({ text: String(text), font: F, size: 24, bold: true });
  const cell = (text, o = {}) => new TableCell({
    shading: o.head ? { type: ShadingType.CLEAR, color: 'auto', fill: 'DCE3F0' } : undefined,
    columnSpan: o.span,
    margins: { top: 40, bottom: 40, left: 80, right: 80 },
    children: [new Paragraph({ alignment: o.align, children: [new TextRun({ text: String(text ?? ''), font: F, size: o.size || 20, bold: o.head || o.bold })] })],
  });
  const table = (head, rows, size = 20, widths) => new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    columnWidths: widths,
    rows: [new TableRow({ tableHeader: true, children: head.map((h) => cell(h, { head: true, size, align: AlignmentType.CENTER })) }),
      ...(rows.length ? rows.map((r) => new TableRow({ cantSplit: true, children: r.map((c) => cell(c, { size })) }))
        : [new TableRow({ children: [cell('Không có', { span: head.length, size })] })])],
  });
  const H = (text) => P(text, { bold: true, size: 26, before: 240, after: 120, heading: HeadingLevel.HEADING_2 });
  const children = [
    P(R.project?.owner || '', { size: 22, after: 0 }),
    P(`Ngày lập: ${pad(R.created.getDate())}/${pad(R.created.getMonth() + 1)}/${R.created.getFullYear()}`, { size: 22, align: AlignmentType.RIGHT }),
    P('BÁO CÁO TIẾN ĐỘ THI CÔNG', { bold: true, size: 32, align: AlignmentType.CENTER, before: 240, after: 120 }),
    P(['Dự án: ', B(R.project?.name || '')], { align: AlignmentType.CENTER, after: 40 }),
    ...(R.pkg ? [P(['Hạng mục chính: ', B(`${R.pkg.code} – ${R.pkg.name}`)], { align: AlignmentType.CENTER, after: 40 })] : []),
    P(['Số liệu tính đến: ', B(fmtFull(R.cut))], { align: AlignmentType.CENTER, after: 240 }),
  ];
  reportSections(R).forEach((s) => {
    children.push(H(`${s.no}. ${s.title}`));
    if (s.kind === 'summary') {
      const T = R.total;
      children.push(P([`Tính đến ${fmtFull(R.cut)}, ${R.pkg ? 'hạng mục ' + R.pkg.name : 'dự án'} có `, B(T.n), ` đầu việc (${R.planned} việc có kế hoạch). Tiến độ thực tế đạt `, B(pct(T.actual)),
        '; với các việc có kế hoạch, thực tế ', B(pct(T.actualPlanned)), ' so với kế hoạch đến kỳ ', B(pct(T.plan)), ' (chênh lệch ', B(dev(T)), ').'], { align: AlignmentType.JUSTIFIED }));
      children.push(table(['Hoàn thành', 'Đang thi công', 'Chậm tiến độ', 'Tạm dừng', 'Chưa đến hạn', 'Chưa có kế hoạch'], [[T.c.done, T.c.doing, T.c.late, T.c.paused, T.c.todo, T.c.unplanned]], 22));
    } else if (s.kind === 'groups') children.push(table(GROUP_HEAD, s.rows.map(groupRow), 20));
    else if (s.kind === 'late') children.push(table(LATE_HEAD, R.late.map(lateRow), 18));
    else if (s.kind === 'detail') {
      detailGroups(R).forEach((g) => {
        children.push(P(g.label, { bold: true, size: 22, before: 160, after: 80 }));
        children.push(table(DETAIL_HEAD, g.list.map((t) => detailRow(t, cutD)), 17));
      });
    } else if (s.kind === 'log') children.push(table(LOG_HEAD, R.log.map(logRow), 18));
  });
  const noBorder = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' };
  const nb = { top: noBorder, bottom: noBorder, left: noBorder, right: noBorder, insideHorizontal: noBorder, insideVertical: noBorder };
  const signCell = (title, name) => new TableCell({ borders: nb, children: [P(title, { bold: true, align: AlignmentType.CENTER, after: 900 }), P(name, { bold: true, align: AlignmentType.CENTER })] });
  children.push(P('', { after: 240 }));
  children.push(new Table({ width: { size: 100, type: WidthType.PERCENTAGE }, borders: nb, rows: [new TableRow({ children: [signCell('NGƯỜI LẬP', R.author), signCell('XÁC NHẬN', '')] })] }));
  const doc = new Document({
    creator: R.author, title: 'Báo cáo tiến độ thi công', description: R.project?.name,
    styles: {
      default: { document: { run: { font: F, size: 24 } } },
      // mục lớn hiện trong khung Navigation của Word
      paragraphStyles: [{ id: 'Heading2', name: 'Heading 2', basedOn: 'Normal', next: 'Normal', quickFormat: true,
        run: { font: F, size: 26, bold: true, color: '000000' }, paragraph: { spacing: { before: 240, after: 120 }, keepNext: true } }],
    },
    sections: [{
      properties: { page: { size: { orientation: R.opt.landscape ? PageOrientation.LANDSCAPE : PageOrientation.PORTRAIT }, margin: { top: 1134, bottom: 1134, left: 1418, right: 1134 } } },
      headers: { default: new Header({ children: [P(`${R.project?.name || ''} – Báo cáo tiến độ đến ${fmtFull(R.cut)}`, { size: 18, align: AlignmentType.RIGHT, after: 0 })] }) },
      footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ children: ['Trang ', PageNumber.CURRENT, ' / ', PageNumber.TOTAL_PAGES], font: F, size: 18 })] })] }) },
      children,
    }],
  });
  return Packer.toBlob(doc);
}

/* ---------- Lưu vào thư mục trên máy (File System Access API) ---------- */
const canPickDir = () => typeof window.showDirectoryPicker === 'function';
function idb(mode, fn) {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('dl_report', 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onerror = () => reject(req.error);
    req.onsuccess = () => {
      try {
        const tx = req.result.transaction('kv', mode), st = tx.objectStore('kv');
        const r = fn(st);
        tx.oncomplete = () => resolve(r?.result);
        tx.onerror = () => reject(tx.error);
      } catch (e) { reject(e); }
    };
  });
}
async function savedDir() { try { return await idb('readonly', (st) => st.get('dir')); } catch { return null; } }
async function pickDir() {
  const h = await window.showDirectoryPicker({ id: 'bao-cao-tien-do', mode: 'readwrite' });
  try { await idb('readwrite', (st) => st.put(h, 'dir')); } catch { /* không lưu được thì lần sau hỏi lại */ }
  return h;
}
async function saveReportFile(blob, name) {
  if (!canPickDir()) {
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 4000);
    return { where: 'thư mục Tải xuống (Downloads) của trình duyệt' };
  }
  let dir = await savedDir();
  if (dir && (await dir.queryPermission({ mode: 'readwrite' })) !== 'granted' && (await dir.requestPermission({ mode: 'readwrite' })) !== 'granted') dir = null;
  if (!dir) dir = await pickDir();
  const fh = await dir.getFileHandle(name, { create: true });
  const w = await fh.createWritable();
  await w.write(blob);
  await w.close();
  return { where: `thư mục “${dir.name}”` };
}

/* ---------- Hộp thoại báo cáo ---------- */
function openReport() {
  if (S.user?.role !== 'admin') return toast('Chỉ tài khoản Quản trị được xuất báo cáo', 'err');
  const now = new Date();
  const o = S.reportOpt ||= { cut: dtstr(now), pkg: S.filters.pkg && S.filters.pkg !== '__none' ? S.filters.pkg : '', secGroups: true, secUnits: true, secLate: true, secDetail: true, logDays: 7, landscape: true };
  openDialog(`
    <div class="dlg-head"><div><h2>Báo cáo tiến độ thi công</h2><small>${esc(curProject()?.name || '')}</small></div><button class="x" data-act="close" aria-label="Đóng">×</button></div>
    <div class="dlg-body rp-wrap">
      <form class="rp-opts" id="rpForm">
        <label class="field"><span>Số liệu tính đến</span><input type="datetime-local" name="cut" value="${esc(o.cut)}" max="${esc(dtstr(now))}" required></label>
        ${projPackages().length ? `<label class="field"><span>Phạm vi</span><select name="pkg">${pkgOptions(o.pkg, 'Toàn dự án')}</select></label>` : ''}
        <label class="field"><span>Nhật ký hiện trường</span><select name="logDays">${[[0, 'Không đưa vào'], [1, '1 ngày gần nhất'], [7, '7 ngày gần nhất'], [30, '30 ngày gần nhất']].map(([v, l]) => `<option value="${v}" ${+o.logDays === v ? 'selected' : ''}>${l}</option>`).join('')}</select></label>
        <fieldset><legend>Nội dung</legend>
          <label class="chk"><input type="checkbox" name="secGroups" ${o.secGroups ? 'checked' : ''}> Theo phần việc</label>
          <label class="chk"><input type="checkbox" name="secUnits" ${o.secUnits ? 'checked' : ''}> Theo nhà thầu</label>
          <label class="chk"><input type="checkbox" name="secLate" ${o.secLate ? 'checked' : ''}> Việc chậm tiến độ</label>
          <label class="chk"><input type="checkbox" name="secDetail" ${o.secDetail ? 'checked' : ''}> Chi tiết từng đầu việc</label>
          <label class="chk"><input type="checkbox" name="landscape" ${o.landscape ? 'checked' : ''}> Trang ngang (A4)</label>
        </fieldset>
        <div class="rp-save"><small id="rpDir">${canPickDir() ? 'Lưu vào thư mục bạn chọn trên máy' : 'Trình duyệt này lưu vào thư mục Tải xuống'}</small>
          ${canPickDir() ? '<button type="button" class="linkish" id="rpPickDir">Chọn thư mục lưu…</button>' : ''}</div>
      </form>
      <div class="rp-preview" id="rpPreview" aria-label="Xem trước báo cáo"></div>
    </div>
    <div class="dlg-foot"><button class="btn ghost" data-act="close">Đóng</button><button class="btn" id="rpExport" data-own-busy>Xuất file Word (.docx)</button></div>`);
  $('#dlg').classList.add('wide');
  $('#dlg').addEventListener('close', () => $('#dlg').classList.remove('wide'), { once: true });
  const form = $('#rpForm');
  const read = () => {
    const f = Object.fromEntries(new FormData(form));
    Object.assign(o, { cut: f.cut || dtstr(now), pkg: f.pkg || '', logDays: +f.logDays || 0,
      secGroups: !!f.secGroups, secUnits: !!f.secUnits, secLate: !!f.secLate, secDetail: !!f.secDetail, landscape: !!f.landscape });
    return o;
  };
  const preview = () => {
    const R = buildReport(read());
    $('#rpPreview').innerHTML = reportHtml(R);
    $('#rpPreview').classList.toggle('landscape', o.landscape);
    return R;
  };
  form.onchange = preview;
  form.oninput = (e) => { if (e.target.name === 'cut') preview(); };
  preview();
  loadDocx().catch(() => {}); // tải sẵn thư viện trong lúc xem trước
  savedDir().then((h) => { if (h && $('#rpDir')) $('#rpDir').textContent = `Lưu vào thư mục “${h.name}”`; });
  $('#rpPickDir')?.addEventListener('click', async () => {
    try { const h = await pickDir(); $('#rpDir').textContent = `Lưu vào thư mục “${h.name}”`; } catch { /* người dùng hủy */ }
  });
  $('#rpExport').onclick = async () => {
    if (!form.reportValidity()) return;
    const btn = $('#rpExport');
    btn.disabled = true; btn.classList.add('busy');
    try {
      const R = preview();
      const blob = await reportDocx(R);
      const c = R.cut.replace(/[-:]/g, '').replace('T', '_');
      const name = `BaoCao_TienDo_${fileTag()}${R.pkg ? '_' + String(R.pkg.code || R.pkg.id).replace(/[^\w-]+/g, '_') : ''}_${c}.docx`;
      const r = await saveReportFile(blob, name);
      toast(`Đã lưu ${name} vào ${r.where}`, 'ok');
    } catch (e) {
      if (e?.name !== 'AbortError') toast(e.message || 'Không xuất được báo cáo', 'err');
    } finally { btn.disabled = false; btn.classList.remove('busy'); }
  };
}

/* ============================ ROUTER ============================ */
function go(view) {
  if (view === 'admin' && !isManager()) view = 'dashboard';
  S.view = view;
  $$('#tabs button').forEach((b) => b.classList.toggle('active', b.dataset.view === view));
  destroyCharts();
  if (!curProject() && view !== 'admin') { $('#main').innerHTML = noProjectHtml(); return; }
  ({ dashboard: renderDashboard, field: renderField, gantt: renderGantt, log: renderLog, admin: renderAdmin })[view]();
  window.scrollTo({ top: 0 });
}
const rerender = () => go(S.view);

/* ============================ DASHBOARD ============================ */
function renderDashboard() {
  const now = new Date();
  const ts = filtered({ cls: '' });
  const cnt = Object.fromEntries(Object.keys(CLS).map((k) => [k, 0]));
  ts.forEach((t) => cnt[klass(t, now)]++);
  const actual = weightedPct(ts, (t) => t.progress / 100);
  const planned = weightedPct(ts.filter((t) => t.plan_start), (t) => planFrac(t, now));
  const actualPlanned = weightedPct(ts.filter((t) => t.plan_start), (t) => t.progress / 100);
  const dev = actualPlanned - planned;
  const todayUps = S.updates.filter((u) => u.report_date === today() && ts.some((t) => t.id === u.task_id));
  const late = ts.filter((t) => klass(t, now) === 'late')
    .map((t) => ({ t, over: planEnd(t) && now > planEnd(t) ? Math.ceil((now - planEnd(t)) / DAY) : 0 }))
    .sort((a, b) => b.over - a.over);
  const t0 = dayStart(now), t1 = new Date(t0.getTime() + 2 * DAY);
  const upcoming = ts.filter((t) => { const s = parseD(t.plan_start), e = planEnd(t); return s && s < t1 && e > t0 && t.progress < 100; })
    .sort((a, b) => (a.plan_start < b.plan_start ? -1 : 1));
  const recent = S.updates.filter((u) => ts.some((t) => t.id === u.task_id)).sort((a, b) => (a.ts < b.ts ? 1 : -1)).slice(0, 12);

  const phaseRows = ['A', 'B', 'C'].map((p) => {
    const pt = ts.filter((t) => String(t.phase).includes(p));
    const a = weightedPct(pt, (t) => t.progress / 100), pl = weightedPct(pt.filter((t) => t.plan_start), (t) => planFrac(t, now));
    return `<div class="meter-row"><span>Pha ${p} <small>(${pt.length})</small></span>
      <div class="stack" title="Kế hoạch ${pl.toFixed(0)}% · Thực tế ${a.toFixed(0)}%"><div class="p" style="width:${pl}%"></div><div class="a" style="width:${a}%"></div></div><b>${a.toFixed(0)}%</b></div>`;
  }).join('');

  $('#main').innerHTML = `
  <div class="toolbar"><h2>Tổng quan tiến độ</h2>
    <button class="btn ghost sm no-print" data-act="export-tasks">⬇ Xuất Excel</button>
    <button class="btn ghost sm no-print" data-act="sync">⟳ Đồng bộ</button></div>
  ${filterBar({ cls: false })}
  <div class="kpis">
    <div class="kpi big"><div class="lbl">Tiến độ thực tế (gia quyền)</div><div class="val">${actual.toFixed(1)}%</div>
      <div class="sub">Kế hoạch đến nay ${planned.toFixed(1)}% · <span class="${dev < 0 ? 'delta-neg' : 'delta-pos'}">${dev >= 0 ? '+' : ''}${dev.toFixed(1)}%</span></div></div>
    <div class="kpi" style="--k:var(--ok)"><div class="lbl">Hoàn thành</div><div class="val">${cnt.done}<small style="font-size:.9rem"> / ${ts.length}</small></div><div class="sub">công việc</div></div>
    <div class="kpi" style="--k:var(--doing)"><div class="lbl">Đang thi công</div><div class="val">${cnt.doing}</div><div class="sub">${cnt.paused} tạm dừng</div></div>
    <div class="kpi" style="--k:var(--late)"><div class="lbl">Chậm tiến độ</div><div class="val">${cnt.late}</div><div class="sub">quá hạn / chưa triển khai</div></div>
    <div class="kpi" style="--k:var(--todo)"><div class="lbl">Chưa đến hạn</div><div class="val">${cnt.todo}</div><div class="sub">${cnt.unplanned} chưa có kế hoạch</div></div>
    <div class="kpi" style="--k:var(--accent)"><div class="lbl">Cập nhật hôm nay</div><div class="val">${todayUps.length}</div><div class="sub">${new Set(todayUps.map((u) => u.unit).filter(Boolean)).size} đơn vị báo cáo</div></div>
  </div>
  ${packageCards(now)}
  <div class="grid g-21">
    <div class="card"><div class="card-head"><h3>Đường cong S – Kế hoạch & thực tế lũy kế</h3><small>% khối lượng gia quyền theo số ngày</small></div><div class="chart-box tall"><canvas id="chS"></canvas></div></div>
    <div class="card"><div class="card-head"><h3>Tình trạng công việc</h3></div><div class="chart-box tall"><canvas id="chStatus"></canvas></div></div>
  </div>
  <div class="grid g-11">
    <div class="card"><div class="card-head"><h3>Tiến độ theo phần việc</h3><small>Kế hoạch đến nay vs thực tế</small></div><div class="chart-box tall"><canvas id="chSec"></canvas></div></div>
    <div class="card"><div class="card-head"><h3>Theo đơn vị thi công</h3><small>Số công việc theo tình trạng</small></div><div class="chart-box tall"><canvas id="chUnit"></canvas></div></div>
  </div>
  <div class="grid g-111">
    <div class="card"><div class="card-head"><h3>Tiến độ theo pha MBA</h3></div>${phaseRows}
      <div class="legend" style="margin-top:12px"><span><i style="background:var(--plan)"></i>Kế hoạch đến nay</span><span><i style="background:var(--doing)"></i>Thực tế</span></div></div>
    <div class="card"><div class="card-head"><h3>Việc chậm tiến độ</h3><span class="pill c-late">${late.length}</span></div>
      <div class="list scroll-y">${late.length ? late.slice(0, 40).map(({ t, over }) => `
        <div class="list-item" data-task="${t.id}" style="cursor:pointer"><div class="row"><span class="tag">${esc(taskLabel(t))}</span>${t.unit ? `<span class="tag unit">${esc(t.unit)}</span>` : ''}${over ? `<span class="tag warn">Quá hạn ${over} ngày</span>` : '<span class="tag warn">Chưa triển khai</span>'}</div>
        <div class="t">${esc(t.name)}</div><small>KH ${fmtD(t.plan_start)} → ${fmtD(t.plan_end)} · thực tế ${t.progress}%</small></div>`).join('') : '<div class="empty">Không có việc chậm 🎉</div>'}</div></div>
    <div class="card"><div class="card-head"><h3>Kế hoạch hôm nay & ngày mai</h3><span class="pill c-doing">${upcoming.length}</span></div>
      <div class="list scroll-y">${upcoming.length ? upcoming.map((t) => `
        <div class="list-item" data-task="${t.id}" style="cursor:pointer"><div class="row"><span class="tag">${esc(taskLabel(t))}</span>${t.unit ? `<span class="tag unit">${esc(t.unit)}</span>` : ''}${pill(klass(t, now))}</div>
        <div class="t">${esc(t.name)}</div><small>${fmtD(t.plan_start)} → ${fmtD(t.plan_end)} · ${t.progress}%</small></div>`).join('') : '<div class="empty">Không có công việc theo kế hoạch</div>'}</div></div>
  </div>
  <div class="card"><div class="card-head"><h3>Cập nhật hiện trường mới nhất</h3><button class="btn ghost sm" data-go="log">Xem nhật ký</button></div>
    <div class="list">${recent.length ? recent.map(updateItem).join('') : '<div class="empty">Chưa có cập nhật</div>'}</div></div>`;

  drawDashboardCharts(ts, now);
}

function packageCards(now) {
  const pk = projPackages();
  if (!pk.length) return '';
  const all = projTasks();
  return `<div class="card" style="margin-bottom:14px"><div class="card-head"><h3>Hạng mục chính</h3><small>Bấm vào hạng mục để lọc toàn bộ báo cáo</small></div>
    <div class="pkg-grid">${pk.map((k) => {
      const ts = all.filter((t) => t.package_id === k.id);
      const a = weightedPct(ts, (t) => t.progress / 100), pl = weightedPct(ts.filter((t) => t.plan_start), (t) => planFrac(t, now));
      const late = ts.filter((t) => klass(t, now) === 'late').length;
      return `<button type="button" class="pkg ${S.filters.pkg === k.id ? 'on' : ''}" data-pkg="${k.id}" aria-pressed="${S.filters.pkg === k.id}">
        <div class="row"><span class="tag unit">${esc(k.code || '—')}</span><span class="tag">${esc(k.status)}</span>${late ? `<span class="tag warn">${late} chậm</span>` : ''}</div>
        <div class="name">${esc(k.name)}</div>
        <div class="meter-row" style="grid-template-columns:1fr 46px;margin:2px 0" title="Kế hoạch ${pl.toFixed(0)}% · Thực tế ${a.toFixed(1)}%"><div class="stack"><div class="p" style="width:${pl}%"></div><div class="a" style="width:${a}%"></div></div><b>${a.toFixed(0)}%</b></div>
        <small class="muted">${ts.length} đầu việc · ${fmtDate(k.start_date)} → ${fmtDate(k.end_date)}</small></button>`;
    }).join('')}</div></div>`;
}

function updateItem(u) {
  const t = taskById(u.task_id);
  const nPh = u.photos ? u.photos.split(',').filter(Boolean).length : 0;
  return `<div class="list-item"><div class="row"><b>${esc(u.user_name || u.email)}</b>${u.unit ? `<span class="tag unit">${esc(u.unit)}</span>` : ''}<small>${fmtTs(u.ts)}${u.report_date && u.report_date !== String(u.ts).slice(0, 10) ? ' · BC ngày ' + fmtD(u.report_date) : ''}</small></div>
    <div class="t" data-task="${esc(u.task_id)}" style="cursor:pointer">${t ? `<span class="tag">${esc(taskLabel(t))}</span> ${esc(t.name)}` : esc(u.task_id)}</div>
    ${u.note ? `<div>${esc(u.note)}</div>` : ''}
    <div class="row">${u.progress !== '' && u.progress != null ? `<span class="tag">${u.progress}%</span>` : ''}${u.status ? `<span class="tag">${esc(u.status)}</span>` : ''}${nPh ? `<button class="btn ghost sm" data-photos="${esc(u.photos)}">📷 ${nPh} ảnh</button>` : ''}</div></div>`;
}

function drawDashboardCharts(ts, now) {
  if (!window.Chart) return;
  Chart.defaults.font.family = '"Be Vietnam Pro", system-ui, sans-serif';
  Chart.defaults.color = cssVar('--muted');
  Chart.defaults.borderColor = cssVar('--line');
  const col = (k) => cssVar(CLS[k].v);

  // S-curve
  const planned = ts.filter((t) => t.plan_start);
  if (planned.length) {
    const starts = planned.map((t) => parseD(t.plan_start)), ends = planned.map(planEnd);
    const d0 = dayStart(new Date(Math.min(...starts))), d1 = dayStart(new Date(Math.max(...ends, now)));
    const hist = {};
    S.updates.forEach((u) => { if (u.progress !== '' && u.progress != null) (hist[u.task_id] ||= []).push(u); });
    Object.values(hist).forEach((a) => a.sort((x, y) => (x.report_date + x.ts < y.report_date + y.ts ? -1 : 1)));
    const actualAt = (t, ds) => {
      const h = (hist[t.id] || []).filter((u) => u.report_date <= ds);
      if (h.length) return +h[h.length - 1].progress / 100;
      if (t.actual_end && t.actual_end.slice(0, 10) <= ds) return 1;
      if (t.actual_start && t.actual_start.slice(0, 10) <= ds) return ds >= today() ? t.progress / 100 : Math.min(t.progress, 50) / 100;
      return 0;
    };
    const labels = [], pl = [], ac = [];
    for (let d = d0; d <= d1; d = new Date(d.getTime() + DAY)) {
      const end = new Date(d.getTime() + DAY), ds = dstr(d);
      labels.push(`${pad(d.getDate())}/${pad(d.getMonth() + 1)}`);
      pl.push(+weightedPct(planned, (t) => planFrac(t, end)).toFixed(1));
      ac.push(ds <= today() ? +weightedPct(planned, (t) => actualAt(t, ds)).toFixed(1) : null);
    }
    S.charts.s = new Chart($('#chS'), {
      type: 'line',
      data: { labels, datasets: [
        { label: 'Kế hoạch', data: pl, borderColor: cssVar('--todo'), backgroundColor: 'transparent', borderDash: [6, 4], tension: .25, pointRadius: 0, borderWidth: 2 },
        { label: 'Thực tế', data: ac, borderColor: cssVar('--brand-2'), backgroundColor: cssVar('--brand-2') + '22', fill: true, tension: .25, pointRadius: 2, borderWidth: 2.5 },
      ] },
      options: { maintainAspectRatio: false, interaction: { mode: 'index', intersect: false },
        scales: { y: { min: 0, max: 100, ticks: { callback: (v) => v + '%' } }, x: { grid: { display: false } } },
        plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { label: (c) => `${c.dataset.label}: ${c.parsed.y}%` } } } },
    });
  }

  // Status donut
  const keys = Object.keys(CLS).filter((k) => ts.some((t) => klass(t, now) === k));
  S.charts.status = new Chart($('#chStatus'), {
    type: 'doughnut',
    data: { labels: keys.map((k) => CLS[k].label), datasets: [{ data: keys.map((k) => ts.filter((t) => klass(t, now) === k).length), backgroundColor: keys.map(col), borderColor: cssVar('--surface'), borderWidth: 2 }] },
    options: { maintainAspectRatio: false, cutout: '62%', plugins: { legend: { position: 'bottom', labels: { boxWidth: 12 } } },
      onClick: (_, el) => { if (el[0]) { S.filters.cls = keys[el[0].index]; go('field'); } } },
  });

  // Sections
  const secs = [...new Set(ts.map((t) => t.section).filter(Boolean))];
  const short = (s) => s.replace(/^([IVX]+)\.\s*/, '$1. ').slice(0, 34) + (s.length > 34 ? '…' : '');
  S.charts.sec = new Chart($('#chSec'), {
    type: 'bar',
    data: { labels: secs.map(short), datasets: [
      { label: 'Kế hoạch đến nay', data: secs.map((s) => +weightedPct(ts.filter((t) => t.section === s && t.plan_start), (t) => planFrac(t, now)).toFixed(1)), backgroundColor: cssVar('--plan'), borderRadius: 4 },
      { label: 'Thực tế', data: secs.map((s) => +weightedPct(ts.filter((t) => t.section === s), (t) => t.progress / 100).toFixed(1)), backgroundColor: cssVar('--brand-2'), borderRadius: 4 },
    ] },
    options: { indexAxis: 'y', maintainAspectRatio: false, scales: { x: { min: 0, max: 100, ticks: { callback: (v) => v + '%' } }, y: { grid: { display: false } } },
      plugins: { legend: { position: 'bottom' }, tooltip: { callbacks: { title: (c) => secs[c[0].dataIndex] } } },
      onClick: (_, el) => { if (el[0]) { S.filters.section = secs[el[0].index]; rerender(); } } },
  });

  // Units
  const units = [...S.units.map((u) => u.code).filter((c) => ts.some((t) => t.unit === c)), ...(ts.some((t) => !t.unit) ? [''] : [])];
  const order = ['done', 'doing', 'paused', 'late', 'todo', 'unplanned'];
  S.charts.unit = new Chart($('#chUnit'), {
    type: 'bar',
    data: { labels: units.map((u) => u || 'Chưa gán'), datasets: order.map((k) => ({ label: CLS[k].label, data: units.map((u) => ts.filter((t) => (t.unit || '') === u && klass(t, now) === k).length), backgroundColor: col(k), borderRadius: 3 })) },
    options: { maintainAspectRatio: false, scales: { x: { stacked: true, grid: { display: false } }, y: { stacked: true, ticks: { precision: 0 } } },
      plugins: { legend: { position: 'bottom', labels: { boxWidth: 12 } } },
      onClick: (_, el) => { if (el[0]) { S.filters.unit = units[el[0].index] || '__none'; rerender(); } } },
  });
}

/* ============================ FIELD UPDATE ============================ */
// Kiểu xem & sắp xếp (giống File Explorer), lưu theo từng thiết bị
const FIELD_VIEWS = {
  list: { label: 'Danh sách', icon: 'M3 5h2v2H3zm4 0h14v2H7zM3 11h2v2H3zm4 0h14v2H7zM3 17h2v2H3zm4 0h14v2H7z' },
  tiles: { label: 'Ô', icon: 'M3 3h8v8H3zm10 0h8v8h-8zM3 13h8v8H3zm10 0h8v8h-8z' },
  details: { label: 'Chi tiết', icon: 'M3 4h18v3H3zm0 5h18v2H3zm0 4h18v2H3zm0 4h18v2H3z' },
  content: { label: 'Nội dung', icon: 'M3 4h6v6H3zm8 1h10v2H11zm0 3h7v1.5h-7zM3 14h6v6H3zm8 1h10v2H11zm0 3h7v1.5h-7z' },
};
const FIELD_SORTS = { wbs: 'Thứ tự WBS', name: 'Tên', modified: 'Ngày sửa đổi' };
const FV_KEY = 'dl_fieldview';
S.fv = (() => {
  const def = { mode: 'tiles', sort: 'wbs', dir: 'asc', group: true };
  try { return { ...def, ...JSON.parse(localStorage.getItem(FV_KEY) || '{}') }; } catch { return def; }
})();
function setFv(patch) {
  Object.assign(S.fv, patch);
  try { localStorage.setItem(FV_KEY, JSON.stringify(S.fv)); } catch { /* ignore */ }
  rerender();
}
const viCollator = new Intl.Collator('vi', { numeric: true, sensitivity: 'base' });
/** Ngày sửa đổi = lần cập nhật hiện trường hoặc lần sửa kế hoạch gần nhất. */
function lastUpdateMap() {
  const m = new Map();
  S.updates.forEach((u) => { const x = m.get(u.task_id); if (!x || u.ts > x.ts) m.set(u.task_id, u); });
  return m;
}
const modifiedOf = (t, lastUp) => { const a = t.updated_at || '', b = lastUp.get(t.id)?.ts || ''; return a > b ? a : b; };
function sortTasks(list, lastUp) {
  const { sort, dir } = S.fv, k = dir === 'desc' ? -1 : 1;
  if (sort === 'name') {
    return [...list].sort((a, b) => k * (viCollator.compare(a.name, b.name) || viCollator.compare(a.phase || '', b.phase || '') || viCollator.compare(a.wbs, b.wbs)));
  }
  if (sort === 'modified') {
    return [...list].sort((a, b) => {
      const ma = modifiedOf(a, lastUp), mb = modifiedOf(b, lastUp);
      if (!ma || !mb) return ma ? -1 : mb ? 1 : 0; // chưa từng sửa luôn nằm cuối
      return k * (ma < mb ? -1 : ma > mb ? 1 : 0);
    });
  }
  return dir === 'desc' ? [...list].reverse() : list;
}

function renderField() {
  const now = new Date(), lastUp = lastUpdateMap();
  const ts = filtered();
  const editable = ts.filter(canEdit).length;
  const groups = new Map();
  ts.forEach((t) => {
    const key = S.fv.group ? `${pkgCode(t)}|${t.section || 'Khác'}` : '|';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(t);
  });
  const fv = S.fv;
  const head = (key, n) => { const [pc, sec] = key.split('|'); return sec ? `${pc ? `<span class="tag unit">${esc(pc)}</span>` : ''}${esc(sec)} <small class="muted">(${n})</small>` : ''; };
  let body;
  if (!ts.length) body = '<div class="empty card">Không có đầu việc phù hợp bộ lọc</div>';
  else if (fv.mode === 'details') body = detailsTable(groups, now, lastUp, head);
  else {
    const render = { list: listRow, tiles: taskCard, content: contentItem }[fv.mode] || taskCard;
    const wrap = { list: 'fv-list', tiles: 'task-grid', content: 'fv-content' }[fv.mode] || 'task-grid';
    body = [...groups].map(([key, list]) => `${S.fv.group ? `<div class="sec-title">${head(key, list.length)}</div>` : ''}
      <div class="${wrap}">${sortTasks(list, lastUp).map((t) => render(t, now, lastUp)).join('')}</div>`).join('');
  }
  $('#main').innerHTML = `
  <div class="toolbar"><h2>Cập nhật hiện trường</h2>
    ${S.user.role === 'contractor' && S.user.unit ? `<button class="btn ghost sm" data-act="mine">Chỉ việc của ${esc(S.user.unit)}</button>` : ''}
    <small class="muted">${ts.length} đầu việc · ${editable} bạn được cập nhật</small></div>
  ${filterBar()}
  <div class="viewbar">
    <div class="seg" role="radiogroup" aria-label="Kiểu xem">${Object.entries(FIELD_VIEWS).map(([k, v]) => `
      <button type="button" role="radio" aria-checked="${fv.mode === k}" class="${fv.mode === k ? 'on' : ''}" data-fv="${k}" title="${v.label}">
        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="${v.icon}"/></svg><span>${v.label}</span></button>`).join('')}
    </div>
    <label class="sortby">Sắp xếp
      <select id="fvSort">${Object.entries(FIELD_SORTS).map(([k, v]) => `<option value="${k}" ${fv.sort === k ? 'selected' : ''}>${v}</option>`).join('')}</select>
    </label>
    <button type="button" class="btn ghost sm" data-act="fv-dir" title="Đảo chiều sắp xếp">${fv.dir === 'desc' ? '↓ Giảm dần' : '↑ Tăng dần'}</button>
    <label class="chk"><input type="checkbox" id="fvGroup" ${fv.group ? 'checked' : ''}> Nhóm theo phần việc</label>
  </div>
  ${body}`;
}

function taskCard(t, now, lastUp) {
  const c = klass(t, now), last = lastUp ? lastUp.get(t.id) : updatesOf(t.id)[0], ed = canEdit(t);
  return `<button type="button" class="task ${ed ? '' : 'locked'}" style="--k:var(${CLS[c].v})" data-task="${t.id}">
    <div class="top"><span class="tag">${esc(t.wbs)}</span>${t.phase ? `<span class="tag">Pha ${esc(t.phase)}</span>` : ''}${t.unit ? `<span class="tag unit">${esc(t.unit)}</span>` : '<span class="tag">Chưa gán ĐV</span>'}${pill(c)}${+t.delay_days > 0 ? `<span class="tag warn">Chậm ${t.delay_days} ngày</span>` : ''}</div>
    <div class="name">${esc(t.name)}</div>
    <div class="meta"><span>KH: ${fmtD(t.plan_start)} → ${fmtD(t.plan_end)}</span><span>TT: ${fmtD(t.actual_start, false)}${t.actual_end ? ' → ' + fmtD(t.actual_end, false) : ''}</span></div>
    <div style="display:flex;gap:8px;align-items:center"><div class="bar" style="flex:1"><i style="width:${t.progress}%;background:var(${CLS[c].v})"></i></div><b style="font-size:.85rem">${t.progress}%</b></div>
    ${last ? `<div class="last">${esc(fmtTs(last.ts))} – ${esc(last.user_name)}: ${esc(last.note || last.status || '')}</div>` : ''}
  </button>`;
}

/** Danh sách: mỗi đầu việc một dòng gọn. */
function listRow(t, now) {
  const c = klass(t, now);
  return `<button type="button" class="li ${canEdit(t) ? '' : 'locked'}" data-task="${t.id}" title="${esc(CLS[c].label)}">
    <i class="dot" style="background:var(${CLS[c].v})" aria-hidden="true"></i>
    <span class="li-wbs">${esc(t.wbs)}</span>
    <span class="li-name">${esc(t.name)}</span>
    <span class="li-ph" title="Pha">${t.phase ? esc(t.phase) : ''}</span>
    <span class="li-unit">${esc(t.unit || '—')}</span>
    <b class="li-pct" style="color:var(${CLS[c].v})">${t.progress}%</b>
  </button>`;
}

/** Nội dung: đầy đủ thông tin và ghi chú gần nhất. */
function contentItem(t, now, lastUp) {
  const c = klass(t, now), last = lastUp.get(t.id), mod = modifiedOf(t, lastUp);
  const nPh = last?.photos ? last.photos.split(',').filter(Boolean).length : 0;
  return `<button type="button" class="ci ${canEdit(t) ? '' : 'locked'}" style="--k:var(${CLS[c].v})" data-task="${t.id}">
    <div class="ci-main">
      <div class="ci-name">${esc(t.name)}</div>
      <div class="ci-meta"><span class="tag">${esc(taskLabel(t))}</span>${t.unit ? `<span class="tag unit">${esc(t.unit)}</span>` : ''}${pill(c)}${+t.delay_days > 0 ? `<span class="tag warn">Chậm ${t.delay_days} ngày</span>` : ''}</div>
      <div class="ci-dates">Kế hoạch ${fmtD(t.plan_start)} → ${fmtD(t.plan_end)} · Thực tế ${fmtD(t.actual_start, false)}${t.actual_end ? ' → ' + fmtD(t.actual_end, false) : ''}</div>
      ${last ? `<div class="ci-note"><b>${esc(last.user_name || last.email)}</b> <small>${fmtTs(last.ts)}</small>${nPh ? ` <small>· ${nPh} ảnh</small>` : ''}<br>${esc(last.note || last.status || '')}</div>` : '<div class="ci-note muted">Chưa có cập nhật hiện trường</div>'}
    </div>
    <div class="ci-side"><b>${t.progress}%</b><div class="bar"><i style="width:${t.progress}%;background:var(${CLS[c].v})"></i></div><small>${mod ? 'Sửa ' + fmtTs(mod) : ''}</small></div>
  </button>`;
}

/** Chi tiết: bảng, bấm tiêu đề cột để sắp xếp. */
function detailsTable(groups, now, lastUp, head) {
  const th = (label, key) => {
    if (!key) return `<th>${label}</th>`;
    const on = S.fv.sort === key, arrow = on ? (S.fv.dir === 'desc' ? ' ↓' : ' ↑') : '';
    return `<th aria-sort="${on ? (S.fv.dir === 'desc' ? 'descending' : 'ascending') : 'none'}"><button type="button" class="th-sort ${on ? 'on' : ''}" data-sort="${key}">${label}${arrow}</button></th>`;
  };
  const rows = [...groups].map(([key, list]) => `${S.fv.group ? `<tr class="grp"><td colspan="10">${head(key, list.length)}</td></tr>` : ''}
    ${sortTasks(list, lastUp).map((t) => { const c = klass(t, now), mod = modifiedOf(t, lastUp); return `<tr data-task="${t.id}" tabindex="0" class="${canEdit(t) ? '' : 'locked'}">
      <td><span class="pill c-${c}">${CLS[c].label}</span></td><td>${esc(t.wbs)}</td><td>${esc(t.phase)}</td><td class="d-name">${esc(t.name)}</td><td>${esc(t.unit || '—')}</td>
      <td>${fmtD(t.plan_start)}</td><td>${fmtD(t.plan_end)}</td><td>${fmtD(t.actual_start, false)}</td><td class="num"><b>${t.progress}%</b></td><td>${mod ? fmtTs(mod) : '—'}</td></tr>`; }).join('')}`).join('');
  return `<div class="table-wrap fv-details"><table><thead><tr>${th('Tình trạng')}${th('WBS', 'wbs')}${th('Pha')}${th('Đầu việc', 'name')}${th('Nhà thầu')}${th('Bắt đầu KH')}${th('Kết thúc KH')}${th('Bắt đầu TT')}${th('%')}${th('Ngày sửa đổi', 'modified')}</tr></thead><tbody>${rows}</tbody></table></div>`;
}

function openTask(id) {
  const t = taskById(id);
  if (!t) return;
  const ed = canEdit(t), c = klass(t), hist = updatesOf(id);
  const pending = [];
  openDialog(`
    <div class="dlg-head"><div><div class="top" style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:6px"><span class="tag">${esc(taskLabel(t))}</span>${t.unit ? `<span class="tag unit">${esc(t.unit)}</span>` : ''}${pill(c)}</div>
      <h2 style="font-size:1.02rem">${esc(t.name)}</h2><small>${pkgById(t.package_id) ? esc(pkgById(t.package_id).name) + ' › ' : ''}${esc(t.section)}${t.group ? ' › ' + esc(t.group) : ''}${t.subgroup ? ' › ' + esc(t.subgroup) : ''}</small></div>
      <button class="x" data-act="close" aria-label="Đóng">×</button></div>
    <form class="dlg-body" id="updForm">
      <div class="info-grid"><div>Kế hoạch bắt đầu<b>${fmtD(t.plan_start)}</b></div><div>Kế hoạch kết thúc<b>${fmtD(t.plan_end)}</b></div>
        <div>Thời gian KH<b>${t.plan_days !== '' ? t.plan_days + ' ngày' : '—'}</b></div><div>Cập nhật cuối<b>${t.updated_at ? fmtTs(t.updated_at) : '—'}</b></div></div>
      ${t.note ? `<div class="note-box">${esc(t.note)}</div>` : ''}
      ${ed ? `
      <div class="field"><span>Tiến độ hoàn thành</span>
        <div class="range-row"><input type="range" name="progress" min="0" max="100" step="5" value="${t.progress}"><output id="pv">${t.progress}%</output></div>
        <div class="quick">${[0, 25, 50, 75, 90, 100].map((v) => `<button type="button" data-q="${v}" class="${v === t.progress ? 'on' : ''}">${v}%</button>`).join('')}</div></div>
      <div class="form-grid">
        <label class="field"><span>Trạng thái</span><select name="status">${TASK_STATUS.map((s) => `<option ${s === (t.status || 'Chưa bắt đầu') ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
        <label class="field"><span>Ngày báo cáo</span><input type="date" name="report_date" value="${today()}" max="${today()}"></label>
        <label class="field"><span>Bắt đầu thực tế</span><input type="datetime-local" name="actual_start" value="${esc(toLocalInput(t.actual_start))}"></label>
        <label class="field"><span>Hoàn thành thực tế</span><input type="datetime-local" name="actual_end" value="${esc(toLocalInput(t.actual_end))}"></label>
        <label class="field"><span>Số ngày chậm (nếu có)</span><input type="number" name="delay_days" step="0.5" min="0" value="${esc(t.delay_days)}"></label>
        <label class="field full"><span>Nội dung / tình hình hiện trường</span><textarea name="note" maxlength="2000" placeholder="VD: Đã hoàn thành lắp sứ 500kV pha A; trời mưa từ 15h30 tạm dừng…"></textarea></label>
      </div>
      <div class="field"><span>Ảnh hiện trường (tối đa 6)</span>
        <div class="photo-pick" id="photoPick"><label class="photo-add">＋<br>Chụp / chọn ảnh<input type="file" accept="image/*" multiple hidden id="photoIn"></label></div></div>`
    : `<div class="note-box">${S.user.role === 'viewer' ? 'Tài khoản chỉ xem không được cập nhật.' : 'Công việc này thuộc đơn vị khác hoặc chưa gán đơn vị – liên hệ quản trị để được phân công.'}</div>`}
      <div><h3 style="margin-bottom:6px">Lịch sử cập nhật (${hist.length})</h3>
        <div class="history">${hist.length ? hist.map((u) => `<div class="h"><div><b>${esc(u.user_name || u.email)}</b> <small>${fmtTs(u.ts)}${u.unit ? ' · ' + esc(u.unit) : ''}</small></div>
          ${u.note ? `<div>${esc(u.note)}</div>` : ''}<small>${u.progress !== '' && u.progress != null ? u.progress + '% · ' : ''}${esc(u.status || '')}</small>
          ${u.photos ? `<div class="photo-pick" style="margin-top:6px" data-lazy="${esc(u.photos)}"></div>` : ''}</div>`).join('') : '<div class="empty">Chưa có cập nhật</div>'}</div></div>
    </form>
    <div class="dlg-foot">${isManager() ? `<button class="btn ghost" data-edit-task="${t.id}">Sửa kế hoạch</button>` : ''}<button class="btn ghost" data-act="close">Đóng</button>${ed ? '<button class="btn" id="saveUpd" data-own-busy>Lưu cập nhật</button>' : ''}</div>`);

  $$('#dlgBody [data-lazy]').forEach((el) => loadThumbs(el, el.dataset.lazy));
  if (!ed) return;
  const form = $('#updForm'), range = form.progress, out = $('#pv');
  const setP = (v) => {
    range.value = v; out.textContent = v + '%';
    $$('.quick button', form).forEach((b) => b.classList.toggle('on', +b.dataset.q === +v));
    if (+v >= 100) { form.status.value = 'Hoàn thành'; if (!form.actual_end.value) form.actual_end.value = dtstr(new Date()); }
    else if (+v > 0 && form.status.value !== 'Tạm dừng') form.status.value = 'Đang thi công';
    if (+v > 0 && !form.actual_start.value) form.actual_start.value = dtstr(new Date());
  };
  range.oninput = () => setP(range.value);
  $$('.quick button', form).forEach((b) => { b.onclick = () => setP(b.dataset.q); });
  form.status.onchange = () => { if (form.status.value === 'Hoàn thành') setP(100); };
  $('#photoIn').onchange = async (e) => {
    for (const f of [...e.target.files]) {
      if (pending.length >= 6) { toast('Tối đa 6 ảnh', true); break; }
      try {
        const p = await shrinkImage(f);
        pending.push(p);
        const img = document.createElement('img');
        img.className = 'thumb'; img.src = `data:${p.mime};base64,${p.data}`; img.title = 'Bấm để bỏ ảnh';
        img.onclick = () => { pending.splice(pending.indexOf(p), 1); img.remove(); };
        $('#photoPick').prepend(img);
      } catch { toast('Không đọc được ảnh ' + f.name, true); }
    }
    e.target.value = '';
  };
  $('#saveUpd').onclick = async () => {
    const btn = $('#saveUpd');
    const fd = Object.fromEntries(new FormData(form));
    if (+fd.progress === t.progress && fd.status === (t.status || 'Chưa bắt đầu') && !fd.note.trim() && !pending.length && fromLocalInput(fd.actual_start) === (t.actual_start || '') && String(fd.delay_days) === String(t.delay_days ?? '')) {
      return toast('Chưa có thay đổi nào để lưu', true);
    }
    btn.disabled = true; btn.textContent = pending.length ? 'Đang tải ảnh…' : 'Đang lưu…';
    try {
      const r = await api('updateTask', {
        task_id: t.id, progress: +fd.progress, status: fd.status, report_date: fd.report_date,
        actual_start: fromLocalInput(fd.actual_start), actual_end: fromLocalInput(fd.actual_end),
        delay_days: fd.delay_days, note: fd.note.trim(), photos: pending,
      });
      Object.assign(t, r.task, { progress: +r.task.progress || 0 });
      S.updates.push(r.update);
      closeDialog();
      toast(`Đã lưu cập nhật: ${t.name.slice(0, 60)} – ${r.task.progress}%`);
      rerender();
    } catch (e) {
      toast(e.message, true);
      btn.disabled = false; btn.textContent = 'Lưu cập nhật';
    }
  };
}
const toLocalInput = (s) => (!s ? '' : s.length === 10 ? s + 'T00:00' : s.slice(0, 16));
const fromLocalInput = (s) => (!s ? '' : s.endsWith('T00:00') ? s.slice(0, 10) : s.slice(0, 16));

function shrinkImage(file, max = 1600) {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const img = new Image();
    img.onload = () => {
      const k = Math.min(1, max / Math.max(img.width, img.height));
      const c = document.createElement('canvas');
      c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
      c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
      URL.revokeObjectURL(url);
      resolve({ name: file.name, mime: 'image/jpeg', data: c.toDataURL('image/jpeg', 0.8).split(',')[1] });
    };
    img.onerror = () => { URL.revokeObjectURL(url); reject(new Error('bad image')); };
    img.src = url;
  });
}
async function photoUrl(id) {
  if (!S.photos[id] || !S.photos[id].startsWith('data:')) {
    const r = await api('getPhoto', { id });
    S.photos[id] = `data:${r.mime};base64,${r.data}`;
  }
  return S.photos[id];
}
async function loadThumbs(el, ids) {
  for (const id of ids.split(',').filter(Boolean)) {
    const img = document.createElement('img');
    img.className = 'thumb loading'; img.alt = 'Ảnh hiện trường đang tải';
    el.appendChild(img);
    photoUrl(id).then((u) => { img.src = u; img.alt = 'Ảnh hiện trường'; img.classList.remove('loading'); img.onclick = () => showLight(u); })
      .catch(() => { img.classList.remove('loading'); img.alt = 'Không tải được ảnh'; img.title = 'Không tải được ảnh – bấm đồng bộ rồi thử lại'; });
  }
}
function showLight(src) { $('#lightImg').src = src; $('#lightbox').showModal(); }
async function showPhotos(ids) {
  const first = ids.split(',').filter(Boolean);
  openDialog(`<div class="dlg-head"><h2>Ảnh hiện trường (${first.length})</h2><button class="x" data-act="close" aria-label="Đóng">×</button></div><div class="dlg-body"><div class="photo-pick" id="phList"></div></div>`);
  loadThumbs($('#phList'), ids);
}

/* ============================ TASK EDIT (admin/manager) ============================ */
function openTaskEdit(id) {
  const t = id ? taskById(id) : { section: S.filters.section || '', unit: '', phase: '', package_id: S.filters.pkg && S.filters.pkg !== '__none' ? S.filters.pkg : projPackages()[0]?.id || '' };
  const ulist = projUnitList().some((u) => u.code === t.unit) || !t.unit ? projUnitList() : [...projUnitList(), ...S.units.filter((u) => u.code === t.unit)];
  openDialog(`
    <div class="dlg-head"><h2>${id ? 'Sửa đầu việc ' + esc(t.wbs) : 'Thêm đầu việc – ' + esc(curProject()?.code || curProject()?.name || '')}</h2><button class="x" data-act="close" aria-label="Đóng">×</button></div>
    <form class="dlg-body" id="taskForm"><div class="form-grid">
      <label class="field full"><span>Tên đầu việc *</span><textarea name="name" required style="min-height:60px">${esc(t.name)}</textarea></label>
      <label class="field"><span>Mã WBS</span><input type="text" name="wbs" value="${esc(t.wbs)}"></label>
      <label class="field"><span>Pha</span><input type="text" name="phase" value="${esc(t.phase)}" placeholder="A / B / C / A, B, C"></label>
      ${projPackages().length ? `<label class="field full"><span>Hạng mục chính</span><select name="package_id">${pkgOptions(t.package_id, '(Không thuộc hạng mục chính)')}</select></label>` : ''}
      <label class="field full"><span>Phần việc</span><input type="text" name="section" list="secList" value="${esc(t.section)}"><datalist id="secList">${sections().map((s) => `<option value="${esc(s)}">`).join('')}</datalist></label>
      <label class="field"><span>Nhóm</span><input type="text" name="group" value="${esc(t.group)}"></label>
      <label class="field"><span>Nhóm con</span><input type="text" name="subgroup" value="${esc(t.subgroup)}"></label>
      <label class="field"><span>Nhà thầu thực hiện</span><select name="unit">${unitOptions(t.unit, '(Chưa gán)', ulist)}</select></label>
      <label class="field"><span>Thời gian KH (ngày)</span><input type="number" step="0.25" min="0" name="plan_days" value="${esc(t.plan_days)}"></label>
      <label class="field"><span>Bắt đầu KH</span><input type="datetime-local" name="plan_start" value="${esc(toLocalInput(t.plan_start))}"></label>
      <label class="field"><span>Kết thúc KH</span><input type="datetime-local" name="plan_end" value="${esc(toLocalInput(t.plan_end))}"></label>
      <label class="field full"><span>Ghi chú</span><textarea name="note">${esc(t.note)}</textarea></label>
    </div></form>
    <div class="dlg-foot">${id && isManager() ? `<button class="btn danger" data-del-task="${id}" style="margin-right:auto">Xóa</button>` : ''}<button class="btn ghost" data-act="close">Hủy</button><button class="btn" id="saveTask">Lưu</button></div>`);
  $('#saveTask').onclick = async () => {
    const f = $('#taskForm');
    if (!f.reportValidity()) return;
    const d = Object.fromEntries(new FormData(f));
    d.plan_start = fromLocalInput(d.plan_start); d.plan_end = fromLocalInput(d.plan_end);
    if (d.plan_start && d.plan_end && d.plan_end < d.plan_start) return toast('Ngày kết thúc phải sau ngày bắt đầu', true);
    if (d.plan_start && d.plan_end && d.plan_days === '') d.plan_days = +((parseD(d.plan_end) - parseD(d.plan_start)) / DAY).toFixed(2);
    if (id) d.id = id; else d.project_id = S.projectId;
    try {
      const r = await api('saveTask', d);
      const ex = taskById(r.task.id);
      if (ex) Object.assign(ex, r.task); else S.tasks.push(r.task);
      r.task.progress = +r.task.progress || 0;
      closeDialog(); toast('Đã lưu công việc'); rerender();
    } catch (e) { toast(e.message, true); }
  };
}

/* ============================ GANTT ============================ */
function renderGantt() {
  const now = new Date();
  let ts = filtered();
  if (S.ganttHideUnplanned) ts = ts.filter((t) => t.plan_start || t.actual_start);
  const pts = ts.flatMap((t) => [parseD(t.plan_start), planEnd(t), parseD(t.actual_start), parseD(t.actual_end)]).filter(Boolean);
  const d0 = dayStart(new Date(Math.min(...pts, now))), d1 = new Date(dayStart(new Date(Math.max(...pts, now))).getTime() + 2 * DAY);
  const nDays = Math.round((d1 - d0) / DAY), PX = S.ganttPx, W = nDays * PX;
  const x = (d) => ((d - d0) / DAY) * PX;
  const todayX = x(now);
  let days = '';
  for (let i = 0; i < nDays; i++) {
    const d = new Date(d0.getTime() + i * DAY), we = d.getDay() === 0 || d.getDay() === 6;
    days += `<div class="g-day ${we ? 'we' : ''} ${dstr(d) === today() ? 'td' : ''}" style="left:${i * PX}px;width:${PX}px">${d.getDate()}<br><span style="font-weight:400">${'CN,T2,T3,T4,T5,T6,T7'.split(',')[d.getDay()]}</span></div>`;
  }
  let rows = '', sec = null;
  ts.forEach((t) => {
    const gk = `${t.package_id}|${t.section}`;
    if (gk !== sec) { sec = gk; rows += `<div class="g-row g-sec"><div class="g-left">${pkgCode(t) ? esc(pkgCode(t)) + ' › ' : ''}${esc(t.section || 'Khác')}</div><div class="g-track" style="width:${W}px"></div></div>`; }
    const c = klass(t, now), s = parseD(t.plan_start), e = planEnd(t);
    const as = parseD(t.actual_start), ae = t.actual_end ? parseD(t.actual_end) : (as ? now : null);
    const tip = `${t.wbs} ${t.phase ? 'Pha ' + t.phase : ''}\n${t.name}\nKH: ${fmtD(t.plan_start)} → ${fmtD(t.plan_end)}\nTT: ${fmtD(t.actual_start)} → ${t.actual_end ? fmtD(t.actual_end) : '…'} (${t.progress}%)`;
    rows += `<div class="g-row" data-task="${t.id}" style="cursor:pointer" title="${esc(tip)}">
      <div class="g-left"><span class="tag">${esc(t.wbs)}${t.phase ? ' ' + esc(t.phase) : ''}</span><span class="nm">${esc(t.name)}</span><b style="font-size:.72rem;color:var(${CLS[c].v})">${t.progress}%</b></div>
      <div class="g-track" style="width:${W}px">
        ${s ? `<div class="gb plan" style="left:${x(s)}px;width:${Math.max(3, x(e) - x(s))}px"></div>` : ''}
        ${as ? `<div class="gb act" style="left:${x(as)}px;width:${Math.max(3, x(ae) - x(as))}px;background:var(${CLS[c].v})"></div>` : ''}
        <div class="g-today" style="left:${todayX}px"></div>
      </div></div>`;
  });
  $('#main').innerHTML = `
    <div class="toolbar"><h2>Biểu đồ tiến độ (Gantt)</h2>
      <label class="legend"><input type="checkbox" id="hideUnpl" ${S.ganttHideUnplanned ? 'checked' : ''}> Ẩn việc chưa có kế hoạch</label>
      <div class="quick" style="flex:none;flex-wrap:nowrap"><button type="button" data-zoom="22" class="${PX === 22 ? 'on' : ''}">−</button><button type="button" data-zoom="34" class="${PX === 34 ? 'on' : ''}">○</button><button type="button" data-zoom="60" class="${PX === 60 ? 'on' : ''}">＋</button></div></div>
    ${filterBar()}
    <div class="legend" style="margin-bottom:10px"><span><i style="background:var(--plan)"></i>Kế hoạch</span>${['done', 'doing', 'late', 'paused'].map((k) => `<span><i style="background:var(${CLS[k].v})"></i>Thực tế – ${CLS[k].label}</span>`).join('')}<span><i style="background:var(--late);width:2px;height:14px"></i>Hôm nay</span></div>
    <div class="gantt-wrap" id="gwrap"><div class="gantt" style="--px:${PX}px">
      <div class="g-row g-head"><div class="g-left">Công việc (${ts.length})</div><div class="g-track" style="width:${W}px;height:38px">${days}</div></div>
      ${rows || '<div class="empty">Không có công việc</div>'}
    </div></div>`;
  const wrap = $('#gwrap');
  wrap.scrollLeft = Math.max(0, todayX - wrap.clientWidth / 2 + 170);
  $('#hideUnpl').onchange = (e) => { S.ganttHideUnplanned = e.target.checked; rerender(); };
}

/* ============================ LOG / DAILY REPORT ============================ */
function renderLog() {
  const date = S.logDate || today();
  const f = S.filters;
  const ups = S.updates.filter((u) => u.report_date === date && taskById(u.task_id)?.project_id === S.projectId && inPkg(taskById(u.task_id)) && (!f.unit || u.unit === f.unit || taskById(u.task_id)?.unit === f.unit))
    .sort((a, b) => (a.ts < b.ts ? 1 : -1));
  const d = parseD(date), next = new Date(d.getTime() + DAY), next2 = new Date(d.getTime() + 2 * DAY);
  const done = projTasks().filter((t) => inPkg(t) && t.actual_end && t.actual_end.slice(0, 10) === date && (!f.unit || t.unit === f.unit));
  const plannedNext = projTasks().filter((t) => { if (!inPkg(t)) return false; const s = parseD(t.plan_start), e = planEnd(t); return s && s < next2 && e > next && t.progress < 100 && (!f.unit || t.unit === f.unit); });
  const units = [...new Set(ups.map((u) => u.unit || '—'))];
  $('#main').innerHTML = `
    <div class="toolbar no-print"><h2>Nhật ký & báo cáo ngày</h2>
      <input type="date" id="logDate" value="${date}" style="width:auto">
      ${projPackages().length ? `<select id="logPkg" style="width:auto" aria-label="Hạng mục chính">${pkgOptions(S.filters.pkg, 'Tất cả hạng mục chính')}</select>` : ''}
      <select id="logUnit" style="width:auto">${unitOptions(f.unit, 'Tất cả nhà thầu', projUnitList())}</select>
      <button class="btn ghost sm" data-act="export-log">⬇ Xuất Excel nhật ký</button>
      <button class="btn sm" data-act="print">🖨 In báo cáo ngày</button></div>
    <div class="report-head"><h2>BÁO CÁO HIỆN TRƯỜNG NGÀY ${fmtD(date)}/${d.getFullYear()}</h2><div>${esc(curProject()?.name || '')}${pkgById(S.filters.pkg) ? ' – ' + esc(pkgById(S.filters.pkg).name) : ''}${f.unit ? ' – Đơn vị: ' + esc(unitName(f.unit)) : ''}</div></div>
    <div class="kpis" style="grid-template-columns:repeat(4,1fr)">
      <div class="kpi" style="--k:var(--accent)"><div class="lbl">Lượt cập nhật</div><div class="val">${ups.length}</div><div class="sub">${units.length} đơn vị</div></div>
      <div class="kpi" style="--k:var(--ok)"><div class="lbl">Hoàn thành trong ngày</div><div class="val">${done.length}</div></div>
      <div class="kpi" style="--k:var(--doing)"><div class="lbl">Kế hoạch ngày ${fmtD(dstr(next))}</div><div class="val">${plannedNext.length}</div></div>
      <div class="kpi"><div class="lbl">Tiến độ chung hiện tại</div><div class="val">${weightedPct(projTasks(), (t) => t.progress / 100).toFixed(1)}%</div></div>
    </div>
    <div class="card" style="margin-bottom:14px"><div class="card-head"><h3>Nội dung cập nhật trong ngày</h3></div>
      <div class="table-wrap"><table><thead><tr><th>Giờ</th><th>Đơn vị</th><th>Công việc</th><th>Người cập nhật</th><th class="num">%</th><th>Trạng thái</th><th>Nội dung</th><th class="no-print">Ảnh</th></tr></thead><tbody>
      ${ups.map((u) => { const t = taskById(u.task_id); const n = u.photos ? u.photos.split(',').filter(Boolean).length : 0; return `<tr>
        <td>${esc(String(u.ts).slice(11, 16))}</td><td>${esc(u.unit || t?.unit || '')}</td>
        <td data-task="${esc(u.task_id)}" style="cursor:pointer"><b>${esc(taskLabel(t))}</b><br>${esc(t?.name || u.task_id)}</td>
        <td>${esc(u.user_name || u.email)}</td><td class="num">${esc(u.progress)}</td><td>${esc(u.status)}</td><td>${esc(u.note)}</td>
        <td class="no-print">${n ? `<button class="btn ghost sm" data-photos="${esc(u.photos)}">📷 ${n}</button>` : ''}</td></tr>`; }).join('') || '<tr><td colspan="8" class="empty">Không có cập nhật trong ngày</td></tr>'}
      </tbody></table></div></div>
    <div class="grid g-11">
      <div class="card"><div class="card-head"><h3>Hoàn thành trong ngày</h3></div><div class="list">${done.map((t) => `<div class="list-item"><div class="row"><span class="tag">${esc(taskLabel(t))}</span>${t.unit ? `<span class="tag unit">${esc(t.unit)}</span>` : ''}</div><div>${esc(t.name)}</div></div>`).join('') || '<div class="empty">—</div>'}</div></div>
      <div class="card"><div class="card-head"><h3>Kế hoạch ngày ${fmtD(dstr(next))}</h3></div><div class="list">${plannedNext.map((t) => `<div class="list-item"><div class="row"><span class="tag">${esc(taskLabel(t))}</span>${t.unit ? `<span class="tag unit">${esc(t.unit)}</span>` : ''}<small>${fmtD(t.plan_start)} → ${fmtD(t.plan_end)} · ${t.progress}%</small></div><div>${esc(t.name)}</div></div>`).join('') || '<div class="empty">—</div>'}</div></div>
    </div>`;
  $('#logDate').onchange = (e) => { S.logDate = e.target.value || today(); rerender(); };
  $('#logUnit').onchange = (e) => { S.filters.unit = e.target.value; rerender(); };
  if ($('#logPkg')) $('#logPkg').onchange = (e) => { S.filters.pkg = e.target.value; rerender(); };
}

/* ============================ ADMIN ============================ */
const PROJECT_STATUS = ['Chuẩn bị', 'Đang thực hiện', 'Tạm dừng', 'Hoàn thành'];
const UNIT_TYPES = ['Quản lý dự án', 'Tư vấn giám sát', 'Thi công', 'Cung cấp thiết bị', 'Khác'];
const ADMIN_TABS = { projects: 'Dự án', packages: 'Hạng mục chính', units: 'Nhà thầu', tasks: 'Đầu việc', users: 'Người dùng' };

function renderAdmin() {
  const tabs = S.user.role === 'admin' ? Object.keys(ADMIN_TABS) : ['packages', 'tasks'];
  const tab = tabs.includes(S.adminTab) ? S.adminTab : tabs[0];
  const pend = S.users.filter((u) => u.status === 'pending').length;
  const cp = curProject();
  $('#main').innerHTML = `
    <div class="toolbar"><h2>Quản trị</h2>
      ${S.user.role === 'admin' ? `<button class="btn ghost sm" data-act="open-db" title="Mở Google Sheet chứa dữ liệu dự án"><svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path fill="currentColor" d="M12 3C7.6 3 4 4.3 4 6v12c0 1.7 3.6 3 8 3s8-1.3 8-3V6c0-1.7-3.6-3-8-3m6 15c-.4.5-2.6 1.3-6 1.3S6.4 18.5 6 18v-2.3c1.5.8 3.7 1.1 6 1.1s4.5-.3 6-1.1zm0-4.5c-.4.5-2.6 1.3-6 1.3s-5.6-.8-6-1.3v-2.3c1.5.8 3.7 1.1 6 1.1s4.5-.3 6-1.1zM12 8.4c-3.4 0-5.6-.8-6-1.3V7c.4-.5 2.6-1.3 6-1.3s5.6.8 6 1.3c-.4.5-2.6 1.4-6 1.4"/></svg>Database</button>` : ''}
      ${S.reportUnlocked && S.user.role === 'admin' && cp ? '<button class="btn sm" data-act="report">Báo cáo tiến độ (.docx)</button>' : ''}</div>
    <div class="subtabs">${tabs.map((k) => `<button data-atab="${k}" class="${tab === k ? 'on' : ''}">${ADMIN_TABS[k]}${k === 'users' && pend ? ` (${pend} chờ duyệt)` : ''}${(k === 'tasks' || k === 'packages') && cp ? ` – ${esc(cp.code || cp.name)}` : ''}</button>`).join('')}</div>
    <div id="adminBody"></div>`;
  ({ projects: adminProjects, packages: adminPackages, units: adminUnits, tasks: adminTasks, users: adminUsers })[tab]();
}

/* ---------- Dự án ---------- */
function adminProjects() {
  $('#adminBody').innerHTML = `
    <div class="toolbar"><small class="muted">${S.projects.length} dự án</small><button class="btn sm" data-act="new-project">＋ Tạo dự án</button></div>
    <div class="table-wrap"><table><thead><tr><th>Mã</th><th>Tên dự án</th><th>Chủ đầu tư / Địa điểm</th><th>Thời gian</th><th>Trạng thái</th><th>Nhà thầu tham gia</th><th class="num">Hạng mục chính</th><th class="num">Đầu việc</th><th class="num">Tiến độ</th><th></th></tr></thead><tbody>
    ${S.projects.map((p) => {
      const ts = S.tasks.filter((t) => t.project_id === p.id);
      const cur = p.id === S.projectId;
      return `<tr${cur ? ' class="current"' : ''}>
        <td><b>${esc(p.code)}</b></td><td>${esc(p.name)}${cur ? ' <span class="tag unit">Đang mở</span>' : ''}<br><small>${esc(p.description)}</small></td>
        <td>${esc(p.owner)}<br><small>${esc(p.location)}</small></td>
        <td style="white-space:nowrap">${fmtDate(p.start_date)} → ${fmtDate(p.end_date)}</td>
        <td><span class="tag">${esc(p.status)}</span></td>
        <td>${projectUnitCodes(p).map((c) => `<span class="tag unit">${esc(c)}</span>`).join(' ') || '<small class="muted">Tất cả</small>'}</td>
        <td class="num">${S.packages.filter((k) => k.project_id === p.id).length}</td><td class="num">${ts.length}</td><td class="num">${weightedPct(ts, (t) => t.progress / 100).toFixed(1)}%</td>
        <td style="white-space:nowrap">${cur ? '' : `<button class="btn ghost sm" data-open-project="${p.id}">Mở</button> `}<button class="btn ghost sm" data-edit-project="${p.id}">Sửa</button> <button class="btn ghost sm danger-text" data-del-project="${p.id}">Xóa</button></td></tr>`;
    }).join('') || '<tr><td colspan="10" class="empty">Chưa có dự án – bấm “Tạo dự án”</td></tr>'}
    </tbody></table></div>`;
}

function openProjectEdit(id) {
  const p = id ? S.projects.find((x) => x.id === id) : { status: 'Đang thực hiện', units: '' };
  const sel = projectUnitCodes(p);
  openDialog(`
    <div class="dlg-head"><h2>${id ? 'Sửa dự án ' + esc(p.code || p.name) : 'Tạo dự án mới'}</h2><button class="x" data-act="close" aria-label="Đóng">×</button></div>
    <form class="dlg-body" id="projForm"><div class="form-grid">
      <label class="field full"><span>Tên dự án *</span><input type="text" name="name" required maxlength="300" value="${esc(p.name)}"></label>
      <label class="field"><span>Mã dự án</span><input type="text" name="code" maxlength="50" value="${esc(p.code)}" placeholder="VD: AT2-DILINH"></label>
      <label class="field"><span>Trạng thái</span><select name="status">${PROJECT_STATUS.map((s) => `<option ${s === p.status ? 'selected' : ''}>${s}</option>`).join('')}</select></label>
      <label class="field"><span>Chủ đầu tư / Quản lý dự án</span><input type="text" name="owner" maxlength="300" value="${esc(p.owner)}"></label>
      <label class="field"><span>Địa điểm</span><input type="text" name="location" maxlength="300" value="${esc(p.location)}"></label>
      <label class="field"><span>Ngày bắt đầu</span><input type="date" name="start_date" value="${esc(String(p.start_date || '').slice(0, 10))}"></label>
      <label class="field"><span>Ngày kết thúc</span><input type="date" name="end_date" value="${esc(String(p.end_date || '').slice(0, 10))}"></label>
      <label class="field full"><span>Mô tả</span><textarea name="description" maxlength="3000">${esc(p.description)}</textarea></label>
      <div class="field full"><span>Nhà thầu tham gia <small>(để trống = tất cả nhà thầu)</small></span>
        <div class="check-grid">${S.units.map((u) => `<label><input type="checkbox" name="units" value="${esc(u.code)}" ${sel.includes(u.code) ? 'checked' : ''}> <b>${esc(u.code)}</b> <small>${esc(u.type || '')}</small></label>`).join('')}</div></div>
    </div></form>
    <div class="dlg-foot"><button class="btn ghost" data-act="close">Hủy</button><button class="btn" id="saveProj">${id ? 'Lưu' : 'Tạo dự án'}</button></div>`);
  $('#saveProj').onclick = async () => {
    const f = $('#projForm');
    if (!f.reportValidity()) return;
    const d = Object.fromEntries(new FormData(f));
    d.units = $$('input[name=units]:checked', f).map((c) => c.value);
    if (d.start_date && d.end_date && d.end_date < d.start_date) return toast('Ngày kết thúc phải sau ngày bắt đầu', true);
    if (id) d.id = id;
    try {
      const r = await api('saveProject', d);
      const ex = S.projects.find((x) => x.id === r.project.id);
      if (ex) Object.assign(ex, r.project); else S.projects.push(r.project);
      if (!id) { setProject(r.project.id); if (S.view === 'admin') S.adminTab = 'tasks'; }
      renderProjSel();
      closeDialog();
      toast(id ? 'Đã lưu dự án' : `Đã tạo dự án ${r.project.code || r.project.name} – hãy thêm đầu việc`);
      rerender();
    } catch (e) { toast(e.message, true); }
  };
}

async function deleteProject(id) {
  const p = S.projects.find((x) => x.id === id);
  const n = S.tasks.filter((t) => t.project_id === id).length;
  const key = p.code || p.id;
  if (!(await confirmBox({ title: `Xóa dự án “${p.name}”?`, danger: true, ok: 'Xóa dự án', requireText: n ? key : '',
    message: n ? `${n} đầu việc và các hạng mục chính của dự án cũng bị xóa. Nhật ký cập nhật và ảnh vẫn được giữ trong Google Sheet.` : 'Dự án chưa có đầu việc nào.' }))) return;
  try {
    await api('deleteProject', { id, cascade: n > 0 });
    S.projects = S.projects.filter((x) => x.id !== id);
    S.tasks = S.tasks.filter((t) => t.project_id !== id);
    S.packages = S.packages.filter((k) => k.project_id !== id);
    if (S.projectId === id) setProject(S.projects[0]?.id || null);
    renderProjSel();
    toast('Đã xóa dự án');
    rerender();
  } catch (e) { toast(e.message, true); }
}

/* ---------- Hạng mục chính ---------- */
function adminPackages() {
  const cp = curProject();
  if (!cp) { $('#adminBody').innerHTML = noProjectHtml(); return; }
  const now = new Date(), pk = projPackages(), all = projTasks();
  const orphan = all.filter((t) => !t.package_id).length;
  $('#adminBody').innerHTML = `
    <div class="toolbar"><small class="muted">${pk.length} hạng mục chính trong dự án <b>${esc(cp.name)}</b></small><button class="btn sm" data-act="new-pkg">＋ Thêm hạng mục chính</button></div>
    ${orphan ? `<div class="note-box" style="margin-bottom:12px">${orphan} đầu việc chưa thuộc hạng mục chính nào – vào tab “Đầu việc”, lọc “(Chưa phân hạng mục chính)” rồi dùng “Chuyển hạng mục”.</div>` : ''}
    <div class="table-wrap"><table><thead><tr><th class="num">TT</th><th>Mã</th><th>Tên hạng mục chính</th><th>Thời gian</th><th>Trạng thái</th><th class="num">Đầu việc</th><th class="num">Chậm</th><th class="num">Tiến độ</th><th></th></tr></thead><tbody>
    ${pk.map((k) => {
      const ts = all.filter((t) => t.package_id === k.id);
      return `<tr><td class="num">${esc(k.order)}</td><td><b>${esc(k.code)}</b></td><td>${esc(k.name)}${k.description ? `<br><small>${esc(k.description)}</small>` : ''}</td>
        <td style="white-space:nowrap">${fmtDate(k.start_date)} → ${fmtDate(k.end_date)}</td><td><span class="tag">${esc(k.status)}</span></td>
        <td class="num">${ts.length}</td><td class="num">${ts.filter((t) => klass(t, now) === 'late').length}</td><td class="num">${weightedPct(ts, (t) => t.progress / 100).toFixed(1)}%</td>
        <td style="white-space:nowrap"><button class="btn ghost sm" data-pkg-tasks="${k.id}">Đầu việc</button> <button class="btn ghost sm" data-edit-pkg="${k.id}">Sửa</button>${S.user.role === 'admin' ? ` <button class="btn ghost sm danger-text" data-del-pkg="${k.id}">Xóa</button>` : ''}</td></tr>`;
    }).join('') || '<tr><td colspan="9" class="empty">Chưa có hạng mục chính – bấm “Thêm hạng mục chính” (VD: Thay MBA AT1, Thay MBA AT2…)</td></tr>'}
    </tbody></table></div>`;
}

function openPackageEdit(id) {
  const k = id ? pkgById(id) : { status: 'Chuẩn bị', order: projPackages().length + 1 };
  openDialog(`
    <div class="dlg-head"><h2>${id ? 'Sửa hạng mục chính ' + esc(k.code || k.name) : 'Thêm hạng mục chính – ' + esc(curProject().code || curProject().name)}</h2><button class="x" data-act="close" aria-label="Đóng">×</button></div>
    <form class="dlg-body" id="pkgForm"><div class="form-grid">
      <label class="field full"><span>Tên hạng mục chính *</span><input type="text" name="name" required maxlength="300" value="${esc(k.name)}" placeholder="VD: Thay thế MBA AT2"></label>
      <label class="field"><span>Mã</span><input type="text" name="code" maxlength="50" value="${esc(k.code)}" placeholder="VD: AT2"></label>
      <label class="field"><span>Trạng thái</span><select name="status">${PROJECT_STATUS.map((x) => `<option ${x === k.status ? 'selected' : ''}>${x}</option>`).join('')}</select></label>
      <label class="field"><span>Ngày bắt đầu</span><input type="date" name="start_date" value="${esc(String(k.start_date || '').slice(0, 10))}"></label>
      <label class="field"><span>Ngày kết thúc</span><input type="date" name="end_date" value="${esc(String(k.end_date || '').slice(0, 10))}"></label>
      <label class="field"><span>Thứ tự hiển thị</span><input type="number" name="order" min="1" step="1" value="${esc(k.order)}"></label>
      <label class="field full"><span>Mô tả</span><textarea name="description" maxlength="3000">${esc(k.description)}</textarea></label>
    </div></form>
    <div class="dlg-foot"><button class="btn ghost" data-act="close">Hủy</button><button class="btn" id="savePkg">Lưu</button></div>`);
  $('#savePkg').onclick = async () => {
    const f = $('#pkgForm');
    if (!f.reportValidity()) return;
    const d = Object.fromEntries(new FormData(f));
    if (d.start_date && d.end_date && d.end_date < d.start_date) return toast('Ngày kết thúc phải sau ngày bắt đầu', true);
    if (id) d.id = id; else d.project_id = S.projectId;
    try {
      const r = await api('savePackage', d);
      const ex = pkgById(r.package.id);
      if (ex) Object.assign(ex, r.package); else S.packages.push(r.package);
      closeDialog(); toast('Đã lưu hạng mục chính'); rerender();
    } catch (e) { toast(e.message, true); }
  };
}

async function deletePackage(id) {
  const k = pkgById(id);
  const n = S.tasks.filter((t) => t.package_id === id).length;
  const key = k.code || k.id;
  if (!(await confirmBox({ title: `Xóa hạng mục “${k.name}”?`, danger: true, ok: 'Xóa hạng mục', requireText: n ? key : '',
    message: n ? `${n} đầu việc của hạng mục cũng bị xóa. Nhật ký cập nhật và ảnh vẫn được giữ trong Google Sheet.` : 'Hạng mục chưa có đầu việc nào.' }))) return;
  try {
    await api('deletePackage', { id, cascade: n > 0 });
    S.packages = S.packages.filter((x) => x.id !== id);
    S.tasks = S.tasks.filter((t) => t.package_id !== id);
    if (S.filters.pkg === id) S.filters.pkg = '';
    toast('Đã xóa hạng mục chính'); rerender();
  } catch (e) { toast(e.message, true); }
}

/* ---------- Nhà thầu ---------- */
function adminUnits() {
  $('#adminBody').innerHTML = `
    <div class="toolbar"><small class="muted">${S.units.length} nhà thầu / đơn vị</small><button class="btn sm" data-act="new-unit">＋ Thêm nhà thầu</button></div>
    <div class="table-wrap"><table><thead><tr><th>Mã</th><th>Tên nhà thầu</th><th>Loại</th><th>Người liên hệ</th><th>Điện thoại</th><th>Email</th><th class="num">Dự án</th><th class="num">Đầu việc</th><th class="num">Người dùng</th><th></th></tr></thead><tbody>
    ${S.units.map((u) => `<tr><td><b>${esc(u.code)}</b>${isAdminUnit(u.code) ? ' <span class="tag">Quản trị</span>' : ''}</td><td>${esc(u.name)}${u.note ? `<br><small>${esc(u.note)}</small>` : ''}</td><td>${esc(u.type)}</td>
      <td>${esc(u.contact)}</td><td>${u.phone ? `<a href="tel:${esc(u.phone)}">${esc(u.phone)}</a>` : ''}</td><td>${u.email ? `<a href="mailto:${esc(u.email)}">${esc(u.email)}</a>` : ''}</td>
      <td class="num">${S.projects.filter((p) => projectUnitCodes(p).includes(u.code)).length}</td>
      <td class="num">${S.tasks.filter((t) => t.unit === u.code).length}</td><td class="num">${S.users.filter((x) => x.unit === u.code).length}</td>
      <td style="white-space:nowrap"><button class="btn ghost sm" data-edit-unit="${esc(u.code)}">Sửa</button> <button class="btn ghost sm danger-text" data-del-unit="${esc(u.code)}">Xóa</button></td></tr>`).join('') || '<tr><td colspan="10" class="empty">Chưa có nhà thầu</td></tr>'}
    </tbody></table></div>`;
}

function openUnitEdit(code) {
  const u = code ? S.units.find((x) => x.code === code) : { type: 'Thi công' };
  openDialog(`
    <div class="dlg-head"><h2>${code ? 'Sửa nhà thầu ' + esc(code) : 'Thêm nhà thầu'}</h2><button class="x" data-act="close" aria-label="Đóng">×</button></div>
    <form class="dlg-body" id="unitForm"><div class="form-grid">
      <label class="field"><span>Mã nhà thầu *</span><input type="text" name="code" required maxlength="30" value="${esc(u.code)}" ${code ? 'readonly' : ''} placeholder="VD: PCC1" style="text-transform:uppercase"></label>
      <label class="field"><span>Loại</span><select name="type">${UNIT_TYPES.map((t) => `<option ${t === u.type ? 'selected' : ''}>${t}</option>`).join('')}</select></label>
      <label class="field full"><span>Tên đầy đủ *</span><input type="text" name="name" required maxlength="200" value="${esc(u.name)}"></label>
      <label class="field"><span>Người liên hệ / Chỉ huy trưởng</span><input type="text" name="contact" maxlength="200" value="${esc(u.contact)}"></label>
      <label class="field"><span>Điện thoại</span><input type="tel" name="phone" maxlength="50" value="${esc(u.phone)}"></label>
      <label class="field full"><span>Email</span><input type="text" name="email" maxlength="200" value="${esc(u.email)}"></label>
      <label class="field full"><span>Ghi chú</span><textarea name="note" maxlength="1000">${esc(u.note)}</textarea></label>
    </div>${code ? '<small class="muted">Mã nhà thầu không đổi được vì đang gắn với đầu việc và người dùng.</small>' : ''}</form>
    <div class="dlg-foot"><button class="btn ghost" data-act="close">Hủy</button><button class="btn" id="saveUnit">Lưu</button></div>`);
  $('#saveUnit').onclick = async () => {
    const f = $('#unitForm');
    if (!f.reportValidity()) return;
    const d = Object.fromEntries(new FormData(f));
    d.isNew = !code;
    try {
      const r = await api('saveUnit', d);
      S.units = r.units;
      closeDialog(); toast('Đã lưu nhà thầu'); rerender();
    } catch (e) { toast(e.message, true); }
  };
}

async function deleteUnit(code) {
  if (!(await confirmBox({ title: `Xóa nhà thầu ${code}?`, message: 'Nhà thầu sẽ bị bỏ khỏi danh mục và khỏi các dự án đang tham gia.', ok: 'Xóa nhà thầu', danger: true }))) return;
  try {
    const r = await api('deleteUnit', { code });
    S.units = r.units;
    S.projects.forEach((p) => { p.units = projectUnitCodes(p).filter((c) => c !== code).join(','); });
    toast('Đã xóa nhà thầu'); rerender();
  } catch (e) { toast(e.message, true); }
}

/* ---------- Đầu việc ---------- */
function adminTasks() {
  if (!curProject()) { $('#adminBody').innerHTML = noProjectHtml(); return; }
  const ts = filtered();
  $('#adminBody').innerHTML = `
    ${filterBar({ cls: false })}
    <div class="toolbar">
      <button class="btn sm" data-act="new-task">＋ Thêm đầu việc</button>
      <button class="btn ghost sm" data-act="import-tasks">⬆ Nhập từ Excel</button>
      <button class="btn ghost sm" data-act="tpl-tasks">⬇ File mẫu</button>
      <span style="flex:1"></span>
      <small class="muted" id="selCount">0 đã chọn</small>
      <select id="bulkUnit" style="width:auto">${unitOptions('', '(Bỏ gán nhà thầu)', projUnitList())}</select>
      <button class="btn ghost sm" data-act="bulk-assign">Gán nhà thầu</button>
      ${projPackages().length ? `<select id="bulkPkg" style="width:auto">${pkgOptions('', '(Bỏ hạng mục chính)')}</select><button class="btn ghost sm" data-act="bulk-pkg">Chuyển hạng mục</button>` : ''}
      <button class="btn ghost sm danger-text" data-act="bulk-delete">Xóa đã chọn</button>
      <input type="file" id="impFile" accept=".xlsx,.xls,.csv" hidden></div>
    <div class="table-wrap" style="max-height:65vh"><table><thead><tr><th><input type="checkbox" id="selAll" aria-label="Chọn tất cả"></th><th>HM chính</th><th>WBS</th><th>Pha</th><th>Đầu việc</th><th>Nhà thầu</th><th>Bắt đầu KH</th><th>Kết thúc KH</th><th class="num">Ngày</th><th class="num">%</th><th></th></tr></thead><tbody>
    ${ts.map((t) => `<tr><td><input type="checkbox" class="sel" value="${t.id}" aria-label="Chọn ${esc(t.wbs)}"></td><td>${pkgCode(t) ? `<span class="tag unit">${esc(pkgCode(t))}</span>` : '<span class="tag warn">—</span>'}</td><td>${esc(t.wbs)}</td><td>${esc(t.phase)}</td><td>${esc(t.name)}<br><small>${esc(t.section)}</small></td>
      <td>${t.unit ? `<span class="tag unit">${esc(t.unit)}</span>` : '<span class="tag warn">Chưa gán</span>'}</td><td>${fmtD(t.plan_start)}</td><td>${fmtD(t.plan_end)}</td><td class="num">${esc(t.plan_days)}</td><td class="num">${t.progress}</td>
      <td><button class="btn ghost sm" data-edit-task="${t.id}">Sửa</button></td></tr>`).join('') || '<tr><td colspan="11" class="empty">Chưa có đầu việc – bấm “Thêm đầu việc” hoặc “Nhập từ Excel”</td></tr>'}
    </tbody></table></div>`;
  const upd = () => { $('#selCount').textContent = `${$$('.sel:checked').length} đã chọn`; };
  $$('.sel').forEach((c) => { c.onchange = upd; });
  $('#selAll').onchange = (e) => { $$('.sel').forEach((c) => { c.checked = e.target.checked; }); upd(); };
}

const TPL_COLS = { 'Hạng mục chính': 'pkg', 'WBS': 'wbs', 'Hạng mục': 'section', 'Phần việc': 'section', 'Nhóm': 'group', 'Nhóm con': 'subgroup', 'Đầu việc': 'name', 'Pha': 'phase', 'Nhà thầu': 'unit', 'Bắt đầu KH': 'plan_start', 'Kết thúc KH': 'plan_end', 'Số ngày KH': 'plan_days', 'Ghi chú': 'note' };
function downloadTemplate() {
  const u = projUnitList()[0]?.code || 'NNB';
  const k = (S.filters.pkg && pkgById(S.filters.pkg)) || projPackages()[0];
  const hm = k ? k.code || k.name : 'AT2';
  exportXlsx('Mau_nhap_dau_viec.xlsx', { 'Dau viec': [
    { 'Hạng mục chính': hm, 'WBS': 'I.1', 'Phần việc': 'I. Phần xây dựng', 'Nhóm': 'A. Móng', 'Nhóm con': '', 'Đầu việc': 'Đào đất hố móng', 'Pha': 'A, B, C', 'Nhà thầu': u, 'Bắt đầu KH': '2026-11-01', 'Kết thúc KH': '2026-11-03', 'Số ngày KH': '', 'Ghi chú': 'Ngày dạng yyyy-mm-dd hoặc dd/mm/yyyy, có thể kèm giờ hh:mm' },
    { 'Hạng mục chính': hm, 'WBS': 'I.2', 'Phần việc': 'I. Phần xây dựng', 'Nhóm': 'A. Móng', 'Nhóm con': '', 'Đầu việc': 'Đổ bê tông móng', 'Pha': '', 'Nhà thầu': u, 'Bắt đầu KH': '03/11/2026 07:00', 'Kết thúc KH': '05/11/2026', 'Số ngày KH': '', 'Ghi chú': '' },
  ] });
}
function normDate(v) {
  if (v == null || v === '') return '';
  if (v instanceof Date && !isNaN(v)) return v.getHours() || v.getMinutes() ? dtstr(v) : dstr(v);
  const s = String(v).trim();
  let m = s.match(/^(\d{4})-(\d{1,2})-(\d{1,2})(?:[T ](\d{1,2}):(\d{2}))?/);
  if (m) return `${m[1]}-${pad(m[2])}-${pad(m[3])}${m[4] ? `T${pad(m[4])}:${m[5]}` : ''}`;
  m = s.match(/^(\d{1,2})[/.-](\d{1,2})[/.-](\d{4})(?:\s+(\d{1,2}):(\d{2}))?/);
  if (m) return `${m[3]}-${pad(m[2])}-${pad(m[1])}${m[4] ? `T${pad(m[4])}:${m[5]}` : ''}`;
  throw new Error(`ngày không hợp lệ "${s}"`);
}
async function importTasksFile(file) {
  if (!window.XLSX) return toast('Thư viện Excel chưa tải xong', true);
  let rows;
  try {
    const wb = XLSX.read(await file.arrayBuffer(), { cellDates: true });
    rows = XLSX.utils.sheet_to_json(wb.Sheets[wb.SheetNames[0]], { defval: '' });
  } catch { return toast('Không đọc được file Excel', true); }
  const codes = new Map(S.units.map((u) => [u.code.toUpperCase(), u.code]));
  const pkgKey = new Map(projPackages().flatMap((k) => [[String(k.code).toLowerCase(), k.id], [String(k.name).toLowerCase(), k.id]]).filter(([x]) => x));
  const errs = [], tasks = [];
  rows.forEach((r, i) => {
    const t = {};
    Object.entries(TPL_COLS).forEach(([h, k]) => { if (r[h] !== undefined) t[k] = r[h] instanceof Date ? r[h] : String(r[h]).trim(); });
    if (!t.name && !t.wbs) return;
    try {
      if (!t.name) throw new Error('thiếu tên đầu việc');
      t.plan_start = normDate(t.plan_start); t.plan_end = normDate(t.plan_end);
      if (t.plan_start && t.plan_end && t.plan_end < t.plan_start) throw new Error('kết thúc KH trước bắt đầu KH');
      if (t.unit) { const c = codes.get(t.unit.toUpperCase()); if (!c) throw new Error(`nhà thầu "${t.unit}" chưa có trong danh mục`); t.unit = c; }
      if (t.pkg) { const id = pkgKey.get(String(t.pkg).toLowerCase()); if (!id) throw new Error(`hạng mục chính "${t.pkg}" chưa có trong dự án`); t.package_id = id; }
      delete t.pkg;
      if (t.plan_days !== undefined && t.plan_days !== '' && isNaN(+t.plan_days)) throw new Error('số ngày KH không phải số');
      tasks.push(t);
    } catch (e) { errs.push(`Dòng ${i + 2}: ${e.message}`); }
  });
  const p = curProject();
  openDialog(`
    <div class="dlg-head"><h2>Nhập đầu việc vào ${esc(p.code || p.name)}</h2><button class="x" data-act="close" aria-label="Đóng">×</button></div>
    <div class="dlg-body">
      ${projPackages().length ? `<label class="field"><span>Hạng mục chính cho các dòng không ghi cột “Hạng mục chính”</span><select id="impPkg">${pkgOptions((S.filters.pkg && S.filters.pkg !== '__none' && S.filters.pkg) || projPackages()[0].id, '(Không thuộc hạng mục chính)')}</select></label>` : ''}
      <div class="note-box">File <b>${esc(file.name)}</b>: ${tasks.length} đầu việc hợp lệ${errs.length ? `, <b style="color:var(--late)">${errs.length} dòng lỗi</b>` : ''}.</div>
      ${errs.length ? `<div class="note-box" style="color:var(--late)">${errs.slice(0, 30).map(esc).join('<br>')}${errs.length > 30 ? '<br>…' : ''}</div><small class="muted">Sửa file rồi nhập lại – chỉ nhập khi không còn dòng lỗi.</small>` : ''}
      <div class="table-wrap" style="max-height:45vh"><table><thead><tr><th>HM chính</th><th>WBS</th><th>Đầu việc</th><th>Pha</th><th>Nhà thầu</th><th>Bắt đầu</th><th>Kết thúc</th></tr></thead><tbody>
        ${tasks.slice(0, 200).map((t) => `<tr><td>${t.package_id ? esc(pkgById(t.package_id).code || pkgById(t.package_id).name) : '<small class="muted">(mặc định)</small>'}</td><td>${esc(t.wbs)}</td><td>${esc(t.name)}<br><small>${esc(t.section)}</small></td><td>${esc(t.phase)}</td><td>${esc(t.unit)}</td><td>${fmtD(t.plan_start)}</td><td>${fmtD(t.plan_end)}</td></tr>`).join('')}
      </tbody></table></div></div>
    <div class="dlg-foot"><button class="btn ghost" data-act="close">Hủy</button><button class="btn" id="doImport" ${errs.length || !tasks.length ? 'disabled' : ''}>Nhập ${tasks.length} đầu việc</button></div>`);
  $('#doImport').onclick = async () => {
    $('#doImport').disabled = true;
    try {
      const def = $('#impPkg')?.value || '';
      const r = await api('importTasks', { project_id: p.id, tasks: tasks.map((t) => ({ ...t, package_id: t.package_id || def })) });
      r.tasks.forEach((t) => { t.progress = +t.progress || 0; S.tasks.push(t); });
      closeDialog(); toast(`Đã nhập ${r.tasks.length} đầu việc`); rerender();
    } catch (e) { toast(e.message, true); $('#doImport').disabled = false; }
  };
}

/* ---------- Người dùng ---------- */
function adminUsers() {
  const list = [...S.users].sort((a, b) => (a.status === 'pending' ? -1 : 0) - (b.status === 'pending' ? -1 : 0));
  $('#adminBody').innerHTML = `<div class="table-wrap"><table><thead><tr><th>Email</th><th>Họ tên</th><th>Điện thoại</th><th>Đơn vị</th><th>Vai trò</th><th>Trạng thái</th><th>Đăng ký</th><th>Đăng nhập cuối</th></tr></thead><tbody>
    ${list.map((u) => `<tr class="${u.status === 'pending' ? 'pending' : ''}" data-user="${esc(u.email)}">
      <td>${esc(u.email)}</td><td>${esc(u.name)}</td><td>${esc(u.phone)}</td>
      <td><select data-uf="unit">${unitOptions(u.unit, '(Không)')}</select></td>
      <td><select data-uf="role">${Object.entries(ROLES).map(([k, v]) => `<option value="${k}" ${k === u.role ? 'selected' : ''}>${v}</option>`).join('')}</select></td>
      <td><select data-uf="status">${Object.entries(USER_STATUS).map(([k, v]) => `<option value="${k}" ${k === u.status ? 'selected' : ''}>${v}</option>`).join('')}</select>
        ${u.status === 'pending' ? `<button class="btn sm" data-approve="${esc(u.email)}" style="margin-top:4px">Duyệt</button>` : ''}</td>
      <td>${fmtTs(u.created_at)}</td><td>${fmtTs(u.last_login)}</td></tr>`).join('') || '<tr><td colspan="8" class="empty">Chưa có người dùng</td></tr>'}
  </tbody></table></div>
  <p class="muted" style="font-size:.82rem">Vai trò: <b>Quản trị</b> (PTC3, TVGS PECC4) – toàn quyền, duyệt tài khoản; <b>Giám sát/BQLDA</b> – cập nhật mọi công việc, sửa kế hoạch; <b>Đơn vị thi công</b> – chỉ cập nhật công việc của đơn vị mình; <b>Chỉ xem</b> – xem dashboard.</p>`;
}
/* ============================ EXPORT ============================ */
function exportXlsx(name, sheets) {
  if (!window.XLSX) return toast('Thư viện Excel chưa tải xong', true);
  const wb = XLSX.utils.book_new();
  Object.entries(sheets).forEach(([n, rows]) => XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(rows), n));
  XLSX.writeFile(wb, name);
}
const fileTag = () => String(curProject()?.code || curProject()?.id || 'DuAn').replace(/[^\w-]+/g, '_');
function exportTasks() {
  const now = new Date();
  exportXlsx(`TienDo_${fileTag()}_${today()}.xlsx`, {
    'Tien do': filtered({ cls: '' }).map((t) => ({
      'Hạng mục chính': pkgById(t.package_id)?.name || '', 'WBS': t.wbs, 'Phần việc': t.section, 'Nhóm': t.group, 'Nhóm con': t.subgroup, 'Công việc': t.name, 'Pha': t.phase, 'Đơn vị': t.unit,
      'Bắt đầu KH': t.plan_start, 'Kết thúc KH': t.plan_end, 'Số ngày KH': t.plan_days, 'Bắt đầu TT': t.actual_start, 'Hoàn thành TT': t.actual_end,
      '% hoàn thành': t.progress, 'Tình trạng': CLS[klass(t, now)].label, 'Trạng thái nhập': t.status, 'Số ngày chậm': t.delay_days,
      'Ghi chú': t.note, 'Cập nhật bởi': t.updated_by, 'Cập nhật lúc': t.updated_at,
    })),
  });
}
function exportLog() {
  exportXlsx(`NhatKy_${fileTag()}_${today()}.xlsx`, {
    'Nhat ky': S.updates.filter((u) => taskById(u.task_id)?.project_id === S.projectId).sort((a, b) => (a.ts < b.ts ? -1 : 1)).map((u) => {
      const t = taskById(u.task_id);
      return { 'Thời điểm': u.ts, 'Ngày báo cáo': u.report_date, 'Hạng mục chính': pkgById(t?.package_id)?.name || '', 'WBS': t?.wbs, 'Pha': t?.phase, 'Công việc': t?.name, 'Đơn vị': u.unit || t?.unit, 'Người cập nhật': u.user_name, 'Email': u.email, '%': u.progress, 'Trạng thái': u.status, 'Nội dung': u.note, 'Số ảnh': u.photos ? u.photos.split(',').filter(Boolean).length : 0 };
    }),
  });
}

/* ============================ EVENTS ============================ */
document.addEventListener('click', async (e) => {
  const el = e.target.closest('[data-act],[data-view],[data-go],[data-task],[data-photos],[data-edit-task],[data-del-task],[data-atab],[data-approve],[data-zoom],[data-open-project],[data-edit-project],[data-del-project],[data-edit-unit],[data-del-unit],[data-pkg],[data-edit-pkg],[data-del-pkg],[data-pkg-tasks],[data-fv],[data-sort]');
  if (!el) {
    if (!e.target.closest('#userMenu,#userChip')) $('#userMenu').hidden = true;
    return;
  }
  const ds = el.dataset;
  if (ds.view) return go(ds.view);
  if (ds.go) return go(ds.go);
  if (ds.photos) { e.stopPropagation(); return showPhotos(ds.photos); }
  if (ds.editTask) return openTaskEdit(ds.editTask);
  if (ds.task && !el.closest('#dlg')) return openTask(ds.task);
  if (ds.atab) { S.adminTab = ds.atab; return rerender(); }
  if (ds.openProject) { setProject(ds.openProject); renderProjSel(); toast('Đã chuyển sang dự án ' + (curProject()?.code || curProject()?.name)); return rerender(); }
  if (ds.editProject) return openProjectEdit(ds.editProject);
  if (ds.delProject) return deleteProject(ds.delProject);
  if (ds.editUnit) return openUnitEdit(ds.editUnit);
  if (ds.fv) return setFv({ mode: ds.fv });
  if (ds.sort) return setFv(S.fv.sort === ds.sort ? { dir: S.fv.dir === 'asc' ? 'desc' : 'asc' } : { sort: ds.sort, dir: ds.sort === 'modified' ? 'desc' : 'asc' });
  if (ds.pkg) { S.filters.pkg = S.filters.pkg === ds.pkg ? '' : ds.pkg; S.filters.section = ''; return rerender(); }
  if (ds.editPkg) return openPackageEdit(ds.editPkg);
  if (ds.delPkg) return deletePackage(ds.delPkg);
  if (ds.pkgTasks) { S.filters.pkg = ds.pkgTasks; S.filters.section = ''; S.adminTab = 'tasks'; return rerender(); }
  if (ds.delUnit) return deleteUnit(ds.delUnit);
  if (ds.zoom) { S.ganttPx = +ds.zoom; return rerender(); }
  if (ds.delTask) {
    if (!(await confirmBox({ title: 'Xóa đầu việc này?', message: 'Nhật ký cập nhật và ảnh vẫn được giữ trong Google Sheet.', ok: 'Xóa đầu việc', danger: true }))) return;
    try { await api('deleteTasks', { ids: [ds.delTask] }); S.tasks = S.tasks.filter((t) => t.id !== ds.delTask); closeDialog(); toast('Đã xóa'); rerender(); } catch (err) { toast(err.message, true); }
    return;
  }
  if (ds.approve) return saveUser(ds.approve, { status: 'active' });
  switch (ds.act) {
    case 'close': return closeDialog();
    case 'close-light': return $('#lightbox').close();
    case 'logout': return logout();
    case 'retry': return startSession();
    case 'refresh':
    case 'sync': return sync(true);
    case 'export-tasks': return exportTasks();
    case 'export-log': return exportLog();
    case 'print': return window.print();
    case 'copy-link': return copyLink();
    case 'report': return openReport();
    case 'open-db':
      if (DEMO) return toast('Bản demo không có Google Sheet – dữ liệu demo lưu trên trình duyệt này.', 'info');
      if (!S.dbUrl) return toast('Máy chủ chưa gửi link Google Sheet. Cập nhật Code.gs mới lên Apps Script và tạo phiên bản triển khai mới.', 'err');
      window.open(S.dbUrl, '_blank', 'noopener');
      return toast('Đã mở Google Sheet database trong tab mới. Nếu Google báo không có quyền, nhờ chủ sở hữu file chia sẻ cho email của bạn.', 'info');
    case 'help': $('#userMenu').hidden = true; return openGuide();
    case 'about': $('#userMenu').hidden = true; return openGuide('about');
    case 'fv-dir': return setFv({ dir: S.fv.dir === 'asc' ? 'desc' : 'asc' });
    case 'mine': S.filters.unit = S.user.unit; return rerender();
    case 'new-task': return openTaskEdit(null);
    case 'new-project': return openProjectEdit(null);
    case 'new-pkg': return openPackageEdit(null);
    case 'bulk-pkg': {
      const ids = $$('.sel:checked').map((c) => c.value);
      if (!ids.length) return toast('Chọn ít nhất một đầu việc', true);
      const pid = $('#bulkPkg').value;
      try {
        await api('bulkUpdateTasks', { task_ids: ids, package_id: pid });
        S.tasks.forEach((t) => { if (ids.includes(t.id)) t.package_id = pid; });
        toast(`Đã chuyển ${ids.length} đầu việc sang ${pid ? pkgById(pid).code || pkgById(pid).name : '(không thuộc hạng mục)'}`); rerender();
      } catch (err) { toast(err.message, true); }
      return;
    }
    case 'new-unit': return openUnitEdit(null);
    case 'import-tasks': return $('#impFile').click();
    case 'tpl-tasks': return downloadTemplate();
    case 'bulk-delete': {
      const ids = $$('.sel:checked').map((c) => c.value);
      if (!ids.length) return toast('Chọn ít nhất một đầu việc', true);
      if (!(await confirmBox({ title: `Xóa ${ids.length} đầu việc đã chọn?`, message: 'Nhật ký cập nhật và ảnh vẫn được giữ trong Google Sheet.', ok: `Xóa ${ids.length} đầu việc`, danger: true }))) return;
      try { await api('deleteTasks', { ids }); S.tasks = S.tasks.filter((t) => !ids.includes(t.id)); toast(`Đã xóa ${ids.length} đầu việc`); rerender(); } catch (err) { toast(err.message, true); }
      return;
    }
    case 'demo-reset': $('#userMenu').hidden = true; if (await confirmBox({ title: 'Đặt lại dữ liệu demo?', message: 'Mọi thay đổi đã nhập trong bản demo sẽ mất; dữ liệu được nạp lại từ file Excel gốc.', ok: 'Đặt lại', danger: true })) Demo.reset(); return;
    case 'profile': $('#userMenu').hidden = true; return openProfile();
    case 'bulk-assign': {
      const ids = $$('.sel:checked').map((c) => c.value);
      if (!ids.length) return toast('Chọn ít nhất một công việc', true);
      const unit = $('#bulkUnit').value;
      try { await api('bulkAssignUnit', { task_ids: ids, unit }); S.tasks.forEach((t) => { if (ids.includes(t.id)) t.unit = unit; }); toast(`Đã gán ${ids.length} công việc cho ${unit || '(trống)'}`); rerender(); } catch (err) { toast(err.message, true); }
    }
  }
});
$('#userChip').addEventListener('click', () => { $('#userMenu').hidden = !$('#userMenu').hidden; });
$('#dlg').addEventListener('click', (e) => { if (e.target.id === 'dlg') closeDialog(); });
$('#lightbox').addEventListener('click', (e) => { if (e.target.id === 'lightbox') $('#lightbox').close(); });

let qTimer;
document.addEventListener('input', (e) => {
  const k = e.target.dataset?.filter;
  if (k !== 'q') return;
  clearTimeout(qTimer);
  qTimer = setTimeout(() => {
    S.filters.q = e.target.value;
    const pos = e.target.selectionStart;
    rerender();
    const inp = $('[data-filter="q"]');
    if (inp) { inp.focus(); inp.setSelectionRange(pos, pos); }
  }, 250);
});
document.addEventListener('change', async (e) => {
  const t = e.target;
  if (t.dataset.filter && t.dataset.filter !== 'q') { S.filters[t.dataset.filter] = t.value; if (t.dataset.filter === 'pkg') S.filters.section = ''; return rerender(); }
  if (t.name === 'unit' && t.form?.id === 'regForm') { $('#regNote').innerHTML = regNote(t.value); return; }
  if (t.id === 'projSel') {
    if (t.value === '__new') { t.value = S.projectId || ''; return openProjectEdit(null); }
    setProject(t.value); renderProjSel(); return rerender();
  }
  if (t.id === 'fvSort') return setFv({ sort: t.value, dir: t.value === 'modified' ? 'desc' : 'asc' });
  if (t.id === 'fvGroup') return setFv({ group: t.checked });
  if (t.id === 'impFile' && t.files[0]) { const f = t.files[0]; t.value = ''; return importTasksFile(f); }
  if (t.dataset.uf) return saveUser(t.closest('tr').dataset.user, { [t.dataset.uf]: t.value });
  if (t.id === 'demoRole' || t.id === 'demoUnit') {
    const me = Demo.me();
    me.role = $('#demoRole').value; me.unit = $('#demoUnit').value;
    Demo.save();
    await reload(); renderUser(); rerender();
    toast(`Đang xem với vai trò ${ROLES[me.role]}${me.unit ? ' – ' + me.unit : ''}`);
  }
});
document.addEventListener('submit', async (e) => {
  e.preventDefault();
  const f = e.target;
  if (!['regForm', 'profileForm'].includes(f.id)) return;
  const d = Object.fromEntries(new FormData(f));
  const btn = f.querySelector('[type=submit]');
  if (btn) btn.disabled = true;
  try {
    if (f.id === 'regForm') {
      const r = await api('register', d);
      S.user = r.user;
      if (r.user.status === 'active') { S.justRegistered = true; S.loginKind = ''; return startSession(); }
      toast('Đã gửi đăng ký – chờ quản trị viên duyệt', 'info');
      return showPending();
    }
    if (f.id === 'profileForm') { const r = await api('saveProfile', d); S.user = r.user; renderUser(); closeDialog(); return toast('Đã lưu thông tin'); }
  } catch (err) { toast(err.message, true); } finally { if (btn) btn.disabled = false; }
});

async function saveUser(email, patch) {
  try {
    const r = await api('saveUser', { email, ...patch });
    const u = S.users.find((x) => x.email === email);
    Object.assign(u, r.user);
    const pend = S.users.filter((x) => x.status === 'pending').length;
    $('#pendingBadge').hidden = !pend; $('#pendingBadge').textContent = pend;
    toast('Đã cập nhật người dùng');
    if (patch.status) rerender();
  } catch (err) { toast(err.message, true); rerender(); }
}
function openProfile() {
  const u = S.user;
  openDialog(`<div class="dlg-head"><h2>Thông tin cá nhân</h2><button class="x" data-act="close" aria-label="Đóng">×</button></div>
    <form class="dlg-body" id="profileForm">
      <div class="info-grid" style="grid-template-columns:1fr 1fr"><div>Email<b>${esc(u.email)}</b></div><div>Vai trò<b>${esc(ROLES[u.role])}${u.unit ? ' · ' + esc(u.unit) : ''}</b></div></div>
      <label class="field"><span>Họ và tên</span><input type="text" name="name" value="${esc(u.name)}" maxlength="100" required></label>
      <label class="field"><span>Số điện thoại</span><input type="tel" name="phone" value="${esc(u.phone)}" maxlength="30"></label>
      <small class="muted">Đổi đơn vị/vai trò: liên hệ quản trị viên.</small>
      <button class="btn" type="submit">Lưu</button></form>`);
}

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') $('#userMenu').hidden = true;
  // dòng bảng Chi tiết: Enter / Space để mở đầu việc
  if ((e.key === 'Enter' || e.key === ' ') && e.target.matches('tr[data-task]')) { e.preventDefault(); openTask(e.target.dataset.task); }
});
window.matchMedia('(prefers-color-scheme: dark)').addEventListener?.('change', () => { if (S.view === 'dashboard' && S.user) rerender(); });

boot();
