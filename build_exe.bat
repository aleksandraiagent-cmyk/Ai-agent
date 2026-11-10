@echo off
REM Сборка TerminalApp.exe
pip install -r requirements.txt pyinstaller
pyinstaller --onefile --name TerminalApp --add-data "web;web" terminal_app.py
echo Готово: dist\TerminalApp.exe
pause
