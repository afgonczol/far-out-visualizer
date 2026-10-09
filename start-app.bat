@echo off
rem Far Out (Electron): hears everything your PC plays, no picker needed.
cd /d "%~dp0"
if not exist node_modules\electron (
  echo First run: installing Electron ^(one-time download^)...
  call npm install --save-dev electron
)
call npx electron .
