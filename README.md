# Linux Cloud Drive Server

Server penyimpanan cloud pribadi ringan (ultra-hemat RAM, zero-dependency Node.js) dengan antarmuka ala **Google Drive** untuk Desktop, Browser, HP Android, dan Linux Desktop App mandiri.

## Fitur Utama

- **Ultra-Hemat RAM**: Streaming file `64 KB`, tanpa dependency `npm`, heap server ~4–5 MB (`--max-old-space-size=48 --jitless`).
- **Tampilan Ala Google Drive (Desktop & HP)**:
  - Light Mode bawaan ala Google Drive + Dark Mode toggle.
  - Layout responsif HP (Search pill di atas, Bottom Navigation Bar, FAB `+`, Bottom Sheet menu, daftar 2 baris, dan grid 2 kolom).
- **Upload Resumable & Serentak**:
  - Hingga 3 file diunggah serentak per chunk `2 MB`, otomatis lanjut dari offset terakhir bila koneksi terputus, dan pilihan **Lewati (Skip)** / **Timpa (Overwrite)** untuk nama file yang sama.
- **Sampah (Trash / Recycle Bin) & Multi-Select**:
  - Penghapusan memindahkan item ke **Sampah** (bisa dipulihkan atau dihapus permanen), serta mendukung pilih banyak (`Ctrl+Click` / mode pilih) untuk pindah & hapus massal.
- **Keamanan Opsional (Kunci Kata Sandi)**:
  - Dapat mengaktifkan proteksi kata sandi dari menu **Pengaturan (`⚙️`)** di UI atau environment variable `CLOUD_PASS`.
- **Mode Wi-Fi Offline + Cloudflared Online**:
  - Akses lewat Wi-Fi/LAN lokal bekerja 100% **offline tanpa kuota internet** (`http://<IP-LAN>:8080`).
  - `cloudflared` berjalan berdampingan khusus untuk akses internet publik (`https://...trycloudflare.com`) yang tampil langsung di Web & Apps.
- **Aplikasi Mandiri Linux & Android APK**:
  - Desktop App Linux berbasis GTK3 + WebKit2 (`./linux-cloud-drive`) lengkap dengan System Tray.
  - Aplikasi Android WebView (`shared_files/Arsip & Aplikasi/LinuxCloudDrive.apk`) yang otomatis menyinkronkan IP Wi-Fi & link Cloudflared terbaru.

## Cara Menjalankan

### 1. Aplikasi Desktop Mandiri (Linux)
```bash
./install-desktop-app.sh   # cukup 1x untuk memasang ikon & menu aplikasi
./linux-cloud-drive
```

### 2. Server + Cloudflared Tunnel (Terminal / Headless)
```bash
chmod +x *.sh
./setup-linux-server.sh    # cukup 1x untuk firewall & cloudflared
./start-linux-server.sh    # Server + Cloudflared (gunakan --local untuk Wi-Fi saja)
```

### 3. Auto-Start saat Linux Booting (`systemd`)
```bash
./install-systemd-service.sh
```

### 4. Docker (Alpine Linux)
```bash
docker compose up -d
```

### 5. Build Ulang APK Android
```bash
./android-app/build-apk.sh
```
Output APK akan langsung tersedia di dalam Drive pada `/Arsip & Aplikasi/LinuxCloudDrive.apk`.

## Endpoint API Utama

- `GET /api/health` — Status kesehatan server & RAM proses
- `GET /api/info` — Info jaringan, status `cloudflared`, statistik disk, sampah & auth
- `POST /api/auth/login` | `POST /api/auth/logout` | `POST /api/auth/password`
- `GET /api/browse?path=/&category=all&search=` — Jelajahi folder, kategori, dan terbaru (`recent`)
- `GET /api/folders` — Daftar seluruh folder
- `POST /api/upload/check` | `POST /api/upload/init` | `POST /api/upload/chunk` | `DELETE /api/upload/cancel`
- `POST /api/folder` | `POST /api/textfile` | `POST /api/rename`
- `DELETE /api/item` | `POST /api/batch/move` | `POST /api/batch/delete`
- `GET /api/trash` | `POST /api/trash/restore` | `DELETE /api/trash`
- `GET/HEAD /files/<path>` — Streaming media (HTTP 206 Range) & unduhan (`?download=1`)
