@echo off
title Rovarin Dashboard (Tailscale)
echo Starting Rovarin Dashboard...
cd /d "%~dp0"
node server.js
pause
