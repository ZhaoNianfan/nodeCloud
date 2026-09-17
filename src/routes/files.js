'use strict';

const express = require('express');
const fs = require('fs');
const fsp = require('fs/promises');
const path = require('path');
const multer = require('multer');
const archiver = require('archiver');

const config = require('../config');
const auth = require('../auth');
const state = require('../state');
const { resolveInside, assertRealInside, sanitizeName, normalizeRel } = require('../paths');

const router = express.Router();
const canWrite = auth.requireRole('admin', 'user');

// ========== 工具函数 ==========

/** 递归收集目录下所有文件的相对路径 */
function collectFiles(dirAbs, dirRel) {
  const out = [];
  let entries;
  try { entries = fs.readdirSync(dirAbs, { withFileTypes: true }); } catch (e) { return out; }
  for (const e of entries) {
    const abs = path.join(dirAbs, e.name);
    const rel = dirRel ? dirRel + '/' + e.name : e.name;
    if (e.isDirectory()) out.push(...collectFiles(abs, rel));
    else if (e.isFile()) out.push(rel);
  }
  return out;
}

/** 检查用户是否拥有该文件（owner 或 admin） */
function isFileOwner(userRole, username, fileRel) {
  if (userRole === 'admin') return true;
  if (userRole === 'guest') return false;
  const rec = state.uploads ? state.uploads.get(fileRel) : null;
  return rec && rec.uploader === username;
}

// 上传
const storage = multer.diskStorage({
  destination: (req, file, cb) => {
    fs.mkdirSync(config.tmpDir, { recursive: true });
    cb(null, config.tmpDir);
  },
  filename: (req, file, cb) => {
    const ext = path.extname(file.originalname || '').slice(0, 20);
    cb(null, `up-${Date.now()}-${Math.random().toString(36).slice(2, 10)}${ext}`);
  },
});
const upload = multer({ storage, limits: { fileSize: config.maxUploadMb * 1024 * 1024, files: 500 } });
const MD_RE = /\.(md|markdown)$/i;

// ========== 目录树 ==========
async function buildTree(absDir, relDir) {
  const entries = await fsp.readdir(absDir, { withFileTypes: true });
  const dirs = [], files = [];
  for (const e of entries) {
    const abs = path.join(absDir, e.name);
    const rel = relDir ? `${relDir}/${e.name}` : e.name;
    if (e.isDirectory()) {
      dirs.push(await buildTree(abs, rel));
    } else if (e.isFile()) {
      let size = 0, mtime = 0;
      try { const st = await fsp.stat(abs); size = st.size; mtime = st.mtimeMs; } catch (err) {}
      files.push({ name: e.name, type: 'file', rel, size, mtime, isMd: MD_RE.test(e.name) });
    }
  }
  const cmp = (a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN');
  dirs.sort(cmp); files.sort(cmp);
  return { name: relDir ? path.basename(absDir) : '', type: 'dir', rel: relDir || '', children: [...dirs, ...files] };
}

router.get('/tree', async (req, res, next) => {
  try { res.json(await buildTree(config.notesRoot, '')); } catch (e) { next(e); }
});

// ========== 全文搜索 ==========
async function listMdFiles(root) {
  const out = [];
  const walk = async (abs, base) => {
    let entries;
    try { entries = await fsp.readdir(abs, { withFileTypes: true }); } catch (e) { return; }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const absP = path.join(abs, e.name);
      const rel = base ? base + '/' + e.name : e.name;
      if (e.isDirectory()) await walk(absP, rel);
      else if (e.isFile() && MD_RE.test(e.name)) out.push(rel);
    }
  };
  await walk(root, '');
  return out;
}

function makeSnippet(text, needle, lowerText) {
  const first = lowerText.indexOf(needle);
  const start = Math.max(0, first - 50);
  const end = Math.min(text.length, first + needle.length + 50);
  const snippet = (start > 0 ? '…' : '') + text.slice(start, end) + (end < text.length ? '…' : '');
  const positions = [];
  let pos = snippet.toLowerCase().indexOf(needle);
  while (pos !== -1) { positions.push([pos, pos + needle.length]); pos = snippet.toLowerCase().indexOf(needle, pos + needle.length); }
  return { snippet, positions };
}

router.get('/search', async (req, res, next) => {
  try {
    const q = String(req.query.q || '').trim();
    if (!q) return res.json({ results: [] });
    const needle = q.toLowerCase();
    const files = await listMdFiles(config.notesRoot);
    const results = [];
    for (const rel of files) {
      const full = path.join(config.notesRoot, ...rel.split('/'));
      let text; try { text = await fsp.readFile(full, 'utf8'); } catch (e) { continue; }
      const lower = text.toLowerCase();
      let count = 0; let idx = lower.indexOf(needle);
      while (idx !== -1) { count++; idx = lower.indexOf(needle, idx + needle.length); }
      if (count === 0) continue;
      const { snippet, positions } = makeSnippet(text, needle, lower);
      results.push({ path: rel, count, snippet, positions });
    }
    results.sort((a, b) => b.count - a.count || a.path.localeCompare(b.path, 'zh-Hans-CN'));
    res.json({ results: results.slice(0, 50) });
  } catch (e) { next(e); }
});

// ========== 文件归属检查（供前端判断编辑按钮） ==========
router.get('/ownership', (req, res) => {
  const rel = String(req.query.path || '');
  if (!rel) return res.json({ canEdit: false });
  if (req.user.role === 'admin') return res.json({ canEdit: true });
  if (req.user.role === 'guest') return res.json({ canEdit: false });
  res.json({ canEdit: isFileOwner(req.user.role, req.user.username, rel) });
});

// ========== 上传 ==========
router.post('/upload', canWrite, upload.array('file', 500), async (req, res, next) => {
  const files = req.files || [];
  if (files.length === 0) return res.status(400).json({ error: '未收到文件' });
  const overwrite = req.body.overwrite !== '0';
  const results = [];
  try {
    for (const f of files) {
      let rel = normalizeRel(req.body.path || '');
      if (!rel || rel.endsWith('/')) {
        rel = rel ? rel + '/' + sanitizeName(f.originalname) : sanitizeName(f.originalname);
      }
      const { full, rel: cleanRel } = resolveInside(config.notesRoot, rel);
      const parent = path.dirname(full);
      fs.mkdirSync(parent, { recursive: true });
      assertRealInside(config.notesRoot, parent);

      const existedBefore = fs.existsSync(full);
      let finalRel = cleanRel;

      if (existedBefore && !overwrite) {
        const ext = path.extname(full);
        const base = path.basename(full, ext);
        let n = 1, candidate;
        do { candidate = path.join(parent, `${base} (${n})${ext}`); n++; } while (fs.existsSync(candidate));
        await fsp.rename(f.path, candidate);
        finalRel = path.relative(config.notesRoot, candidate).split(path.sep).join('/');
        if (state.uploads) state.uploads.record(finalRel, req.user.username);
        results.push({ rel: finalRel, size: f.size, conflict: true, renamed: true });
        continue;
      }

      if (existedBefore) await fsp.rm(full, { force: true });
      try { await fsp.rename(f.path, full); } catch (e) {
        if (e.code === 'EXDEV') { await fsp.copyFile(f.path, full); await fsp.unlink(f.path).catch(() => {}); } else { throw e; }
      }
      if (state.uploads) state.uploads.record(finalRel, req.user.username);
      results.push({ rel: finalRel, size: f.size, conflict: existedBefore, renamed: false });
    }
    res.json({ ok: true, files: results });
  } catch (e) {
    for (const f of files) fsp.unlink(f.path).catch(() => {});
    next(e);
  }
});

// ========== 新建文件夹 ==========
router.post('/dir', auth.requireAuth, async (req, res, next) => {
  try {
    const p = (req.body && req.body.path) || '';
    const { full } = resolveInside(config.notesRoot, p);
    if (full === path.resolve(config.notesRoot)) return res.status(400).json({ error: '不能创建根目录' });
    fs.mkdirSync(full, { recursive: true });
    assertRealInside(config.notesRoot, full);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ========== 读取文件 ==========
router.get('/file', (req, res, next) => {
  try {
    const { full } = resolveInside(config.notesRoot, req.query.path);
    assertRealInside(config.notesRoot, full);
    if (!fs.existsSync(full) || !fs.statSync(full).isFile()) return res.status(404).json({ error: '文件不存在' });
    if (req.query.download === '1') {
      res.download(full, path.basename(full), (err) => { if (err && !res.headersSent) next(err); });
    } else {
      res.setHeader('Cache-Control', 'private, max-age=300');
      res.sendFile(full, (err) => { if (err && !res.headersSent) next(err); });
    }
  } catch (e) { next(e); }
});

// ========== 编辑 Markdown ==========
router.put('/edit', async (req, res, next) => {
  try {
    const rel = (req.body && req.body.path) || '';
    const content = req.body && req.body.content;
    if (typeof content !== 'string') return res.status(400).json({ error: '缺少内容' });
    const { full, rel: cleanRel } = resolveInside(config.notesRoot, rel);
    if (!MD_RE.test(cleanRel)) return res.status(400).json({ error: '只能编辑 Markdown 文件' });
    if (!fs.existsSync(full) || !fs.statSync(full).isFile()) return res.status(404).json({ error: '文件不存在' });
    assertRealInside(config.notesRoot, full);
    if (!isFileOwner(req.user.role, req.user.username, cleanRel)) {
      return res.status(403).json({ error: '只能编辑自己上传的笔记' });
    }
    const tmp = full + '.edit-' + Date.now();
    await fsp.writeFile(tmp, content, 'utf8');
    await fsp.rename(tmp, full);
    if (state.uploads) state.uploads.touch(cleanRel);
    res.json({ ok: true });
  } catch (e) { next(e); }
});

// ========== 打包下载 ==========
router.get('/zip', auth.requireAuth, (req, res, next) => {
  try {
    const { full } = resolveInside(config.notesRoot, req.query.path);
    assertRealInside(config.notesRoot, full);
    if (!fs.existsSync(full)) return res.status(404).json({ error: '路径不存在' });
    const isDir = fs.statSync(full).isDirectory();
    const baseName = isDir ? path.basename(full) || 'notes' : path.basename(full, path.extname(full));
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader('Content-Disposition', `attachment; filename*=UTF-8''${encodeURIComponent(baseName + '.zip')}`);
    const archive = archiver('zip', { zlib: { level: 6 } });
    archive.on('error', (err) => { res.destroy(err); });
    res.on('close', () => archive.abort());
    archive.pipe(res);
    if (isDir) archive.directory(full, baseName); else archive.file(full, { name: path.basename(full) });
    archive.finalize();
  } catch (e) { next(e); }
});

// ========== 删除（文件或文件夹） ==========
router.delete('/file', auth.requireAuth, async (req, res, next) => {
  try {
    const { full, rel: cleanRel } = resolveInside(config.notesRoot, req.query.path);
    if (full === path.resolve(config.notesRoot)) return res.status(400).json({ error: '不能删除根目录' });
    assertRealInside(config.notesRoot, full);
    if (req.user.role === 'guest') return res.status(403).json({ error: '游客仅可在线查看' });

    const isDir = fs.existsSync(full) && fs.statSync(full).isDirectory();

    if (isDir) {
      // 文件夹删除：递归检查所有文件归属，必须全部属于当前用户
      const childFiles = collectFiles(full, cleanRel);
      for (const fileRel of childFiles) {
        if (!isFileOwner(req.user.role, req.user.username, fileRel)) {
          return res.status(403).json({ error: '该文件夹包含其他用户的文件，无法删除' });
        }
      }
      await fsp.rm(full, { recursive: true, force: true });
      // 清理所有子文件的归属记录
      if (state.uploads) {
        for (const fileRel of childFiles) state.uploads.remove(fileRel);
      }
    } else {
      // 文件删除：检查归属
      if (!isFileOwner(req.user.role, req.user.username, cleanRel)) {
        return res.status(403).json({ error: '只能删除自己上传的文件' });
      }
      await fsp.rm(full, { force: true });
      if (state.uploads) state.uploads.remove(cleanRel);
    }

    res.json({ ok: true });
  } catch (e) { next(e); }
});

module.exports = router;
