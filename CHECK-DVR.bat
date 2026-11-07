@echo off
title Congruence Eye - DVR check
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows\check-dvr.ps1"
echo.
pause
