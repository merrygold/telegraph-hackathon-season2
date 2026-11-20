#!/usr/bin/env bash
# One-time setup on a fresh Ubuntu 22.04/24.04 VPS. Run as root from the copied project folder:
#   cd /opt/telegraph-hackathon && bash deploy/setup.sh
set -euo pipefail
ROOT="$(cd "$(dirname "$0")/.." && pwd)"

apt-get update
apt-get install -y curl debian-keyring debian-archive-keyring apt-transport-https
curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/gpg.key | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
curl -1sLf https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt > /etc/apt/sources.list.d/caddy-stable.list
apt-get update
apt-get install -y nodejs caddy

id -u tripwire >/dev/null 2>&1 || useradd --system --home "$ROOT" tripwire
(cd "$ROOT/tripwire" && npm ci --omit=dev)
(cd "$ROOT/measure" && npm ci --omit=dev)
chown -R tripwire: "$ROOT"
chmod 600 "$ROOT/tripwire/.env"

unit() { # name, folder, command
  cat > "/etc/systemd/system/$1.service" <<EOF
[Unit]
Description=$1
After=network-online.target
[Service]
User=tripwire
WorkingDirectory=$ROOT/$2
ExecStart=/usr/bin/node $3
Restart=always
RestartSec=5
NoNewPrivileges=true
[Install]
WantedBy=multi-user.target
EOF
}
unit tripwire tripwire "--env-file=.env server.mjs"
unit gauge gauge "gauge.mjs"
unit measure measure "runnable.mjs"

cp "$ROOT/deploy/Caddyfile" /etc/caddy/Caddyfile
systemctl daemon-reload
systemctl enable --now tripwire gauge measure
systemctl reload caddy
systemctl --no-pager status tripwire gauge measure | grep -E "●|Active"
