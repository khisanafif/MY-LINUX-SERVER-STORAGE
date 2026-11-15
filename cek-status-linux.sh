#!/usr/bin/env bash
# ==============================================================================
#  DIAGNOSTIK JARINGAN LINUX SERVER, IP WIFI/LAN, FIREWALL & CLOUDFLARED
# ==============================================================================

cd "$(dirname "$0")"

echo "=================================================================="
echo "   DIAGNOSTIK LINUX CLOUD SERVER, IP WIFI/LAN & CLOUDFLARED       "
echo "=================================================================="
echo ""

echo "[1] ALAMAT IP LOKAL (WIFI / LAN) DAN DEFAULT GATEWAY DI LINUX:"
ip -4 -br addr show 2>/dev/null || hostname -I
echo "    Gateway Router:"
ip route | grep default || true
echo ""

echo "[2] STATUS PORT 8080 DI LINUX:"
if ss -tulpn 2>/dev/null | grep -q ":8080 "; then
    ss -tulpn 2>/dev/null | grep ":8080 "
    echo "    -> [AKTIF] Server sedang mendengarkan pada Port 8080!"
else
    echo "    -> [BELUM AKTIF] Jalankan ./start-linux-server.sh terlebih dahulu."
fi
echo ""

echo "[3] LINK PUBLIK CLOUDFLARED AKTIF:"
if [ -f "./cloudflared.log" ]; then
    CF_LINK="$(grep -o 'https://[-a-zA-Z0-9]*\.trycloudflare\.com' ./cloudflared.log | tail -n 1 || true)"
    if [ -n "$CF_LINK" ]; then
        echo "    -> $CF_LINK"
    else
        echo "    -> (Sedang membuat link atau cloudflared belum berjalan)"
    fi
else
    echo "    -> File cloudflared.log belum ada."
fi
echo ""

echo "[4] ALAMAT IP PUBLIK WAN DARI ROUTER WIFI / ISP ANDA:"
PUB_IP="$(curl -s --max-time 5 https://api.ipify.org || echo 'Tidak terdeteksi')"
echo "    -> $PUB_IP"
echo "    (Jika menggunakan Port Forwarding Router: http://${PUB_IP}:8080)"
echo "=================================================================="

