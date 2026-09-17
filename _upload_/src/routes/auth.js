'use strict';

const express = require('express');
const config = require('../config');
const auth = require('../auth');
const state = require('../state');

const router = express.Router();

const USERNAME_RE = /^[\w\u4e00-\u9fa5-]{2,32}$/;

function validateCredentials(username, password) {
  if (!USERNAME_RE.test(username || '')) {
    return '用户名需为 2-32 位字母、数字、下划线、中文或连字符';
  }
  if (typeof password !== 'string' || password.length < 8 || password.length > 128) {
    return '密码长度需为 8-128 位';
  }
  return null;
}

// 公开状态：是否需要初始化 / 当前是否已登录（含角色）
router.get('/status', (req, res) => {
  const payload = auth.verify(req.cookies[config.cookieName]);
  let user = null;
  if (payload && payload.sub) {
    const u = state.users.find(payload.sub);
    if (u) user = { username: u.username, role: u.role === 'guest' ? 'guest' : 'admin' };
  }
  res.json({
    needsSetup: state.users.count() === 0,
    authenticated: !!user,
    user,
  });
});

// 首次使用：创建管理员（正式）账号（仅当系统尚无任何用户时允许）
router.post('/setup', async (req, res, next) => {
  try {
    if (state.users.count() > 0) {
      return res.status(403).json({ error: '系统已初始化，不能重复创建账号' });
    }
    const { username, password } = req.body || {};
    const err = validateCredentials(username, password);
    if (err) return res.status(400).json({ error: err });
    const created = await state.users.create(username, password, 'admin');
    const token = auth.issueToken(username);
    auth.setAuthCookie(req, res, token);
    res.json({ ok: true, user: { username: created.username, role: 'admin' } });
  } catch (e) {
    next(e);
  }
});

router.post('/login', auth.loginLimiter, async (req, res, next) => {
  try {
    const { username, password } = req.body || {};
    if (!username || !password) {
      return res.status(400).json({ error: '请输入用户名和密码' });
    }
    const ok = await state.users.verify(username, password);
    if (!ok) {
      req._loginFail();
      return res.status(401).json({ error: '用户名或密码错误' });
    }
    req._loginOk();
    const user = state.users.find(username);
    const role = user.role === 'guest' ? 'guest' : 'admin';
    const token = auth.issueToken(username);
    auth.setAuthCookie(req, res, token);
    res.json({ ok: true, user: { username, role } });
  } catch (e) {
    next(e);
  }
});

router.post('/logout', (req, res) => {
  auth.clearAuthCookie(req, res);
  res.json({ ok: true });
});

router.get('/me', auth.requireAuth, (req, res) => {
  res.json({ user: req.user });
});

// ==================== 用户管理（管理员专属） ====================

// 用户列表
router.get('/users', auth.requireAuth, auth.requireRole('admin'), (req, res) => {
  res.json({ users: state.users.all() });
});

// 创建游客账号（仅可在线查看）
router.post('/users', auth.requireAuth, auth.requireRole('admin'), async (req, res, next) => {
  try {
    const { username, password } = req.body || {};
    const err = validateCredentials(username, password);
    if (err) return res.status(400).json({ error: err });
    const created = await state.users.create(username, password, 'guest');
    res.json({ ok: true, user: { username: created.username, role: 'guest' } });
  } catch (e) {
    next(e);
  }
});

// 删除游客账号（不能删自己/管理员）
router.delete('/users/:username', auth.requireAuth, auth.requireRole('admin'), (req, res, next) => {
  try {
    const target = state.users.find(req.params.username);
    if (!target) {
      const err = new Error('用户不存在');
      err.status = 404;
      throw err;
    }
    if (target.username === req.user.username) {
      return res.status(400).json({ error: '不能删除当前登录的账号' });
    }
    if (target.role !== 'guest') {
      return res.status(403).json({ error: '只能删除游客账号' });
    }
    const removed = state.users.remove(target.username);
    res.json({ ok: true, user: removed });
  } catch (e) {
    next(e);
  }
});

module.exports = router;
