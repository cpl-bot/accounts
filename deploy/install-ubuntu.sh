#!/usr/bin/env bash
# Talai — one-shot installer for an Ubuntu 22.04/24.04 LAN server.
# Run as a sudo-capable user from a checkout of the repo:  sudo bash deploy/install-ubuntu.sh
# Idempotent: safe to re-run after `git pull` to rebuild and restart.
set -euo pipefail

APP_DIR=/opt/talai
APP_USER=talai
REPO_DIR="$(cd "$(dirname "$0")/.." && pwd)"
WITH_OLLAMA="${WITH_OLLAMA:-1}"
OLLAMA_MODEL="${OLLAMA_MODEL:-gemma3:12b}"

log() { printf '\n==> %s\n' "$*"; }

log "System packages"
apt-get update -qq
apt-get install -y -qq curl git ca-certificates build-essential python3 python3-venv ufw >/dev/null

if ! command -v node >/dev/null || [[ "$(node -v | cut -c2-3)" -lt 22 ]]; then
  log "Node.js 22"
  curl -fsSL https://deb.nodesource.com/setup_22.x | bash - >/dev/null
  apt-get install -y -qq nodejs >/dev/null
fi
corepack enable >/dev/null 2>&1 || true
corepack prepare pnpm@10 --activate >/dev/null 2>&1 || npm install -g pnpm@10 >/dev/null

if ! id "$APP_USER" >/dev/null 2>&1; then
  log "Service user $APP_USER"
  useradd --system --create-home --shell /usr/sbin/nologin "$APP_USER"
fi

log "Sync code to $APP_DIR"
mkdir -p "$APP_DIR"
rsync -a --delete --exclude .git --exclude node_modules --exclude .next \
  --exclude 'middleware/.venv' --exclude 'middleware/data' --exclude '.env' --exclude 'middleware/.env' \
  "$REPO_DIR"/ "$APP_DIR"/
chown -R "$APP_USER:$APP_USER" "$APP_DIR"

log "uv for $APP_USER"
su -s /bin/bash "$APP_USER" -c 'command -v ~/.local/bin/uv >/dev/null || curl -LsSf https://astral.sh/uv/install.sh | sh' >/dev/null

for f in "$APP_DIR/.env" "$APP_DIR/middleware/.env"; do
  if [[ ! -f "$f" ]]; then
    cp "${f%/.env}/.env.example" "$f"
    chown "$APP_USER:$APP_USER" "$f"; chmod 600 "$f"
    echo "   created $f from example — EDIT IT before starting the services"
  fi
done

log "Middleware dependencies + migrations"
su -s /bin/bash "$APP_USER" -c "cd $APP_DIR/middleware && ~/.local/bin/uv sync --frozen --no-dev && ~/.local/bin/uv run alembic upgrade head"

log "Web build"
su -s /bin/bash "$APP_USER" -c "cd $APP_DIR && pnpm install --frozen-lockfile && pnpm build"

if [[ "$WITH_OLLAMA" == "1" ]]; then
  if ! command -v ollama >/dev/null; then
    log "Ollama"
    curl -fsSL https://ollama.com/install.sh | sh
  fi
  systemctl enable --now ollama
  log "Pulling $OLLAMA_MODEL (this can take a while)"
  ollama pull "$OLLAMA_MODEL" || echo "   model pull failed — run 'ollama pull $OLLAMA_MODEL' later"
fi

log "systemd units"
install -m 644 "$APP_DIR/deploy/systemd/talai-middleware.service" /etc/systemd/system/
install -m 644 "$APP_DIR/deploy/systemd/talai-web.service" /etc/systemd/system/
systemctl daemon-reload
systemctl enable --now talai-middleware talai-web
systemctl restart talai-middleware talai-web

log "Firewall (LAN: 3000 open; 8000 and 11434 stay local)"
ufw allow 3000/tcp >/dev/null || true
ufw --force enable >/dev/null || true

log "Done"
echo "   web:        http://$(hostname -I | awk '{print $1}'):3000"
echo "   middleware: curl http://localhost:8000/health"
echo "   status:     systemctl status talai-middleware talai-web"
echo "   logs:       journalctl -u talai-middleware -f"
