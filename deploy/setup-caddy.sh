#!/usr/bin/env bash
# ============================================================
# 安装 Caddy（反向代理 + 自动 HTTPS）
# 用法：sudo bash deploy/setup-caddy.sh
# 之后编辑 /etc/caddy/Caddyfile（可参考本项目 deploy/Caddyfile）
# 并执行：caddy reload --config /etc/caddy/Caddyfile
# ============================================================
set -euo pipefail

if [ "$(id -u)" -ne 0 ]; then
  echo "请用 root 或 sudo 执行本脚本"
  exit 1
fi

echo "==> 安装 Caddy（官方仓库）"
apt-get install -y debian-keyring debian-archive-keyring apt-transport-https curl
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' | tee /etc/apt/sources.list.d/caddy-stable.list
apt-get update -y
apt-get install -y caddy

systemctl enable caddy
systemctl restart caddy
caddy version

echo ""
echo "完成。编辑 /etc/caddy/Caddyfile 添加站点配置（参考 deploy/Caddyfile），"
echo "然后执行：caddy reload --config /etc/caddy/Caddyfile"
echo "提示：域名需要先解析到本服务器 IP，且安全组放行 80/443。"
