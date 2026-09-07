'use strict';

const path = require('path');
const fs = require('fs');

const toPosix = (p) => String(p).replace(/\\/g, '/');

/**
 * 规范化相对路径：去开头斜杠、去 '.' 段，禁止 '..' 段。
 * 抛 400 错误。
 */
function normalizeRel(rel) {
  let r = toPosix(rel || '');
  r = r.replace(/^\/+/, '');
  const segs = r.split('/').filter((s) => s && s !== '.');
  if (segs.some((s) => s === '..')) {
    const err = new Error('非法路径');
    err.status = 400;
    throw err;
  }
  return segs.join('/');
}

/**
 * 将相对路径解析到根目录内；任何逃逸尝试都会抛 400。
 * 返回 { full, rel }
 */
function resolveInside(root, rel) {
  const clean = normalizeRel(rel);
  const rootRes = path.resolve(root);
  const full = path.resolve(rootRes, clean);
  if (full !== rootRes && !full.startsWith(rootRes + path.sep)) {
    const err = new Error('非法路径');
    err.status = 400;
    throw err;
  }
  return { full, rel: clean };
}

/** 对已存在的路径做 realpath 校验，防止符号链接逃逸出根目录 */
function assertRealInside(root, full) {
  const rootReal = fs.realpathSync(root);
  let real;
  try {
    real = fs.realpathSync(full);
  } catch (e) {
    real = full;
  }
  if (real !== rootReal && !real.startsWith(rootReal + path.sep)) {
    const err = new Error('非法路径');
    err.status = 400;
    throw err;
  }
}

/** 清理文件名：取 basename，去除控制字符 */
function sanitizeName(name) {
  const base = path.basename(toPosix(name || ''));
  const clean = base.replace(/[\u0000-\u001f\u007f]/g, '').trim();
  if (!clean || clean === '.' || clean === '..') {
    const err = new Error('非法文件名');
    err.status = 400;
    throw err;
  }
  return clean;
}

const posixJoin = (...parts) =>
  parts.filter((p) => p !== undefined && p !== null && p !== '').map(toPosix).join('/');

module.exports = { toPosix, normalizeRel, resolveInside, assertRealInside, sanitizeName, posixJoin };
