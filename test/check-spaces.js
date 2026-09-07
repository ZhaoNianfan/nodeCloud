'use strict';

// 本地验证：含空格路径 + ==高亮== 的渲染管线（与 app.js 中逻辑一致）
const { marked } = require('marked');

function fixSpacesInInlineUrls(md) {
  return String(md).replace(/(!?\[[^\]\n]*\]\()([^)\n]*)(\))/g, (whole, pre, inner, post) => {
    const content = (inner || '').trim();
    if (!content || content.startsWith('<')) return whole;
    if (!/[\s\u3000]/.test(content)) return whole;
    let dest = content;
    let tail = '';
    const tm = content.match(/^(.*?)(\s+(["'])[^"']*\3\s*)$/);
    if (tm) {
      dest = tm[1].trim();
      tail = tm[2];
    }
    if (!/[\s\u3000]/.test(dest)) return whole;
    return pre + dest.replace(/[\s\u3000]+/g, '%20') + tail + post;
  });
}

const decodeMaybe = (s) => {
  try {
    return decodeURIComponent(s);
  } catch (e) {
    return s;
  }
};

const resolveRel = (baseDir, rel) => {
  const segs = (baseDir ? baseDir.split('/') : []).concat(String(rel).replace(/\\/g, '/').split('/'));
  const out = [];
  for (const s of segs) {
    if (!s || s === '.') continue;
    if (s === '..') {
      out.pop();
      continue;
    }
    out.push(s);
  }
  return out.join('/');
};

const cases = [
  // 用户实际场景：中文 + 空格 + .image 目录
  '![图片](images/个人笔记-0901 - 副本.image/image-20251216194813339-1788257542769-7.png)',
  // 普通无空格（回归）
  '![图](./img/a.png)',
  // 空格加标题
  '![图](images/pic 1.png "title")',
  // 已用 <> 包裹
  '![图](<images/pic 1.png>)',
  // 链接跳转（含空格 .md）
  '[去另一篇](my notes/other note.md)',
];

let fail = 0;
for (const c of cases) {
  const fixed = fixSpacesInInlineUrls(c);
  const html = marked.parse(fixed, { gfm: true, breaks: true });
  console.log('输入:', c);
  console.log('修复:', fixed);
  console.log('HTML:', html.trim());
  const m = html.match(/src="([^"]+)"/);
  if (m) {
    const resolved = resolveRel('', decodeMaybe(m[1]));
    console.log('解析为:', resolved, '->', '/api/file?path=' + encodeURIComponent(resolved));
  }
  console.log('---');
  if (fixed.includes('![图片](images/个人笔记-0901') && !html.includes('<img')) fail++;
}

console.log(fail === 0 ? '== 空格路径渲染检查通过 ==' : `== ${fail} 处失败 ==`);
process.exit(fail);
