# NoteCloud · 轻量 Markdown 笔记云

一个部署在你自己服务器上的笔记应用：**可视化上传 / 下载 Markdown 笔记与图片，电脑和手机浏览器在线查看**，目录层级与本地一致，笔记内相对路径引用的图片原样可看，上传不修改文件名。

- **技术栈**：Node.js + Express（后端）· 原生 JS 单页应用（前端，无构建步骤）· bcrypt + HMAC 会话鉴权 · 无数据库（用户存 JSON 文件）
- **资源占用**：常驻内存约 100~150MB，1 核 512MB 的机器即可流畅运行，2G2 核服务器绰绰有余
- **依赖**：全部为纯 JS 包，无原生编译，`npm install` 即可，部署省心

---

## 功能一览

| 能力 | 说明 |
| ---- | ---- |
| 双角色账号 | **管理员（正式账号）**＝首次访问创建的那个账号，可上传/下载/删除/管理用户；管理员可在「用户管理」里创建**游客账号**，游客**仅可在线查看**（无上传/下载/删除按钮，服务端同样拦截） |
| 登录鉴权 | 会话 Cookie（HttpOnly + SameSite=Lax + 30 天有效）；密码 bcrypt 哈希存储；同一 IP 15 分钟内连续输错 5 次自动限流；删除的账号会话立即失效 |
| 上传文件 / 文件夹 | 支持多选文件、整文件夹上传（保留目录结构）、拖拽上传；**文件名原样保留**，不添加任何前缀/哈希 |
| 冲突策略 | 侧栏可勾选「上传时覆盖同名文件」（默认开）；关闭时同名文件自动追加 `(1)` 后缀保留两者 |
| 在线查看 | Markdown 渲染（GFM 表格、代码高亮、`==高亮==` 语法、引用、任务列表）；**相对路径图片**（`./img/a.png`、`../assets/b.png`，含空格/中文的文件名也能解析）自动显示；笔记间相对链接可站内跳转；图片缺失时提示实际解析路径，并按文件名自动查找服务器上的同名图片兜底 |
| 下载 | 单文件下载、文件夹一键打包 ZIP 下载 |
| 目录管理 | 侧栏目录树（层级清晰）、面包屑导航、新建文件夹、删除（含确认）；**电脑端侧栏可一键收起**，阅读更专注 |
| 多端适配 | 手机端抽屉式侧栏；**阅读笔记时自动进入沉浸模式**：隐藏上传等页眉按钮，返回/文件名/原文/下载操作栏固定在屏幕顶部 |
| 安全加固 | 路径穿越防护（`..` 全部拦截 + realpath 校验防符号链接逃逸）、跨站 Origin 校验、CSP 等安全响应头、XSS 消毒（DOMPurify） |

---

## 目录结构

```
noteCloud/
├── server.js                # 入口
├── src/
│   ├── config.js            # 配置（端口/根目录/上传上限等）
│   ├── auth.js              # 会话签发/校验、登录限流
│   ├── users.js             # 用户存储（JSON 文件，原子写入）
│   ├── paths.js             # 路径安全（穿越防护核心）
│   ├── state.js             # 共享状态
│   └── routes/
│       ├── auth.js          # /api/auth/*
│       └── files.js         # /api/tree|upload|file|zip|dir（删）
├── public/                  # 前端（index.html / app.js / style.css / vendor）
│   └── vendor/              # 已打包的第三方库（marked/DOMPurify/highlight.js）
├── scripts/
│   ├── create-user.js       # 命令行创建/重置用户密码
│   └── build-vendor.js      # 重新打包 vendor（一般不需要）
├── deploy/
│   ├── install-ubuntu.sh    # Ubuntu/Debian 一键部署
│   ├── setup-caddy.sh       # 安装 Caddy（HTTPS）
│   ├── notecloud.service    # systemd 服务单元
│   └── Caddyfile            # 反向代理示例
├── UPGRADE.md               # ★ 从旧版本升级（笔记零丢失）指南
├── test/                    # 测试脚本（可选）
├── data/                    # 运行时生成：users.json、secret.key、tmp（勿提交）
└── notes/                   # 笔记根目录（勿提交）
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

> 服务器上的端口 3000 建议仅放行给需要的来源；如果配了 Caddy 反代，3000 端口可以不对外开放（Caddy 走 127.0.0.1 转发）。

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

**笔记零丢失升级**请务必阅读 [UPGRADE.md](./UPGRADE.md)：
核心是「只替换代码、绝不删 `data/` 与 `notes/`」，升级前先备份，旧账号自动成为管理员。

---

## 日常使用

### 角色说明

- **管理员（正式账号）**：首次部署后第一个创建的就是管理员。拥有全部功能，并在侧栏底部「用户管理」里创建/删除游客账号。
- **游客账号**：只能**在线查看**笔记与图片，看不到上传/下载/删除/新建等按钮（服务端同样拦截，游客调接口会返回 403）。

### 电脑端

1. 登录后左侧是目录树，点任意文件夹进入；顶部有面包屑。点击顶栏左上角 **☰** 可收起/展开侧栏，阅读更专注。
2. **上传**（管理员）：点「上传文件」多选文件；「上传文件夹」整目录上传（保留层级）；也可以直接把文件/文件夹拖进页面。
3. **查看**：点文件名即渲染预览，表格、代码高亮、相对路径图片（`./`、`../` 均可）正常显示；笔记里相对链接到其他 `.md` 可点开跳转。
4. **下载**（管理员）：文件行内「下载」；文件夹行内「ZIP」；顶部「下载 ZIP」打包当前文件夹。
5. **删除**（管理员）：行内「删除」，二次确认。

### 手机端

浏览器打开同一地址登录即可。侧栏收进抽屉（左上角 ☰）。**点开笔记进入沉浸阅读**：顶部上传等功能按钮自动隐藏，返回/文件名/原文/下载固定在屏幕最上方，翻页不遮挡。iOS 的 Safari 不支持「上传文件夹」，可逐文件上传（电脑上传文件夹不受影响）。

### 创建游客账号

管理员登录后，点侧栏底部「用户管理」→ 输入用户名/密码 → 创建；列表里可删除游客账号（删除后该游客立即无法登录）。

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

## 安全设计说明

- **鉴权**：登录成功后签发 HMAC-SHA256 签名会话令牌，存入 HttpOnly Cookie（JS 无法读取），SameSite=Lax 防 CSRF；密码使用 bcrypt（10 轮）哈希。
- **路径穿越**：所有相对路径先做规范化（拒绝 `..` 段、控制字符、绝对路径），再做 `realpath` 校验，符号链接无法逃出笔记根目录。
- **XSS**：Markdown 渲染后经 DOMPurify 消毒；CSP 仅允许同源脚本/样式。
- **跨站请求**：带 Origin 的写请求必须同源；登录接口限流防暴力破解。
- **数据安全**：`users.json`、`secret.key` 以 600 权限保存，原子写入；请定期备份 `notes/` 和 `data/` 两个目录。

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
（或打包 tar.gz 下载到本地。）

**Q: 上传大文件报 413？**
调大 `MAX_UPLOAD_MB`；若经 Caddy/Nginx 反代，还要检查代理的请求体上限。

**Q: 服务器内存小会卡吗？**
本应用常驻约 100~150MB，512MB 内存即可运行；2G2 核完全没问题。200Mbps 带宽下上传下载基本是满速。

---

## 本地测试（可选）

```bash
# 前端静态一致性检查
npm run test:frontend

# UI 冒烟测试（需服务器运行于 127.0.0.1:3000 且数据为全新状态）
npm run test:ui

# API 全量测试（需服务器运行且数据全新；Windows 下执行 test/run-tests.ps1）
```
