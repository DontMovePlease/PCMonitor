@echo off
title PC Monitor Development Server
cd /d "%~dp0"
echo Starting PC Monitor in development mode...
echo Keep this window open while working. Saved server-source changes restart the server automatically.
echo.
call npm run dev
echo.
echo The development watcher has stopped.
pause
