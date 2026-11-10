@echo off
chcp 65001 >nul
rem Запуск терминала так, чтобы его было видно с iPhone в той же Wi-Fi сети
set "EXE=%~dp0TerminalApp.exe"
if not exist "%EXE%" set "EXE=%~dp0dist\TerminalApp.exe"
if not exist "%EXE%" (
  echo Не найден TerminalApp.exe. Положите этот файл в одну папку с TerminalApp.exe.
  pause
  exit /b 1
)
"%EXE%" --lan
