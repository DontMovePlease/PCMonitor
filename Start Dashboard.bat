@echo off
title Start PC Monitor Dashboard
cd /d "%~dp0"
echo ======================================================
echo    Starting PC Monitor Dashboard in Background
echo ======================================================
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\start.ps1"

echo.
echo ------------------------------------------------------
echo  Access from your iPhone via Tailscale:
echo  Open the Tailscale IP for this PC, then enter your PIN on the login screen.
echo.
echo  Localhost:
echo  Use the actual port printed above; default 7331, fallback 7332-7335.
echo ------------------------------------------------------
echo.
pause
