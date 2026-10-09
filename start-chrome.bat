@echo off
rem Far Out (Chrome): serves the page on localhost and opens it as a chromeless app window.
cd /d "%~dp0"
start "far-out-server" /min python -m http.server 5177 --bind 127.0.0.1
timeout /t 1 >nul
set CHROME=C:\Program Files\Google\Chrome\Application\chrome.exe
if exist "%CHROME%" ( start "" "%CHROME%" --app=http://localhost:5177/ ) else ( start http://localhost:5177/ )
