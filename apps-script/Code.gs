/**
 * Backend API cho Web App quản lý hiện trường nhiều dự án (khởi đầu: NCS TBA 500kV Di Linh).
 * Cấu trúc: Dự án > Hạng mục chính (Packages) > Phần việc (section) > Đầu việc (Tasks).
 * Database: chính Google Sheet chứa script này (Projects, Packages, Tasks, Updates, Users, Units, Config).
 * Xác thực: Google ID token (Sign in with Google) được kiểm tra ở server.
 * Các sheet được đọc/ghi theo TÊN CỘT ở dòng 1, nên có thể thêm cột mới mà không lệch dữ liệu.
 */

var SCHEMA = {
  Projects: ['id', 'code', 'name', 'location', 'owner', 'start_date', 'end_date', 'status',
    'units', 'description', 'created_by', 'created_at', 'updated_at'],
  Packages: ['id', 'project_id', 'code', 'name', 'start_date', 'end_date', 'status', 'description',
    'order', 'created_by', 'created_at', 'updated_at'],
  Tasks: ['id', 'project_id', 'package_id', 'wbs', 'section', 'group', 'subgroup', 'name', 'phase', 'unit',
    'plan_start', 'plan_end', 'plan_days', 'actual_start', 'actual_end',
    'progress', 'status', 'delay_days', 'note', 'updated_by', 'updated_at', 'order'],
  Updates: ['id', 'ts', 'report_date', 'task_id', 'email', 'user_name', 'unit',
    'progress', 'status', 'actual_start', 'actual_end', 'delay_days', 'note', 'photos'],
  Users: ['email', 'name', 'phone', 'unit', 'role', 'status', 'created_at', 'last_login'],
  Units: ['code', 'name', 'type', 'contact', 'phone', 'email', 'note'],
  Config: ['key', 'value']
};
var ROLES = ['admin', 'manager', 'contractor', 'viewer'];
var USER_STATUS = ['pending', 'active', 'disabled'];
var TASK_STATUS = ['', 'Chưa bắt đầu', 'Đang thi công', 'Tạm dừng', 'Hoàn thành'];
var PROJECT_STATUS = ['Chuẩn bị', 'Đang thực hiện', 'Tạm dừng', 'Hoàn thành'];
// Loại nhà thầu mặc định; admin thêm/sửa/xóa trong app (lưu ở Config › UNIT_TYPES dạng JSON)
var DEFAULT_UNIT_TYPES = ['Quản lý dự án', 'Tư vấn giám sát', 'Thi công', 'Cung cấp thiết bị', 'Khác'];
var MAX_PHOTOS = 6;
var MAX_PHOTO_B64 = 3 * 1024 * 1024;
var MAX_IMPORT = 2000;

/* ============================ SETUP ============================ */

/** Chạy 1 lần từ trình soạn thảo Apps Script (chạy lại an toàn – dùng để nâng cấp cấu trúc sheet). */
function setup() {
  var ss = SpreadsheetApp.getActive();
  PropertiesService.getScriptProperties().setProperty('SPREADSHEET_ID', ss.getId());
  Object.keys(SCHEMA).forEach(function (name) {
    var sh = ss.getSheetByName(name) || ss.insertSheet(name);
    var cols = SCHEMA[name];
    var hdr = sh.getLastRow() ? sh.getRange(1, 1, 1, sh.getLastColumn()).getValues()[0].map(String) : [];
    var missing = cols.filter(function (c) { return hdr.indexOf(c) < 0; });
    if (missing.length) sh.getRange(1, hdr.length + 1, 1, missing.length).setValues([missing]);
    sh.getRange(1, 1, Math.max(sh.getMaxRows(), 2), hdr.length + missing.length).setNumberFormat('@');
    sh.setFrozenRows(1);
  });
  HDR = {};
  var cfg = getConfig_();
  var defaults = {
    PROJECT_NAME: 'Thay thế MBA AT1 - TBA 500kV Di Linh',
    ADMIN_EMAILS: Session.getEffectiveUser().getEmail(),
    AUTO_APPROVE: 'TRUE',
    ADMIN_UNITS: 'PTC3,PECC4',
    GOOGLE_CLIENT_ID: '',
    PHOTO_FOLDER_ID: ''
  };
  Object.keys(defaults).forEach(function (k) {
    if (cfg[k] === undefined || cfg[k] === '') setConfig_(k, cfg[k] || defaults[k]);
  });
  [['PTC3', 'Công ty Truyền tải điện 3 (PTC3)', 'Quản lý dự án'],
    ['PECC4', 'Tư vấn giám sát (PECC4)', 'Tư vấn giám sát']].forEach(function (u) {
    if (!unitExists_(u[0])) appendRow_('Units', { code: u[0], name: u[1], type: u[2] });
  });
  // Nâng cấp từ bản 1 dự án: gom các công việc chưa có project_id vào một dự án mặc định
  var orphans = readTable_('Tasks').filter(function (t) { return !t.project_id; });
  if (orphans.length) {
    var p = readTable_('Projects')[0];
    if (!p) {
      p = { id: 'P001', code: 'AT1-DILINH', name: getConfig_().PROJECT_NAME, status: 'Đang thực hiện', created_at: nowIso_() };
      appendRow_('Projects', p);
    }
    orphans.forEach(function (t) { t.project_id = p.id; writeRow_('Tasks', t); });
  }
  if (!getConfig_().PHOTO_FOLDER_ID) {
    var parent = DriveApp.getFileById(ss.getId()).getParents();
    var folder = (parent.hasNext() ? parent.next() : DriveApp.getRootFolder())
      .createFolder('DiLinh_HienTruong_Anh');
    setConfig_('PHOTO_FOLDER_ID', folder.getId());
  }
  Logger.log('Setup xong. Nhớ điền GOOGLE_CLIENT_ID trong sheet Config rồi Deploy > Web app.');
}

/* ============================ HTTP ============================ */

function doGet() {
  return json_({ ok: true, service: 'Field progress API', time: new Date().toISOString() });
}

function doPost(e) {
  try {
    HDR = {};
    var req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
    var auth = verifyToken_(req.idToken);
    var data = route_(String(req.action || ''), req.data || {}, auth);
    return json_({ ok: true, data: data });
  } catch (err) {
    return json_({ ok: false, error: String((err && err.message) || err) });
  }
}

function json_(o) {
  return ContentService.createTextOutput(JSON.stringify(o)).setMimeType(ContentService.MimeType.JSON);
}

function route_(action, d, auth) {
  if (action === 'me') return me_(auth);
  if (action === 'register') return register_(auth, d);

  var user = requireUser_(auth);
  var ADMIN = ['admin'], MGR = ['admin', 'manager'];
  var routes = {
    bootstrap: [null, bootstrap_, false],
    updateTask: [null, updateTask_, true],
    getPhoto: [null, getPhoto_, false],
    saveProfile: [null, saveProfile_, true],
    saveTask: [MGR, saveTask_, true],
    deleteTasks: [MGR, deleteTasks_, true],
    importTasks: [MGR, importTasks_, true],
    syncTasks: [MGR, syncTasks_, true],
    bulkAssignUnit: [MGR, bulkAssignUnit_, true],
    bulkUpdateTasks: [MGR, bulkUpdateTasks_, true],
    saveProject: [ADMIN, saveProject_, true],
    savePackage: [MGR, savePackage_, true],
    deletePackage: [ADMIN, deletePackage_, true],
    deleteProject: [ADMIN, deleteProject_, true],
    saveUnit: [ADMIN, saveUnit_, true],
    saveUnitType: [ADMIN, saveUnitType_, true],
    deleteUnitType: [ADMIN, deleteUnitType_, true],
    deleteUnit: [ADMIN, deleteUnit_, true],
    saveUser: [ADMIN, saveUser_, true]
  };
  var r = routes[action];
  if (!r) throw new Error('Hành động không hợp lệ: ' + action);
  if (r[0]) requireRole_(user, r[0]);
  return r[2] ? withLock_(function () { return r[1](user, d); }) : r[1](user, d);
}

function withLock_(fn) {
  var lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { return fn(); } finally { lock.releaseLock(); }
}

/* ============================ AUTH ============================ */

function verifyToken_(token) {
  if (!token) throw new Error('AUTH: Chưa đăng nhập');
  var cache = CacheService.getScriptCache();
  var key = 'tok_' + Utilities.base64EncodeWebSafe(
    Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, token)).slice(0, 40);
  var hit = cache.get(key);
  if (hit) return JSON.parse(hit);

  var res = UrlFetchApp.fetch('https://oauth2.googleapis.com/tokeninfo?id_token=' + encodeURIComponent(token),
    { muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) throw new Error('AUTH: Phiên đăng nhập hết hạn, vui lòng đăng nhập lại');
  var p = JSON.parse(res.getContentText());
  var clientId = getConfig_().GOOGLE_CLIENT_ID;
  if (!clientId) throw new Error('Chưa cấu hình GOOGLE_CLIENT_ID trong sheet Config');
  if (p.aud !== clientId) throw new Error('AUTH: Token không dành cho ứng dụng này');
  if (p.iss !== 'accounts.google.com' && p.iss !== 'https://accounts.google.com') throw new Error('AUTH: Token không hợp lệ');
  if (String(p.email_verified) !== 'true') throw new Error('AUTH: Email Google chưa xác minh');
  var ttl = Math.min(Number(p.exp) - Math.floor(Date.now() / 1000), 600);
  if (ttl <= 0) throw new Error('AUTH: Phiên đăng nhập hết hạn, vui lòng đăng nhập lại');
  var auth = { email: String(p.email).toLowerCase(), name: p.name || '', picture: p.picture || '' };
  cache.put(key, JSON.stringify(auth), ttl);
  return auth;
}

function isAdminEmail_(email) {
  return String(getConfig_().ADMIN_EMAILS || '').toLowerCase().split(/[,;\s]+/).indexOf(email) >= 0;
}

function adminUnits_() {
  return String(getConfig_().ADMIN_UNITS || '').toUpperCase().split(/[,;\s]+/).filter(String);
}

function findUser_(email) {
  return readTable_('Users').filter(function (u) { return String(u.email).toLowerCase() === email; })[0] || null;
}

function requireUser_(auth) {
  var u = findUser_(auth.email);
  if (!u) throw new Error('NOT_REGISTERED: Tài khoản chưa đăng ký');
  if (u.status !== 'active') throw new Error('NOT_ACTIVE: Tài khoản đang chờ duyệt hoặc đã bị khóa');
  return u;
}

function requireRole_(user, roles) {
  if (roles.indexOf(user.role) < 0) throw new Error('Bạn không có quyền thực hiện thao tác này');
}

function canEditTask_(user, task) {
  if (user.role === 'admin' || user.role === 'manager') return true;
  return user.role === 'contractor' && !!task.unit && task.unit === user.unit;
}

/* ============================ ACCOUNT ============================ */

function publicConfig_() {
  var c = getConfig_();
  return { PROJECT_NAME: c.PROJECT_NAME || '', AUTO_APPROVE: c.AUTO_APPROVE === 'TRUE', ADMIN_UNITS: adminUnits_(), UNIT_TYPES: unitTypes_() };
}

function me_(auth) {
  var u = findUser_(auth.email);
  if (u) {
    u.last_login = nowIso_();
    writeRow_('Users', u);
  }
  return { profile: auth, user: u ? clean_(u) : null, config: publicConfig_(), units: readTable_('Units').map(clean_) };
}

function register_(auth, d) {
  return withLock_(function () {
    if (findUser_(auth.email)) throw new Error('Tài khoản đã đăng ký');
    var name = str_(d.name || auth.name, 100);
    if (!name) throw new Error('Vui lòng nhập họ tên');
    var unit = str_(d.unit, 30);
    if (unit && !unitExists_(unit)) throw new Error('Đơn vị không tồn tại');
    var admin = isAdminEmail_(auth.email);
    var auto = getConfig_().AUTO_APPROVE === 'TRUE';
    // Đơn vị quản trị (PTC3, TVGS PECC4): nhận quyền Quản trị nhưng phải được admin hiện có duyệt
    var adminUnit = !!unit && adminUnits_().indexOf(unit) >= 0;
    var u = {
      email: auth.email, name: name, phone: str_(d.phone, 30), unit: unit,
      role: (admin || adminUnit) ? 'admin' : (unit ? 'contractor' : 'viewer'),
      status: admin || (auto && !adminUnit) ? 'active' : 'pending',
      created_at: nowIso_(), last_login: nowIso_()
    };
    appendRow_('Users', u);
    return { user: u };
  });
}

function saveProfile_(user, d) {
  user.name = str_(d.name, 100) || user.name;
  user.phone = str_(d.phone, 30);
  writeRow_('Users', user);
  return { user: clean_(user) };
}

/** Dòng thêm tay trên Google Sheet nhưng chưa có id: tự cấp id để app sửa/cập nhật được. */
function fixMissingIds_() {
  [['Projects', 'P'], ['Packages', 'H'], ['Tasks', 'T']].forEach(function (x) {
    var rows = readTable_(x[0]);
    var miss = rows.filter(function (r) { return !r.id && r.name; });
    if (!miss.length) return;
    withLock_(function () {
      rows = readTable_(x[0]);
      rows.filter(function (r) { return !r.id && r.name; }).forEach(function (r) {
        r.id = nextId_(x[1], rows);
        writeRow_(x[0], r);
      });
    });
  });
}

function bootstrap_(user) {
  fixMissingIds_();
  var res = {
    user: clean_(user),
    config: publicConfig_(),
    units: readTable_('Units').map(clean_),
    projects: readTable_('Projects').map(clean_),
    packages: readTable_('Packages').map(clean_).sort(function (a, b) { return Number(a.order) - Number(b.order); }),
    tasks: readTable_('Tasks').map(clean_).sort(function (a, b) { return Number(a.order) - Number(b.order); }),
    updates: readTable_('Updates').slice(-3000).map(clean_),
    synced_at: nowIso_()
  };
  if (user.role === 'admin') {
    res.users = readTable_('Users').map(clean_);
    res.dbUrl = ss_().getUrl(); // link Google Sheet database – chỉ gửi cho Quản trị
  }
  return res;
}

/* ============================ FIELD UPDATE ============================ */

function updateTask_(user, d) {
  var task = readTable_('Tasks').filter(function (t) { return t.id === d.task_id; })[0];
  if (!task) throw new Error('Không tìm thấy công việc');
  if (!canEditTask_(user, task)) throw new Error('Công việc này thuộc đơn vị khác, bạn không được cập nhật');

  var progress = d.progress === '' || d.progress == null ? Number(task.progress || 0) : clampNum_(d.progress, 0, 100);
  var status = TASK_STATUS.indexOf(d.status) >= 0 ? d.status : task.status;
  var today = nowIso_().slice(0, 10);
  if (progress >= 100) status = 'Hoàn thành';
  else if (status === 'Hoàn thành') status = 'Đang thi công';
  else if (progress > 0 && !status) status = 'Đang thi công';

  task.progress = progress;
  task.status = status;
  task.actual_start = dateStr_(d.actual_start) || task.actual_start || (progress > 0 ? today : '');
  task.actual_end = progress >= 100 ? (dateStr_(d.actual_end) || task.actual_end || today) : '';
  if (d.delay_days !== '' && d.delay_days != null) task.delay_days = clampNum_(d.delay_days, -365, 365);
  task.updated_by = user.email;
  task.updated_at = nowIso_();

  var photoIds = savePhotos_(d.photos || [], task, user);
  var up = {
    id: 'U' + new Date().getTime().toString(36) + Math.floor(Math.random() * 1e4),
    ts: nowIso_(), report_date: dateStr_(d.report_date) || today, task_id: task.id,
    email: user.email, user_name: user.name, unit: user.unit,
    progress: progress, status: status, actual_start: task.actual_start, actual_end: task.actual_end,
    delay_days: task.delay_days, note: str_(d.note, 2000), photos: photoIds.join(',')
  };
  writeRow_('Tasks', task);
  appendRow_('Updates', up);
  return { task: clean_(task), update: up };
}

function savePhotos_(photos, task, user) {
  if (!photos.length) return [];
  if (photos.length > MAX_PHOTOS) throw new Error('Tối đa ' + MAX_PHOTOS + ' ảnh mỗi lần cập nhật');
  var folder = DriveApp.getFolderById(getConfig_().PHOTO_FOLDER_ID);
  return photos.map(function (p, i) {
    var b64 = String(p.data || '');
    if (b64.length > MAX_PHOTO_B64) throw new Error('Ảnh quá lớn');
    var mime = /^image\/(jpeg|png|webp)$/.test(p.mime) ? p.mime : 'image/jpeg';
    var name = task.id + '_' + Utilities.formatDate(new Date(), tz_(), 'yyyyMMdd_HHmmss') + '_' + (i + 1) + '.jpg';
    var file = folder.createFile(Utilities.newBlob(Utilities.base64Decode(b64), mime, name));
    file.setDescription(task.wbs + ' ' + task.name + ' | ' + user.email);
    return file.getId();
  });
}

function getPhoto_(user, d) {
  var id = String(d.id || '');
  if (!/^[\w-]{10,}$/.test(id)) throw new Error('Ảnh không hợp lệ');
  var file = DriveApp.getFileById(id);
  var folderId = getConfig_().PHOTO_FOLDER_ID;
  var parents = file.getParents(), ok = false;
  while (parents.hasNext()) if (parents.next().getId() === folderId) ok = true;
  if (!ok) throw new Error('Ảnh không thuộc thư mục dự án');
  var blob = file.getBlob();
  return { mime: blob.getContentType(), data: Utilities.base64Encode(blob.getBytes()) };
}

/* ============================ PROJECTS ============================ */

function saveProject_(user, d) {
  var list = readTable_('Projects');
  var p = d.id ? list.filter(function (x) { return x.id === d.id; })[0] : null;
  if (d.id && !p) throw new Error('Không tìm thấy dự án');
  var isNew = !p;
  if (isNew) p = { id: nextId_('P', list), created_by: user.email, created_at: nowIso_() };

  p.name = str_(d.name !== undefined ? d.name : p.name, 300);
  if (!p.name) throw new Error('Vui lòng nhập tên dự án');
  if (d.code !== undefined) p.code = str_(d.code, 50);
  if (p.code && list.some(function (x) { return x.id !== p.id && String(x.code).toLowerCase() === p.code.toLowerCase(); })) {
    throw new Error('Mã dự án "' + p.code + '" đã tồn tại');
  }
  ['location', 'owner'].forEach(function (k) { if (d[k] !== undefined) p[k] = str_(d[k], 300); });
  if (d.description !== undefined) p.description = str_(d.description, 3000);
  if (d.start_date !== undefined) p.start_date = dateStr_(d.start_date);
  if (d.end_date !== undefined) p.end_date = dateStr_(d.end_date);
  if (p.start_date && p.end_date && p.end_date < p.start_date) throw new Error('Ngày kết thúc phải sau ngày bắt đầu');
  if (d.status !== undefined) {
    if (PROJECT_STATUS.indexOf(d.status) < 0) throw new Error('Trạng thái dự án không hợp lệ');
    p.status = d.status;
  }
  if (!p.status) p.status = 'Đang thực hiện';
  if (d.units !== undefined) {
    var codes = (Array.isArray(d.units) ? d.units : String(d.units).split(',')).map(function (c) { return str_(c, 30); }).filter(String);
    codes.forEach(function (c) { if (!unitExists_(c)) throw new Error('Nhà thầu không tồn tại: ' + c); });
    p.units = codes.join(',');
  }
  p.updated_at = nowIso_();
  if (isNew) appendRow_('Projects', p); else writeRow_('Projects', p);
  return { project: clean_(p) };
}

function deleteProject_(user, d) {
  var p = readTable_('Projects').filter(function (x) { return x.id === d.id; })[0];
  if (!p) throw new Error('Không tìm thấy dự án');
  var tasks = readTable_('Tasks').filter(function (t) { return t.project_id === p.id; });
  if (tasks.length && !d.cascade) throw new Error('Dự án còn ' + tasks.length + ' công việc. Xác nhận xóa kèm công việc.');
  deleteRows_('Tasks', tasks);
  deleteRows_('Packages', readTable_('Packages').filter(function (k) { return k.project_id === p.id; }));
  deleteRows_('Projects', [p]);
  return { id: p.id, deletedTasks: tasks.length };
}

/* ============================ HẠNG MỤC CHÍNH (Packages) ============================ */

function savePackage_(user, d) {
  var list = readTable_('Packages');
  var k = d.id ? list.filter(function (x) { return x.id === d.id; })[0] : null;
  if (d.id && !k) throw new Error('Không tìm thấy hạng mục chính');
  var isNew = !k;
  if (isNew) {
    if (!projectExists_(d.project_id)) throw new Error('Vui lòng chọn dự án hợp lệ');
    k = { id: nextId_('H', list), project_id: d.project_id, created_by: user.email, created_at: nowIso_(),
      order: list.reduce(function (m, x) { return x.project_id === d.project_id ? Math.max(m, Number(x.order) || 0) : m; }, 0) + 1 };
  }
  k.name = str_(d.name !== undefined ? d.name : k.name, 300);
  if (!k.name) throw new Error('Vui lòng nhập tên hạng mục chính');
  if (d.code !== undefined) k.code = str_(d.code, 50);
  if (k.code && list.some(function (x) { return x.id !== k.id && x.project_id === k.project_id && String(x.code).toLowerCase() === k.code.toLowerCase(); })) {
    throw new Error('Mã hạng mục "' + k.code + '" đã có trong dự án');
  }
  if (d.description !== undefined) k.description = str_(d.description, 3000);
  if (d.start_date !== undefined) k.start_date = dateStr_(d.start_date);
  if (d.end_date !== undefined) k.end_date = dateStr_(d.end_date);
  if (k.start_date && k.end_date && k.end_date < k.start_date) throw new Error('Ngày kết thúc phải sau ngày bắt đầu');
  if (d.status !== undefined) {
    if (PROJECT_STATUS.indexOf(d.status) < 0) throw new Error('Trạng thái không hợp lệ');
    k.status = d.status;
  }
  if (!k.status) k.status = 'Chuẩn bị';
  if (d.order !== undefined && d.order !== '') k.order = Number(d.order);
  k.updated_at = nowIso_();
  if (isNew) appendRow_('Packages', k); else writeRow_('Packages', k);
  return { package: clean_(k) };
}

function deletePackage_(user, d) {
  var k = readTable_('Packages').filter(function (x) { return x.id === d.id; })[0];
  if (!k) throw new Error('Không tìm thấy hạng mục chính');
  var tasks = readTable_('Tasks').filter(function (t) { return t.package_id === k.id; });
  if (tasks.length && !d.cascade) throw new Error('Hạng mục còn ' + tasks.length + ' đầu việc. Xác nhận xóa kèm đầu việc.');
  deleteRows_('Tasks', tasks);
  deleteRows_('Packages', [k]);
  return { id: k.id, deletedTasks: tasks.length };
}

/* ============================ TASKS ============================ */

function projectExists_(id) {
  return readTable_('Projects').some(function (p) { return p.id === id; });
}

function applyTaskFields_(t, d, pkgs) {
  if (d.package_id !== undefined) {
    if (d.package_id && !pkgs.some(function (k) { return k.id === d.package_id && k.project_id === t.project_id; })) {
      throw new Error('Hạng mục chính không thuộc dự án');
    }
    t.package_id = str_(d.package_id, 20);
  }
  ['wbs', 'section', 'group', 'subgroup', 'name', 'phase', 'note'].forEach(function (k) {
    if (d[k] !== undefined) t[k] = str_(d[k], k === 'note' ? 2000 : 500);
  });
  if (d.unit !== undefined) {
    if (d.unit && !unitExists_(d.unit)) throw new Error('Nhà thầu không tồn tại: ' + d.unit);
    t.unit = str_(d.unit, 30);
  }
  ['plan_start', 'plan_end'].forEach(function (k) { if (d[k] !== undefined) t[k] = dateStr_(d[k]); });
  if (t.plan_start && t.plan_end && t.plan_end < t.plan_start) throw new Error('Kết thúc KH phải sau bắt đầu KH: ' + (t.name || ''));
  if (d.plan_days !== undefined) t.plan_days = d.plan_days === '' ? '' : clampNum_(d.plan_days, 0, 3650);
  if (d.order !== undefined && d.order !== '') t.order = Number(d.order);
  if (!t.name) throw new Error('Vui lòng nhập tên công việc');
}

function saveTask_(user, d) {
  var tasks = readTable_('Tasks');
  var t = d.id ? tasks.filter(function (x) { return x.id === d.id; })[0] : null;
  if (d.id && !t) throw new Error('Không tìm thấy công việc');
  var isNew = !t;
  if (isNew) {
    if (!projectExists_(d.project_id)) throw new Error('Vui lòng chọn dự án hợp lệ');
    t = { id: nextId_('T', tasks), project_id: d.project_id, progress: 0, status: '', order: maxOrder_(tasks, d.project_id) + 1 };
  } else if (d.project_id && d.project_id !== t.project_id) {
    if (!projectExists_(d.project_id)) throw new Error('Dự án không tồn tại');
    t.project_id = d.project_id;
    if (d.package_id === undefined) t.package_id = '';
  }
  applyTaskFields_(t, d, readTable_('Packages'));
  t.updated_by = user.email;
  t.updated_at = nowIso_();
  if (isNew) appendRow_('Tasks', t); else writeRow_('Tasks', t);
  var proj = linkUnits_(t.project_id, [t.unit]);
  return { task: clean_(t), project: proj };
}

function importTasks_(user, d) {
  if (!projectExists_(d.project_id)) throw new Error('Vui lòng chọn dự án hợp lệ');
  var rows = d.tasks || [];
  if (!rows.length) throw new Error('Không có công việc nào để nhập');
  if (rows.length > MAX_IMPORT) throw new Error('Tối đa ' + MAX_IMPORT + ' dòng mỗi lần nhập');
  var tasks = readTable_('Tasks'), pkgs = readTable_('Packages');
  var n = Number(nextId_('T', tasks).slice(1)), order = maxOrder_(tasks, d.project_id);
  var out = rows.map(function (r, i) {
    var t = { id: 'T' + pad3_(n + i), project_id: d.project_id, progress: 0, status: '', order: ++order,
      updated_by: user.email, updated_at: nowIso_() };
    try { applyTaskFields_(t, r, pkgs); } catch (e) { throw new Error('Dòng ' + (i + 2) + ': ' + e.message); }
    if (t.plan_start && t.plan_end && (t.plan_days === undefined || t.plan_days === '')) {
      t.plan_days = Math.round((parseIso_(t.plan_end) - parseIso_(t.plan_start)) / 864e5 * 100) / 100;
    }
    return t;
  });
  appendRows_('Tasks', out);
  var proj = linkUnits_(d.project_id, out.map(function (t) { return t.unit; }));
  return { tasks: out.map(clean_), project: proj };
}

/**
 * Nhập lại file Excel xuất từ app: dòng có id -> cập nhật các ô được gửi lên; dòng không có id -> thêm mới.
 * Đổi % hoàn thành / ngày thực tế / trạng thái thì ghi thêm một dòng nhật ký "Cập nhật từ file Excel".
 * Kiểm tra toàn bộ trước, chỉ ghi khi không có dòng lỗi.
 */
function syncTasks_(user, d) {
  if (!projectExists_(d.project_id)) throw new Error('Vui lòng chọn dự án hợp lệ');
  var rows = d.rows || [];
  if (!rows.length) throw new Error('Không có dòng nào để cập nhật');
  if (rows.length > MAX_IMPORT) throw new Error('Tối đa ' + MAX_IMPORT + ' dòng mỗi lần nhập');
  var tasks = readTable_('Tasks'), pkgs = readTable_('Packages'), byId = {};
  tasks.forEach(function (t) { byId[t.id] = t; });
  var n = Number(nextId_('T', tasks).slice(1)), order = maxOrder_(tasks, d.project_id);
  var now = nowIso_(), today = now.slice(0, 10), stamp = new Date().getTime().toString(36);
  var created = [], changed = [], ups = [];
  rows.forEach(function (r, i) {
    try {
      var t;
      if (r.id) {
        t = byId[r.id];
        if (!t || t.project_id !== d.project_id) throw new Error('không có đầu việc mã ' + r.id + ' trong dự án này');
        if (changed.indexOf(t) >= 0) throw new Error('mã ' + r.id + ' xuất hiện nhiều lần trong file');
      } else {
        t = { id: 'T' + pad3_(n + created.length), project_id: d.project_id, progress: 0, status: '', order: ++order };
      }
      applyTaskFields_(t, r, pkgs);
      var log = false;
      if (r.progress !== undefined && r.progress !== '') {
        var pr = clampNum_(r.progress, 0, 100);
        if (pr !== Number(t.progress || 0)) { t.progress = pr; log = true; }
      }
      ['actual_start', 'actual_end'].forEach(function (k) {
        if (r[k] !== undefined) { var v = dateStr_(r[k]); if (v !== (t[k] || '')) { t[k] = v; log = true; } }
      });
      if (r.status !== undefined && TASK_STATUS.indexOf(r.status) >= 0 && r.status !== (t.status || '')) { t.status = r.status; log = true; }
      if (log) {
        var p = Number(t.progress || 0);
        if (p >= 100) { t.status = 'Hoàn thành'; t.actual_end = t.actual_end || today; }
        else { if (t.status === 'Hoàn thành') t.status = 'Đang thi công'; t.actual_end = ''; }
        if (p > 0 && !t.actual_start) t.actual_start = today;
        if (p > 0 && !t.status) t.status = 'Đang thi công';
        ups.push({ id: 'U' + stamp + '_' + i, ts: now, report_date: today, task_id: t.id, email: user.email, user_name: user.name,
          unit: user.unit, progress: p, status: t.status, actual_start: t.actual_start, actual_end: t.actual_end,
          delay_days: t.delay_days, note: 'Cập nhật từ file Excel', photos: '' });
      }
      if (t.plan_start && t.plan_end && (t.plan_days === undefined || t.plan_days === '')) {
        t.plan_days = Math.round((parseIso_(t.plan_end) - parseIso_(t.plan_start)) / 864e5 * 100) / 100;
      }
      t.updated_by = user.email;
      t.updated_at = now;
      (r.id ? changed : created).push(t);
    } catch (e) { throw new Error('Dòng ' + (r._line || i + 2) + ': ' + e.message); }
  });
  writeRows_('Tasks', changed);
  appendRows_('Tasks', created);
  appendRows_('Updates', ups);
  var proj = linkUnits_(d.project_id, created.concat(changed).map(function (t) { return t.unit; }));
  return { created: created.map(clean_), changed: changed.map(clean_), updates: ups, project: proj };
}

/** Dự án có danh sách nhà thầu tham gia: tự thêm các nhà thầu vừa được gán. Trả về dự án nếu có thay đổi. */
function linkUnits_(projectId, codes) {
  var p = readTable_('Projects').filter(function (x) { return x.id === projectId; })[0];
  if (!p) return null;
  var list = String(p.units || '').split(',').filter(String);
  if (!list.length) return null; // trống = tất cả nhà thầu
  var add = codes.filter(function (c, i, a) { return c && list.indexOf(c) < 0 && a.indexOf(c) === i; });
  if (!add.length) return null;
  p.units = list.concat(add).join(',');
  p.updated_at = nowIso_();
  writeRow_('Projects', p);
  return clean_(p);
}

function deleteTasks_(user, d) {
  var ids = d.ids || (d.id ? [d.id] : []);
  var del = readTable_('Tasks').filter(function (t) { return ids.indexOf(t.id) >= 0; });
  if (!del.length) throw new Error('Không tìm thấy công việc');
  deleteRows_('Tasks', del);
  return { ids: del.map(function (t) { return t.id; }) };
}

function bulkAssignUnit_(user, d) {
  return bulkUpdateTasks_(user, { task_ids: d.task_ids, unit: d.unit || '' });
}

/** Cập nhật hàng loạt nhà thầu (unit) và/hoặc hạng mục chính (package_id). */
function bulkUpdateTasks_(user, d) {
  var ids = d.task_ids || [];
  if (d.unit && !unitExists_(d.unit)) throw new Error('Nhà thầu không tồn tại');
  var pkgs = d.package_id ? readTable_('Packages') : [];
  var sel = readTable_('Tasks').filter(function (t) { return ids.indexOf(t.id) >= 0; });
  // kiểm tra hết trước khi ghi để không cập nhật dở dang
  sel.forEach(function (t) {
    if (d.package_id && !pkgs.some(function (k) { return k.id === d.package_id && k.project_id === t.project_id; })) {
      throw new Error('Hạng mục chính không thuộc dự án của đầu việc ' + t.id);
    }
  });
  sel.forEach(function (t) {
    if (d.package_id !== undefined) t.package_id = d.package_id;
    if (d.unit !== undefined) t.unit = d.unit;
    t.updated_by = user.email;
    t.updated_at = nowIso_();
  });
  writeRows_('Tasks', sel);
  var projects = [];
  if (d.unit) {
    sel.map(function (t) { return t.project_id; }).filter(function (x, i, a) { return a.indexOf(x) === i; })
      .forEach(function (pid) { var p = linkUnits_(pid, [d.unit]); if (p) projects.push(p); });
  }
  return { count: sel.length, projects: projects };
}

/* ============================ CONTRACTORS (Units) ============================ */

function saveUnit_(user, d) {
  var code = str_(d.code, 30).toUpperCase().replace(/[^A-Z0-9Đ_-]/g, '');
  if (!code) throw new Error('Mã nhà thầu không hợp lệ');
  var u = readTable_('Units').filter(function (x) { return x.code === code; })[0];
  if (u && d.isNew) throw new Error('Mã nhà thầu "' + code + '" đã tồn tại');
  if (!u && d.isNew === false) throw new Error('Không tìm thấy nhà thầu');
  var isNew = !u;
  if (isNew) u = { code: code };
  if (d.name !== undefined) u.name = str_(d.name, 200);
  if (!u.name) u.name = code;
  if (d.type !== undefined) {
    if (d.type && unitTypes_().indexOf(d.type) < 0) throw new Error('Loại nhà thầu không hợp lệ');
    u.type = d.type;
  }
  ['contact', 'phone', 'email'].forEach(function (k) { if (d[k] !== undefined) u[k] = str_(d[k], 200); });
  if (d.note !== undefined) u.note = str_(d.note, 1000);
  if (isNew) appendRow_('Units', u); else writeRow_('Units', u);
  return { unit: clean_(u), units: readTable_('Units').map(clean_) };
}

function deleteUnit_(user, d) {
  var u = readTable_('Units').filter(function (x) { return x.code === d.code; })[0];
  if (!u) throw new Error('Không tìm thấy nhà thầu');
  var nT = readTable_('Tasks').filter(function (t) { return t.unit === u.code; }).length;
  var nU = readTable_('Users').filter(function (x) { return x.unit === u.code; }).length;
  if (nT || nU) throw new Error('Không thể xóa: nhà thầu còn ' + nT + ' công việc và ' + nU + ' người dùng. Hãy chuyển sang nhà thầu khác trước.');
  readTable_('Projects').forEach(function (p) {
    var list = String(p.units || '').split(',').filter(function (c) { return c && c !== u.code; });
    if (list.join(',') !== p.units) { p.units = list.join(','); writeRow_('Projects', p); }
  });
  deleteRows_('Units', [u]);
  return { code: u.code, units: readTable_('Units').map(clean_) };
}

/* ---------- Loại nhà thầu ---------- */

function unitTypes_() {
  try {
    var a = JSON.parse(getConfig_().UNIT_TYPES || '');
    if (Array.isArray(a) && a.length) return a.map(String);
  } catch (e) { /* chưa cấu hình hoặc sai định dạng: dùng mặc định */ }
  return DEFAULT_UNIT_TYPES.slice();
}

/** Thêm loại mới (không có d.old) hoặc đổi tên loại d.old thành d.name – nhà thầu đang dùng loại cũ được đổi theo. */
function saveUnitType_(user, d) {
  var name = str_(d.name, 60), old = str_(d.old, 60), types = unitTypes_();
  if (!name) throw new Error('Vui lòng nhập tên loại nhà thầu');
  var dup = types.some(function (t) { return t.toLowerCase() === name.toLowerCase() && t !== old; });
  if (dup) throw new Error('Loại "' + name + '" đã có');
  if (old) {
    var i = types.indexOf(old);
    if (i < 0) throw new Error('Không tìm thấy loại "' + old + '"');
    types[i] = name;
    readTable_('Units').forEach(function (u) { if (u.type === old) { u.type = name; writeRow_('Units', u); } });
  } else {
    types.push(name);
  }
  setConfig_('UNIT_TYPES', JSON.stringify(types));
  return { types: types, units: readTable_('Units').map(clean_) };
}

function deleteUnitType_(user, d) {
  var name = str_(d.name, 60), types = unitTypes_();
  if (types.indexOf(name) < 0) throw new Error('Không tìm thấy loại "' + name + '"');
  var n = readTable_('Units').filter(function (u) { return u.type === name; }).length;
  if (n) throw new Error('Không thể xóa: còn ' + n + ' nhà thầu thuộc loại "' + name + '". Hãy đổi loại cho các nhà thầu đó trước.');
  if (types.length === 1) throw new Error('Phải giữ lại ít nhất một loại nhà thầu');
  types.splice(types.indexOf(name), 1);
  setConfig_('UNIT_TYPES', JSON.stringify(types));
  return { types: types };
}

function unitExists_(code) {
  return readTable_('Units').some(function (u) { return u.code === code; });
}

/* ============================ USERS ============================ */

function saveUser_(admin, d) {
  var u = findUser_(String(d.email || '').toLowerCase());
  if (!u) throw new Error('Không tìm thấy người dùng');
  if (d.role !== undefined) { if (ROLES.indexOf(d.role) < 0) throw new Error('Vai trò không hợp lệ'); u.role = d.role; }
  if (d.status !== undefined) { if (USER_STATUS.indexOf(d.status) < 0) throw new Error('Trạng thái không hợp lệ'); u.status = d.status; }
  if (d.unit !== undefined) { if (d.unit && !unitExists_(d.unit)) throw new Error('Đơn vị không tồn tại'); u.unit = d.unit; }
  if (u.email === admin.email && (u.role !== 'admin' || u.status !== 'active')) throw new Error('Không thể tự hạ quyền/khóa chính mình');
  writeRow_('Users', u);
  return { user: clean_(u) };
}

/* ============================ SHEET HELPERS (theo tên cột) ============================ */

var HDR = {};

function ss_() {
  var id = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
  return id ? SpreadsheetApp.openById(id) : SpreadsheetApp.getActive();
}

function sheet_(name) {
  var sh = ss_().getSheetByName(name);
  if (!sh) throw new Error('Thiếu sheet "' + name + '" – hãy chạy hàm setup()');
  return sh;
}

function headers_(name) {
  if (!HDR[name]) {
    var sh = sheet_(name), lc = sh.getLastColumn();
    HDR[name] = lc ? sh.getRange(1, 1, 1, lc).getValues()[0].map(String) : [];
    var miss = SCHEMA[name].filter(function (c) { return HDR[name].indexOf(c) < 0; });
    if (miss.length) throw new Error('Sheet "' + name + '" thiếu cột ' + miss.join(', ') + ' – hãy chạy lại hàm setup()');
  }
  return HDR[name];
}

function readTable_(name) {
  var sh = sheet_(name), last = sh.getLastRow(), hdr = headers_(name);
  if (last < 2) return [];
  var values = sh.getRange(2, 1, last - 1, hdr.length).getValues();
  var out = [];
  values.forEach(function (row, i) {
    if (row.every(function (v) { return v === '' || v === null; })) return;
    var o = { _row: i + 2 };
    hdr.forEach(function (c, j) { if (c) o[c] = cell_(row[j], DATE_COLS[c] === 1); });
    out.push(o);
  });
  return out;
}

function rowValues_(name, obj) {
  return headers_(name).map(function (c) {
    var v = obj[c];
    if (v === undefined || v === null) return '';
    if (typeof v === 'string' && /^[=+\-@]/.test(v)) return "'" + v; // chặn công thức
    return String(v);
  });
}

function appendRow_(name, obj) { appendRows_(name, [obj]); }

function appendRows_(name, objs) {
  if (!objs.length) return;
  var sh = sheet_(name), row = sh.getLastRow() + 1, n = headers_(name).length;
  sh.getRange(row, 1, objs.length, n).setNumberFormat('@')
    .setValues(objs.map(function (o) { return rowValues_(name, o); }));
  objs.forEach(function (o, i) { o._row = row + i; });
}

function writeRow_(name, obj) {
  if (!obj._row) throw new Error('Thiếu vị trí dòng');
  sheet_(name).getRange(obj._row, 1, 1, headers_(name).length).setNumberFormat('@').setValues([rowValues_(name, obj)]);
}

/** Ghi nhiều dòng: ít dòng thì ghi từng dòng, nhiều dòng thì ghi cả vùng một lần cho nhanh. */
function writeRows_(name, objs) {
  if (objs.length <= 15) { objs.forEach(function (o) { writeRow_(name, o); }); return; }
  var sh = sheet_(name), n = headers_(name).length, last = sh.getLastRow();
  var rng = sh.getRange(2, 1, last - 1, n);
  var vals = rng.getValues().map(function (row) {
    return row.map(function (v) { return typeof v === 'string' && /^[=+\-@]/.test(v) ? "'" + v : v; }); // giữ chặn công thức
  });
  objs.forEach(function (o) { vals[o._row - 2] = rowValues_(name, o); });
  rng.setNumberFormat('@').setValues(vals);
}

function deleteRows_(name, objs) {
  var sh = sheet_(name);
  objs.map(function (o) { return o._row; }).sort(function (a, b) { return b - a; })
    .forEach(function (r) { sh.deleteRow(r); });
}

function getConfig_() {
  var cfg = {};
  readTable_('Config').forEach(function (r) { cfg[r.key] = String(r.value); });
  return cfg;
}

function setConfig_(key, value) {
  var r = readTable_('Config').filter(function (x) { return x.key === key; })[0];
  if (r) { r.value = value; writeRow_('Config', r); } else appendRow_('Config', { key: key, value: value });
}

/* ============================ UTILS ============================ */

function tz_() { return Session.getScriptTimeZone() || 'Asia/Ho_Chi_Minh'; }

function nowIso_() { return Utilities.formatDate(new Date(), tz_(), "yyyy-MM-dd'T'HH:mm:ss"); }

function pad3_(n) { return n < 1000 ? ('00' + n).slice(-3) : String(n); }

function nextId_(prefix, list) {
  var max = list.reduce(function (m, x) { return Math.max(m, Number(String(x.id).replace(/\D/g, '')) || 0); }, 0);
  return prefix + pad3_(max + 1);
}

function maxOrder_(tasks, projectId) {
  return tasks.reduce(function (m, x) { return x.project_id === projectId ? Math.max(m, Number(x.order) || 0) : m; }, 0);
}

function parseIso_(s) {
  var m = String(s).match(/^(\d{4})-(\d{2})-(\d{2})(?:T(\d{2}):(\d{2}))?/);
  return new Date(+m[1], m[2] - 1, +m[3], +(m[4] || 0), +(m[5] || 0));
}

// Cột ngày: chấp nhận cả giá trị nhập tay trên Google Sheet (ô ngày, "22/10/2026", "22/10/2026 07:30")
var DATE_COLS = { plan_start: 1, plan_end: 1, actual_start: 1, actual_end: 1, start_date: 1, end_date: 1, report_date: 1 };

function cell_(v, isDate) {
  if (Object.prototype.toString.call(v) === '[object Date]') {
    var s = Utilities.formatDate(v, tz_(), "yyyy-MM-dd'T'HH:mm");
    return s.slice(11) === '00:00' ? s.slice(0, 10) : s;
  }
  if (typeof v !== 'string') return v;
  v = v.replace(/^'/, '');
  if (isDate) {
    var t = v.trim(), m = t.match(/^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})(?:\s+(\d{1,2}):(\d{2}))?$/);
    if (m) return m[3] + '-' + ('0' + m[2]).slice(-2) + '-' + ('0' + m[1]).slice(-2) + (m[4] ? 'T' + ('0' + m[4]).slice(-2) + ':' + m[5] : '');
    m = t.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})/);
    if (m) return m[1] + '-' + m[2] + '-' + m[3] + (m[4] + m[5] === '0000' ? '' : 'T' + m[4] + ':' + m[5]);
    return t;
  }
  return v;
}

function clean_(o) {
  var c = {};
  Object.keys(o).forEach(function (k) { if (k !== '_row') c[k] = o[k]; });
  return c;
}

function str_(v, max) { return String(v == null ? '' : v).trim().slice(0, max || 500); }

function clampNum_(v, min, max) {
  var n = Number(v);
  if (isNaN(n)) throw new Error('Giá trị số không hợp lệ: ' + v);
  return Math.max(min, Math.min(max, Math.round(n * 100) / 100));
}

function dateStr_(v) {
  var s = str_(v, 20);
  if (!s) return '';
  if (!/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2})?$/.test(s)) throw new Error('Ngày không hợp lệ: ' + s);
  return s;
}
