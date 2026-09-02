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

// 公开状态：是否需要初始化 / 当前是否已登录
router.get('/status', (req, res) => {
  const payload = auth.verify(req.cookies[config.cookieName]);
  res.json({
    needsSetup: state.users.count() === 0,
    authenticated: !!payload,
    user: payload ? { username: payload.sub } : null,
  });
});

// 首次使用：创建管理员账号（仅当系统尚无任何用户时允许）
router.post('/setup', async (req, res, next) => {
  try {
    if (state.users.count() > 0) {
      return res.status(403).json({ error: '系统已初始化，不能重复创建账号' });
    }
    const { username, password } = req.body || {};
    const err = validateCredentials(username, password);
    if (err) return res.status(400).json({ error: err });
    await state.users.create(username, password);
    const token = auth.issueToken(username);
    auth.setAuthCookie(req, res, token);
    res.json({ ok: true, user: { username } });
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
    const token = auth.issueToken(username);
    auth.setAuthCookie(req, res, token);
    res.json({ ok: true, user: { username } });
  } catch (e) {
    next(e);
  }
});

router.post('/logout', (req, res) => {
  auth.clearAuthCookie(req, res);
  res.json({ ok: true });
});

router.get('/me', auth.requireAuth, (req, res) => {
  res.json({ user: { username: req.user.username } });
});

module.exports = router;
