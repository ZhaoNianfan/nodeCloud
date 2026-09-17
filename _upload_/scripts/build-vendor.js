'use strict';

/**
 * 打包前端第三方库到 public/vendor。
 * 全部用纯 Node 实现：拷贝 + 简易 CommonJS 包装，不依赖 esbuild / 网络。
 * 产物随项目提交，服务器部署时无需重新打包。
 *
 * 用法: node scripts/build-vendor.js
 */

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const NM = path.join(ROOT, 'node_modules');
const OUT = path.join(ROOT, 'public', 'vendor');

fs.mkdirSync(OUT, { recursive: true });

function copy(src, dest) {
  fs.copyFileSync(src, dest);
  console.log('copy  ', path.relative(ROOT, dest));
}

// ---------- 1) marked（UMD 浏览器版） ----------
copy(path.join(NM, 'marked', 'marked.min.js'), path.join(OUT, 'marked.min.js'));

// ---------- 2) DOMPurify（浏览器版） ----------
copy(path.join(NM, 'dompurify', 'dist', 'purify.min.js'), path.join(OUT, 'purify.min.js'));

// ---------- 3) highlight.js 简易打包 ----------
// highlight.js 的 npm 包是 CommonJS，浏览器不能直接用。
// 这里把它们包进一个微型模块系统后注册到 window.hljs。
const HLJS_LIB = path.join(NM, 'highlight.js', 'lib');
const coreSrc = fs.readFileSync(path.join(HLJS_LIB, 'core.js'), 'utf8');
const commonSrc = fs.readFileSync(path.join(HLJS_LIB, 'common.js'), 'utf8');

// 从 lib/common.js 解析需要注册的语言（与官方 common 集合一致）
const re = /registerLanguage\('([^']+)',\s*require\('\.\/languages\/([^']+)'\)\)/g;
const langs = [];
let m;
while ((m = re.exec(commonSrc))) {
  langs.push({ name: m[1], file: m[2] });
}

const langSrcs = {};
for (const l of langs) {
  langSrcs[l.file] = fs.readFileSync(path.join(HLJS_LIB, 'languages', l.file + '.js'), 'utf8');
}

const parts = [];
parts.push('/* 由 scripts/build-vendor.js 生成，请勿手动修改 */');
parts.push('(function () {');
parts.push('  var __modules = {};');
parts.push('  function __define(id, fn) { __modules[id] = { exports: {}, fn: fn }; }');
parts.push('  function __require(id) {');
parts.push('    var m = __modules[id];');
parts.push('    if (!m) throw new Error("module not found: " + id);');
parts.push('    if (!m.loaded) { m.loaded = true; m.fn(m, m.exports, __require); }');
parts.push('    return m.exports;');
parts.push('  }');
parts.push('');
parts.push('  __define("core", function (module, exports, require) {');
parts.push(coreSrc);
parts.push('  });');
for (const l of langs) {
  parts.push('');
  parts.push('  __define("lang:' + l.file + '", function (module, exports, require) {');
  parts.push(langSrcs[l.file]);
  parts.push('  });');
}
parts.push('');
parts.push('  var __hljs = __require("core");');
for (const l of langs) {
  parts.push(
    '  try { __hljs.registerLanguage(' + JSON.stringify(l.name) + ', __require("lang:' + l.file + '")); } catch (e) {}'
  );
}
parts.push('  window.hljs = __hljs;');
parts.push('})();');

const hlOut = path.join(OUT, 'highlight.common.js');
fs.writeFileSync(hlOut, parts.join('\n'));
console.log('build ', path.relative(ROOT, hlOut), `(${langs.length} 种语言)`);

// ---------- 4) highlight.js github 主题 ----------
copy(path.join(NM, 'highlight.js', 'styles', 'github.css'), path.join(OUT, 'highlight-github.css'));

console.log('vendor 打包完成 -> public/vendor');
