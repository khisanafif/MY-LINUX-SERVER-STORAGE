@echo off
title Akses Publik Internet - Cloudflare Tunnel (Mode Hemat RAM)
color 0E
cd /d "%~dp0"

echo ==================================================================
echo   MEMBUKA AKSES PUBLIK CLOUDFLARED (MODE HEMAT RAM & KONEKSI TUNGGAL)
echo ==================================================================
echo.

:: 1. Pastikan Server Lokal (Port 8080) Sudah Menyala
netstat -ano | findstr ":8080" | findstr "LISTENING" >nul 2>&1
if %errorLevel% neq 0 (
    echo [*] Server lokal belum menyala. Menyalakan Server Mode Hemat RAM...
    start "Cloud Storage Server Port 8080" cmd /k "cd /d "%~dp0" && set UV_THREADPOOL_SIZE=2 && node --max-old-space-size=48 --max-semi-space-size=1 --jitless --expose-gc server.js"
    timeout /t 2 /nobreak >nul
) else (
    echo [OK] Server lokal di Port 8080 sudah aktif.
)

:: 2. Cek apakah cloudflared sudah ada di folder ini atau di sistem Windows
set "CF_CMD="
if exist "%~dp0cloudflared.exe" (
    set "CF_CMD=%~dp0cloudflared.exe"
) else (
    where cloudflared >nul 2>&1
    if %errorLevel% equ 0 (
        set "CF_CMD=cloudflared"
    )
)

:: 3. Jika belum ada, unduh otomatis cloudflared.exe resmi dari Cloudflare
if "%CF_CMD%"=="" (
    echo.
    echo [*] Mengunduh cloudflared.exe resmi untuk Windows x64...
    curl.exe -L -o "%~dp0cloudflared.exe" https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-windows-amd64.exe
    if exist "%~dp0cloudflared.exe" (
        set "CF_CMD=%~dp0cloudflared.exe"
    ) else (
        echo [GAGAL] Tidak dapat mengunduh cloudflared.exe. Pastikan internet aktif.
        pause
        exit /b 1
    )
)

:: 4. Jalankan Cloudflare Quick Tunnel dengan Flag Hemat RAM (GOGC=50 & --ha-connections 1)
if exist "%~dp0cloudflared.log" del /f /q "%~dp0cloudflared.log" >nul 2>&1
set GOGC=50

echo.
echo ==================================================================
echo [*] Menjalankan Cloudflare Tunnel (Hemat RAM) ke http://localhost:8080
echo [*] Salin link https://xxxx-xxxx-xxxx.trycloudflare.com di bawah:
echo ==================================================================
echo.

"%CF_CMD%" tunnel --no-autoupdate --ha-connections 1 --url http://localhost:8080 --logfile "%~dp0cloudflared.log"
pause
