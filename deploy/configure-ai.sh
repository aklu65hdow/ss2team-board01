#!/usr/bin/env bash
# Подключение автоматического брифа и расшифровки созвонов.
# Запуск на сервере: sudo bash /opt/team-board/deploy/configure-ai.sh
set -euo pipefail
ENV_FILE=/opt/team-board/.env.local
[ "$(id -u)" -eq 0 ] || { echo "Запустите через sudo"; exit 1; }
[ -f "$ENV_FILE" ] || { echo "Не найден $ENV_FILE. Сначала установите доску (install.sh)."; exit 1; }

set_var() { sed -i "/^$1=/d" "$ENV_FILE"; [ -n "$2" ] && printf '%s=%s\n' "$1" "$2" >> "$ENV_FILE"; return 0; }

echo
echo "== Бриф созвонов =="
echo "Подойдёт любой сервис языковых моделей с OpenAI-совместимым API (/chat/completions)."
read -rp "Настроить бриф? (y/N): " A
if [[ "$A" =~ ^[yYдД] ]]; then
  read -rp "Адрес API (обычно оканчивается на /v1): " URL
  read -rsp "Ключ API (ввод скрыт): " KEY; echo
  read -rp "Название модели (из документации сервиса): " MODEL
  set_var LLM_API_URL "${URL%/}"; set_var LLM_API_KEY "$KEY"; set_var LLM_MODEL "$MODEL"
  echo "Бриф: настроен."
fi

echo
echo "== Расшифровка записей =="
echo "Подойдёт сервис расшифровки речи с OpenAI-совместимым API (/audio/transcriptions)."
read -rp "Настроить расшифровку? (y/N): " B
if [[ "$B" =~ ^[yYдД] ]]; then
  read -rp "Адрес API (обычно оканчивается на /v1): " TURL
  read -rsp "Ключ API (ввод скрыт): " TKEY; echo
  read -rp "Название модели расшифровки: " TMODEL
  set_var TRANSCRIBE_API_URL "${TURL%/}"; set_var TRANSCRIBE_API_KEY "$TKEY"; set_var TRANSCRIBE_MODEL "$TMODEL"
  echo "Расшифровка: настроена."
fi

chown board:board "$ENV_FILE"; chmod 600 "$ENV_FILE"
systemctl restart team-board
echo
echo "Готово, доска перезапущена. Обновите страницу созвона в браузере."
