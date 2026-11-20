#!/usr/bin/env bash
# ==============================================================================
#  PASANG AUTO-START SYSTEMD SERVICE DI LINUX SERVER (MODE ULTRA HEMAT RAM)
#  Menjadikan Cloud Storage Server & Cloudflared jalan otomatis saat Linux boot
# ==============================================================================

set -e
cd "$(dirname "$0")"
APP_DIR="$(pwd)"
NODE_BIN="$(command -v node || echo /usr/bin/node)"
CF_BIN="$(command -v cloudflared || echo "${APP_DIR}/cloudflared")"
CURRENT_USER="$(whoami)"

SUDO=""
if [ "$(id -u)" -ne 0 ] && command -v sudo >/dev/null 2>&1; then
    SUDO="sudo"
fi

echo "=================================================================="
echo "   KONFIGURASI SYSTEMD AUTO-START SERVICE (MODE ULTRA HEMAT RAM)  "
echo "=================================================================="
echo "  [1] Pasang & Aktifkan Auto-Start (cloud-storage & cloud-tunnel)"
echo "  [2] Hentikan & Hapus Auto-Start"
echo ""
read -r -p "Pilih angka [1 atau 2] (Default=1): " OPSI

if [ "${OPSI:-1}" = "2" ]; then
    echo "[*] Menghentikan dan menghapus systemd service..."
    $SUDO systemctl stop cloud-tunnel.service cloud-storage.service 2>/dev/null || true
    $SUDO systemctl disable cloud-tunnel.service cloud-storage.service 2>/dev/null || true
    $SUDO rm -f /etc/systemd/system/cloud-storage.service /etc/systemd/system/cloud-tunnel.service
    $SUDO systemctl daemon-reload
    echo "[SELESAI] Auto-Start Linux systemd telah dihapus."
    exit 0
fi

echo "[1/3] Membuat /etc/systemd/system/cloud-storage.service (Batas RAM Maks 64 MB)..."
$SUDO tee /etc/systemd/system/cloud-storage.service >/dev/null <<EOF
[Unit]
Description=Lightweight Linux Cloud Storage Server (Ultra Low RAM)
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
User=${CURRENT_USER}
WorkingDirectory=${APP_DIR}
Environment=PORT=8080
Environment=UV_THREADPOOL_SIZE=2
ExecStart=${NODE_BIN} --max-old-space-size=48 --max-semi-space-size=1 --jitless --expose-gc ${APP_DIR}/server.js
MemoryHigh=48M
MemoryMax=64M
Restart=always
RestartSec=3

[Install]
WantedBy=multi-user.target
EOF

echo "[2/3] Membuat /etc/systemd/system/cloud-tunnel.service (GOGC=50, 1 Conn)..."
$SUDO tee /etc/systemd/system/cloud-tunnel.service >/dev/null <<EOF
[Unit]
Description=Cloudflared Public Tunnel (Low RAM Mode)
After=network-online.target cloud-storage.service
Requires=cloud-storage.service

[Service]
Type=simple
User=${CURRENT_USER}
WorkingDirectory=${APP_DIR}
Environment=GOGC=50
ExecStartPre=/bin/rm -f ${APP_DIR}/cloudflared.log
ExecStart=${CF_BIN} tunnel --no-autoupdate --ha-connections 1 --url http://localhost:8080 --logfile ${APP_DIR}/cloudflared.log
MemoryHigh=48M
MemoryMax=64M
Restart=always
RestartSec=5

[Install]
WantedBy=multi-user.target
EOF

echo "[3/3] Mengaktifkan dan menyalakan service..."
$SUDO systemctl daemon-reload
$SUDO systemctl enable --now cloud-storage.service
$SUDO systemctl enable --now cloud-tunnel.service

sleep 4
echo ""
echo "=================================================================="
echo " [BERHASIL] Linux Cloud Storage & Cloudflared (Mode Hemat RAM)"
echo " telah berjalan otomatis di background (Systemd Daemon)!"
echo "=================================================================="
