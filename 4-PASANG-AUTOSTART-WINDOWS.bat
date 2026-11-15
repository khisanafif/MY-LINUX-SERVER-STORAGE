@echo off
title Pengaturan Auto-Start Windows Server
color 0B
cd /d "%~dp0"

net session >nul 2>&1
if %errorLevel% neq 0 (
    echo [!] Meminta hak akses Administrator...
    powershell -Command "Start-Process -FilePath '%~f0' -Verb RunAs"
    exit /b
)

echo ==================================================================
echo       PENGATURAN AUTO-START SERVER SAAT WINDOWS MENYALA
echo ==================================================================
echo.
echo Pilih aksi yang diinginkan:
echo   [1] Aktifkan Auto-Start (Server otomatis jalan saat Windows Boot)
echo   [2] Nonaktifkan / Hapus Auto-Start
echo.
set /p opsi="Ketik angka [1 atau 2] lalu tekan Enter: "

if "%opsi%"=="2" goto hapus

:pasang
echo.
echo [*] Mendaftarkan tugas "MyWindowsPublicServer" ke Windows Task Scheduler...
schtasks /create /tn "MyWindowsPublicServer" /tr "\"%~dp02-JALANKAN-SERVER.bat\"" /sc onlogon /rl highest /f
if %errorLevel% equ 0 (
    echo [BERHASIL] Server sekarang akan otomatis menyala setiap kali Windows aktif!
) else (
    echo [GAGAL] Terjadi kesalahan saat mendaftarkan Task Scheduler.
)
echo.
pause
exit /b

:hapus
echo.
echo [*] Menghapus tugas "MyWindowsPublicServer" dari Windows Task Scheduler...
schtasks /delete /tn "MyWindowsPublicServer" /f
echo [SELESAI] Auto-Start telah dinonaktifkan.
echo.
pause

