@echo off
title Enable Windows Autostart
cd /d "%~dp0"
echo ======================================================
echo    Configuring Automatic Windows Startup
echo ======================================================
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\enable_autostart.ps1"

echo.
pause
