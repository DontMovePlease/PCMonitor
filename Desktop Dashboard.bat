@echo off
title Rovarin Desktop
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "%~dp0scripts\desktop-preview.ps1"
