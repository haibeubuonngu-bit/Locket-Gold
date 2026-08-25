@echo off
cd /d "%~dp0"

echo ===================================================
echo   Locket Gold Web Dashboard (http://localhost:3000)
echo ===================================================

if not exist "node_modules" (
    echo [*] Dang cai dat dependencies...
    "C:\Program Files\nodejs\npm.cmd" install
)

echo.
echo [*] Dang khoi dong Web Server...
echo [*] Truy cap: http://localhost:3000
echo.

"C:\Program Files\nodejs\node.exe" server.js

pause
