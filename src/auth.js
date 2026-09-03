'use strict';

const crypto = require('crypto');
const fs = require('fs');
const config = require('./config');
const state = require('./state');

let _secret = null;

/** 读取或生成签名密钥（HMAC-SHA256），持久化到 data/secret.key */
function loadSecret(file) {
  if (fs.existsSync(file)) {
    _secret = fs.readFileSync(file, 'utf8').trim();
  } else {
    _secret = crypto.randomBytes(48).toString('base64url');
    fs.writeFileSync(file, _secret, { mode: 0o600 });
    try {
      fs.chmodSync(file, 0o600);
    } catch (e) {}
  }
  return _secret;
}

const b64url = (buf) => Buffer.from(buf).toString('base64url');

function sign(payload) {
  const body = b64url(JSON.stringify(payload));
  const sig = crypto.createHmac('sha256', _secret).update(body).digest('base64url');
  return body + '.' + sig;
}

/** 校验签名与有效期；不通过返回 null */
function verify(token) {
  if (!token) return null;
  const parts = String(token).split('.');
  if (parts.length !== 2) return null;
  const [body, sig] = parts;
  const expected = crypto.createHmac('sha256', _secret).update(body).digest('base64url');
  const a = Buffer.from(sig);
  const b = Buffer.from(expected);
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try {
    const payload = JSON.parse(Buffer.from(body, 'base64url').toString('utf8'));
    if (!payload || !payload.sub) return null;
    if (typeof payload.exp === 'number' && payload.exp * 1000 < Date.now()) return null;
    return payload;
  } catch (e) {
    return null;
  }
}

function issueToken(username) {
  const now = Math.floor(Date.now() / 1000);
  return sign({ sub: username, iat: now, exp: now + config.sessionDays * 86400 });
}

function isSecureRequest(req) {
  if (config.forceHttps) return true;
  if (req.secure) return true;
  return req.headers['x-forwarded-proto'] === 'https';
}

function setAuthCookie(req, res, token) {
  res.cookie(config.cookieName, token, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isSecureRequest(req),
    maxAge: config.sessionDays * 86400 * 1000,
    path: '/',
  });
}

function clearAuthCookie(req, res) {
  res.clearCookie(config.cookieName, {
    httpOnly: true,
    sameSite: 'lax',
    secure: isSecureRequest(req),
    path: '/',
  });
}

/** 登录鉴权中间件：校验签名后从用户存储取最新信息（含角色），
 *  账号被删除时立即失效。 */
function requireAuth(req, res, next) {
  const payload = verify(req.cookies[config.cookieName]);
  if (!payload || !payload.sub) {
    return res.status(401).json({ error: '未登录或登录已过期' });
  }
  const user = state.users ? state.users.find(payload.sub) : null;
  if (!user) {
    return res.status(401).json({ error: '账号不存在或已被删除' });
  }
  req.user = { username: user.username, role: user.role === 'guest' ? 'guest' : 'admin' };
  next();
}

/** 角色限制：requireRole('admin') / requireRole('admin', 'guest') */
function requireRole(...roles) {
  return (req, res, next) => {
    if (!req.user || !roles.includes(req.user.role)) {
      return res.status(403).json({ error: '游客账号仅可在线查看，此操作需要管理员权限' });
    }
    next();
  };
}

// ---- 登录限流：同一 IP 15 分钟内最多 5 次失败 ----
const loginAttempts = new Map();

function loginLimiter(req, res, next) {
  const key = req.ip || 'unknown';
  const now = Date.now();
  const rec = loginAttempts.get(key);
  if (rec && rec.count >= 5 && rec.resetAt > now) {
    return res.status(429).json({ error: '登录尝试过多，请 15 分钟后再试' });
  }
  req._loginFail = () => {
    const r = loginAttempts.get(key) || { count: 0, resetAt: now + 15 * 60 * 1000 };
    r.count += 1;
    loginAttempts.set(key, r);
  };
  req._loginOk = () => loginAttempts.delete(key);
  next();
}

module.exports = {
  loadSecret,
  sign,
  verify,
  issueToken,
  requireAuth,
  requireRole,
  loginLimiter,
  setAuthCookie,
  clearAuthCookie,
};
