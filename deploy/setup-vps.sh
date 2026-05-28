#!/usr/bin/env bash
set -euo pipefail

APP_USER="${APP_USER:-artemgpt}"
APP_DIR="${APP_DIR:-/opt/artemgpt}"
INSTALL_OLLAMA="${INSTALL_OLLAMA:-true}"
OLLAMA_MODEL="${OLLAMA_MODEL:-llama3.2:1b}"

if [[ "$(id -u)" -ne 0 ]]; then
  echo "Run as root: sudo bash deploy/setup-vps.sh" >&2
  exit 1
fi

apt-get update
apt-get install -y ca-certificates curl git build-essential rsync

if ! command -v node >/dev/null 2>&1 || [[ "$(node -v | cut -d. -f1 | tr -d v)" -lt 20 ]]; then
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash -
  apt-get install -y nodejs
fi

if ! id "$APP_USER" >/dev/null 2>&1; then
  useradd --system --create-home --shell /usr/sbin/nologin "$APP_USER"
fi

mkdir -p "$APP_DIR" "$APP_DIR/data"
chown -R "$APP_USER:$APP_USER" "$APP_DIR"

if [[ "$INSTALL_OLLAMA" == "true" ]]; then
  if ! command -v ollama >/dev/null 2>&1; then
    curl -fsSL https://ollama.com/install.sh | sh
  fi
  systemctl enable ollama || true
  systemctl start ollama || true
  ollama pull "$OLLAMA_MODEL"
fi

cat >/etc/systemd/system/artemgpt.service <<SERVICE
[Unit]
Description=ArtemGPT Telegram bot
After=network-online.target ollama.service
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$APP_DIR
Environment=NODE_ENV=production
ExecStart=/usr/bin/npm start
Restart=always
RestartSec=5
User=$APP_USER
Group=$APP_USER

[Install]
WantedBy=multi-user.target
SERVICE

systemctl daemon-reload
systemctl enable artemgpt

echo "VPS base environment is ready."
echo "Next: copy project to $APP_DIR, create $APP_DIR/.env, run npm ci && npm run build, then systemctl start artemgpt."
