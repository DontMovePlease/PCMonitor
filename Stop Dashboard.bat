@echo off
title Stop PC Monitor Dashboard
cd /d "%~dp0"
echo ======================================================
echo       Stopping PC Monitor Dashboard Server
echo ======================================================
echo.

powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\stop.ps1"

echo.
if errorlevel 1 (echo Dashboard shutdown could not be confirmed.) else (echo Dashboard server is stopped.)
echo.
pause
