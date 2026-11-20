#!/usr/bin/env bash
# ==============================================================================
#  MENJALANKAN LINUX CLOUD STORAGE SERVER + CLOUDFLARED (MODE ULTRA HEMAT RAM)
#  Penggunaan:
#    ./start-linux-server.sh           (Menjalankan Server + Cloudflared)
#    ./start-linux-server.sh --local   (Hanya menjalankan Server Lokal & LAN)
# ==============================================================================

cd "$(dirname "$0")"
PORT="${PORT:-8080}"
export UV_THREADPOOL_SIZE=2
export GOGC=50
NODE_LOW_RAM_FLAGS="--max-old-space-size=48 --max-semi-space-size=1 --jitless --expose-gc"

echo "=================================================================="
echo "  MEMULAI LINUX CLOUD STORAGE SERVER (MODE ULTRA HEMAT RAM)       "
echo "=================================================================="

# 1. Hentikan sesi server lama pada Port 8080 jika masih berjalan
if command -v fuser >/dev/null 2>&1; then
    fuser -k "${PORT}/tcp" >/dev/null 2>&1 || true
elif command -v lsof >/dev/null 2>&1; then
    OLD_PID="$(lsof -ti:"${PORT}" 2>/dev/null || true)"
    if [ -n "$OLD_PID" ]; then
        kill -9 $OLD_PID 2>/dev/null || true
    fi
else
    pkill -f "server.js" 2>/dev/null || true
fi

# 2. Jika mode Lokal / Wi-Fi LAN Offline saja (--local atau --offline)
if [ "${1:-}" = "--local" ] || [ "${1:-}" = "--offline" ]; then
    echo "[*] Menjalankan dalam mode Wi-Fi/LAN Offline (Ultra Hemat RAM)..."
    exec node $NODE_LOW_RAM_FLAGS server.js
fi

# 3. Jalankan node server.js di background dengan flag penghemat RAM V8
echo "[*] Menyalakan Cloud Storage Server di background (Heap ~4 MB)..."
nohup node $NODE_LOW_RAM_FLAGS server.js > server.log 2>&1 &
SERVER_PID=$!
sleep 2

# Tampilkan IP LAN / Wi-Fi aktif di Linux
LAN_IPS="$(hostname -I 2>/dev/null || ip -4 addr show | awk '/inet / && $2 !~ /^127/ {sub(/\/.*/, "", $2); print $2}' | xargs)"
echo "------------------------------------------------------------------"
echo " [OK] Server Cloud Aktif (PID: $SERVER_PID)"
echo "  -> Akses Lokal       : http://localhost:${PORT}"
for ip in $LAN_IPS; do
    echo "  -> Akses Wi-Fi / LAN : http://${ip}:${PORT}  (Offline / Tanpa Internet)"
done
echo "------------------------------------------------------------------"

# 4. Pertahankan cloudflared yang sudah berjalan agar link publik tidak berubah (kecuali --restart-tunnel)
if [ "${1:-}" != "--restart-tunnel" ] && pgrep -x cloudflared >/dev/null 2>&1 && [ -f ./cloudflared.log ]; then
    CF_LINK="$(grep -o 'https://[-a-zA-Z0-9]*\.trycloudflare\.com' ./cloudflared.log | tail -n 1 || true)"
    echo "[OK] Cloudflared sudah berjalan di background (link dipertahankan)."
    if [ -n "$CF_LINK" ]; then
        echo "  -> Akses Publik      : $CF_LINK"
    fi
    echo "=================================================================="
    trap 'echo ""; echo "[*] Menghentikan Linux Cloud Server..."; kill $SERVER_PID 2>/dev/null || true; exit 0' INT TERM
    wait $SERVER_PID
    exit 0
fi

pkill -x cloudflared >/dev/null 2>&1 || true
rm -f ./cloudflared.log

# 5. Cari binary cloudflared Linux (khusus akses online publik; Wi-Fi lokal tetap jalan walau offline)
CF_BIN=""
if [ -x "./cloudflared" ]; then
    CF_BIN="./cloudflared"
elif command -v cloudflared >/dev/null 2>&1; then
    CF_BIN="cloudflared"
elif curl -fsI --max-time 3 https://github.com >/dev/null 2>&1; then
    echo "[*] cloudflared belum ditemukan. Menjalankan setup-linux-server.sh..."
    bash ./setup-linux-server.sh
    CF_BIN="./cloudflared"
fi

if [ -z "$CF_BIN" ]; then
    echo "[*] Binary cloudflared tidak ditemukan. Server berjalan dalam mode Lokal & Wi-Fi Offline."
    echo "=================================================================="
    trap 'echo ""; echo "[*] Menghentikan Linux Cloud Server..."; kill $SERVER_PID 2>/dev/null || true; exit 0' INT TERM
    wait $SERVER_PID
    exit 0
fi

trap 'echo ""; echo "[*] Menghentikan Linux Cloud Server & Cloudflared..."; kill $SERVER_PID 2>/dev/null || true; exit 0' INT TERM

echo "[*] Menjalankan Cloudflared (khusus jalur online publik; otomatis tersambung saat ada internet)..."
echo "[*] Link https://xxxx-xxxx.trycloudflare.com akan tampil otomatis di Web & Aplikasi:"
echo "=================================================================="
"$CF_BIN" tunnel --no-autoupdate --ha-connections 1 --url "http://localhost:${PORT}" --logfile ./cloudflared.log
