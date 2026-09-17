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

// 写操作（建目录/删除/打包下载）仅管理员可用；游客只允许在线查看
const adminOnly = auth.requireRole('admin');
// 上传：管理员 + 普通用户均可（普通用户上传后成为该文件的 uploader）
const canWrite = auth.requireRole('admin', 'user');

// ---------- 上传：先落到临时目录，路由内再做冲突处理与最终落位 ----------
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

const upload = multer({
  storage,
  limits: { fileSize: config.maxUploadMb * 1024 * 1024, files: 500 },
});

const MD_RE = /\.(md|markdown)$/i;

// ---------- 目录树 ----------
async function buildTree(absDir, relDir) {
  const entries = await fsp.readdir(absDir, { withFileTypes: true });
  const dirs = [];
  const files = [];
  for (const e of entries) {
    const abs = path.join(absDir, e.name);
    const rel = relDir ? `${relDir}/${e.name}` : e.name;
    if (e.isDirectory()) {
      dirs.push(await buildTree(abs, rel));
    } else if (e.isFile()) {
      let size = 0;
      let mtime = 0;
      try {
        const st = await fsp.stat(abs);
        size = st.size;
        mtime = st.mtimeMs;
      } catch (err) {}
      const fileObj = { name: e.name, type: 'file', rel, size, mtime, isMd: MD_RE.test(e.name) };
      // 附加归属信息（供前端判断删除/编辑权限）
      if (state.uploads) {
        const rec = state.uploads.get(rel);
        if (rec) fileObj.owner = rec.uploader;
      }
      files.push(fileObj);
    }
    // 符号链接等其他类型一律忽略
  }
  const cmp = (a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN');
  dirs.sort(cmp);
  files.sort(cmp);
  return {
    name: relDir ? path.basename(absDir) : '',
    type: 'dir',
    rel: relDir || '',
    children: [...dirs, ...files],
  };
}

router.get('/tree', async (req, res, next) => {
  try {
    const tree = await buildTree(config.notesRoot, '');
    res.json(tree);
  } catch (e) {
    next(e);
  }
});

// ---------- 全文搜索 ----------
// 扫描 notes/ 下所有 .md，按匹配次数排序，最多返回 50 条。
async function listMdFiles(root) {
  const out = [];
  const walk = async (abs, base) => {
    let entries;
    try {
      entries = await fsp.readdir(abs, { withFileTypes: true });
    } catch (e) {
      return;
    }
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

/** 取第一个匹配位置的前后各 50 字作为片段，并给出片段内关键词位置（用于高亮） */
function makeSnippet(text, needle, lowerText) {
  const first = lowerText.indexOf(needle);
  const start = Math.max(0, first - 50);
  const end = Math.min(text.length, first + needle.length + 50);
  const prefix = start > 0 ? '…' : '';
  const suffix = end < text.length ? '…' : '';
  const snippet = prefix + text.slice(start, end) + suffix;
  const snipLower = snippet.toLowerCase();
  const positions = [];
  let pos = snipLower.indexOf(needle);
  while (pos !== -1) {
    positions.push([pos, pos + needle.length]);
    pos = snipLower.indexOf(needle, pos + needle.length);
  }
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
      let text;
      try {
        text = await fsp.readFile(full, 'utf8');
      } catch (e) {
        continue;
      }
      const lower = text.toLowerCase();
      let count = 0;
      let idx = lower.indexOf(needle);
      while (idx !== -1) {
        count++;
        idx = lower.indexOf(needle, idx + needle.length);
      }
      if (count === 0) continue;
      const { snippet, positions } = makeSnippet(text, needle, lower);
      results.push({ path: rel, count, snippet, positions });
    }
    results.sort((a, b) => b.count - a.count || a.path.localeCompare(b.path, 'zh-Hans-CN'));
    res.json({ results: results.slice(0, 50) });
  } catch (e) {
    next(e);
  }
});

// ---------- 文件归属检查 ----------
router.get('/ownership', (req, res) => {
  const rel = String(req.query.path || '');
  if (!rel) return res.json({ canEdit: false });
  // 管理员可编辑任何文件
  if (req.user.role === 'admin') return res.json({ canEdit: true });
  // 游客不可编辑
  if (req.user.role === 'guest') return res.json({ canEdit: false });
  // 普通用户：检查是否是自己上传的
  const rec = state.uploads ? state.uploads.get(rel) : null;
  const canEdit = rec && rec.uploader === req.user.username;
  res.json({ canEdit });
});

// ---------- 上传 ----------
// 请求：multipart，字段 path=目标相对路径(含文件名)，overwrite=1|0，file=文件
router.post('/upload', canWrite, upload.array('file', 500), async (req, res, next) => {
  const files = req.files || [];
  if (files.length === 0) {
    return res.status(400).json({ error: '未收到文件' });
  }
  const overwrite = req.body.overwrite !== '0';
  const results = [];
  try {
    for (const f of files) {
      let rel = normalizeRel(req.body.path || '');
      // path 未含文件名（如以 / 结尾）时，用原始文件名补全
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
        // 保留两者：自动追加 “ (n)” 后缀（仅在冲突时，非必要不修改文件名）
        const ext = path.extname(full);
        const base = path.basename(full, ext);
        let n = 1;
        let candidate;
        do {
          candidate = path.join(parent, `${base} (${n})${ext}`);
          n++;
        } while (fs.existsSync(candidate));
        await fsp.rename(f.path, candidate);
        finalRel = path.relative(config.notesRoot, candidate).split(path.sep).join('/');
        if (state.uploads) state.uploads.record(finalRel, req.user.username);
        results.push({ rel: finalRel, size: f.size, conflict: true, renamed: true });
        continue;
      }

      if (existedBefore) {
        await fsp.rm(full, { force: true });
      }
      try {
        await fsp.rename(f.path, full);
      } catch (e) {
        if (e.code === 'EXDEV') {
          await fsp.copyFile(f.path, full);
          await fsp.unlink(f.path).catch(() => {});
        } else {
          throw e;
        }
      }
      if (state.uploads) state.uploads.record(finalRel, req.user.username);
      results.push({ rel: finalRel, size: f.size, conflict: existedBefore, renamed: false });
    }
    res.json({ ok: true, files: results });
  } catch (e) {
    for (const f of files) {
      fsp.unlink(f.path).catch(() => {});
    }
    next(e);
  }
});

// ---------- 新建文件夹 ----------
router.post('/dir', auth.requireAuth, async (req, res, next) => {
  try {
    const p = (req.body && req.body.path) || '';
    const { full } = resolveInside(config.notesRoot, p);
    if (full === path.resolve(config.notesRoot)) {
      return res.status(400).json({ error: '不能创建根目录' });
    }
    fs.mkdirSync(full, { recursive: true });
    assertRealInside(config.notesRoot, full);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

// ---------- 读取文件（在线预览 / 图片 / 下载） ----------
// 游客可在线查看（内联读取），但 download=1 需非游客权限
router.get('/file', (req, res, next) => {
  try {
    if (req.query.download === '1' && req.user.role === 'guest') {
      return res.status(403).json({ error: '游客账号仅可在线查看，不能下载文件' });
    }
    const { full } = resolveInside(config.notesRoot, req.query.path);
    assertRealInside(config.notesRoot, full);
    if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
      return res.status(404).json({ error: '文件不存在' });
    }
    if (req.query.download === '1') {
      res.download(full, path.basename(full), (err) => {
        if (err && !res.headersSent) next(err);
      });
    } else {
      res.setHeader('Cache-Control', 'private, max-age=300');
      res.sendFile(full, (err) => {
        if (err && !res.headersSent) next(err);
      });
    }
  } catch (e) {
    next(e);
  }
});

// ---------- 浏览器内编辑 Markdown ----------
// 权限：admin 任意；user 仅自己的文件；guest 返回 403。
router.put('/edit', async (req, res, next) => {
  try {
    const rel = (req.body && req.body.path) || '';
    const content = req.body && req.body.content;
    if (typeof content !== 'string') {
      return res.status(400).json({ error: '缺少内容' });
    }
    const { full, rel: cleanRel } = resolveInside(config.notesRoot, rel);
    if (!MD_RE.test(cleanRel)) {
      return res.status(400).json({ error: '只能编辑 Markdown 文件' });
    }
    if (!fs.existsSync(full) || !fs.statSync(full).isFile()) {
      return res.status(404).json({ error: '文件不存在' });
    }
    assertRealInside(config.notesRoot, full);

    if (req.user.role === 'guest') {
      return res.status(403).json({ error: '游客仅可在线查看，不能编辑' });
    }
    if (req.user.role === 'user') {
      const rec = state.uploads ? state.uploads.get(cleanRel) : null;
      if (!rec || rec.uploader !== req.user.username) {
        return res.status(403).json({ error: '只能编辑自己上传的笔记' });
      }
    }

    // 原子写入：先写临时文件再覆盖，避免断电产生半截文件
    const tmp = full + '.edit-' + Date.now();
    await fsp.writeFile(tmp, content, 'utf8');
    await fsp.rename(tmp, full);
    if (state.uploads) state.uploads.touch(cleanRel);
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

// ---------- 打包下载（文件夹 ZIP / 单文件） ----------
router.get('/zip', auth.requireAuth, (req, res, next) => {
  try {
    const { full } = resolveInside(config.notesRoot, req.query.path);
    assertRealInside(config.notesRoot, full);
    if (!fs.existsSync(full)) {
      return res.status(404).json({ error: '路径不存在' });
    }
    const isDir = fs.statSync(full).isDirectory();
    const baseName = isDir ? path.basename(full) || 'notes' : path.basename(full, path.extname(full));
    res.setHeader('Content-Type', 'application/zip');
    res.setHeader(
      'Content-Disposition',
      `attachment; filename*=UTF-8''${encodeURIComponent(baseName + '.zip')}`
    );
    const archive = archiver('zip', { zlib: { level: 6 } });
    archive.on('error', (err) => {
      res.destroy(err);
    });
    res.on('close', () => archive.abort());
    archive.pipe(res);
    if (isDir) {
      archive.directory(full, baseName);
    } else {
      archive.file(full, { name: path.basename(full) });
    }
    archive.finalize();
  } catch (e) {
    next(e);
  }
});

// ---------- 删除（文件或文件夹） ----------
router.delete('/file', auth.requireAuth, async (req, res, next) => {
  try {
    const { full, rel: cleanRel } = resolveInside(config.notesRoot, req.query.path);
    if (full === path.resolve(config.notesRoot)) {
      return res.status(400).json({ error: '不能删除根目录' });
    }
    assertRealInside(config.notesRoot, full);
    // 权限校验：游客不能删，普通用户只能删自己的
    if (req.user.role === 'guest') {
      return res.status(403).json({ error: '游客仅可在线查看' });
    }
    if (req.user.role === 'user') {
      const rec = state.uploads ? state.uploads.get(cleanRel) : null;
      if (!rec || rec.uploader !== req.user.username) {
        return res.status(403).json({ error: '只能删除自己上传的文件' });
      }
    }
    // 先判断类型，再删除，最后清理归属记录
    const isDir = fs.existsSync(full) && fs.statSync(full).isDirectory();
    await fsp.rm(full, { recursive: true, force: true });
    if (state.uploads) {
      if (isDir) {
        state.uploads.removeDir(cleanRel);
      } else {
        state.uploads.remove(cleanRel);
      }
    }
    res.json({ ok: true });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
