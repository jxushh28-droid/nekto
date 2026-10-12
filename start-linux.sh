#!/usr/bin/env bash
set -euo pipefail
cd -- "$(dirname -- "$0")"
if ! docker info >/dev/null 2>&1; then
  echo 'Start Docker Desktop or Docker Engine first.' >&2
  exit 1
fi
echo 'Starting Nekto locally. The first build downloads the browser and can take several minutes.'
docker compose -f compose.local.yaml up --build -d --wait --wait-timeout 120
echo 'Ready: http://127.0.0.1:3100/audio — click the Nekto extension to open it.'
