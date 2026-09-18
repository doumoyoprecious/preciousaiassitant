#!/usr/bin/env bash
# Precious AI boot script: installs dependencies if missing, then starts the server.
set -e
cd "$(dirname "$0")"

if ! python3 -c "import fastapi, uvicorn, fastembed, pypdf, docx, bs4, numpy" >/dev/null 2>&1; then
  echo "[boot] installing dependencies..."
  pip3 install -r requirements.txt >/dev/null 2>&1 || pip3 install --break-system-packages -r requirements.txt
fi

export PORT="${PORT:-8000}"
exec python3 -m uvicorn app.main:app --host 0.0.0.0 --port "$PORT"
