# NoteCloud 升级部署指南（旧版 → 最新版，笔记/账号零丢失）

> 适用环境（你的服务器）：
> - 项目代码位于 **`/home/admin` 下**（目录名见第 0 步定位，下文用 `APP_DIR` 表示）
> - 以系统用户 **admin** 运行，由 **systemd** 服务启动（服务名见第 0 步，下文用 `SERVICE` 表示）
> - 你负责把本地干净项目打成 **.zip** 上传；命令由 **root（Hermes）** 执行
> - 服务器上跑的是**昨天最后修改的旧版本**，本次要升到最新版（含游客账号、桌面阅读体验修复等）

---

## ⚠️ 核心原则（先读三遍）

1. **`data/`（账号、密钥、会话）和 `notes/`（你的全部笔记）永远不要删**。升级只做「覆盖代码文件 + 重新安装依赖」。
2. **先备份，再升级**；备份目录保留一段时间，出问题可一键回滚。
3. 升级后浏览器首次访问请**硬刷新（Ctrl+F5）**（新版本静态资源带版本号，会自动避开旧缓存）。

---

## 第 0 步：定位当前安装（只做一次，几分钟）

```bash
# 1) 找到项目目录（server.js 所在位置）
ls -d /home/admin/*/server.js
# 例：输出 /home/admin/noteCloud/server.js → APP_DIR=/home/admin/noteCloud

# 2) 找到 systemd 服务名
systemctl list-units --type=service --all | grep -iE 'note|cloud'

# 3) 确认服务以哪个用户运行（应为 admin）
systemctl show -p User <服务名>

# 4) 确认当前版本能正常响应
curl -s http://127.0.0.1:3000/api/health
```

记下两个变量，后面所有命令都用它们代替：
- `APP_DIR`＝项目目录（如 `/home/admin/noteCloud`）
- `SERVICE`＝服务名（如 `notecloud`）

---

## 第 1 步：备份（必做）

```bash
# 停服，保证备份一致性（不停也可以，推荐停）
systemctl stop $SERVICE

# 备份账号/密钥/会话 与 全部笔记
cp -a $APP_DIR/data  $APP_DIR/data.bak.$(date +%Y%m%d)
cp -a $APP_DIR/notes $APP_DIR/notes.bak.$(date +%Y%m%d)

# 核对备份成功（两个数字应一致，就是你的笔记数）
ls $APP_DIR/notes | wc -l
ls $APP_DIR/notes.bak.$(date +%Y%m%d) | wc -l
```

---

## 第 2 步：打包并上传 .zip

**本地**：把干净项目打成 zip，**不要包含 `node_modules`**（体积大、无必要；`data/`、`notes/` 是空目录，带上无害）：
- Windows 直接选中项目文件夹右键压缩时，先把 `node_modules` 移出或排除（用 7-Zip/WinRAR 的"排除"功能选排除 `node_modules`、`.git` 即可）

**服务器（root）**：上传后解压到**新目录**，不要直接解压覆盖旧目录：

```bash
# 上传（admin 用什么工具传都行，放到 /home/admin/ 或 /root/ 均可）
# 例如：scp notecloud.zip root@<IP>:/root/

mkdir -p /root/notecloud-new
cd /root/notecloud-new
unzip -o /root/notecloud.zip

# Windows zip 常自带一层外层文件夹，检查 server.js 实际位置：
find /root/notecloud-new -name server.js
# 若在子目录（如 /root/notecloud-new/noteCloud/server.js），就 cd 到那一层再继续

# 保险：把解压目录里的 node_modules 删掉（后续会全新安装）
rm -rf /root/notecloud-new/node_modules
```

---

## 第 3 步：覆盖代码（data/notes 原地保留）

```bash
# 用新代码覆盖 APP_DIR（只覆盖/新增文件；zip 里的 data/notes 是空的，不会碰服务器现有内容）
cp -a /root/notecloud-new/. $APP_DIR/

# 如果你确认服务器有 rsync，用下面这条更严谨（明确排除三个目录）：
# rsync -a --delete --exclude=data --exclude=notes --exclude=node_modules \
#        /root/notecloud-new/ $APP_DIR/
```

> ⚠️ 严禁 `rm -rf $APP_DIR` 再重放——那会连笔记一起删。上面 `cp -a` 不会删除任何已有文件。

---

## 第 4 步：依赖与权限

```bash
# 属主改回 admin（服务运行用户）
chown -R admin:admin $APP_DIR

# 以 admin 身份重新安装生产依赖（纯 JS 无编译，很快）
su - admin -c "cd $APP_DIR && npm install --omit=dev --no-audit --no-fund"
```

> 如果你的服务运行用户不是 `admin`（第 0 步 `systemctl show -p User` 查到的为准），把上面的 `admin` 全部替换成那个用户。

---

## 第 5 步：启动并验证

```bash
systemctl start $SERVICE
systemctl status $SERVICE --no-pager | head -n 8

# 健康检查
curl -s http://127.0.0.1:3000/api/health
# 应返回 {"ok":true,...}

# 笔记数量核对（与第 1 步一致）
ls $APP_DIR/notes | wc -l
```

浏览器访问原地址：

1. **Ctrl+F5 硬刷新**一次；
2. 用**原来的账号密码**登录 —— 应直接成功（`data/` 没动，密钥、会话都在，已登录设备无需重登）；
3. 左侧目录树看到全部旧笔记，图片正常；
4. 侧栏底部出现「**用户管理**」= 升级成功（你现在是管理员，可创建游客账号）。

---

## 数据迁移说明（自动，无需手工操作）

| 旧版本情况 | 升级后自动行为 |
| --- | --- |
| 旧 `users.json` 没有 `role` 字段 | 旧账号**自动视为管理员**，登录后可在「用户管理」创建游客账号 |
| 笔记目录结构/文件名 | **完全不变**，相对路径图片照常显示 |
| `data/secret.key` 保持不变 | 登录会话不失效，已登录设备不用重新登录 |
| 旧的 `data/tmp` 残留 | 无害，服务自动清理 |

---

## 回滚方法（万一新版本有问题）

```bash
systemctl stop $SERVICE

# 需要时还原数据（正常只还原代码即可）
cp -a $APP_DIR/data.bak.YYYYMMDD/.  $APP_DIR/data/
cp -a $APP_DIR/notes.bak.YYYYMMDD/. $APP_DIR/notes/

# 还原旧代码：用旧版本包同样方式 cp -a 覆盖回 $APP_DIR（或重新部署旧包）

systemctl start $SERVICE
```

> 只要不删 `data.bak.*` / `notes.bak.*`，随时能回滚。

---

## 常见问题

**Q：升级后提示"系统已初始化，不能重复创建账号"？**
正常——你已有账号。用旧账号登录；忘了密码：
```bash
su - admin -c "cd $APP_DIR && node scripts/create-user.js <用户名> --force"
```

**Q：zip 解压后多了一层文件夹？**
以 `find /root/notecloud-new -name server.js` 找到的那层作为新代码根目录，把命令里的路径换成它。

**Q：端口/目录我自定义过？**
本流程**不覆盖** `/etc/systemd/system/` 下的服务文件，你的自定义 `Environment=`（如 `PORT`、`NOTE_ROOT`）原样保留，无需重设。
