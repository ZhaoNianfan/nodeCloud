'use strict';

/**
 * 浏览器环境冒烟测试（jsdom）：加载真实页面 -> 登录 -> 浏览目录 -> 上传 -> 预览。
 * 前置条件：服务器已在 127.0.0.1:3000 运行，且数据为全新状态。
 */

const { JSDOM, VirtualConsole } = require('jsdom');

const BASE = 'http://127.0.0.1:3000/';
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const pageErrors = [];
const virtualConsole = new VirtualConsole();
virtualConsole.on('jsdomError', (e) => pageErrors.push('jsdomError: ' + (e.message || e)));
virtualConsole.on('error', (...a) => pageErrors.push('console.error: ' + a.join(' ')));

let cookie = ''; // 模拟浏览器 Cookie 存储

function assert(cond, msg) {
  if (cond) console.log('[PASS]', msg);
  else {
    console.log('[FAIL]', msg);
    process.exitCode = 1;
  }
}

(async () => {
  const dom = await JSDOM.fromURL(BASE, {
    runScripts: 'dangerously',
    resources: 'usable',
    pretendToBeVisual: true,
    virtualConsole,
    beforeParse(window) {
      // fetch 代理：模拟浏览器 Cookie 持久化
      window.fetch = (url, opts = {}) => {
        const u = new URL(url, window.location.href);
        const init = { ...opts };
        init.headers = new Headers(opts.headers || {});
        if (cookie) init.headers.set('Cookie', cookie);
        return globalThis.fetch(u.href, init).then(async (res) => {
          const sc = res.headers.get('set-cookie');
          if (sc) cookie = sc.split(';')[0];
          return res;
        });
      };
    },
  });

  const { window } = dom;
  const { document } = window;

  // 把模拟 cookie 同步进 jsdom 的 cookie jar（上传走 XHR，需要带上登录态）
  function syncJar() {
    if (cookie) {
      try {
        dom.cookieJar.setCookieSync(cookie, BASE);
      } catch (e) {
        /* 忽略 */
      }
    }
  }

  // 等待页面脚本执行完成
  await sleep(2000);
  const cs = (id) => window.getComputedStyle(document.getElementById(id)).display;
  const loginVisible = !document.getElementById('login').hidden;
  const appHidden = document.getElementById('app').hidden;
  assert(loginVisible && appHidden, '首次访问显示登录页（setup 模式）');
  assert(cs('modal') === 'none', '初始无悬浮模态框遮挡（display:none）');
  assert(cs('app') === 'none', '登录前应用主体隐藏');
  assert(cs('login') === 'flex', '登录页可见（display:flex）');
  assert(
    document.getElementById('btnLogin').textContent.includes('创建账号'),
    'setup 模式按钮文案为「创建账号」'
  );

  // 创建管理员账号
  document.getElementById('inUser').value = 'admin';
  document.getElementById('inPass').value = 'passw0rd123';
  document
    .getElementById('loginForm')
    .dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
  await sleep(1500);
  syncJar();

  const appVisible = !document.getElementById('app').hidden;
  assert(appVisible, '创建账号后进入应用');
  assert(cs('login') === 'none', '登录后登录页真正隐藏（display:none）');
  assert(cs('modal') === 'none', '登录后仍无悬浮模态框');
  assert(cs('app') === 'flex', '应用主体显示（display:flex）');
  assert(document.getElementById('userName').textContent === 'admin', '显示当前用户名 admin');

  const treeHtml = document.getElementById('tree').innerHTML;
  assert(!!document.querySelector('#tree .tree-list'), '目录树已渲染');

  // 通过 UI 上传文件（模拟文件选择；files 属性只定义一次，后续可写）
  const fileInputEl = document.getElementById('fileInput');
  let filesDefined = false;
  function uploadViaUI(files) {
    if (!filesDefined) {
      Object.defineProperty(fileInputEl, 'files', { value: [], configurable: true, writable: true });
      filesDefined = true;
    }
    fileInputEl.files = files;
    fileInputEl.dispatchEvent(new window.Event('change', { bubbles: true }));
  }

  // 通过 UI 上传一个 Markdown 文件
  const sampleMd = '# 冒烟测试笔记\n\n![图](./img/a.png)\n\n```js\nvar x=1;\n```';
  const file = new window.File([sampleMd], '冒烟测试.md', { type: 'text/markdown' });
  uploadViaUI([file]);
  await sleep(3000);

  const listHtml = document.getElementById('filelist').innerHTML;
  assert(listHtml.includes('冒烟测试.md'), '上传后文件列表出现该笔记');

  // 点击笔记行打开预览
  const mdRow = Array.from(document.querySelectorAll('.file-row')).find((r) =>
    r.textContent.includes('冒烟测试.md')
  );
  assert(!!mdRow, '文件列表包含笔记行');
  mdRow.click();
  await sleep(1500);

  assert(!document.getElementById('preview').hidden, '预览面板已显示');
  const noteBodyEl = document.getElementById('noteBody');
  const noteBody = noteBodyEl.innerHTML;
  console.log('--- noteBody 内容片段:', noteBody.slice(0, 300));
  console.log('--- window.marked:', typeof window.marked, '| window.DOMPurify:', typeof window.DOMPurify, '| window.hljs:', typeof window.hljs);
  assert(noteBody.includes('冒烟测试笔记'), '预览渲染出标题');
  assert(noteBody.includes('hljs-'), '代码块已高亮（hljs 类）');

  const img = document.querySelector('#noteBody img');
  assert(!!img, '预览中包含图片元素');
  if (img) {
    const expected = '/api/file?path=' + encodeURIComponent('img/a.png');
    assert(
      img.getAttribute('src') === expected,
      '相对图片路径已重写 (实际: ' + img.getAttribute('src') + ')'
    );
  }

  // === 场景 1.5：笔记内相对链接跳转 + 阅读栏滚动显隐 ===
  const srcNote = '# 链接源\n\n[跳到目标笔记](./链接目标.md)';
  const tgtNote = '# 链接目标笔记\n\n内容很长的目标\n'.repeat(3);
  const srcFile = new window.File([srcNote], '链接源.md', { type: 'text/markdown' });
  const tgtFile = new window.File([tgtNote], '链接目标.md', { type: 'text/markdown' });
  uploadViaUI([srcFile, tgtFile]);
  await sleep(3000);

  window.location.hash = '#dir/';
  await sleep(600);
  const srcRow = Array.from(document.querySelectorAll('.file-row')).find((r) =>
    r.textContent.includes('链接源.md')
  );
  assert(!!srcRow, '链接源笔记已上传');
  srcRow.click();
  await sleep(1500);
  assert(document.getElementById('previewTitle').textContent === '链接源.md', '已打开链接源笔记');

  const internalLink = document.querySelector('#noteBody a.internal');
  assert(!!internalLink, '目标链接被识别为站内链接 (internal)');
  if (internalLink) {
    internalLink.dispatchEvent(new window.Event('click', { bubbles: true, cancelable: true }));
    await sleep(1500);
    assert(
      document.getElementById('previewTitle').textContent === '链接目标.md',
      '点击相对链接跳转到目标笔记'
    );
    assert(
      document.getElementById('noteBody').textContent.includes('链接目标笔记'),
      '目标笔记内容已渲染'
    );
  }

  // 阅读栏滚动显隐（模拟向下/向上滑动）
  const scroller = document.getElementById('content');
  const scrollStub = (val) =>
    Object.defineProperty(scroller, 'scrollTop', { value: val, configurable: true, writable: true });
  scrollStub(400);
  scroller.dispatchEvent(new window.Event('scroll'));
  await sleep(80);
  assert(document.body.classList.contains('bar-hidden'), '向下滑动后操作栏收起 (bar-hidden)');
  scrollStub(120);
  scroller.dispatchEvent(new window.Event('scroll'));
  await sleep(80);
  assert(!document.body.classList.contains('bar-hidden'), '向上滑动后操作栏唤出');

  window.location.hash = '#dir/';
  await sleep(600);

  // === 场景 2：路径含空格/中文（.image 目录） + ==高亮== ===
  const spacedImgDir = 'images/个人笔记-0901 - 副本.image';
  const spacedNote = [
    '# 空格路径笔记',
    '',
    '==高光测试高亮==',
    '',
    `![图片](${spacedImgDir}/image-20251216194813339.png)`,
    '',
  ].join('\n');
  const mdFile2 = new window.File([spacedNote], '空格路径笔记.md', { type: 'text/markdown' });
  const pngBytes = new Uint8Array([
    137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 13, 73, 72, 68, 82, 0, 0, 0, 1, 0, 0, 0, 1, 8, 6,
    0, 0, 0, 31, 21, 196, 137, 0, 0, 0, 13, 73, 68, 65, 84, 120, 156, 99, 252, 207, 192, 80, 15,
    0, 1, 5, 1, 1, 138, 153, 44, 33, 0, 0, 0, 0, 73, 69, 78, 68, 174, 66, 96, 130,
  ]);
  const pngFile = new window.File([pngBytes], 'image-20251216194813339.png', { type: 'image/png' });
  Object.defineProperty(pngFile, 'webkitRelativePath', {
    value: `${spacedImgDir}/image-20251216194813339.png`,
  });
  uploadViaUI([mdFile2, pngFile]);
  await sleep(3000);

  // 打开含空格路径的笔记
  const spacedRow = Array.from(document.querySelectorAll('.file-row')).find((r) =>
    r.textContent.includes('空格路径笔记.md')
  );
  assert(!!spacedRow, '含空格路径笔记已上传并出现在列表');
  spacedRow.click();
  await sleep(1500);

  const noteBody2 = document.getElementById('noteBody').innerHTML;
  assert(noteBody2.includes('空格路径笔记'), '空格路径笔记渲染出标题');
  assert(!noteBody2.includes('![图片]('), '含空格路径不再以纯文本形式残留（已被解析为图片）');
  assert(noteBody2.includes('<mark>高光测试高亮</mark>'), '==高亮== 渲染为 <mark>');
  const img2 = document.querySelector('#noteBody img');
  assert(!!img2, '含空格路径的图片被解析成 img 元素');
  if (img2) {
    const expected2 = '/api/file?path=' + encodeURIComponent(`${spacedImgDir}/image-20251216194813339.png`);
    assert(
      img2.getAttribute('src') === expected2,
      '空格/中文图片路径正确重写 (实际: ' + img2.getAttribute('src') + ')'
    );
    const res = await window.fetch(img2.getAttribute('src'));
    assert(res.status === 200, '空格路径图片实际可加载（HTTP 200）');
  }

  // === 场景 3：图片路径不存在但服务器上有同名文件 → 自动兜底 ===
  const lonelyFile = new window.File([pngBytes], '独苗图.png', { type: 'image/png' });
  const note3Content = '# 兜底笔记\n\n![图](images/不存在目录/独苗图.png)';
  const mdFile3 = new window.File([note3Content], '兜底笔记.md', { type: 'text/markdown' });
  uploadViaUI([mdFile3, lonelyFile]);
  await sleep(3000);

  const fallbackRow = Array.from(document.querySelectorAll('.file-row')).find((r) =>
    r.textContent.includes('兜底笔记.md')
  );
  assert(!!fallbackRow, '兜底笔记已上传');
  fallbackRow.click();
  await sleep(1500);
  const fallbackImg = document.querySelector('#noteBody img');
  assert(!!fallbackImg, '兜底笔记图片元素存在');
  if (fallbackImg) {
    const failedSrc = fallbackImg.getAttribute('src');
    fallbackImg.dispatchEvent(new window.Event('error', { bubbles: false }));
    const expectedFb = '/api/file?path=' + encodeURIComponent('独苗图.png');
    assert(
      fallbackImg.getAttribute('src') === expectedFb,
      `图片按文件名自动兜底 (${failedSrc} -> ${fallbackImg.getAttribute('src')})`
    );
  }

  // === 场景 4：完全找不到 → 显示诊断占位 ===
  const note4Content = '# 缺失笔记\n\n![图](images/完全不存在的图.png)';
  const mdFile4 = new window.File([note4Content], '缺失笔记.md', { type: 'text/markdown' });
  uploadViaUI([mdFile4]);
  await sleep(3000);

  const brokenRow = Array.from(document.querySelectorAll('.file-row')).find((r) =>
    r.textContent.includes('缺失笔记.md')
  );
  brokenRow.click();
  await sleep(1500);
  const brokenImg = document.querySelector('#noteBody img');
  assert(!!brokenImg, '缺失笔记图片元素存在');
  if (brokenImg) {
    brokenImg.dispatchEvent(new window.Event('error', { bubbles: false }));
    const brokenBox = document.querySelector('#noteBody .img-broken');
    assert(!!brokenBox, '找不到图片时显示诊断占位');
    assert(
      brokenBox.textContent.includes('images/完全不存在的图.png'),
      '诊断占位包含实际解析路径'
    );
  }

  // 登出
  document.getElementById('btnLogout').click();
  await sleep(1000);
  assert(!document.getElementById('login').hidden, '登出后回到登录页');

  // === 场景 5：角色与界面 ===
  // 重新以管理员登录
  async function doLogin(u, p) {
    document.getElementById('inUser').value = u;
    document.getElementById('inPass').value = p;
    document
      .getElementById('loginForm')
      .dispatchEvent(new window.Event('submit', { bubbles: true, cancelable: true }));
    await sleep(1200);
    syncJar();
  }
  await doLogin('admin', 'passw0rd123');
  assert(!document.getElementById('app').hidden, '管理员重新登录成功');
  window.location.hash = '#dir/'; // 回到根目录列表，确保列表按当前角色重新渲染
  await sleep(800);

  // 管理员可见用户管理入口与写操作按钮
  assert(!document.getElementById('btnUsers').hidden, '管理员可见「用户管理」');
  assert(!document.getElementById('btnUpload').hidden, '管理员可见上传按钮');
  assert(document.getElementById('userRole').textContent === '管理员', '角色徽标=管理员');

  // 打开用户管理，创建游客账号
  document.getElementById('btnUsers').click();
  await sleep(800);
  assert(!document.getElementById('usersModal').hidden, '用户管理弹窗已打开');
  document.getElementById('nuUser').value = 'guest01';
  document.getElementById('nuPass').value = 'guestpass123';
  document.getElementById('nuCreate').click();
  await sleep(1200);
  assert(
    document.getElementById('usersList').textContent.includes('guest01'),
    '用户列表出现新建的游客账号'
  );
  document.getElementById('nuClose').click();
  await sleep(300);

  // 电脑端侧栏收起/展开（桌面宽度）
  assert(!document.body.classList.contains('sidebar-collapsed'), '初始侧栏展开');
  document.getElementById('btnMenu').click();
  assert(document.body.classList.contains('sidebar-collapsed'), '点击 ☰ 收起侧栏');
  document.getElementById('btnMenu').click();
  assert(!document.body.classList.contains('sidebar-collapsed'), '再次点击展开侧栏');

  // 登出并用游客登录
  document.getElementById('btnLogout').click();
  await sleep(800);
  await doLogin('guest01', 'guestpass123');
  assert(document.getElementById('userName').textContent === 'guest01', '游客登录成功');
  assert(document.getElementById('userRole').textContent === '游客', '角色徽标=游客');
  assert(document.getElementById('btnUsers').hidden, '游客看不到用户管理');
  assert(document.getElementById('btnUpload').hidden, '游客看不到上传文件');
  assert(document.getElementById('btnUploadDir').hidden, '游客看不到上传文件夹');
  assert(document.getElementById('btnNewDir').hidden, '游客看不到新建文件夹');
  assert(document.getElementById('btnZip').hidden, '游客看不到下载ZIP');
  assert(!document.getElementById('btnLogout').hidden, '游客仍可退出');

  // 游客文件列表无下载/删除按钮
  const guestList = document.getElementById('filelist').innerHTML;
  assert(!guestList.includes('>删除<') && !guestList.includes('>下载<'), '游客列表无下载/删除按钮');

  // 游客可在线查看笔记（打开根目录的 md）
  const guestRows = Array.from(document.querySelectorAll('.file-row'));
  const guestMd = guestRows.find((r) => r.textContent.includes('冒烟测试.md'));
  assert(!!guestMd, '游客能看到笔记文件行');
  guestMd.click();
  await sleep(1500);
  assert(document.body.classList.contains('previewing'), '阅读笔记时进入 previewing 阅读模式');
  assert(
    document.getElementById('noteBody').textContent.includes('冒烟测试笔记'),
    '游客能在线查看笔记内容'
  );

  // 返回列表后退出阅读模式
  window.location.hash = '#dir/';
  await sleep(800);
  assert(!document.body.classList.contains('previewing'), '返回列表后退出阅读模式');

  // 登出
  document.getElementById('btnLogout').click();
  await sleep(800);
  assert(!document.getElementById('login').hidden, '游客登出');

  console.log('\n页面 JS 错误数:', pageErrors.length);
  pageErrors.forEach((e) => console.log('  ', e));
  assert(pageErrors.length === 0, '无页面 JS 运行时错误');

  dom.window.close();
  process.exit(process.exitCode || 0);
})().catch((e) => {
  console.error('冒烟测试异常:', e);
  process.exit(1);
});
