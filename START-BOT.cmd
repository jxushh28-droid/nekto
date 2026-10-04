@echo off
setlocal
cd /d "%~dp0"
where node >nul 2>nul
if errorlevel 1 (
 echo Install Node.js 24 LTS from https://nodejs.org and run this again.
 pause
 exit /b 1
)
node -e "const [a,b]=process.versions.node.split('.').map(Number);process.exit(a>24||a===24&&b>=17?0:1)"
if errorlevel 1 (
 echo Node.js 24.17 or newer is required. Update Node.js first.
 pause
 exit /b 1
)
if not exist .env (
 copy .env.example .env >nul
 echo Fill DISCORD_TOKEN, GUILD_ID, OWNER_ID and both NEKTO_AUTH_TOKEN values in the opened file. Save it, then run START-BOT.cmd again.
 start "" notepad .env
 pause
 exit /b 0
)
if not exist node_modules\playwright\package.json (
 call npm ci --no-audit --no-fund
 if errorlevel 1 (
  echo Installation failed. Check internet access and rerun.
  pause
  exit /b 1
 )
)
call npm run setup-browser
if errorlevel 1 (
 echo Browser setup failed. See the message above for the available options.
 pause
 exit /b 1
)
call npm run doctor
if errorlevel 1 (
 echo A dependency check failed. Run npm ci in this folder, then try again.
 pause
 exit /b 1
)
call npm start
pause
