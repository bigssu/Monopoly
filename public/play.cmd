@echo off
rem Money Poly: double-click to play this build in the browser (needs Node.js).
cd /d "%~dp0"
node play-server.mjs
if errorlevel 1 pause
