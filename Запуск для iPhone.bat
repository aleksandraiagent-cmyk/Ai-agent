@echo off
chcp 65001 >nul
rem Запуск терминала так, чтобы его было видно с iPhone в той же Wi-Fi сети
"%~dp0TerminalApp.exe" --lan
