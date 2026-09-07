'use strict';

// 前端静态一致性检查（本地测试用）
const fs = require('fs');

const appJs = fs.readFileSync('public/app.js', 'utf8');
const html = fs.readFileSync('public/index.html', 'utf8');

// 提取 app.js 中引用的元素 id
const ids = new Set();
const re = /\$\(['"]#([\w-]+)['"]\)|\$\$\(['"]#([\w-]+)['"]\)/g;
let m;
while ((m = re.exec(appJs))) ids.add(m[1] || m[2]);

const missing = [...ids].filter((id) => !html.includes(`id="${id}"`));
console.log('引用的元素 id 数:', ids.size);
console.log('缺失:', missing.length ? missing.join(', ') : '无');

// 语法检查（vm.Script 仅编译不执行，避免子进程）
const vm = require('vm');
let syntaxOk = true;
try {
  new vm.Script(appJs);
} catch (e) {
  syntaxOk = false;
  console.log('语法错误:', e.message);
}
console.log('app.js 语法检查:', syntaxOk ? 'OK' : 'FAIL');

// marked 版本 API 验证
const { marked } = require('marked');
console.log('marked v12 parse:', marked.parse('# hi', { gfm: true, breaks: true }).trim());

process.exit(missing.length || !syntaxOk ? 1 : 0);
