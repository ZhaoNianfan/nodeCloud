'use strict';

const path = require('path');
const fs = require('fs');
const express = require('express');
const cookieParser = require('cookie-parser');

const config = require('./src/config');
const state = require('./src/state');
const auth = require('./src/auth');
const { UserStore } = require('./src/users');
const authRoutes = require('./src/routes/auth');
const fileRoutes = require('./src/routes/files');

// 初始化目录
fs.mkdirSync(config.dataDir, { recursive: true });
fs.mkdirSync(config.notesRoot, { recursive: true });
fs.mkdirSync(config.tmpDir, { recursive: true });

// 共享状态
state.users = new UserStore(path.join(config.dataDir, 'users.json'));
state.secret = auth.loadSecret(path.join(config.dataDir, 'secret.key'));

const app = express();
app.disable('x-powered-by');
// 部署在 Caddy / Nginx 反向代理之后，信任代理转发头
app.set('trust proxy', true);

// 基础安全响应头
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'DENY');
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader(
    'Content-Security-Policy',
    "default-src 'self'; img-src 'self' data:; style-src 'self'; script-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'"
  );
  next();
});

// 简易访问日志
app.use((req, res, next) => {
  const t0 = Date.now();
  res.on('finish', () => {
    console.log(`${new Date().toISOString()} ${req.method} ${req.originalUrl} ${res.statusCode} ${Date.now() - t0}ms`);
  });
  next();
});

app.use(express.json({ limit: '1mb' }));
app.use(cookieParser());

// 跨站请求防护：带 Origin 的写请求必须同源
app.use((req, res, next) => {
  if (['POST', 'PUT', 'PATCH', 'DELETE'].includes(req.method)) {
    const origin = req.headers.origin;
    if (origin) {
      try {
        const o = new URL(origin);
        if (o.host !== req.headers.host) {
          return res.status(403).json({ error: '跨站请求被拒绝' });
        }
      } catch (e) {
        return res.status(400).json({ error: '非法请求头' });
      }
    }
  }
  next();
});

app.get('/api/health', (req, res) => res.json({ ok: true, uptime: process.uptime() }));

app.use('/api/auth', authRoutes);
app.use('/api', auth.requireAuth, fileRoutes);

// 静态资源（前端界面）
app.use(express.static(config.publicDir, { maxAge: '10m', index: 'index.html' }));

// 统一错误处理
app.use((err, req, res, next) => {
  if (err && err.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: `单个文件超过 ${config.maxUploadMb}MB 限制` });
  }
  if (err && err.name === 'MulterError') {
    return res.status(400).json({ error: `上传错误: ${err.message}` });
  }
  console.error(err);
  res.status(err.status || 500).json({ error: err.message || '服务器内部错误' });
});

app.listen(config.port, () => {
  console.log(`NoteCloud 已启动: http://0.0.0.0:${config.port}`);
  console.log(`笔记根目录: ${config.notesRoot}`);
  console.log(`数据目录:   ${config.dataDir}`);
});
