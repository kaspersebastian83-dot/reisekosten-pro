#!/bin/bash
cd "$(dirname "$0")"
if ! command -v node >/dev/null 2>&1; then
  echo "Node.js 22 oder neuer ist nicht installiert."
  echo "Bitte installieren Sie Node.js von https://nodejs.org und starten Sie erneut."
  read -r -p "Enter zum Schließen"
  exit 1
fi
if [ ! -d node_modules ]; then
  echo "Einmalige Installation wird vorbereitet..."
  npm install || exit 1
fi
echo "SpesenKit startet. Das Fenster bitte geöffnet lassen."
npm run dev &
server_pid=$!
trap 'kill "$server_pid" 2>/dev/null' EXIT INT TERM

for attempt in {1..30}; do
  if curl -fsS http://localhost:5173/ >/dev/null 2>&1; then
    open http://localhost:5173/
    break
  fi
  if ! kill -0 "$server_pid" 2>/dev/null; then
    wait "$server_pid"
    exit $?
  fi
  sleep 1
done

wait "$server_pid"
