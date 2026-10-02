@echo off
title Disable Windows Autostart
cd /d "%~dp0"
echo ======================================================
echo    Disabling Automatic Windows Startup
echo ======================================================
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\disable_autostart.ps1"

echo.
pause
