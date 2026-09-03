# NoteCloud 升级指南（不删除任何笔记与账号数据）

> 适用场景：服务器上已经运行**旧版本**的 NoteCloud，`/opt/notecloud/notes` 里已经存放了大量笔记。
> 目标：升级到最新版代码，**notes/（笔记）、data/（账号、密钥、会话）全部保留，一个文件都不丢**。

---

## ⚠️ 核心原则（先读三遍）

1. **`/opt/notecloud/data` 和 `/opt/notecloud/notes` 永远不要删**。升级只替换「代码文件 + 重新安装依赖」。
2. **先备份，再升级**。备份不花多少时间，出问题能一键回滚。
3. 升级后**首次打开浏览器请硬刷新（Ctrl+F5）**，新版本资源带版本号会自动避开旧缓存。

---

## 第 0 步：备份（强烈建议，必做）

在服务器上执行（把日期换成当天）：

```bash
# 1) 停服务，保证备份期间数据一致（不停也可以，推荐停）
sudo systemctl stop notecloud

# 2) 备份数据目录（账号/密钥/会话）
sudo cp -a /opt/notecloud/data /opt/notecloud/data.bak.$(date +%Y%m%d)

# 3) 备份笔记目录（你的全部笔记）
sudo cp -a /opt/notecloud/notes /opt/notecloud/notes.bak.$(date +%Y%m%d)

# 4) 确认备份成功（两边文件数应一致）
ls /opt/notecloud/ | grep bak
sudo ls /opt/notecloud/notes.bak.$(date +%Y%m%d) | wc -l
sudo ls /opt/notecloud/notes | wc -l
```

> 备份会占用与 notes 同等大小的磁盘空间，先 `df -h` 确认空间足够。

---

## 第 1 步：把新版本项目上传到服务器

### 1.1 在本地打好干净包（在项目根目录执行）

```bash
cd noteCloud
tar --exclude=node_modules --exclude=.git -czf notecloud-new.tgz .
```

> 只排除 `node_modules` 与 `.git`；代码、`public/`（含离线 vendor）、`deploy/`、`scripts/` 全都要。
> 本地空目录 `data/`、`notes/` 打进包也没关系（服务器上的不会被动到）。

### 1.2 上传并解压到**新目录**（不要直接覆盖旧目录）

```bash
scp notecloud-new.tgz root@<服务器IP>:/root/

# 服务器上：
mkdir -p /root/notecloud-new
cd /root/notecloud-new
sudo tar -xzf /root/notecloud-new.tgz
```

---

## 第 2 步：执行升级（二选一，推荐方法 B）

### 方法 B：手动同步（推荐，最可控，不会改动你的 systemd 自定义配置）

```bash
# 1) 停服
sudo systemctl stop notecloud

# 2) 用新代码覆盖 /opt/notecloud 的“代码部分”，
#    明确排除 data / notes / node_modules —— 这三样一个都不动
cd /opt/notecloud
sudo rsync -a --delete \
  --exclude=data --exclude=notes --exclude=node_modules \
  /root/notecloud-new/ /opt/notecloud/

# 3) 重新安装生产依赖（与旧版本一致，纯 JS 无编译，很快）
sudo npm install --omit=dev --no-audit --no-fund

# 4) 恢复属主（防止个别文件变成 root）
sudo chown -R notecloud:notecloud /opt/notecloud

# 5) 启动并查看状态
sudo systemctl start notecloud
sudo systemctl status notecloud --no-pager | head -n 8
```

> 方法 B **不会**覆盖 `/etc/systemd/system/notecloud.service`，
> 你自定义过的 `Environment=`（如 `PORT` / `NOTE_ROOT` / `MAX_UPLOAD_MB`）原样保留。

### 方法 A：直接重跑一键部署脚本（简单，但会重写 systemd 服务文件）

```bash
cd /root/notecloud-new
sudo bash deploy/install-ubuntu.sh
```

> ⚠️ 注意：脚本会把 `deploy/notecloud.service` 覆盖到 `/etc/systemd/system/`。
> 如果你以前**自定义过端口或目录**等环境变量，脚本跑完后需要重新编辑服务文件：
>
> ```bash
> sudo nano /etc/systemd/system/notecloud.service   # 把自定义 Environment 加回去
> sudo systemctl daemon-reload
> sudo systemctl restart notecloud
> ```

---

## 第 3 步：验证升级成功

```bash
# 服务健康检查
curl -s http://127.0.0.1:3000/api/health
# 应返回 {"ok":true,...}

# 确认笔记一个不少
sudo ls /opt/notecloud/notes | wc -l      # 与第 0 步备份时的数量一致
```

浏览器访问（域名/IP 不变）：

1. **Ctrl+F5 硬刷新**一次；
2. 用**原来的账号密码登录** —— 应直接成功（`data/` 没动，密钥与会话都还在）；
3. 左侧目录树应看到全部旧笔记，图片正常显示；
4. 侧栏底部出现「**用户管理**」——说明已升级到带游客账号的新版本。

---

## 数据迁移说明（自动完成，无需手工操作）

| 旧版本情况 | 升级后自动行为 |
| --- | --- |
| 旧 `users.json` 里没有 `role` 字段 | 所有旧账号**自动视为管理员（正式账号）**，登录后可在「用户管理」里创建游客账号 |
| 笔记目录结构与文件名 | **完全不变**，相对路径图片引用不受影响 |
| `data/secret.key` | 保持不变 → 已登录的设备**不用重新登录** |
| 旧的 `data/tmp` 上传残留 | 不影响，可忽略（服务会自动清理未完成上传） |

---

## 回滚方法（万一新版本有问题）

```bash
# 1) 停服
sudo systemctl stop notecloud

# 2) 用备份的数据目录/笔记目录还原（若怀疑数据被误动才需要）
sudo rm -rf /opt/notecloud/data /opt/notecloud/notes
sudo cp -a /opt/notecloud/data.bak.XXXX /opt/notecloud/data
sudo cp -a /opt/notecloud/notes.bak.XXXX /opt/notecloud/notes

# 3) 还原旧代码（若保留了旧版本包，同样用 rsync 覆盖回去，排除 data/notes）
#    或直接把 /root/notecloud-new 里的新代码移除后重新部署旧包

# 4) 启动
sudo systemctl start notecloud
```

> 平时只要**不删除 `data.bak.*`、`notes.bak.*`**，随时都能回来。

---

## 常见问题

**Q：升级后访问提示"系统已初始化，不能重复创建账号"？**
正常——因为你已有账号。用旧账号登录即可；忘记密码就用：
```bash
sudo -u notecloud node /opt/notecloud/scripts/create-user.js <用户名> --force
```

**Q：升级后想改笔记存放位置？**
在 systemd 服务文件里加 `Environment=NOTE_ROOT=/新的路径`，`daemon-reload` 后重启，并把原 notes 内容迁过去、`chown notecloud:notecloud`。

**Q：磁盘空间不够备份？**
至少确认 `df -h` 还有「notes 大小 × 2」的空闲；不够就先清理旧备份或扩容后再升级。
