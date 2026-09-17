'use strict';

// 生成上传测试样本（本地测试用）
const fs = require('fs');
const path = require('path');

const tmp = path.join(__dirname);
const png = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

fs.mkdirSync(path.join(tmp, '2024', 'assets'), { recursive: true });
fs.writeFileSync(path.join(tmp, '2024', 'assets', 'pic.png'), png);

const note1 = `# 我的第一篇笔记

今天学习了 **Markdown** 和图片引用。

## 图片示例

![测试图片](./assets/pic.png)

![上级目录图片](../2024/assets/pic.png)

相对路径的图片应该能正常显示。

## 代码块

\`\`\`js
function hello() {
  console.log("hello notecloud");
}
\`\`\`

## 表格

| 项目 | 状态 |
| ---- | ---- |
| 上传 | OK |
| 下载 | OK |

> 这是一条引用
`;
fs.writeFileSync(path.join(tmp, '2024', 'note1.md'), note1, 'utf8');

const note2 = `# 第二篇笔记

引用根目录下的图片：![图片](./2024/assets/pic.png)

跳转到 [第一篇笔记](./2024/note1.md)

\`\`\`python
print("hello")
\`\`\`
`;
fs.writeFileSync(path.join(tmp, 'note2.md'), note2, 'utf8');

console.log('samples ready in', tmp);
