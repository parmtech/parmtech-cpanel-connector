@echo off
setlocal
powershell.exe -NoProfile -ExecutionPolicy Bypass -File "%~dp0scripts\windows-connector.ps1" -Action Setup
if errorlevel 1 pause
