'use strict';

/* ================= 工具函数 ================= */
const $ = (sel, root) => (root || document).querySelector(sel);
const $$ = (sel, root) => Array.from((root || document).querySelectorAll(sel));
const mk = (tag, cls, text) => {
  const el = document.createElement(tag);
  if (cls) el.className = cls;
  if (text !== undefined) el.textContent = text;
  return el;
};

const posixJoin = (...parts) =>
  parts.filter((p) => p !== undefined && p !== null && p !== '').join('/');

// 解析 Markdown 内的相对路径：以笔记所在目录为基准，归一化 ./ ../ 段
function resolveRel(baseDir, rel) {
  const segs = (baseDir ? baseDir.split('/') : []).concat(String(rel).replace(/\\/g, '/').split('/'));
  const out = [];
  for (const s of segs) {
    if (!s || s === '.') continue;
    if (s === '..') {
      out.pop();
      continue;
    }
    out.push(s);
  }
  return out.join('/');
}

const escapeHtml = (s) =>
  String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

// 解码可能被百分比编码的字符串（解析容错用）
function decodeMaybe(s) {
  try {
    return decodeURIComponent(s);
  } catch (e) {
    return s;
  }
}

// Markdown 预处理：图片/链接目标里的裸空格会被 marked（CommonMark）拒之门外，
// 整条 ![..](..) 会变成纯文本。把目标中的空白百分号编码后再交给 marked。
// 兼容中文文件名里常见的 " - 副本"、空格等；已用 <> 包裹或带引号标题的跳过。
function fixSpacesInInlineUrls(md) {
  return String(md).replace(/(!?\[[^\]\n]*\]\()([^)\n]*)(\))/g, (whole, pre, inner, post) => {
    const content = (inner || '').trim();
    if (!content || content.startsWith('<')) return whole; // 已用 <> 包裹：空格合法
    if (!/[\s\u3000]/.test(content)) return whole; // 无空白，无需处理
    let dest = content;
    let tail = '';
    // 分离末尾可选 title："..." 或 '...'
    const tm = content.match(/^(.*?)(\s+(["'])[^"']*\3\s*)$/);
    if (tm) {
      dest = tm[1].trim();
      tail = tm[2];
    }
    if (!/[\s\u3000]/.test(dest)) return whole;
    return pre + dest.replace(/[\s\u3000]+/g, '%20') + tail + post;
  });
}

// 扩展 marked：支持 ==高亮== 语法（渲染为 <mark>）
marked.use({
  extensions: [
    {
      name: 'eqhighlight',
      level: 'inline',
      start(src) {
        return src.indexOf('==');
      },
      tokenizer(src) {
        const m = /^==([^=\n]+?)==/.exec(src);
        if (m && m[1] && m[1].trim() === m[1]) {
          return { type: 'eqhighlight', raw: m[0], text: m[1] };
        }
        return undefined;
      },
      renderer(token) {
        return '<mark>' + escapeHtml(token.text) + '</mark>';
      },
    },
  ],
});

const isImageName = (name) => /\.(png|jpe?g|gif|webp|svg|bmp|ico|avif)$/i.test(name);

function fmtSize(n) {
  if (n == null) return '-';
  if (n < 1024) return n + ' B';
  if (n < 1024 * 1024) return (n / 1024).toFixed(1) + ' KB';
  return (n / 1024 / 1024).toFixed(1) + ' MB';
}

function fmtTime(ms) {
  if (!ms) return '-';
  const d = new Date(ms);
  const p = (x) => String(x).padStart(2, '0');
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

/* ================= 状态 ================= */
const state = {
  tree: null,
  cur: '', // 当前目录（相对路径）
  view: null, // 正在预览的笔记相对路径
  user: null,
  needsSetup: false,
  uploading: false,
  mobile: window.innerWidth < 900,
};

/* ================= API ================= */
async function api(path, opts = {}) {
  const init = { credentials: 'same-origin', ...opts };
  if (opts.body && !(opts.body instanceof FormData)) {
    init.headers = { 'Content-Type': 'application/json', ...(opts.headers || {}) };
  } else if (opts.headers) {
    init.headers = opts.headers;
  }
  const res = await fetch(path, init);
  if (res.status === 401) {
    showLogin();
    throw new Error('未登录');
  }
  let data = null;
  try {
    data = await res.json();
  } catch (e) {
    /* 无响应体 */
  }
  if (!res.ok) throw new Error((data && data.error) || `请求失败 (${res.status})`);
  return data;
}

async function apiText(path) {
  const res = await fetch(path, { credentials: 'same-origin' });
  if (res.status === 401) {
    showLogin();
    throw new Error('未登录');
  }
  if (!res.ok) throw new Error('读取失败 (' + res.status + ')');
  return res.text();
}

/* ================= Toast / 弹窗 ================= */
let toastTimer = null;
function toast(msg, ms = 3000) {
  const el = $('#toast');
  el.textContent = msg;
  el.hidden = false;
  el.classList.remove('show');
  void el.offsetWidth;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.hidden = true;
  }, ms);
}

function confirmBox(title, text, okText = '确定') {
  return new Promise((resolve) => {
    $('#modalTitle').textContent = title;
    $('#modalText').textContent = text;
    $('#modalInput').hidden = true;
    $('#modalOk').textContent = okText;
    $('#modalOk').classList.add('danger');
    $('#modal').hidden = false;
    const done = (v) => {
      $('#modal').hidden = true;
      $('#modalOk').onclick = null;
      $('#modalCancel').onclick = null;
      resolve(v);
    };
    $('#modalOk').onclick = () => done(true);
    $('#modalCancel').onclick = () => done(false);
  });
}

function promptBox(title, placeholder = '', value = '') {
  return new Promise((resolve) => {
    $('#modalTitle').textContent = title;
    $('#modalText').textContent = '';
    const input = $('#modalInput');
    input.hidden = false;
    input.placeholder = placeholder;
    input.value = value;
    $('#modalOk').textContent = '确定';
    $('#modalOk').classList.remove('danger');
    $('#modal').hidden = false;
    input.focus();
    const done = (v) => {
      $('#modal').hidden = true;
      $('#modalOk').onclick = null;
      $('#modalCancel').onclick = null;
      input.onkeydown = null;
      resolve(v);
    };
    $('#modalOk').onclick = () => done(input.value.trim());
    $('#modalCancel').onclick = () => done(null);
    input.onkeydown = (e) => {
      if (e.key === 'Enter') done(input.value.trim());
      if (e.key === 'Escape') done(null);
    };
  });
}

/* ================= 登录 / 初始化 ================= */
const isGuest = () => state.user && state.user.role === 'guest';

function showLogin() {
  $('#app').hidden = true;
  $('#login').hidden = false;
  $('#loginHint').textContent = state.needsSetup
    ? '首次使用，请创建管理员账号（密码至少 8 位）'
    : '请登录以访问你的笔记';
  $('#btnLogin').textContent = state.needsSetup ? '创建账号' : '登 录';
  $('#loginError').hidden = true;
  document.body.classList.remove('previewing', 'sidebar-collapsed', 'guest');
}

async function submitAuth(e) {
  e.preventDefault();
  const username = $('#inUser').value.trim();
  const password = $('#inPass').value;
  const errEl = $('#loginError');
  errEl.hidden = true;
  try {
    const res = await api(state.needsSetup ? '/api/auth/setup' : '/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    state.user = res.user;
    state.needsSetup = false; // 账号已存在，之后均为普通登录
    enterApp();
  } catch (err) {
    errEl.textContent = err.message;
    errEl.hidden = false;
  }
}

// 按角色调整界面：游客隐藏所有写操作（上传/下载/删除/建目录）
function applyRoleUI() {
  const guest = isGuest();
  const adminEls = ['btnUpload', 'btnUploadDir', 'btnNewDir', 'btnZip', 'btnDownloadNote', 'btnUsers', 'optRow'];
  adminEls.forEach((id) => {
    const el = document.getElementById(id);
    if (el) el.hidden = guest;
  });
  const roleEl = $('#userRole');
  if (roleEl) {
    roleEl.textContent = guest ? '游客' : '管理员';
    roleEl.hidden = false;
    roleEl.classList.toggle('guest', guest);
  }
  document.body.classList.toggle('guest', guest);
}

async function enterApp() {
  $('#login').hidden = true;
  $('#app').hidden = false;
  $('#userName').textContent = state.user.username;
  applyRoleUI();
  await refreshTree();
  navigateFromHash();
}

async function logout() {
  try {
    await api('/api/auth/logout', { method: 'POST' });
  } catch (e) {
    /* 忽略 */
  }
  state.user = null;
  state.needsSetup = false; // 已有账号，登出后回到普通登录模式
  state.tree = null;
  showLogin();
}

/* ================= 目录树 ================= */
function findNode(rel) {
  if (!state.tree) return null;
  if (!rel) return state.tree;
  let node = state.tree;
  for (const s of rel.split('/')) {
    node = (node.children || []).find((n) => n.type === 'dir' && n.name === s);
    if (!node) return null;
  }
  return node;
}

function renderTree() {
  const wrap = $('#tree');
  wrap.innerHTML = '';
  const root = state.tree;
  if (!root) return;
  const ul = mk('ul', 'tree-list');
  const dirs = (root.children || []).filter((n) => n.type === 'dir');
  if (dirs.length === 0) {
    ul.appendChild(mk('li', 'tree-empty', '（暂无文件夹）'));
  }
  dirs.forEach((d) => ul.appendChild(dirNode(d, 0)));
  wrap.appendChild(ul);
  highlightTree();
}

function dirNode(node, depth) {
  const li = mk('li');
  const row = mk('div', 'tree-row');
  row.dataset.rel = node.rel;
  row.style.paddingLeft = 10 + depth * 18 + 'px';
  const caret = mk('span', 'caret', '▸');
  const label = mk('span', 'tree-label', node.name);
  row.append(caret, label);
  const subUl = mk('ul', 'tree-list');
  subUl.hidden = true;
  const subs = (node.children || []).filter((n) => n.type === 'dir');
  subs.forEach((c) => subUl.appendChild(dirNode(c, depth + 1)));
  caret.onclick = (e) => {
    e.stopPropagation();
    subUl.hidden = !subUl.hidden;
    caret.textContent = subUl.hidden ? '▸' : '▾';
    li.classList.toggle('expanded', !subUl.hidden);
  };
  row.onclick = () => {
    subUl.hidden = false;
    caret.textContent = '▾';
    li.classList.add('expanded');
    go('#dir/' + encodeURIComponent(node.rel));
  };
  li.append(row, subUl);
  return li;
}

function highlightTree() {
  $$('#tree .tree-row').forEach((r) => r.classList.toggle('active', r.dataset.rel === state.cur));
}

/* ================= 导航 ================= */
function go(hash) {
  if (location.hash === hash) navigateFromHash();
  else location.hash = hash;
}

function navigateFromHash() {
  const h = location.hash || '#dir/';
  if (h.startsWith('#view/')) {
    const rel = decodeURIComponent(h.slice(6)); // '#view/' 共 6 字符
    if (rel !== state.view) openPreview(rel);
    return;
  }
  let rel = '';
  if (h.startsWith('#dir/')) rel = decodeURIComponent(h.slice(5));
  state.view = null;
  state.cur = rel;
  renderBreadcrumb();
  renderList();
  highlightTree();
  $('#preview').hidden = true;
  $('#filelist').hidden = false;
  document.body.classList.remove('previewing'); // 离开阅读模式
  resetReadBar();
  closeDrawer();
}

function renderBreadcrumb() {
  const el = $('#breadcrumb');
  el.innerHTML = '';
  const segs = state.cur ? state.cur.split('/') : [];
  const rootCrumb = mk('span', 'crumb', '📒 全部笔记');
  rootCrumb.onclick = () => go('#dir/');
  el.appendChild(rootCrumb);
  let acc = '';
  segs.forEach((s, i) => {
    acc = acc ? acc + '/' + s : s;
    const sep = mk('span', 'crumb-sep', '/');
    const c = mk('span', 'crumb', s);
    if (i < segs.length - 1) c.onclick = () => go('#dir/' + encodeURIComponent(acc));
    else c.classList.add('current');
    el.append(sep, c);
  });
}

/* ================= 文件列表 ================= */
function renderList() {
  const el = $('#filelist');
  el.innerHTML = '';
  if (state.cur) el.appendChild(parentRow());
  const node = findNode(state.cur);
  const items = node ? node.children : [];
  if (items.length === 0) {
    el.appendChild(
      mk(
        'div',
        'empty',
        state.cur ? '此文件夹为空' : '还没有笔记：点击右上角「上传文件」，或直接把文件拖到页面里'
      )
    );
  }
  items.forEach((n) => el.appendChild(n.type === 'dir' ? dirRow(n) : fileRow(n)));
}

function parentRow() {
  const row = mk('div', 'file-row');
  const name = mk('div', 'f-name');
  name.innerHTML = '📁 <span class="up">.. 上级目录</span>';
  row.append(name, mk('div', 'f-meta'), mk('div', 'f-actions'));
  row.classList.add('clickable');
  row.onclick = () => go('#dir/' + encodeURIComponent(state.cur.split('/').slice(0, -1).join('/')));
  return row;
}

function dirRow(n) {
  const row = mk('div', 'file-row');
  const name = mk('div', 'f-name', '📁 ' + n.name);
  const meta = mk('div', 'f-meta', `${(n.children || []).length} 项`);
  const actions = mk('div', 'f-actions');
  row.append(name, meta, actions);
  row.classList.add('clickable');
  row.onclick = () => go('#dir/' + encodeURIComponent(n.rel));
  if (!isGuest()) {
    const btnZip = mk('button', 'btn tiny', 'ZIP');
    const btnDel = mk('button', 'btn tiny danger', '删除');
    btnZip.onclick = (e) => {
      e.stopPropagation();
      downloadZip(n.rel);
    };
    btnDel.onclick = (e) => {
      e.stopPropagation();
      delNode(n);
    };
    actions.append(btnZip, btnDel);
  }
  return row;
}

function fileRow(n) {
  const row = mk('div', 'file-row');
  const isMd = n.isMd;
  const isImg = isImageName(n.name);
  const icon = isMd ? '📄' : isImg ? '🖼️' : '📎';
  const name = mk('div', 'f-name', `${icon} ${n.name}`);
  const meta = mk('div', 'f-meta', `${fmtSize(n.size)} · ${fmtTime(n.mtime)}`);
  const actions = mk('div', 'f-actions');
  row.append(name, meta, actions);
  row.classList.add('clickable');
  if (isMd) {
    const btnView = mk('button', 'btn tiny', '查看');
    btnView.onclick = (e) => {
      e.stopPropagation();
      openPreviewFromList(n.rel);
    };
    actions.appendChild(btnView);
    row.onclick = () => openPreviewFromList(n.rel);
  } else if (isImg) {
    const btnView = mk('button', 'btn tiny', '查看');
    btnView.onclick = (e) => {
      e.stopPropagation();
      window.open('/api/file?path=' + encodeURIComponent(n.rel), '_blank');
    };
    actions.appendChild(btnView);
    row.onclick = () => window.open('/api/file?path=' + encodeURIComponent(n.rel), '_blank');
  }
  if (!isGuest()) {
    const btnDl = mk('button', 'btn tiny', '下载');
    btnDl.onclick = (e) => {
      e.stopPropagation();
      window.location = '/api/file?path=' + encodeURIComponent(n.rel) + '&download=1';
    };
    const btnDel = mk('button', 'btn tiny danger', '删除');
    btnDel.onclick = (e) => {
      e.stopPropagation();
      delNode(n);
    };
    actions.append(btnDl, btnDel);
  }
  return row;
}

function openPreviewFromList(rel) {
  if (state.mobile) closeDrawer();
  location.hash = '#view/' + encodeURIComponent(rel);
}

/* ===== 图片加载失败兜底与诊断 ===== */

// 在目录树中按文件名找同名文件；优先选择与笔记目录前缀重合最长的那个
function findFileByBasename(basename, noteDir, exceptRel) {
  if (!state.tree || !basename) return null;
  const candidates = [];
  const walk = (node) => {
    if (!node || !node.children) return;
    for (const c of node.children) {
      if (c.type === 'file' && c.name === basename && c.rel !== exceptRel) candidates.push(c.rel);
      else if (c.type === 'dir') walk(c);
    }
  };
  walk(state.tree);
  if (!candidates.length) return null;
  const prefixLen = (rel) => {
    const a = noteDir ? noteDir.split('/') : [];
    const b = rel.split('/').slice(0, -1);
    let i = 0;
    while (i < a.length && i < b.length && a[i] === b[i]) i++;
    return i;
  };
  candidates.sort((x, y) => prefixLen(y) - prefixLen(x));
  return candidates[0];
}

function handleImgError(img, noteDir) {
  if (!img || !img.isConnected) return;
  if (img.dataset.fallbackDone) {
    showImgBroken(img);
    return;
  }
  const base = (img.dataset.rel || '').split('/').pop();
  const fallback = findFileByBasename(base, noteDir, img.dataset.rel);
  if (fallback) {
    img.dataset.fallbackDone = '1';
    img.dataset.rel = fallback;
    img.src = '/api/file?path=' + encodeURIComponent(fallback);
    return; // 命中兜底路径；若仍加载失败会再次触发 error → 显示诊断
  }
  showImgBroken(img);
}

function showImgBroken(img) {
  if (!img || !img.isConnected) return;
  const resolved = img.dataset.rel || '';
  const box = document.createElement('span');
  box.className = 'img-broken';
  const code = document.createElement('code');
  code.textContent = resolved;
  box.appendChild(document.createTextNode('🖼️ 图片未找到（'));
  box.appendChild(code);
  box.appendChild(
    document.createTextNode('）：请检查笔记中的引用路径与图片实际位置是否一致，或重新上传图片')
  );
  img.replaceWith(box);
}

/* ================= 笔记预览 ================= */
async function openPreview(rel) {
  state.view = rel;
  $('#filelist').hidden = true;
  const pv = $('#preview');
  pv.hidden = false;
  $('#previewTitle').textContent = rel.split('/').pop();
  const body = $('#noteBody');
  body.innerHTML = '<p class="loading">加载中…</p>';
  document.body.classList.add('previewing'); // 阅读模式（手机端隐藏页眉、操作栏吸顶）
  resetReadBar();
  try {
    const text = await apiText('/api/file?path=' + encodeURIComponent(rel));
    // 先修复含空格（等）的图片/链接目标，再交给 marked 解析
    const fixed = fixSpacesInInlineUrls(text);
    const rawHtml = marked.parse(fixed, { gfm: true, breaks: true });
    const clean = DOMPurify.sanitize(rawHtml);
    const holder = document.createElement('div');
    holder.innerHTML = clean;

    const noteDir = rel.includes('/') ? rel.slice(0, rel.lastIndexOf('/')) : '';

    // 相对路径图片 → 鉴权接口；失败时按文件名自动查找同名文件兜底
    $$('img', holder).forEach((img) => {
      const src = img.getAttribute('src') || '';
      if (!src || /^(https?:|data:|#|\/\/)/i.test(src) || src.startsWith('/')) return;
      const resolved = resolveRel(noteDir, decodeMaybe(src));
      img.src = '/api/file?path=' + encodeURIComponent(resolved);
      img.loading = 'lazy';
      img.alt = img.alt || '';
      img.title = '实际路径: ' + resolved; // 悬停可见，便于排查
      img.dataset.rel = resolved;
      img.addEventListener('error', () => handleImgError(img, noteDir));
    });

    // 相对链接：.md → 站内跳转；其他相对文件 → 下载/查看；外链 → 新窗口
    // 相对链接：.md → 站内跳转；其他相对文件 → 下载/查看；外链 → 新窗口
    $$('a', holder).forEach((a) => {
      const href = a.getAttribute('href') || '';
      if (!href || href.startsWith('/')) return;
      if (/^(https?:|mailto:|tel:)/i.test(href)) {
        a.target = '_blank';
        a.rel = 'noopener';
        return;
      }
      if (/^(data:|#)/i.test(href)) return;
      let raw = decodeMaybe(href);
      // 去掉 #锚点 片段后判断/解析（站内暂时不支持标题锚点定位）
      const fragIdx = raw.indexOf('#');
      if (fragIdx >= 0) raw = raw.slice(0, fragIdx);
      const resolved = resolveRel(noteDir, raw);
      if (/\.(md|markdown)$/i.test(resolved)) {
        a.href = '#view/' + encodeURIComponent(resolved);
        a.classList.add('internal');
      } else {
        a.href = '/api/file?path=' + encodeURIComponent(resolved);
        a.target = '_blank';
        a.rel = 'noopener';
      }
    });

    // 表格移动端横向滚动
    $$('table', holder).forEach((t) => {
      const w = document.createElement('div');
      w.className = 'table-wrap';
      t.parentNode.insertBefore(w, t);
      w.appendChild(t);
    });

    // 代码高亮
    $$('pre code', holder).forEach((block) => {
      try {
        hljs.highlightElement(block);
      } catch (e) {
        /* 忽略 */
      }
    });

    body.innerHTML = '';
    body.appendChild(holder.firstChild ? holder : mk('p', '', '（空笔记）'));
    // 回到内容区顶部
    const scroller = $('#content');
    if (scroller) scroller.scrollTop = 0;
  } catch (err) {
    body.innerHTML = '<p class="error-text">' + escapeHtml(err.message) + '</p>';
  }
}

/* ================= 上传 ================= */
let progressTotal = 0;
let progressDone = 0;

function setProgress(frac) {
  $('#barFill').style.width = Math.max(0, Math.min(100, Math.round(frac * 100))) + '%';
}

function makeUploadRel(f) {
  const rel = f.webkitRelativePath ? f.webkitRelativePath : f.name;
  return posixJoin(state.cur, rel);
}

function uploadOne(rel, file, overwrite) {
  return new Promise((resolve, reject) => {
    const fd = new FormData();
    fd.append('path', rel);
    fd.append('overwrite', overwrite ? '1' : '0');
    fd.append('file', file);
    const xhr = new XMLHttpRequest();
    xhr.open('POST', '/api/upload');
    xhr.onload = () => {
      if (xhr.status === 401) {
        showLogin();
        reject(new Error('未登录'));
        return;
      }
      let data = null;
      try {
        data = JSON.parse(xhr.responseText);
      } catch (e) {}
      if (xhr.status >= 200 && xhr.status < 300) resolve(data || {});
      else reject(new Error((data && data.error) || '上传失败 (' + xhr.status + ')'));
    };
    xhr.onerror = () => reject(new Error('网络错误'));
    xhr.upload.onprogress = (e) => {
      if (e.lengthComputable && progressTotal > 0) {
        setProgress((progressDone + e.loaded / e.total) / progressTotal);
      }
    };
    xhr.send(fd);
  });
}

async function startUpload(fileList) {
  const files = Array.from(fileList);
  if (!files.length || state.uploading) return;
  const overwrite = $('#optOverwrite').checked;
  state.uploading = true;
  $('#btnUpload').disabled = true;
  $('#btnUploadDir').disabled = true;
  const progressEl = $('#progress');
  progressEl.hidden = false;
  progressTotal = files.length;
  progressDone = 0;
  setProgress(0);
  $('#progressText').textContent = `上传中 0/${progressTotal}`;

  const out = { ok: 0, notes: [], errors: [] };
  const pool = Math.min(3, files.length);
  let idx = 0;

  const worker = async () => {
    while (idx < files.length) {
      const f = files[idx++];
      const rel = makeUploadRel(f);
      try {
        const r = await uploadOne(rel, f, overwrite);
        out.ok++;
        const info = r.files && r.files[0];
        if (info && info.renamed) out.notes.push(`${info.rel}（已存在，保留两者）`);
        else if (info && info.conflict) out.notes.push(`${info.rel}（已覆盖）`);
      } catch (err) {
        out.errors.push(`${f.name}: ${err.message}`);
      }
      progressDone++;
      setProgress(progressDone / progressTotal);
      $('#progressText').textContent = `上传中 ${progressDone}/${progressTotal}`;
    }
  };

  await Promise.all(Array.from({ length: pool }, worker));
  progressEl.hidden = true;
  state.uploading = false;
  $('#btnUpload').disabled = false;
  $('#btnUploadDir').disabled = false;
  await refreshTree();
  const parts = [`成功 ${out.ok} 个`];
  if (out.notes.length) parts.push(out.notes.slice(0, 5).join('；') + (out.notes.length > 5 ? ` 等 ${out.notes.length} 条` : ''));
  if (out.errors.length) parts.push('失败：' + out.errors.join('；'));
  toast(parts.join(' · '), 6000);
}

/* ================= 其他操作 ================= */
async function refreshTree() {
  try {
    state.tree = await api('/api/tree');
    renderTree();
    renderList();
  } catch (e) {
    toast(e.message);
  }
}

async function createDir() {
  const name = await promptBox('新建文件夹', '文件夹名称');
  if (!name) return;
  if (/[\\/:*?"<>|]/.test(name)) {
    toast('名称包含非法字符');
    return;
  }
  try {
    await api('/api/dir', { method: 'POST', body: JSON.stringify({ path: posixJoin(state.cur, name) }) });
    await refreshTree();
    toast('已创建');
  } catch (e) {
    toast(e.message);
  }
}

async function delNode(n) {
  const ok = await confirmBox(
    '删除确认',
    `确定要删除「${n.rel}」吗？${n.type === 'dir' ? '文件夹内所有内容都会被删除，' : ''}此操作不可恢复。`,
    '删除'
  );
  if (!ok) return;
  try {
    await api('/api/file?path=' + encodeURIComponent(n.rel), { method: 'DELETE' });
    await refreshTree();
    toast('已删除');
  } catch (e) {
    toast(e.message);
  }
}

function downloadZip(rel) {
  window.location = '/api/zip?path=' + encodeURIComponent(rel || '');
}

/* ================= 用户管理 ================= */
async function openUsers() {
  try {
    const data = await api('/api/auth/users');
    renderUsers(data.users || []);
  } catch (e) {
    toast(e.message);
    return;
  }
  $('#usersModal').hidden = false;
}

function renderUsers(users) {
  const list = $('#usersList');
  list.innerHTML = '';
  const me = state.user ? state.user.username : '';
  users.forEach((u) => {
    const row = mk('div', 'user-item');
    const name = mk('span', 'user-item-name', u.username + (u.username === me ? '（我）' : ''));
    const chip = mk('span', 'role-chip' + (u.role === 'guest' ? ' guest' : ''), u.role === 'guest' ? '游客' : '管理员');
    row.append(name, chip);
    if (u.role === 'guest' && u.username !== me) {
      const btnDel = mk('button', 'btn tiny danger', '删除');
      btnDel.onclick = async () => {
        const ok = await confirmBox('删除账号', `确定删除游客账号「${u.username}」吗？该账号将立即无法登录。`, '删除');
        if (!ok) return;
        try {
          await api('/api/auth/users/' + encodeURIComponent(u.username), { method: 'DELETE' });
          toast('已删除');
          const data = await api('/api/auth/users');
          renderUsers(data.users || []);
        } catch (e) {
          toast(e.message);
        }
      };
      row.appendChild(btnDel);
    }
    list.appendChild(row);
  });
  if (!users.length) list.appendChild(mk('div', 'user-item', '暂无用户'));
}

async function createGuest() {
  const username = $('#nuUser').value.trim();
  const password = $('#nuPass').value;
  if (!username || !password) {
    toast('请填写用户名和密码');
    return;
  }
  try {
    await api('/api/auth/users', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    });
    $('#nuUser').value = '';
    $('#nuPass').value = '';
    toast(`已创建游客账号 ${username}`);
    const data = await api('/api/auth/users');
    renderUsers(data.users || []);
  } catch (e) {
    toast(e.message);
  }
}

/* ================= 移动端抽屉 ================= */
function closeDrawer() {
  $('#sidebar').classList.remove('open');
  $('#mask').hidden = true;
}

/* ===== 阅读时操作栏智能显隐：下滑收起、上滑唤出 ===== */
let lastReadY = 0;

function onReadScroll() {
  const scroller = $('#content');
  if (!scroller || !document.body.classList.contains('previewing')) return;
  const y = scroller.scrollTop;
  if (y <= 56) {
    document.body.classList.remove('bar-hidden'); // 接近顶部时始终显示
  } else if (y > lastReadY + 4) {
    document.body.classList.add('bar-hidden'); // 向下滑 → 收起
  } else if (y < lastReadY - 4) {
    document.body.classList.remove('bar-hidden'); // 向上滑 → 唤出
  }
  lastReadY = y;
}

function resetReadBar() {
  lastReadY = 0;
  document.body.classList.remove('bar-hidden');
}

/* ================= 事件绑定与启动 ================= */
document.addEventListener('DOMContentLoaded', async () => {
  window.addEventListener('hashchange', navigateFromHash);
  $('#loginForm').addEventListener('submit', submitAuth);
  $('#btnLogout').onclick = logout;
  $('#btnRefreshTree').onclick = refreshTree;

  $('#btnUpload').onclick = () => {
    if (isGuest()) return toast('游客仅可在线查看');
    $('#fileInput').click();
  };
  $('#btnUploadDir').onclick = () => {
    if (isGuest()) return toast('游客仅可在线查看');
    $('#dirInput').click();
  };
  $('#fileInput').addEventListener('change', (e) => {
    if (!isGuest()) startUpload(e.target.files);
    e.target.value = '';
  });
  $('#dirInput').addEventListener('change', (e) => {
    if (!isGuest()) startUpload(e.target.files);
    e.target.value = '';
  });
  $('#btnNewDir').onclick = createDir;
  $('#btnZip').onclick = () => downloadZip(state.cur);

  $('#btnBack').onclick = () => (history.length > 1 ? history.back() : go('#dir/'));
  $('#btnOpenRaw').onclick = () => {
    if (state.view) window.open('/api/file?path=' + encodeURIComponent(state.view), '_blank');
  };
  $('#btnDownloadNote').onclick = () => {
    if (state.view) window.location = '/api/file?path=' + encodeURIComponent(state.view) + '&download=1';
  };

  // 笔记内相对链接跳转（.md → 站内打开另一篇笔记）
  $('#noteBody').addEventListener('click', (e) => {
    const a = e.target.closest('a.internal');
    if (!a) return;
    e.preventDefault();
    const href = a.getAttribute('href') || '';
    if (href.startsWith('#view/')) go(href); // 显式跳转，保证各浏览器行为一致
  });

  // 用户管理
  $('#btnUsers').onclick = openUsers;
  $('#nuClose').onclick = () => {
    $('#usersModal').hidden = true;
  };
  $('#nuCreate').onclick = createGuest;
  $('#nuPass').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') createGuest();
  });

  // 侧栏：手机端=抽屉；电脑端=收起/展开
  $('#btnMenu').onclick = () => {
    if (state.mobile) {
      $('#sidebar').classList.add('open');
      $('#mask').hidden = false;
    } else {
      document.body.classList.toggle('sidebar-collapsed');
    }
  };
  $('#mask').onclick = closeDrawer;
  window.addEventListener('resize', () => {
    state.mobile = window.innerWidth < 900;
  });

  // 阅读滚动：下滑收起操作栏，上滑唤出
  $('#content').addEventListener('scroll', onReadScroll, { passive: true });

  // 拖拽上传（含文件夹：浏览器会给条目附带 webkitRelativePath）
  let dragDepth = 0;
  document.body.addEventListener('dragenter', (e) => {
    e.preventDefault();
    dragDepth++;
  });
  document.body.addEventListener('dragover', (e) => e.preventDefault());
  document.body.addEventListener('dragleave', (e) => {
    e.preventDefault();
    dragDepth = Math.max(0, dragDepth - 1);
    if (dragDepth === 0) document.body.classList.remove('dragging');
  });
  document.body.addEventListener('drop', (e) => {
    e.preventDefault();
    dragDepth = 0;
    document.body.classList.remove('dragging');
    if (e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files.length) {
      if (isGuest()) toast('游客仅可在线查看，不能上传');
      else startUpload(e.dataTransfer.files);
    }
  });
  document.body.addEventListener('dragenter', () => document.body.classList.add('dragging'));

  // 启动
  try {
    const st = await api('/api/auth/status');
    state.needsSetup = st.needsSetup;
    if (st.authenticated) {
      state.user = st.user;
      enterApp();
    } else {
      showLogin();
    }
  } catch (e) {
    // 连不上服务器也不能白屏：至少给出登录界面和错误提示
    showLogin();
    toast('无法连接服务器，请检查服务是否启动');
  }
});
