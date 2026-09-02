'use strict';

const fs = require('fs');
const bcrypt = require('bcryptjs');

/**
 * 用户存储：单文件 JSON，原子写入，权限 600。
 * 个人笔记应用规模足够，无需数据库。
 */
class UserStore {
  constructor(file) {
    this.file = file;
    this.users = this._load();
  }

  _load() {
    try {
      const data = JSON.parse(fs.readFileSync(this.file, 'utf8'));
      return Array.isArray(data) ? data : [];
    } catch (e) {
      return [];
    }
  }

  _save() {
    const tmp = this.file + '.tmp';
    fs.writeFileSync(tmp, JSON.stringify(this.users, null, 2), { encoding: 'utf8', mode: 0o600 });
    try {
      fs.chmodSync(tmp, 0o600);
    } catch (e) {}
    fs.renameSync(tmp, this.file);
    try {
      fs.chmodSync(this.file, 0o600);
    } catch (e) {}
  }

  count() {
    return this.users.length;
  }

  find(username) {
    const key = String(username || '').toLowerCase();
    return this.users.find((u) => u.username.toLowerCase() === key) || null;
  }

  async create(username, password) {
    if (this.find(username)) {
      const err = new Error('用户名已存在');
      err.status = 409;
      throw err;
    }
    const hash = await bcrypt.hash(password, 10);
    this.users.push({
      username,
      hash,
      createdAt: new Date().toISOString(),
    });
    this._save();
    return { username };
  }

  async setPassword(username, password) {
    const user = this.find(username);
    if (!user) {
      const err = new Error('用户不存在');
      err.status = 404;
      throw err;
    }
    user.hash = await bcrypt.hash(password, 10);
    this._save();
    return { username };
  }

  async verify(username, password) {
    const user = this.find(username);
    if (!user) return false;
    return bcrypt.compare(password || '', user.hash);
  }
}

module.exports = { UserStore };
