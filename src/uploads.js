'use strict';

const fs = require('fs');
const path = require('path');

/**
 * 文件归属存储：uploads.json 记录「谁上传了哪个文件」。
 * 结构：{ "path/to/note.md": { "uploader": "username", "uploadedAt": 1726500000000 } }
 * 与 UserStore 一样采用单文件 JSON + 原子写入，规模足够。
 */
class UploadStore {
  constructor(file) {
    this.file = file;
    this.map = this._load();
  }

  _load() {
    try {
      const data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      return data && typeof data === 'object' && !Array.isArray(data) ? data : {};
    } catch (e) {
      return {};
    }
  }

  _save() {
    fs.mkdirSync(path.dirname(this.file), { recursive: true });
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.map, null, 2), { encoding: 'utf8', mode: 0o600 });
    try {
      fs.chmodSync(tmp, 0o600);
    } catch (e) {}
    fs.renameSync(tmp, this.file);
    try {
      fs.chmodSync(this.file, 0o600);
    } catch (e) {}
  }

  get(rel) {
    return this.map[rel] || null;
  }

  /** 记录归属（上传成功时调用） */
  record(rel, username) {
    this.map[rel] = { uploader: username, uploadedAt: Date.now() };
    this._save();
  }

  /** 更新编辑时间戳（若已有归属记录） */
  touch(rel) {
    const rec = this.map[rel];
    if (rec) {
      rec.uploadedAt = Date.now();
      this._save();
    }
  }

  size() {
    return Object.keys(this.map).length;
  }

  /** 删除单个文件的归属记录 */
  remove(rel) {
    if (this.map[rel]) {
      delete this.map[rel];
      this._save();
    }
  }

  /** 删除文件夹下所有归属记录 */
  removeDir(dirRel) {
    const prefix = dirRel ? dirRel + '/' : '';
    let changed = false;
    for (const key of Object.keys(this.map)) {
      if (key === dirRel || key.startsWith(prefix)) {
        delete this.map[key];
        changed = true;
      }
    }
    if (changed) this._save();
  }
}

const MD_RE = /\.(md|markdown)$/i;

/** 递归扫描 notes 目录下的 Markdown 文件，返回 posix 相对路径数组 */
function scanMdFiles(root) {
  const out = [];
  const walk = (abs, base) => {
    let entries;
    try {
      entries = fs.readdirSync(abs, { withFileTypes: true });
    } catch (e) {
      return;
    }
    for (const e of entries) {
      if (e.name.startsWith('.')) continue;
      const absP = path.join(abs, e.name);
      const rel = base ? base + '/' + e.name : e.name;
      if (e.isDirectory()) walk(absP, rel);
      else if (e.isFile() && MD_RE.test(e.name)) out.push(rel);
    }
  };
  walk(root, '');
  return out;
}

/** 首次迁移：把所有既有 .md 文件归属到第一个管理员，返回迁移数量 */
function migrate(store, notesRoot, firstAdmin) {
  const rels = scanMdFiles(notesRoot);
  const now = Date.now();
  for (const rel of rels) store.map[rel] = { uploader: firstAdmin, uploadedAt: now };
  store._save();
  return rels.length;
}

module.exports = { UploadStore, scanMdFiles, migrate };
