#!/usr/bin/env bash
# Установка командной доски на чистый сервер Ubuntu 22.04 / 24.04.
# Запуск (под root):  bash install.sh
set -euo pipefail

APP_DIR=/opt/team-board
APP_USER=board
REPO_URL="${REPO_URL:-https://github.com/aklu65hdow/ss2team-board01.git}"

say()  { printf '\n\033[1;34m==> %s\033[0m\n' "$*"; }
warn() { printf '\033[1;33m!! %s\033[0m\n' "$*"; }
die()  { printf '\033[1;31mОшибка: %s\033[0m\n' "$*"; exit 1; }

[ "$(id -u)" -eq 0 ] || die "запустите скрипт от root: sudo bash install.sh"
. /etc/os-release
[ "${ID:-}" = "ubuntu" ] || warn "скрипт проверен под Ubuntu, у вас ${PRETTY_NAME:-неизвестная система}"

# ---------- вопросы ----------
say "Настройки доски"
echo "Ключи Supabase: Project Settings → API."
read -rp "Project URL (https://xxxx.supabase.co): " SB_URL
read -rp "Ключ anon / publishable: " SB_ANON
read -rsp "Ключ service_role / secret (ввод скрыт): " SB_SERVICE; echo
[[ "$SB_URL" =~ ^https://.+ ]] || die "Project URL должен начинаться с https://"
[ -n "$SB_ANON" ] && [ -n "$SB_SERVICE" ] || die "ключи не должны быть пустыми"

PUBLIC_IP="$(curl -fsS --max-time 8 https://api.ipify.org 2>/dev/null || hostname -I | awk '{print $1}')"
DEFAULT_DOMAIN="${PUBLIC_IP//./-}.sslip.io"
echo
echo "Адрес сайта. Если своего домена нет, нажмите Enter: будет $DEFAULT_DOMAIN"
echo "(свой домен должен уже указывать A-записью на IP этого сервера: $PUBLIC_IP)"
read -rp "Домен [$DEFAULT_DOMAIN]: " DOMAIN
DOMAIN="${DOMAIN:-$DEFAULT_DOMAIN}"
DOMAIN="${DOMAIN#https://}"; DOMAIN="${DOMAIN#http://}"; DOMAIN="${DOMAIN%/}"

if [ -n "${GITHUB_TOKEN:-}" ]; then REPO_URL="https://x-access-token:${GITHUB_TOKEN}@${REPO_URL#https://}"; fi

# ---------- система ----------
say "Обновляю пакеты и ставлю git, ffmpeg, Caddy"
export DEBIAN_FRONTEND=noninteractive
apt-get update -y
apt-get install -y ca-certificates curl git ffmpeg ufw
if ! apt-get install -y caddy; then
  say "Caddy нет в стандартных пакетах, ставлю из официального репозитория"
  apt-get install -y debian-keyring debian-archive-keyring apt-transport-https gnupg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/gpg.key' | gpg --dearmor -o /usr/share/keyrings/caddy-stable-archive-keyring.gpg
  curl -1sLf 'https://dl.cloudsmith.io/public/caddy/stable/debian.deb.txt' > /etc/apt/sources.list.d/caddy-stable.list
  apt-get update -y && apt-get install -y caddy
fi

say "Ставлю Node.js 22"
NODE_MAJOR=0; command -v node >/dev/null && NODE_MAJOR="$(node -v | sed 's/v\([0-9]*\).*/\1/')"
if [ "$NODE_MAJOR" -lt 20 ]; then
  if curl -fsSL https://deb.nodesource.com/setup_22.x -o /tmp/nodesource.sh && bash /tmp/nodesource.sh; then
    apt-get install -y nodejs
  else
    warn "репозиторий NodeSource недоступен, ставлю Node.js с nodejs.org"
    ARCH="$(dpkg --print-architecture)"; [ "$ARCH" = "amd64" ] && ARCH=x64
    VER="$(curl -fsSL https://nodejs.org/dist/latest-v22.x/ | grep -o "node-v22[0-9.]*-linux-${ARCH}.tar.xz" | head -1)"
    [ -n "$VER" ] || die "не удалось скачать Node.js. Проверьте доступ в интернет с сервера."
    curl -fsSL "https://nodejs.org/dist/latest-v22.x/$VER" | tar -xJ -C /usr/local --strip-components=1
  fi
fi
node -v

# Сборке нужно ~1.5 ГБ памяти: на маленьких серверах добавляем файл подкачки.
MEM_MB="$(awk '/MemTotal/ {print int($2/1024)}' /proc/meminfo)"
if [ "$MEM_MB" -lt 2000 ] && [ ! -f /swapfile ]; then
  say "Памяти ${MEM_MB} МБ, добавляю файл подкачки 2 ГБ"
  fallocate -l 2G /swapfile && chmod 600 /swapfile && mkswap /swapfile && swapon /swapfile
  echo '/swapfile none swap sw 0 0' >> /etc/fstab
fi

# ---------- код ----------
say "Скачиваю код доски"
id "$APP_USER" >/dev/null 2>&1 || useradd --system --create-home --shell /usr/sbin/nologin "$APP_USER"
if [ -d "$APP_DIR/.git" ]; then
  git -C "$APP_DIR" pull --ff-only
else
  git clone --depth 1 "$REPO_URL" "$APP_DIR" || die "не удалось скачать код. Если репозиторий приватный, запустите так: GITHUB_TOKEN=ваш_токен bash install.sh"
fi
git -C "$APP_DIR" remote set-url origin "${REPO_URL/x-access-token:*@/}" 2>/dev/null || true

cat > "$APP_DIR/.env.local" <<ENV
NEXT_PUBLIC_SUPABASE_URL=$SB_URL
NEXT_PUBLIC_SUPABASE_ANON_KEY=$SB_ANON
SUPABASE_SERVICE_ROLE_KEY=$SB_SERVICE
FFMPEG_PATH=/usr/bin/ffmpeg
NEXT_TELEMETRY_DISABLED=1
ENV
chmod 600 "$APP_DIR/.env.local"
chown -R "$APP_USER:$APP_USER" "$APP_DIR"

say "Собираю доску (3–6 минут)"
sudo -u "$APP_USER" -H bash -c "cd '$APP_DIR' && npm ci --no-audit --no-fund && npm run build"

# ---------- автозапуск ----------
say "Настраиваю автозапуск"
cat > /etc/systemd/system/team-board.service <<UNIT
[Unit]
Description=Командная доска
After=network.target

[Service]
User=$APP_USER
WorkingDirectory=$APP_DIR
Environment=NODE_ENV=production
Environment=PORT=3000
Environment=HOSTNAME=127.0.0.1
ExecStart=$(command -v npm) start
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable --now team-board
systemctl restart team-board

# ---------- HTTPS ----------
say "Настраиваю HTTPS для $DOMAIN"
cat > /etc/caddy/Caddyfile <<CADDY
$DOMAIN {
	encode gzip
	reverse_proxy 127.0.0.1:3000
}
CADDY
systemctl enable caddy
systemctl restart caddy

ufw allow OpenSSH >/dev/null; ufw allow 80/tcp >/dev/null; ufw allow 443/tcp >/dev/null
ufw --force enable >/dev/null

echo "$DOMAIN" > "$APP_DIR/.domain"
sleep 5
say "Готово!"
cat <<DONE

  Доска: https://$DOMAIN
  (первое открытие может занять до минуты, пока выпускается сертификат HTTPS)

  Последний шаг, в Supabase → Authentication → URL Configuration:
    Site URL:       https://$DOMAIN
    Redirect URLs:  https://$DOMAIN/auth/callback

  Потом войдите первым: вы станете администратором.

  Обновить доску до новой версии:  sudo bash $APP_DIR/deploy/update.sh
  Посмотреть ошибки:               journalctl -u team-board -n 100
DONE
