#!/usr/bin/env bash
# Обновление доски до последней версии из репозитория. Запуск: sudo bash /opt/team-board/deploy/update.sh
set -euo pipefail
APP_DIR=/opt/team-board
cd "$APP_DIR"
if [ -n "${GITHUB_TOKEN:-}" ]; then
  sudo -u board git pull --ff-only "https://x-access-token:${GITHUB_TOKEN}@$(git remote get-url origin | sed 's#https://##')" main
else
  sudo -u board git pull --ff-only
fi
sudo -u board -H bash -c "cd '$APP_DIR' && npm ci --no-audit --no-fund && npm run build"
systemctl restart team-board
echo "Обновлено: $(git log -1 --format='%h %s')"
