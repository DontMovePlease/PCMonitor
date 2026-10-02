@echo off
title PC Monitor Dashboard (Tailscale)
echo Starting PC Monitor Dashboard...
cd /d "%~dp0"
node server.js
pause
