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

# 2. Jika hanya ingin mode Lokal / Wi-Fi LAN saja (--local)
if [ "${1:-}" = "--local" ]; then
    echo "[*] Menjalankan dalam mode Lokal & Wi-Fi/LAN (Ultra Hemat RAM)..."
    exec node $NODE_LOW_RAM_FLAGS server.js
fi

# 3. Jalankan node server.js di background dengan flag penghemat RAM V8
echo "[*] Menyalakan Cloud Storage Server di background (Heap ~3.5 MB)..."
nohup node $NODE_LOW_RAM_FLAGS server.js > server.log 2>&1 &
SERVER_PID=$!
sleep 2

# Tampilkan IP LAN / Wi-Fi aktif di Linux
LAN_IPS="$(hostname -I 2>/dev/null || ip -4 addr show | awk '/inet / && $2 !~ /^127/ {sub(/\/.*/, "", $2); print $2}' | xargs)"
echo "------------------------------------------------------------------"
echo " [OK] Server Cloud Aktif (PID: $SERVER_PID)"
echo "  -> Akses Lokal       : http://localhost:${PORT}"
for ip in $LAN_IPS; do
    echo "  -> Akses Wi-Fi / LAN : http://${ip}:${PORT}"
done
echo "------------------------------------------------------------------"

# 4. Cari binary cloudflared Linux
CF_BIN=""
if [ -x "./cloudflared" ]; then
    CF_BIN="./cloudflared"
elif command -v cloudflared >/dev/null 2>&1; then
    CF_BIN="cloudflared"
else
    echo "[*] cloudflared belum ditemukan. Menjalankan setup-linux-server.sh..."
    bash ./setup-linux-server.sh
    CF_BIN="./cloudflared"
fi

rm -f ./cloudflared.log

trap 'echo ""; echo "[*] Menghentikan Linux Cloud Server..."; kill $SERVER_PID 2>/dev/null || true; exit 0' INT TERM

echo "[*] Membuka jalur internet publik Cloudflared (Hemat RAM: GOGC=50, 1 Conn)..."
echo "[*] Salin link https://xxxx-xxxx.trycloudflare.com yang muncul di bawah:"
echo "=================================================================="
"$CF_BIN" tunnel --no-autoupdate --ha-connections 1 --url "http://localhost:${PORT}" --logfile ./cloudflared.log
