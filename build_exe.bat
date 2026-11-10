@echo off
chcp 65001 >nul
REM Сборка TerminalApp.exe
pip install -r requirements.txt pyinstaller
pyinstaller --onefile --name TerminalApp --add-data "app;app" --collect-all yfinance --collect-all curl_cffi --collect-all anthropic terminal_app.py
echo Готово: dist\TerminalApp.exe
pause
