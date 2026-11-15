#!/usr/bin/env bash
# ==============================================================================
#  INSTALASI OTOMATIS LINUX CLOUD STORAGE SERVER + FIREWALL + CLOUDFLARED
#  Mendukung: Ubuntu, Debian, Alpine Linux, Armbian, CentOS/RHEL/AlmaLinux, WSL
# ==============================================================================

set -e
cd "$(dirname "$0")"

echo "=================================================================="
echo "   SETUP LINUX CLOUD STORAGE SERVER (RINGAN, CEPAT & OTOMATIS)    "
echo "=================================================================="

# Gunakan sudo jika bukan root
SUDO=""
if [ "$(id -u)" -ne 0 ] && command -v sudo >/dev/null 2>&1; then
    SUDO="sudo"
fi

# 1. Cek & Install Node.js + curl jika belum tersedia
if ! command -v node >/dev/null 2>&1 || ! command -v curl >/dev/null 2>&1; then
    echo "[1/4] Menginstal Node.js dan curl untuk Linux..."
    if command -v apt-get >/dev/null 2>&1; then
        $SUDO apt-get update -y
        $SUDO apt-get install -y nodejs curl ca-certificates
    elif command -v apk >/dev/null 2>&1; then
        $SUDO apk update
        $SUDO apk add --no-cache nodejs curl ca-certificates
    elif command -v dnf >/dev/null 2>&1; then
        $SUDO dnf install -y nodejs curl ca-certificates
    elif command -v yum >/dev/null 2>&1; then
        $SUDO yum install -y nodejs curl ca-certificates
    else
        echo "[!] Silakan instal nodejs dan curl secara manual pada distro Linux Anda."
    fi
else
    echo "[1/4] Node.js ($(node -v)) dan curl sudah terpasang."
fi

# 2. Unduh Binary Linux cloudflared Resmi Sesuai Arsitektur CPU
if ! command -v cloudflared >/dev/null 2>&1 && [ ! -f "./cloudflared" ]; then
    echo "[2/4] Mendeteksi arsitektur CPU Linux dan mengunduh cloudflared..."
    ARCH="$(uname -m)"
    case "$ARCH" in
        x86_64|amd64)
            CF_ARCH="amd64"
            ;;
        aarch64|arm64)
            CF_ARCH="arm64"
            ;;
        armv7l|armhf|arm)
            CF_ARCH="arm"
            ;;
        *)
            CF_ARCH="amd64"
            ;;
    esac

    CF_URL="https://github.com/cloudflare/cloudflared/releases/latest/download/cloudflared-linux-${CF_ARCH}"
    echo "      Mengunduh dari: $CF_URL"
    curl -L -o ./cloudflared "$CF_URL"
    chmod +x ./cloudflared
    if [ -d /usr/local/bin ]; then
        $SUDO cp ./cloudflared /usr/local/bin/cloudflared 2>/dev/null || true
    fi
    echo "      [BERHASIL] cloudflared Linux (${CF_ARCH}) siap digunakan!"
else
    echo "[2/4] cloudflared sudah tersedia."
fi

# 3. Buka Port 8080 (TCP) pada Firewall Linux (UFW / Firewalld / Iptables)
echo "[3/4] Membuka Port 8080/tcp di Firewall Linux untuk akses Wi-Fi/LAN..."
if command -v ufw >/dev/null 2>&1; then
    $SUDO ufw allow 8080/tcp >/dev/null 2>&1 || true
    echo "      -> Aturan UFW ditambahkan: allow 8080/tcp"
elif command -v firewall-cmd >/dev/null 2>&1; then
    $SUDO firewall-cmd --permanent --add-port=8080/tcp >/dev/null 2>&1 || true
    $SUDO firewall-cmd --reload >/dev/null 2>&1 || true
    echo "      -> Aturan Firewalld ditambahkan: 8080/tcp"
elif command -v iptables >/dev/null 2>&1; then
    $SUDO iptables -C INPUT -p tcp --dport 8080 -j ACCEPT 2>/dev/null || \
    $SUDO iptables -I INPUT -p tcp --dport 8080 -j ACCEPT 2>/dev/null || true
    echo "      -> Aturan iptables ditambahkan: TCP Port 8080 ACCEPT"
fi

# 4. Berikan izin eksekusi ke seluruh script Linux
echo "[4/4] Mengatur izin eksekusi script (.sh)..."
chmod +x ./*.sh 2>/dev/null || true

echo ""
echo "=================================================================="
echo " [SELESAI] Setup Linux Cloud Storage Server Berhasil!"
echo " Untuk menyalakan Server + Cloudflared sekarang, jalankan:"
echo "   ./start-linux-server.sh"
echo "=================================================================="

