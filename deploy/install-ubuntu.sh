#!/usr/bin/env bash
# ============================================================
# NoteCloud 一键部署脚本（Ubuntu / Debian）
# 用法（在项目目录内执行）：
#   sudo bash deploy/install-ubuntu.sh
#
# 可选环境变量：
#   APP_DIR=/opt/notecloud   安装目录（默认 /opt/notecloud）
# ============================================================
set -euo pipefail

SRC_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR="${APP_DIR:-/opt/notecloud}"
APP_USER=notecloud

if [ "$(id -u)" -ne 0 ]; then
  echo "请用 root 或 sudo 执行本脚本"
  exit 1
fi

echo "==> [1/6] 检查 / 安装 Node.js 20 LTS"
if ! command -v node >/dev/null 2>&1; then
  apt-get update -y
  apt-get install -y ca-certificates curl
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
node -v && npm -v

echo "==> [2/6] 创建运行用户"
if ! id -u "$APP_USER" >/dev/null 2>&1; then
  useradd -r -s /usr/sbin/nologin "$APP_USER"
fi

echo "==> [3/6] 复制项目到 $APP_DIR"
mkdir -p "$APP_DIR"
# 排除不需要的目录
rsync -a --delete \
  --exclude node_modules --exclude .git --exclude test \
  --exclude .npm-cache --exclude data --exclude notes \
  "$SRC_DIR/" "$APP_DIR/" 2>/dev/null || {
  # rsync 不可用时用 tar 管道复制
  tar -C "$SRC_DIR" --exclude=node_modules --exclude=.git --exclude=test \
      --exclude=.npm-cache --exclude=data --exclude=notes -cf - . | \
    tar -C "$APP_DIR" -xf -
}

echo "==> [4/6] 安装依赖（仅生产依赖）"
cd "$APP_DIR"
npm install --omit=dev --no-audit --no-fund

echo "==> [5/6] 初始化数据目录并授权"
mkdir -p "$APP_DIR/data" "$APP_DIR/notes"
chown -R "$APP_USER:$APP_USER" "$APP_DIR"
# data / notes 权限收紧
chmod 700 "$APP_DIR/data" "$APP_DIR/notes"

echo "==> [6/6] 注册 systemd 服务"
cp "$APP_DIR/deploy/notecloud.service" /etc/systemd/system/notecloud.service
systemctl daemon-reload
systemctl enable notecloud
systemctl restart notecloud
sleep 1
systemctl --no-pager -l status notecloud | head -n 6 || true

echo ""
echo "======================================================"
echo " 部署完成！接下来："
echo "  1) 阿里云控制台 -> 安全组：放行 TCP 80、443（如用 IP 直连则放行 3000）"
echo "  2) 浏览器访问 http://<服务器IP>:3000 ，首次进入会引导创建管理员账号"
echo "  3) 如需域名 + HTTPS：安装 Caddy（见 deploy/setup-caddy.sh）"
echo " 服务管理：systemctl status/restart/stop notecloud"
echo " 日志查看：journalctl -u notecloud -f"
echo "======================================================"
