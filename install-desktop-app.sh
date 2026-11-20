#!/usr/bin/env bash
# ==============================================================================
#  PASANG SHORTCUT APLIKASI DESKTOP MANDIRI (LINUX CLOUD DRIVE)
#  Mendaftarkan ikon dan entri menu aplikasi ke sistem Linux user saat ini.
# ==============================================================================

set -e
cd "$(dirname "$0")"
APP_DIR="$(pwd)"

chmod +x "${APP_DIR}/linux-cloud-drive" "${APP_DIR}/"*.sh 2>/dev/null || true

ICON_DEST_DIR="${HOME}/.local/share/icons/hicolor/scalable/apps"
APPS_DEST_DIR="${HOME}/.local/share/applications"

mkdir -p "$ICON_DEST_DIR" "$APPS_DEST_DIR"
cp "${APP_DIR}/assets/linux-cloud-drive.svg" "${ICON_DEST_DIR}/linux-cloud-drive.svg"

cat > "${APPS_DEST_DIR}/linux-cloud-drive.desktop" <<EOF
[Desktop Entry]
Version=1.0
Type=Application
Name=Linux Cloud Drive
GenericName=Cloud Storage Drive
Comment=Aplikasi Cloud Storage Mandiri Ala Google Drive (Ultra Hemat RAM)
Exec="${APP_DIR}/linux-cloud-drive"
Icon=linux-cloud-drive
Terminal=false
Categories=Utility;Network;FileManager;
StartupWMClass=linux-cloud-drive
StartupNotify=true
EOF

chmod +x "${APPS_DEST_DIR}/linux-cloud-drive.desktop"

if command -v update-desktop-database >/dev/null 2>&1; then
    update-desktop-database "$APPS_DEST_DIR" >/dev/null 2>&1 || true
fi
if command -v gtk-update-icon-cache >/dev/null 2>&1; then
    gtk-update-icon-cache -f -t "${HOME}/.local/share/icons/hicolor" >/dev/null 2>&1 || true
fi

echo "[OK] Shortcut aplikasi desktop 'Linux Cloud Drive' berhasil dipasang!"
echo "     Desktop Entry : ${APPS_DEST_DIR}/linux-cloud-drive.desktop"
echo "     Ikon          : ${ICON_DEST_DIR}/linux-cloud-drive.svg"
echo "     Launcher      : ${APP_DIR}/linux-cloud-drive"
