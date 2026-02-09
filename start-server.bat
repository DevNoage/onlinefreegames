@echo on
setlocal
cd /d "%~dp0"
where node
start "" cmd /k "cd /d %~dp0 && node server.js"
timeout /t 1 /nobreak >nul
start "" "http://localhost:3000/"
