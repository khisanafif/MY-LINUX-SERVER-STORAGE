@echo off
title Linux Cloud Storage Server - Mode Ultra Hemat RAM (Port 8080)
color 0A
cd /d "%~dp0"

echo [*] Memeriksa apakah Port 8080 sedang dipakai oleh sesi lama...
for /f "tokens=5" %%a in ('netstat -aon ^| findstr ":8080" ^| findstr "LISTENING"') do (
    echo [*] Menghentikan proses server lama pada Port 8080 (PID: %%a) agar versi terbaru aktif...
    taskkill /F /PID %%a >nul 2>&1
)

set UV_THREADPOOL_SIZE=2
echo [*] Memulai Cloud Storage Server (Mode Ultra Hemat RAM - Heap ~3.5 MB)...
echo.
node --max-old-space-size=48 --max-semi-space-size=1 --jitless --expose-gc server.js
echo.
echo [!] Server berhenti.
pause
