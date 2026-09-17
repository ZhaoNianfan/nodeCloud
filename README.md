# NoteCloud v2.0 · 轻量 Markdown 笔记云

一个部署在你自己服务器上的笔记应用：**可视化上传 / 下载 Markdown 笔记与图片，电脑和手机浏览器在线查看**，支持在线编辑、全文搜索、三角色权限管理。

- **技术栈**：Node.js + Express（后端）· 原生 JS 单页应用（前端，无构建步骤）· bcrypt + HMAC 会话鉴权 · 无数据库（用户存 JSON 文件）
- **资源占用**：常驻内存约 100~150MB，1 核 512MB 即可流畅运行，2G2 核服务器绰绰有余
- **依赖**：全部为纯 JS 包，无原生编译，`npm install` 即可，部署省心

---

## 功能一览

| 能力 | 说明 |
| ---- | ---- |
| 三角色账号 | **管理员** = 全权操作 + 管理用户；**普通用户** = 上传/下载/编辑/删除自己的文件；**游客** = 仅查看和下载 |
| 在线编辑 | 管理员可编辑任意 Markdown；普通用户可编辑自己上传的文件；电脑端左右分栏实时预览，手机端全屏编辑切换 |
| 全文搜索 | 输入关键词实时搜索所有 Markdown 笔记内容，匹配片段高亮 |
| 上下篇导航 | 查看笔记时自动显示同目录下的上一篇/下一篇 |
| TOC 目录 | 阅读笔记时自动生成右侧目录栏，跟随滚动高亮，可折叠；手机端底部按钮唤出抽屉 |
| 上传文件 / 文件夹 | 支持多选文件、整文件夹上传（保留目录结构）、拖拽上传；**文件名原样保留** |
| 冲突策略 | 侧栏可勾选「上传时覆盖同名文件」（默认开）；关闭时同名文件自动追加 `(1)` 后缀保留两者 |
| 在线查看 | Markdown 渲染（GFM 表格、代码高亮、`==高亮==` 语法、引用、任务列表）；**相对路径图片**自动显示；笔记间相对链接可站内跳转 |
| 下载 | 所有用户可下载单文件；管理员和普通用户可下载文件夹 ZIP |
| 目录管理 | 侧栏目录树、面包屑导航、新建文件夹、删除（含确认）；电脑端侧栏可一键收起 |
| 多端适配 | 手机端抽屉式侧栏；阅读笔记时自动进入沉浸模式，操作栏随滚动显隐 |
| 安全加固 | 路径穿越防护、跨站 Origin 校验、CSP 安全响应头、XSS 消毒（DOMPurify） |

---

## 权限模型

### 角色说明

| 角色 | 上传 | 下载 | 新建文件夹 | 编辑文件 | 删除文件 | 删除文件夹 | 管理用户 |
| ---- | ---- | ---- | ---------- | -------- | -------- | ---------- | -------- |
| 管理员 | ✅ | ✅ | ✅ | 任意文件 | 任意文件 | ✅ | ✅ |
| 普通用户 | ✅ | ✅ | ✅ | 仅自己的 | 仅自己的 | ✅（需文件全归属自己） | ❌ |
| 游客 | ❌ | ✅ | ❌ | ❌ | ❌ | ❌ | ❌ |

### 文件归属规则

- `data/uploads.json` 记录每个文件的上传者
- 上传文件时自动记录归属
- 删除文件时自动清理归属记录
- 删除文件夹时递归检查所有子文件归属，全部属于当前用户才允许删除

### 迁移规则

首次启动时，如果 `uploads.json` 不存在，会自动扫描 `notes/` 目录，把所有 `.md` 文件归属到第一个创建的管理员账号。

---

## 目录结构

```
noteCloud/
├── server.js                # 入口
├── src/
│   ├── config.js            # 配置（端口/根目录/上传上限等）
│   ├── auth.js              # 会话签发/校验、登录限流
│   ├── users.js             # 用户存储（JSON 文件，原子写入）
│   ├── uploads.js           # 文件归属存储（uploads.json）
│   ├── paths.js             # 路径安全（穿越防护核心）
│   ├── state.js             # 共享状态
│   └── routes/
│       ├── auth.js          # /api/auth/*
│       └── files.js         # /api/tree|upload|file|zip|dir|edit|search|ownership|my-files
├── public/                  # 前端
│   ├── index.html
│   ├── app.js
│   ├── style.css
│   └── vendor/              # 第三方库（marked/DOMPurify/highlight.js）
├── scripts/
│   ├── create-user.js       # 命令行创建/重置用户密码
│   └── build-vendor.js      # 重新打包 vendor（一般不需要）
├── deploy/
│   ├── install-ubuntu.sh    # Ubuntu/Debian 一键部署
│   ├── setup-caddy.sh       # 安装 Caddy（HTTPS）
│   ├── notecloud.service    # systemd 服务单元
│   └── Caddyfile            # 反向代理示例
├── UPGRADE.md               # 从旧版本升级指南
├── data/                    # 运行时生成：users.json、uploads.json、secret.key
└── notes/                   # 笔记根目录
```

---

## 本地运行（开发 / 预览）

需要 Node.js ≥ 18。

```bash
npm install
npm start
# 打开 http://127.0.0.1:3000 ，首次进入创建管理员账号
```

> 笔记默认存放在项目下 `notes/` 目录，可直接用文件管理器查看、备份。

---

## 服务器部署（推荐：Ubuntu 20.04/22.04/24.04）

### 1. 上传项目到服务器

在本地把整个 `noteCloud` 目录上传到服务器（scp / 宝塔面板 / 其他方式均可），例如放到 `/root/noteCloud`。

### 2. 一键部署

```bash
cd /root/noteCloud
sudo bash deploy/install-ubuntu.sh
```

脚本会自动完成：安装 Node.js 20 LTS → 创建 `notecloud` 运行用户 → 复制到 `/opt/notecloud` → 安装生产依赖 → 初始化 `data/` `notes/` → 注册 systemd 服务并启动。

### 3. 放行端口（阿里云）

阿里云控制台 → ECS 实例 → 安全组 → 配置规则 → 入方向放行：

- `80`、`443`（配域名 + HTTPS 用）
- 如果暂时只想用 IP 直连，放行 `3000`

### 4. 首次访问

浏览器打开 `http://<服务器公网IP>:3000`，页面会引导**创建管理员账号**（用户名 2-32 位，密码至少 8 位）。

> 服务器上的端口 3000 建议仅放行给需要的来源；如果配了 Caddy 反代，3000 端口可以不对外开放。

### 5.（推荐）域名 + 自动 HTTPS

```bash
sudo bash deploy/setup-caddy.sh          # 安装 Caddy
sudo vim /etc/caddy/Caddyfile            # 按 deploy/Caddyfile 示例配置你的域名
sudo caddy reload --config /etc/caddy/Caddyfile
```

域名需先解析到服务器 IP，Caddy 会自动申请 Let's Encrypt 证书并续期。之后用 `https://你的域名` 访问即可。

### 服务管理

```bash
systemctl status notecloud     # 状态
systemctl restart notecloud    # 重启
journalctl -u notecloud -f     # 实时日志
```

### 从旧版本升级（服务器上已存有笔记时）

**笔记零丢失升级**请务必阅读 [UPGRADE.md](./UPGRADE.md)：核心是「只替换代码、绝不删 `data/` 与 `notes/`」，升级前先备份，旧账号自动成为管理员。

---

## 日常使用

### 角色说明

- **管理员**：首次部署后第一个创建的就是管理员。拥有全部功能，并在侧栏底部「用户管理」里创建/管理其他用户。
- **普通用户**：可上传、下载、编辑/删除自己上传的文件。不能管理用户。
- **游客账号**：只能**在线查看和下载**笔记与图片，不能上传/编辑/删除。

### 电脑端

1. 登录后左侧是目录树，点任意文件夹进入；顶部有面包屑。点击顶栏左上角 **☰** 可收起/展开侧栏。
2. **上传**（管理员/普通用户）：点「上传文件」多选；「上传文件夹」整目录上传；也可以直接拖拽。
3. **查看**：点文件名即渲染预览，支持 TOC 目录、上下篇导航、代码高亮、相对路径图片。
4. **编辑**：查看笔记时点「编辑」按钮进入编辑器，左右分栏实时预览，Ctrl+S 保存。
5. **下载**（所有用户）：文件行「下载」；文件夹行「ZIP」；顶部「下载 ZIP」。
6. **删除**：管理员可删除任意内容；普通用户只能删除自己上传的文件，删除文件夹时自动校验归属。

### 手机端

浏览器打开同一地址登录即可。侧栏收进抽屉（左上角 ☰）。**点开笔记进入沉浸阅读**：顶部功能按钮自动隐藏，下滑收起/上滑唤出操作栏。目录按钮悬浮在右侧，点击唤出底部抽屉。

### 用户管理

管理员登录后，点侧栏底部「用户管理」→ 输入用户名/密码/选择角色 → 创建。管理员可以修改其他用户的角色，不能修改自己的角色。

### 命令行管理用户

```bash
cd /opt/notecloud
sudo -u notecloud node scripts/create-user.js 张三            # 新建管理员账号
sudo -u notecloud node scripts/create-user.js 李四 --guest     # 新建游客账号
sudo -u notecloud node scripts/create-user.js 张三 --force     # 重置密码
```

---

## 配置项（环境变量）

| 变量 | 默认值 | 说明 |
| ---- | ------ | ---- |
| `PORT` | `3000` | 监听端口 |
| `NOTE_ROOT` | `<项目>/notes` | 笔记根目录 |
| `NOTE_DATA` | `<项目>/data` | 用户/密钥数据目录 |
| `MAX_UPLOAD_MB` | `1024` | 单文件上传上限（MB） |
| `SESSION_DAYS` | `30` | 会话有效期（天） |
| `FORCE_HTTPS` | 空 | 设为 `1` 时强制 Cookie 只走 HTTPS |

systemd 里可通过 `Environment=` 设置，见 `deploy/notecloud.service` 注释。

---

## API 接口

| 接口 | 方法 | 说明 | 权限 |
| ---- | ---- | ---- | ---- |
| `/api/auth/status` | GET | 登录状态 | 无 |
| `/api/auth/setup` | POST | 首次创建管理员 | 无（仅首次） |
| `/api/auth/login` | POST | 登录 | 无 |
| `/api/auth/logout` | POST | 登出 | 已登录 |
| `/api/auth/users` | GET | 用户列表 | 管理员 |
| `/api/auth/users` | POST | 创建用户 | 管理员 |
| `/api/auth/users/:username` | DELETE | 删除用户 | 管理员 |
| `/api/auth/users/:username/role` | PUT | 修改用户角色 | 管理员 |
| `/api/tree` | GET | 目录树 | 已登录 |
| `/api/upload` | POST | 上传文件 | 管理员/普通用户 |
| `/api/dir` | POST | 新建文件夹 | 管理员/普通用户 |
| `/api/file` | GET | 读取/下载文件 | 已登录 |
| `/api/file` | DELETE | 删除文件/文件夹 | 已登录（归属校验） |
| `/api/edit` | PUT | 编辑 Markdown | 文件 owner 或管理员 |
| `/api/zip` | GET | 打包下载 | 已登录 |
| `/api/search` | GET | 全文搜索 | 已登录 |
| `/api/ownership` | GET | 检查文件归属 | 已登录 |
| `/api/my-files` | GET | 获取当前用户文件列表 | 已登录 |

---

## 安全设计说明

- **鉴权**：HMAC-SHA256 签名会话令牌，HttpOnly Cookie，SameSite=Lax，密码 bcrypt（10 轮）哈希。
- **路径穿越**：相对路径规范化（拒绝 `..`、控制字符、绝对路径）+ realpath 校验防符号链接逃逸。
- **XSS**：Markdown 渲染后经 DOMPurify 消毒；CSP 仅允许同源脚本/样式。
- **跨站请求**：带 Origin 的写请求必须同源；登录接口限流防暴力破解。
- **数据安全**：`users.json`、`secret.key`、`uploads.json` 以 600 权限保存，原子写入。

---

## 常见问题

**Q: 忘记管理员密码？**
```bash
sudo -u notecloud node /opt/notecloud/scripts/create-user.js admin --force
```

**Q: 想改笔记根目录？**
systemd 单元里加 `Environment=NOTE_ROOT=/data/notes` 并 `systemctl restart notecloud`。注意把新目录 `chown notecloud:notecloud`。

**Q: 更新版本？**
备份 `notes/`、`data/` 后，用新代码覆盖 `/opt/notecloud`（不要删 `data/`、`notes/`），`npm install --omit=dev`，再 `systemctl restart notecloud`。

**Q: 如何备份？**
```bash
rsync -a /opt/notecloud/notes /opt/notecloud/data /backup/
```

**Q: 上传大文件报 413？**
调大 `MAX_UPLOAD_MB`；若经 Caddy/Nginx 反代，还要检查代理的请求体上限。

**Q: 服务器内存小会卡吗？**
本应用常驻约 100~150MB，512MB 内存即可运行；2G2 核完全没问题。

---

## 环境要求

- Node.js ≥ 18
- 操作系统：Linux（推荐 Ubuntu 20.04/22.04/24.04）、macOS、Windows
- 最低配置：1 核 512MB 内存
- 推荐配置：2 核 2GB 内存

---

## 版本历史

### v2.0（当前版本）
- 新增三角色权限系统（管理员/普通用户/游客）
- 新增在线 Markdown 编辑器
- 新增全文搜索
- 新增 TOC 目录（桌面端右侧栏 + 手机端抽屉）
- 新增上下篇导航
- 新增文件归属追踪（uploads.json）
- 优化手机端阅读体验（沉浸模式、操作栏智能显隐）
- 优化 CSP 安全策略
