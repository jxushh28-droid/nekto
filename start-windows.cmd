@echo off
cd /d "%~dp0"
docker info >nul 2>&1
if errorlevel 1 (
  echo Start Docker Desktop first. Install it from https://www.docker.com/products/docker-desktop/
  pause
  exit /b 1
)
echo Starting Nekto on your computer. The first build downloads the browser and can take several minutes.
docker compose -f compose.local.yaml up --build -d --wait --wait-timeout 120
if errorlevel 1 (
  echo Startup failed. The details are above. Use Docker Desktop to inspect nekto-local.
  pause
  exit /b 1
)
start "" "http://127.0.0.1:3100/audio"
echo Ready. You can now use the Nekto extension.
pause
