@echo off
rem Duplo clique para abrir o menu do Disparador WhatsApp
cd /d "%~dp0"
powershell -NoProfile -ExecutionPolicy Bypass -File "%~dp0iniciar.ps1"
pause
