@echo off
title Konfigurasi Windows Firewall - Server Port 8080
color 0B
echo ==================================================================
echo      MEMBUKA PORT 8080 DI WINDOWS DEFENDER FIREWALL (INBOUND)
echo ==================================================================
echo.

net session >nul 2>&1
if %errorLevel% neq 0 (
    echo [!] Meminta hak akses Administrator...
    powershell -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)

echo [1/2] Menghapus aturan lama jika ada...
netsh advfirewall firewall delete rule name="MyServer_Public_LAN_8080" >nul 2>&1

echo [2/2] Menambahkan aturan Inbound TCP Port 8080 (Private, Public, Domain)...
netsh advfirewall firewall add rule name="MyServer_Public_LAN_8080" dir=in action=allow protocol=TCP localport=8080 profile=any

echo.
if %errorLevel% equ 0 (
    echo [BERHASIL] Port 8080 sudah dibuka di Windows Firewall!
    echo Perangkat lain di jaringan Wi-Fi / LAN dan Router Port Forwarding
    echo sekarang diizinkan mengakses server ini.
) else (
    echo [GAGAL] Pastikan Anda klik "Yes" saat muncul konfirmasi Administrator.
)
echo.
pause

