'use strict';

const path = require('path');

const ROOT = process.cwd();
const env = (k, d) =>
  process.env[k] !== undefined && process.env[k] !== '' ? process.env[k] : d;

const config = {
  port: parseInt(env('PORT', '3000'), 10),
  notesRoot: path.resolve(env('NOTE_ROOT', path.join(ROOT, 'notes'))),
  dataDir: path.resolve(env('NOTE_DATA', path.join(ROOT, 'data'))),
  tmpDir: path.resolve(env('NOTE_TMP', path.join(ROOT, 'data', 'tmp'))),
  publicDir: path.resolve(ROOT, 'public'),
  maxUploadMb: parseInt(env('MAX_UPLOAD_MB', '1024'), 10),
  sessionDays: parseInt(env('SESSION_DAYS', '30'), 10),
  forceHttps: env('FORCE_HTTPS', '') === '1',
  cookieName: 'notecloud_token',
};

module.exports = config;
