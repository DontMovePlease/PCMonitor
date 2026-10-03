@echo off
title Rovarin Development Server
cd /d "%~dp0"
echo Starting Rovarin in development mode...
echo Keep this window open while working. Saved server-source changes restart the server automatically.
echo.
call npm run dev
echo.
echo The development watcher has stopped.
pause
