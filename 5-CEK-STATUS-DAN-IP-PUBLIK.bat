@echo off
title Diagnostik Jaringan, IP Wi-Fi/LAN, dan IP Publik
color 0F
echo ==================================================================
echo      DIAGNOSTIK STATUS SERVER, IP WIFI/LAN, DAN IP PUBLIK ISP
echo ==================================================================
echo.

echo [1] ALAMAT IP LOKAL (WIFI / LAN) DAN DEFAULT GATEWAY ROUTER:
ipconfig | findstr /i "IPv4 Subnet Gateway"
echo.

echo [2] STATUS PORT 8080 DI KOMPUTER INI:
netstat -ano | findstr ":8080"
if %errorLevel% neq 0 (
    echo     -> Port 8080 belum aktif. Jalankan "2-JALANKAN-SERVER.bat" terlebih dahulu.
) else (
    echo     -> Port 8080 SEDANG AKTIF dan siap menerima koneksi!
)
echo.

echo [3] STATUS ATURAN WINDOWS FIREWALL (MyServer_Public_LAN_8080):
netsh advfirewall firewall show rule name="MyServer_Public_LAN_8080" | findstr /i "Rule Enabled Action LocalPort"
if %errorLevel% neq 0 (
    echo     -> Aturan Firewall belum dipasang! Jalankan "1-BUKA-FIREWALL-ADMIN.bat".
)
echo.

echo [4] MENGECEK ALAMAT IP PUBLIK INTERNET DARI KONEKSI WIFI/ISP ANDA:
curl -s --max-time 5 https://api.ipify.org
echo.
echo     (Jika menggunakan Port Forwarding di Router 192.168.1.1, akses luar adalah:
echo      http://[IP-PUBLIK-DI-ATAS]:8080 )
echo.
echo ==================================================================
pause

