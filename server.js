// Batasi jumlah thread worker libuv menjadi 2 agar hemat RAM native
process.env.UV_THREADPOOL_SIZE = '2';

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');
const crypto = require('crypto');

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 8080;
const HOST = process.env.HOST || '0.0.0.0';

// Ukuran buffer streaming dibatasi 64 KB agar upload/streaming file bergiga-giga tetap hemat RAM
const STREAM_CHUNK_SIZE = 64 * 1024;
const RESUMABLE_CHUNK_SIZE = 2 * 1024 * 1024;
const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const STALE_UPLOAD_MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

const DATA_ROOT = process.env.CLOUD_DATA_DIR ? path.resolve(process.env.CLOUD_DATA_DIR) : __dirname;
const SHARED_DIR = path.join(DATA_ROOT, 'shared_files');
const PUBLIC_DIR = process.env.CLOUD_PUBLIC_DIR ? path.resolve(process.env.CLOUD_PUBLIC_DIR) : path.join(__dirname, 'public');
const NOTES_FILE = path.join(DATA_ROOT, 'shared_notes.json');
const UPLOAD_TMP_DIR = path.join(DATA_ROOT, '.upload_tmp');
const TRASH_DIR = path.join(DATA_ROOT, '.trash');
const TRASH_INDEX_FILE = path.join(TRASH_DIR, 'index.json');
const CONFIG_FILE = path.join(DATA_ROOT, '.server_config.json');

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'SAMEORIGIN',
  'Referrer-Policy': 'no-referrer',
};

// Pastikan direktori utama & folder contoh tersedia
const DEFAULT_FOLDERS = ['Dokumen', 'Gambar & Foto', 'Video & Musik', 'Arsip & Aplikasi'];
if (!fs.existsSync(SHARED_DIR)) {
  fs.mkdirSync(SHARED_DIR, { recursive: true });
}
for (const folder of DEFAULT_FOLDERS) {
  const folderPath = path.join(SHARED_DIR, folder);
  if (!fs.existsSync(folderPath)) {
    fs.mkdirSync(folderPath, { recursive: true });
  }
}
if (!fs.existsSync(PUBLIC_DIR)) {
  fs.mkdirSync(PUBLIC_DIR, { recursive: true });
}
if (!fs.existsSync(NOTES_FILE)) {
  fs.writeFileSync(
    NOTES_FILE,
    JSON.stringify(
      [
        {
          id: Date.now(),
          author: 'System',
          text: 'Selamat datang di Linux Cloud Storage (Mode Ultra Hemat RAM)! Anda dapat membuat folder, mengunggah berbagai jenis file, menonton video, melihat foto, dan berbagi catatan.',
          time: new Date().toLocaleString('id-ID'),
        },
      ],
      null,
      2
    ),
    'utf8'
  );
}

const sampleFile = path.join(SHARED_DIR, 'Dokumen', 'SELAMAT_DATANG_CLOUD.txt');
if (!fs.existsSync(sampleFile) && fs.existsSync(path.join(SHARED_DIR, 'Dokumen'))) {
  fs.writeFileSync(
    sampleFile,
    'Selamat datang di Linux Cloud Storage (Mode Hemat RAM)!\r\n\r\nFitur Cloud yang tersedia:\r\n1. Buat Folder & Sub-folder tanpa batas\r\n2. Upload banyak file sekaligus (Drag & Drop) dengan buffer hemat RAM (64 KB)\r\n3. Filter otomatis berdasarkan Jenis File (Gambar, Video, Audio, Dokumen, Arsip)\r\n4. Preview Gambar, Pemutar Video/Musik langsung di browser, dan Editor File Teks\r\n5. Ganti Nama (Rename), Pindahkan, Unduh, dan Hapus File/Folder\r\n',
    'utf8'
  );
}

// Fungsi pembersih RAM (Garbage Collection)
function runGC() {
  if (typeof global.gc === 'function') {
    try {
      global.gc();
    } catch {}
  }
}

// Klasifikasi Kategori File berdasarkan Ekstensi
const CATEGORY_MAP = {
  image: ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg', '.bmp', '.ico', '.avif'],
  video: ['.mp4', '.webm', '.mkv', '.avi', '.mov', '.flv', '.wmv', '.m4v'],
  audio: ['.mp3', '.wav', '.ogg', '.flac', '.m4a', '.aac', '.wma'],
  document: ['.pdf', '.txt', '.md', '.doc', '.docx', '.xls', '.xlsx', '.ppt', '.pptx', '.csv', '.json', '.xml', '.html', '.css', '.js', '.py', '.bat', '.log', '.ini'],
  archive: ['.zip', '.rar', '.7z', '.tar', '.gz', '.iso', '.exe', '.msi', '.apk'],
};

const TEXT_EXTENSIONS = new Set([
  '.txt', '.md', '.json', '.xml', '.csv', '.html', '.css', '.js', '.py', '.bat', '.ps1', '.log', '.ini', '.yml', '.yaml'
]);

function getFileCategory(filename) {
  const ext = path.extname(filename).toLowerCase();
  for (const [cat, exts] of Object.entries(CATEGORY_MAP)) {
    if (exts.includes(ext)) return cat;
  }
  return 'other';
}

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.bmp': 'image/bmp',
  '.txt': 'text/plain; charset=utf-8',
  '.md': 'text/plain; charset=utf-8',
  '.log': 'text/plain; charset=utf-8',
  '.csv': 'text/csv; charset=utf-8',
  '.bat': 'text/plain; charset=utf-8',
  '.py': 'text/plain; charset=utf-8',
  '.pdf': 'application/pdf',
  '.zip': 'application/zip',
  '.rar': 'application/vnd.rar',
  '.7z': 'application/x-7z-compressed',
  '.apk': 'application/vnd.android.package-archive',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mkv': 'video/x-matroska',
  '.mov': 'video/quicktime',
  '.avi': 'video/x-msvideo',
  '.mp3': 'audio/mpeg',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.m4a': 'audio/mp4',
  '.flac': 'audio/flac',
};

// Pembacaan URL Cloudflared hemat RAM (Hanya membaca hingga 32 KB log & menyimpannya di cache)
let cachedTunnelUrl = null;
let lastLogCacheKey = '';

function isCloudflaredRunning() {
  if (process.platform !== 'linux') return true;
  try {
    const entries = fs.readdirSync('/proc');
    for (const entry of entries) {
      if (!/^\d+$/.test(entry)) continue;
      try {
        const comm = fs.readFileSync(`/proc/${entry}/comm`, 'utf8').trim();
        if (comm === 'cloudflared') return true;
      } catch {}
    }
    return false;
  } catch {
    return true;
  }
}

function getCloudflaredUrl() {
  if (!isCloudflaredRunning()) {
    cachedTunnelUrl = null;
    lastLogCacheKey = '';
    return null;
  }
  const logFile = path.join(__dirname, 'cloudflared.log');
  if (!fs.existsSync(logFile)) {
    cachedTunnelUrl = null;
    lastLogCacheKey = '';
    return null;
  }
  try {
    const stat = fs.statSync(logFile);
    const cacheKey = `${stat.size}:${stat.mtimeMs}`;
    if (cachedTunnelUrl && cacheKey === lastLogCacheKey) {
      return cachedTunnelUrl;
    }
    lastLogCacheKey = cacheKey;
    const readSize = Math.min(stat.size, 32768);
    if (readSize <= 0) return null;
    const buf = Buffer.allocUnsafe(readSize);
    const fd = fs.openSync(logFile, 'r');
    // Baca bagian awal (biasanya URL ada di baris 4-6) dan jika log besar baca bagian akhir juga
    fs.readSync(fd, buf, 0, readSize, 0);
    let content = buf.toString('utf8');
    if (stat.size > 32768) {
      const tailLen = Math.min(stat.size - 32768, 16384);
      const tailBuf = Buffer.allocUnsafe(tailLen);
      fs.readSync(fd, tailBuf, 0, tailLen, stat.size - tailLen);
      content += '\n' + tailBuf.toString('utf8');
    }
    fs.closeSync(fd);
    const matches = content.match(/https:\/\/[a-zA-Z0-9-]+\.trycloudflare\.com/g);
    if (matches && matches.length > 0) {
      cachedTunnelUrl = matches[matches.length - 1];
    }
    return cachedTunnelUrl;
  } catch {
    return null;
  }
}

function getNetworkAddresses() {
  const interfaces = os.networkInterfaces();
  const addresses = [];
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]) {
      if (iface.family === 'IPv4' && !iface.internal) {
        const isWifi = /^(wl|wlan|wifi)/i.test(name);
        const isLan = /^(en|eth)/i.test(name);
        addresses.push({
          interface: name,
          kind: isWifi ? 'Wi-Fi' : isLan ? 'LAN' : 'Jaringan',
          address: iface.address,
          netmask: iface.netmask,
          mac: iface.mac,
          url: `http://${iface.address}:${PORT}`,
        });
      }
    }
  }
  addresses.sort((a, b) => {
    const score = (x) => (x.kind === 'Wi-Fi' ? 0 : x.kind === 'LAN' ? 1 : 2);
    return score(a) - score(b);
  });
  return addresses;
}

function safeDecodeURIComponent(str) {
  try {
    return decodeURIComponent(str);
  } catch {
    return str;
  }
}

function resolveSafePath(relPath = '') {
  const cleaned = String(relPath || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '');
  const resolved = path.resolve(SHARED_DIR, cleaned);
  if (resolved !== SHARED_DIR && !resolved.startsWith(SHARED_DIR + path.sep)) {
    return null;
  }
  return resolved;
}

function listAllFolders() {
  const folders = ['/'];
  function walk(dir) {
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        const fullPath = path.join(dir, entry.name);
        folders.push(toRelPosix(fullPath));
        walk(fullPath);
      }
    }
  }
  walk(SHARED_DIR);
  folders.sort((a, b) => a.localeCompare(b));
  return folders;
}

function getSafeUploadId(rawId) {
  const cleaned = String(rawId || '').trim();
  return /^[a-f0-9]{16,64}$/i.test(cleaned) ? cleaned : null;
}

function getUploadPaths(uploadId) {
  if (!fs.existsSync(UPLOAD_TMP_DIR)) {
    fs.mkdirSync(UPLOAD_TMP_DIR, { recursive: true });
  }
  return {
    metaPath: path.join(UPLOAD_TMP_DIR, `${uploadId}.json`),
    partPath: path.join(UPLOAD_TMP_DIR, `${uploadId}.part`),
  };
}

function movePathSafe(srcPath, destPath) {
  const destDir = path.dirname(destPath);
  if (!fs.existsSync(destDir)) {
    fs.mkdirSync(destDir, { recursive: true });
  }
  try {
    fs.renameSync(srcPath, destPath);
  } catch (err) {
    if (err.code !== 'EXDEV') throw err;
    fs.cpSync(srcPath, destPath, { recursive: true });
    fs.rmSync(srcPath, { recursive: true, force: true });
  }
}

function finalizeResumableUpload(partPath, metaPath, destPath) {
  movePathSafe(partPath, destPath);
  if (fs.existsSync(metaPath)) {
    fs.unlinkSync(metaPath);
  }
  invalidateStorageCache();
  runGC();
}

/* Manajemen Sampah (Trash / Recycle Bin) */
function ensureTrashDir() {
  if (!fs.existsSync(TRASH_DIR)) {
    fs.mkdirSync(TRASH_DIR, { recursive: true });
  }
}

function loadTrashIndex() {
  ensureTrashDir();
  if (!fs.existsSync(TRASH_INDEX_FILE)) return [];
  try {
    const parsed = JSON.parse(fs.readFileSync(TRASH_INDEX_FILE, 'utf8'));
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function saveTrashIndex(items) {
  ensureTrashDir();
  fs.writeFileSync(TRASH_INDEX_FILE, JSON.stringify(items, null, 2), 'utf8');
}

function computePathSize(targetAbs) {
  try {
    const st = fs.statSync(targetAbs);
    if (st.isFile()) return st.size;
    if (!st.isDirectory()) return 0;
    let sum = 0;
    for (const entry of fs.readdirSync(targetAbs, { withFileTypes: true })) {
      sum += computePathSize(path.join(targetAbs, entry.name));
    }
    return sum;
  } catch {
    return 0;
  }
}

function moveItemToTrash(targetAbs) {
  ensureTrashDir();
  const id = crypto.randomBytes(8).toString('hex');
  const origRel = toRelPosix(targetAbs);
  const name = path.basename(targetAbs);
  const isDirectory = fs.statSync(targetAbs).isDirectory();
  const size = computePathSize(targetAbs);
  const trashPath = path.join(TRASH_DIR, `${id}_${sanitizeName(name)}`);

  movePathSafe(targetAbs, trashPath);

  const items = loadTrashIndex();
  const entry = {
    id,
    name,
    originalPath: origRel,
    originalFolder: toRelPosix(path.dirname(targetAbs)),
    isDirectory,
    size,
    trashName: path.basename(trashPath),
    deletedAt: Date.now(),
    deletedTime: new Date().toLocaleString('id-ID'),
  };
  items.unshift(entry);
  saveTrashIndex(items);
  invalidateStorageCache();
  runGC();
  return entry;
}

function restoreTrashItem(id) {
  const items = loadTrashIndex();
  const idx = items.findIndex((x) => x.id === id);
  if (idx === -1) return { error: 'Item sampah tidak ditemukan', status: 404 };

  const item = items[idx];
  const trashPath = path.join(TRASH_DIR, item.trashName);
  if (!fs.existsSync(trashPath)) {
    items.splice(idx, 1);
    saveTrashIndex(items);
    return { error: 'Berkas sampah sudah hilang dari disk', status: 404 };
  }

  let destAbs = resolveSafePath(item.originalPath);
  if (!destAbs || destAbs === SHARED_DIR) {
    destAbs = path.join(SHARED_DIR, sanitizeName(item.name));
  }
  if (fs.existsSync(destAbs)) {
    const ext = item.isDirectory ? '' : path.extname(destAbs);
    const base = item.isDirectory ? path.basename(destAbs) : path.basename(destAbs, ext);
    destAbs = path.join(path.dirname(destAbs), `${base}_pulih_${Date.now()}${ext}`);
  }

  movePathSafe(trashPath, destAbs);
  items.splice(idx, 1);
  saveTrashIndex(items);
  invalidateStorageCache();
  runGC();
  return { restoredPath: toRelPosix(destAbs) };
}

function deleteTrashItem(id) {
  const items = loadTrashIndex();
  const idx = items.findIndex((x) => x.id === id);
  if (idx === -1) return false;
  const trashPath = path.join(TRASH_DIR, items[idx].trashName);
  if (fs.existsSync(trashPath)) {
    fs.rmSync(trashPath, { recursive: true, force: true });
  }
  items.splice(idx, 1);
  saveTrashIndex(items);
  runGC();
  return true;
}

function emptyTrash() {
  const items = loadTrashIndex();
  for (const item of items) {
    const trashPath = path.join(TRASH_DIR, item.trashName);
    if (fs.existsSync(trashPath)) {
      fs.rmSync(trashPath, { recursive: true, force: true });
    }
  }
  saveTrashIndex([]);
  runGC();
}

function getTrashStats() {
  const items = loadTrashIndex();
  let bytes = 0;
  for (const item of items) bytes += item.size || 0;
  return { count: items.length, bytes };
}

/* Keamanan & Kunci Kata Sandi Opsional */
function loadServerConfig() {
  let cfg = { secret: null, passHash: null, passSalt: null };
  if (fs.existsSync(CONFIG_FILE)) {
    try {
      cfg = { ...cfg, ...JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8')) };
    } catch {}
  }
  if (!cfg.secret) {
    cfg.secret = crypto.randomBytes(32).toString('hex');
    try {
      fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), { encoding: 'utf8', mode: 0o600 });
    } catch {}
  }
  return cfg;
}

function saveServerConfig(cfg) {
  fs.writeFileSync(CONFIG_FILE, JSON.stringify(cfg, null, 2), { encoding: 'utf8', mode: 0o600 });
}

function hashPassword(password, salt) {
  return crypto.scryptSync(String(password), salt, 32).toString('hex');
}

function verifyPasswordHash(password, salt, expectedHex) {
  if (!salt || !expectedHex) return false;
  const actual = Buffer.from(hashPassword(password, salt), 'hex');
  const expected = Buffer.from(expectedHex, 'hex');
  return actual.length === expected.length && crypto.timingSafeEqual(actual, expected);
}

function isAuthEnabled(cfg) {
  return Boolean(process.env.CLOUD_PASS || (cfg && cfg.passHash && cfg.passSalt));
}

function checkPassword(password, cfg) {
  if (process.env.CLOUD_PASS) {
    const a = Buffer.from(String(password || ''), 'utf8');
    const b = Buffer.from(String(process.env.CLOUD_PASS), 'utf8');
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  }
  return verifyPasswordHash(password, cfg.passSalt, cfg.passHash);
}

function parseCookies(req) {
  const raw = req.headers.cookie || '';
  const map = {};
  for (const part of raw.split(';')) {
    const idx = part.indexOf('=');
    if (idx > 0) {
      map[part.slice(0, idx).trim()] = safeDecodeURIComponent(part.slice(idx + 1).trim());
    }
  }
  return map;
}

function createSessionToken(secret) {
  const exp = String(Date.now() + SESSION_TTL_MS);
  const sig = crypto.createHmac('sha256', secret).update(exp).digest('hex');
  return `${exp}.${sig}`;
}

function isSessionValid(req, cfg) {
  if (!isAuthEnabled(cfg)) return true;
  const cookies = parseCookies(req);
  const token = cookies.lcd_session || '';
  const parts = token.split('.');
  if (parts.length !== 2) return false;
  const [expStr, sigHex] = parts;
  const exp = Number(expStr);
  if (!Number.isFinite(exp) || exp < Date.now()) return false;
  const expectedHex = crypto.createHmac('sha256', cfg.secret).update(expStr).digest('hex');
  const a = Buffer.from(sigHex, 'hex');
  const b = Buffer.from(expectedHex, 'hex');
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

/* Pembersihan file upload sementara yang kadaluwarsa (> 7 hari) */
function cleanupStaleTempUploads() {
  if (!fs.existsSync(UPLOAD_TMP_DIR)) return;
  const now = Date.now();
  try {
    for (const name of fs.readdirSync(UPLOAD_TMP_DIR)) {
      const full = path.join(UPLOAD_TMP_DIR, name);
      try {
        const st = fs.statSync(full);
        if (now - st.mtimeMs > STALE_UPLOAD_MAX_AGE_MS) {
          fs.unlinkSync(full);
        }
      } catch {}
    }
  } catch {}
}

cleanupStaleTempUploads();
setInterval(cleanupStaleTempUploads, 24 * 60 * 60 * 1000).unref();

function toRelPosix(absPath) {
  const rel = path.relative(SHARED_DIR, absPath).replace(/\\/g, '/');
  return rel ? '/' + rel : '/';
}

function sanitizeName(name) {
  return path.basename(String(name || '').trim()).replace(/[<>:"/\\|?*\x00-\x1F]/g, '_');
}

// Cache Statistik Penyimpanan Cloud agar tidak membebani RAM & Disk saat refresh berulang
let storageStatsCache = null;
let storageCacheTime = 0;

function invalidateStorageCache() {
  storageStatsCache = null;
}

function getStorageStats() {
  const now = Date.now();
  if (storageStatsCache && now - storageCacheTime < 120000) {
    return storageStatsCache;
  }

  const stats = {
    totalBytes: 0,
    totalFiles: 0,
    totalFolders: 0,
    categories: {
      image: { count: 0, bytes: 0 },
      video: { count: 0, bytes: 0 },
      audio: { count: 0, bytes: 0 },
      document: { count: 0, bytes: 0 },
      archive: { count: 0, bytes: 0 },
      other: { count: 0, bytes: 0 },
    },
    disk: null,
  };

  function walk(dir) {
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        stats.totalFolders++;
        walk(full);
      } else if (entry.isFile()) {
        try {
          const st = fs.statSync(full);
          const cat = getFileCategory(entry.name);
          stats.totalFiles++;
          stats.totalBytes += st.size;
          stats.categories[cat].count++;
          stats.categories[cat].bytes += st.size;
        } catch {}
      }
    }
  }

  walk(SHARED_DIR);

  try {
    if (typeof fs.statfsSync === 'function') {
      const df = fs.statfsSync(SHARED_DIR);
      const totalDisk = df.blocks * df.bsize;
      const freeDisk = df.bfree * df.bsize;
      const usedDisk = totalDisk - freeDisk;
      stats.disk = {
        totalBytes: totalDisk,
        freeBytes: freeDisk,
        usedBytes: usedDisk,
        percent: totalDisk > 0 ? Math.round((usedDisk / totalDisk) * 100) : 0,
      };
    }
  } catch {}

  storageStatsCache = stats;
  storageCacheTime = now;
  return stats;
}

function browseDirectory(relPath, categoryFilter, searchQuery) {
  const isGlobalFilter = (categoryFilter && categoryFilter !== 'all') || (searchQuery && searchQuery.trim() !== '');
  const query = (searchQuery || '').trim().toLowerCase();

  if (!isGlobalFilter) {
    const absDir = resolveSafePath(relPath);
    if (!absDir || !fs.existsSync(absDir) || !fs.statSync(absDir).isDirectory()) {
      return null;
    }

    const folders = [];
    const files = [];
    const entries = fs.readdirSync(absDir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(absDir, entry.name);
      const itemRel = toRelPosix(fullPath);
      try {
        const st = fs.statSync(fullPath);
        if (entry.isDirectory()) {
          let childCount = 0;
          try {
            childCount = fs.readdirSync(fullPath).length;
          } catch {}
          folders.push({
            name: entry.name,
            path: itemRel,
            itemCount: childCount,
            modified: st.mtime.toLocaleString('id-ID'),
            timestamp: st.mtimeMs,
          });
        } else if (entry.isFile()) {
          const ext = path.extname(entry.name).toLowerCase();
          files.push({
            name: entry.name,
            path: itemRel,
            folder: toRelPosix(absDir),
            size: st.size,
            ext: ext || '-',
            category: getFileCategory(entry.name),
            isText: TEXT_EXTENSIONS.has(ext),
            modified: st.mtime.toLocaleString('id-ID'),
            timestamp: st.mtimeMs,
            url: '/files' + itemRel.split('/').map(encodeURIComponent).join('/'),
          });
        }
      } catch {}
    }

    folders.sort((a, b) => a.name.localeCompare(b.name));
    files.sort((a, b) => b.timestamp - a.timestamp);

    return {
      currentPath: toRelPosix(absDir),
      folders,
      files,
    };
  }

  const matchedFolders = [];
  const matchedFiles = [];

  function walkSearch(dir) {
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      const itemRel = toRelPosix(fullPath);
      try {
        const st = fs.statSync(fullPath);
        if (entry.isDirectory()) {
          if ((!categoryFilter || categoryFilter === 'all') && query && entry.name.toLowerCase().includes(query)) {
            let childCount = 0;
            try {
              childCount = fs.readdirSync(fullPath).length;
            } catch {}
            matchedFolders.push({
              name: entry.name,
              path: itemRel,
              itemCount: childCount,
              modified: st.mtime.toLocaleString('id-ID'),
              timestamp: st.mtimeMs,
            });
          }
          walkSearch(fullPath);
        } else if (entry.isFile()) {
          const cat = getFileCategory(entry.name);
          const matchCat = !categoryFilter || categoryFilter === 'all' || categoryFilter === 'recent' || cat === categoryFilter;
          const matchQuery = !query || entry.name.toLowerCase().includes(query);
          if (matchCat && matchQuery) {
            const ext = path.extname(entry.name).toLowerCase();
            matchedFiles.push({
              name: entry.name,
              path: itemRel,
              folder: toRelPosix(dir),
              size: st.size,
              ext: ext || '-',
              category: cat,
              isText: TEXT_EXTENSIONS.has(ext),
              modified: st.mtime.toLocaleString('id-ID'),
              timestamp: st.mtimeMs,
              url: '/files' + itemRel.split('/').map(encodeURIComponent).join('/'),
            });
          }
        }
      } catch {}
    }
  }

  walkSearch(SHARED_DIR);
  matchedFiles.sort((a, b) => b.timestamp - a.timestamp);

  return {
    currentPath: '/',
    folders: matchedFolders,
    files: matchedFiles,
  };
}

function sendJson(res, statusCode, data, extraHeaders = {}) {
  res.writeHead(statusCode, {
    ...SECURITY_HEADERS,
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Connection': 'close',
    ...extraHeaders,
  });
  res.end(JSON.stringify(data));
}

function readJsonBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk.toString();
      if (body.length > 2 * 1024 * 1024) {
        req.destroy();
        reject(new Error('Ukuran data melebihi batas 2 MB'));
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error('Format JSON tidak valid'));
      }
    });
    req.on('error', reject);
  });
}

function findApkFilesInDrive() {
  const results = [];
  function walk(dir) {
    let entries = [];
    try {
      entries = fs.readdirSync(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile() && entry.name.toLowerCase().endsWith('.apk')) {
        try {
          const st = fs.statSync(fullPath);
          const rel = toRelPosix(fullPath);
          results.push({
            name: entry.name,
            path: rel,
            size: st.size,
            url: '/files' + rel.split('/').map(encodeURIComponent).join('/'),
          });
        } catch {}
      }
    }
  }
  walk(SHARED_DIR);
  return results;
}

const server = http.createServer(async (req, res) => {
  try {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = safeDecodeURIComponent(parsedUrl.pathname);

  const clientIp = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').replace('::ffff:', '');
  const cfg = loadServerConfig();
  const authEnabled = isAuthEnabled(cfg);
  const authenticated = isSessionValid(req, cfg);

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      ...SECURITY_HEADERS,
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-File-Name, X-Target-Folder',
    });
    return res.end();
  }

  // 0. API: Health Check & Autentikasi
  if (pathname === '/api/health' && req.method === 'GET') {
    const procMem = process.memoryUsage();
    return sendJson(res, 200, {
      ok: true,
      app: 'linux-cloud-drive',
      uptimeSeconds: Math.floor(process.uptime()),
      ram: {
        heapMB: (procMem.heapUsed / 1024 / 1024).toFixed(2),
        rssMB: (procMem.rss / 1024 / 1024).toFixed(2),
      },
    });
  }

  if (pathname === '/api/auth/login' && req.method === 'POST') {
    try {
      const body = await readJsonBody(req);
      if (!authEnabled) {
        return sendJson(res, 200, { ok: true, authRequired: false });
      }
      if (!checkPassword(body.password || '', cfg)) {
        return sendJson(res, 401, { error: 'Kata sandi salah' });
      }
      const token = createSessionToken(cfg.secret);
      return sendJson(
        res,
        200,
        { ok: true },
        { 'Set-Cookie': `lcd_session=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}` }
      );
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }
  }

  if (pathname === '/api/auth/logout' && req.method === 'POST') {
    return sendJson(
      res,
      200,
      { ok: true },
      { 'Set-Cookie': 'lcd_session=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0' }
    );
  }

  // 1. API: Info Sistem, Penggunaan RAM Proses Server, Jaringan & Cloud Storage
  if (pathname === '/api/info' && req.method === 'GET') {
    if (authEnabled && !authenticated) {
      return sendJson(res, 200, {
        app: 'linux-cloud-drive',
        authRequired: true,
        authenticated: false,
        hostname: os.hostname(),
        port: PORT,
        networks: getNetworkAddresses(),
        tunnelActive: isCloudflaredRunning(),
        publicTunnelUrl: getCloudflaredUrl(),
      });
    }
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const procMem = process.memoryUsage();
    const trashStats = getTrashStats();
    return sendJson(res, 200, {
      app: 'linux-cloud-drive',
      authRequired: authEnabled,
      authenticated: true,
      envPasswordActive: Boolean(process.env.CLOUD_PASS),
      hostname: os.hostname(),
      platform: `${os.type()} ${os.release()} (${os.arch()})`,
      uptimeSeconds: Math.floor(process.uptime()),
      osUptimeSeconds: Math.floor(os.uptime()),
      systemLoad: os.loadavg ? os.loadavg().map((n) => n.toFixed(2)) : [],
      nodeVersion: process.version,
      port: PORT,
      clientIp,
      serverRam: {
        heapMB: (procMem.heapUsed / 1024 / 1024).toFixed(2),
        rssMB: (procMem.rss / 1024 / 1024).toFixed(2),
      },
      memory: {
        totalGB: (totalMem / 1024 / 1024 / 1024).toFixed(2),
        usedGB: ((totalMem - freeMem) / 1024 / 1024 / 1024).toFixed(2),
        percent: Math.round(((totalMem - freeMem) / totalMem) * 100),
      },
      networks: getNetworkAddresses(),
      tunnelActive: isCloudflaredRunning(),
      publicTunnelUrl: getCloudflaredUrl(),
      apkFiles: findApkFilesInDrive(),
      trash: trashStats,
      storage: getStorageStats(),
      serverTime: new Date().toLocaleString('id-ID'),
    });
  }

  // Gerbang Autentikasi untuk seluruh rute API & file bila kata sandi diaktifkan
  if (authEnabled && !authenticated && (pathname.startsWith('/api/') || pathname.startsWith('/files/'))) {
    return sendJson(res, 401, { error: 'Autentikasi diperlukan', authRequired: true });
  }

  if (pathname === '/api/auth/password' && req.method === 'POST') {
    try {
      if (process.env.CLOUD_PASS) {
        return sendJson(res, 400, { error: 'Kata sandi dikunci melalui environment variable CLOUD_PASS' });
      }
      const body = await readJsonBody(req);
      if (authEnabled && !checkPassword(body.currentPassword || '', cfg)) {
        return sendJson(res, 403, { error: 'Kata sandi saat ini tidak cocok' });
      }
      const nextPass = String(body.newPassword || '').trim();
      if (!nextPass) {
        cfg.passHash = null;
        cfg.passSalt = null;
        saveServerConfig(cfg);
        return sendJson(res, 200, { ok: true, authRequired: false, message: 'Kunci kata sandi server dinonaktifkan' });
      }
      if (nextPass.length < 4) {
        return sendJson(res, 400, { error: 'Kata sandi minimal 4 karakter' });
      }
      const salt = crypto.randomBytes(16).toString('hex');
      cfg.passSalt = salt;
      cfg.passHash = hashPassword(nextPass, salt);
      saveServerConfig(cfg);
      const token = createSessionToken(cfg.secret);
      return sendJson(
        res,
        200,
        { ok: true, authRequired: true, message: 'Kata sandi server berhasil diperbarui' },
        { 'Set-Cookie': `lcd_session=${encodeURIComponent(token)}; HttpOnly; Path=/; SameSite=Lax; Max-Age=${Math.floor(SESSION_TTL_MS / 1000)}` }
      );
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }
  }

  // 1b. API: Bersihkan RAM Server secara paksa (Garbage Collection + Reset Cache)
  if (pathname === '/api/gc' && req.method === 'POST') {
    invalidateStorageCache();
    runGC();
    const procMem = process.memoryUsage();
    return sendJson(res, 200, {
      message: 'RAM Server berhasil dibersihkan!',
      heapMB: (procMem.heapUsed / 1024 / 1024).toFixed(2),
      rssMB: (procMem.rss / 1024 / 1024).toFixed(2),
    });
  }

  // 2. API: Jelajahi Folder & Filter Kategori / Pencarian Cloud
  if ((pathname === '/api/browse' || pathname === '/api/files') && req.method === 'GET') {
    const relPath = parsedUrl.searchParams.get('path') || '/';
    const category = parsedUrl.searchParams.get('category') || 'all';
    const search = parsedUrl.searchParams.get('search') || '';

    const result = browseDirectory(relPath, category, search);
    if (!result) {
      return sendJson(res, 404, { error: 'Folder tidak ditemukan' });
    }
    return sendJson(res, 200, result);
  }

  // 2b. API: Daftar Semua Folder untuk Pemindahan File ala Drive
  if (pathname === '/api/folders' && req.method === 'GET') {
    return sendJson(res, 200, { folders: listAllFolders() });
  }

  // 3. API: Buat Folder Baru
  if (pathname === '/api/folder' && req.method === 'POST') {
    try {
      const body = await readJsonBody(req);
      const parentRel = body.parentPath || '/';
      const folderName = sanitizeName(body.name);
      if (!folderName) {
        return sendJson(res, 400, { error: 'Nama folder tidak boleh kosong' });
      }
      const parentAbs = resolveSafePath(parentRel);
      if (!parentAbs || !fs.existsSync(parentAbs)) {
        return sendJson(res, 404, { error: 'Folder induk tidak ditemukan' });
      }
      const newFolderAbs = path.join(parentAbs, folderName);
      if (fs.existsSync(newFolderAbs)) {
        return sendJson(res, 400, { error: 'Folder dengan nama tersebut sudah ada' });
      }
      fs.mkdirSync(newFolderAbs, { recursive: true });
      invalidateStorageCache();
      return sendJson(res, 200, { message: 'Folder berhasil dibuat', path: toRelPosix(newFolderAbs) });
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }
  }

  // 4. API: Buat atau Edit File Teks Langsung di Cloud
  if (pathname === '/api/textfile' && req.method === 'POST') {
    try {
      const body = await readJsonBody(req);
      const folderRel = body.folder || '/';
      let fileName = sanitizeName(body.name || 'catatan_baru.txt');
      if (!path.extname(fileName)) fileName += '.txt';

      const folderAbs = resolveSafePath(folderRel);
      if (!folderAbs || !fs.existsSync(folderAbs)) {
        return sendJson(res, 404, { error: 'Folder tujuan tidak ditemukan' });
      }
      const targetAbs = path.join(folderAbs, fileName);
      fs.writeFileSync(targetAbs, String(body.content ?? ''), 'utf8');
      invalidateStorageCache();
      runGC();
      return sendJson(res, 200, { message: 'File teks berhasil disimpan', path: toRelPosix(targetAbs) });
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }
  }

  // 5. API: Ganti Nama (Rename) atau Pindahkan File / Folder
  if (pathname === '/api/rename' && req.method === 'POST') {
    try {
      const body = await readJsonBody(req);
      const oldAbs = resolveSafePath(body.oldPath);
      if (!oldAbs || oldAbs === SHARED_DIR || !fs.existsSync(oldAbs)) {
        return sendJson(res, 404, { error: 'File atau folder asal tidak ditemukan' });
      }

      let newAbs;
      if (body.targetFolder !== undefined) {
        const destFolderAbs = resolveSafePath(body.targetFolder);
        if (!destFolderAbs || !fs.existsSync(destFolderAbs) || !fs.statSync(destFolderAbs).isDirectory()) {
          return sendJson(res, 400, { error: 'Folder tujuan tidak valid' });
        }
        newAbs = path.join(destFolderAbs, path.basename(oldAbs));
      } else {
        const safeNewName = sanitizeName(body.newName);
        if (!safeNewName) {
          return sendJson(res, 400, { error: 'Nama baru tidak valid' });
        }
        newAbs = path.join(path.dirname(oldAbs), safeNewName);
      }

      if (newAbs === oldAbs || newAbs.startsWith(oldAbs + path.sep)) {
        return sendJson(res, 400, { error: 'Tidak dapat memindahkan folder ke dalam dirinya sendiri' });
      }
      if (fs.existsSync(newAbs)) {
        return sendJson(res, 400, { error: 'Nama tersebut sudah digunakan di lokasi tujuan' });
      }

      fs.renameSync(oldAbs, newAbs);
      invalidateStorageCache();
      return sendJson(res, 200, { message: 'Berhasil diperbarui', newPath: toRelPosix(newAbs) });
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }
  }

  // 6.0 API: Cek Duplikasi Nama File Sebelum Upload (Pilih Skip / Overwrite)
  if (pathname === '/api/upload/check' && req.method === 'POST') {
    try {
      const body = await readJsonBody(req);
      const folderAbs = resolveSafePath(body.folder || '/');
      const fileNames = Array.isArray(body.fileNames) ? body.fileNames : [];
      if (!folderAbs) {
        return sendJson(res, 400, { error: 'Folder tujuan tidak valid' });
      }
      const existing = [];
      for (const rawName of fileNames) {
        const safeName = sanitizeName(rawName);
        if (safeName && fs.existsSync(path.join(folderAbs, safeName))) {
          existing.push(String(rawName));
        }
      }
      return sendJson(res, 200, { existing });
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }
  }

  // 6a. API: Inisialisasi / Resume Upload Bertahap (Resumable Chunked Upload)
  if (pathname === '/api/upload/init' && req.method === 'POST') {
    try {
      const body = await readJsonBody(req);
      const safeName = sanitizeName(body.fileName);
      const folderRel = body.folder || '/';
      const folderAbs = resolveSafePath(folderRel);
      const fileSize = Number(body.fileSize);
      const lastModified = Number(body.lastModified || 0);
      const onConflict = body.onConflict === 'skip' ? 'skip' : 'overwrite';

      if (!safeName || !folderAbs || !Number.isFinite(fileSize) || fileSize < 0) {
        return sendJson(res, 400, { error: 'Parameter upload tidak valid' });
      }
      if (!fs.existsSync(folderAbs)) {
        fs.mkdirSync(folderAbs, { recursive: true });
      }

      const destPath = path.join(folderAbs, safeName);
      if (onConflict === 'skip' && fs.existsSync(destPath)) {
        return sendJson(res, 200, {
          skipped: true,
          completed: false,
          path: toRelPosix(destPath),
        });
      }

      const key = `${toRelPosix(folderAbs)}|${safeName}|${fileSize}|${lastModified}`;
      const uploadId = crypto.createHash('sha256').update(key).digest('hex').slice(0, 32);
      const { metaPath, partPath } = getUploadPaths(uploadId);

      if (fileSize === 0) {
        fs.writeFileSync(destPath, '');
        invalidateStorageCache();
        return sendJson(res, 200, {
          uploadId,
          offset: 0,
          chunkSize: RESUMABLE_CHUNK_SIZE,
          completed: true,
          path: toRelPosix(destPath),
        });
      }

      let offset = 0;
      let resumed = false;
      if (fs.existsSync(metaPath) && fs.existsSync(partPath)) {
        try {
          const existingMeta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
          const st = fs.statSync(partPath);
          if (existingMeta.fileSize === fileSize && existingMeta.destPath === path.join(folderAbs, safeName) && st.size <= fileSize) {
            offset = st.size;
            resumed = offset > 0;
          }
        } catch {}
      }

      if (!resumed && offset === 0) {
        fs.writeFileSync(
          metaPath,
          JSON.stringify({
            uploadId,
            fileName: safeName,
            folder: toRelPosix(folderAbs),
            destPath: path.join(folderAbs, safeName),
            fileSize,
            createdAt: Date.now(),
          }),
          'utf8'
        );
        fs.writeFileSync(partPath, '');
      }

      if (offset === fileSize) {
        const destPath = path.join(folderAbs, safeName);
        finalizeResumableUpload(partPath, metaPath, destPath);
        return sendJson(res, 200, {
          uploadId,
          offset,
          chunkSize: RESUMABLE_CHUNK_SIZE,
          completed: true,
          resumed: true,
          path: toRelPosix(destPath),
        });
      }

      return sendJson(res, 200, {
        uploadId,
        offset,
        chunkSize: RESUMABLE_CHUNK_SIZE,
        completed: false,
        resumed,
      });
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }
  }

  // 6b. API: Terima Potongan Chunk Upload secara Streaming ke Disk (Tanpa Menumpuk RAM)
  if (pathname === '/api/upload/chunk' && req.method === 'POST') {
    const uploadId = getSafeUploadId(parsedUrl.searchParams.get('uploadId'));
    const offset = Number(parsedUrl.searchParams.get('offset'));
    if (!uploadId || !Number.isFinite(offset) || offset < 0) {
      return sendJson(res, 400, { error: 'Parameter chunk tidak valid' });
    }

    const { metaPath, partPath } = getUploadPaths(uploadId);
    if (!fs.existsSync(metaPath) || !fs.existsSync(partPath)) {
      return sendJson(res, 404, { error: 'Sesi upload tidak ditemukan' });
    }

    let meta;
    try {
      meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
    } catch {
      return sendJson(res, 500, { error: 'Metadata upload rusak' });
    }

    const currentSize = fs.statSync(partPath).size;
    if (currentSize !== offset) {
      return sendJson(res, 409, {
        error: 'Offset chunk tidak cocok',
        expectedOffset: currentSize,
      });
    }

    const writeStream = fs.createWriteStream(partPath, {
      flags: 'a',
      highWaterMark: STREAM_CHUNK_SIZE,
    });
    let chunkBytes = 0;
    let aborted = false;
    let responded = false;

    const replyOnce = (code, data) => {
      if (responded || res.headersSent) return;
      responded = true;
      sendJson(res, code, data);
    };

    req.on('data', (chunk) => {
      chunkBytes += chunk.length;
    });

    req.on('aborted', () => {
      aborted = true;
      writeStream.destroy();
    });

    req.on('close', () => {
      if (!req.complete && !aborted) {
        aborted = true;
        writeStream.destroy();
      }
    });

    req.pipe(writeStream);

    writeStream.on('finish', () => {
      if (aborted) return;
      const newOffset = currentSize + chunkBytes;
      if (newOffset >= meta.fileSize) {
        try {
          finalizeResumableUpload(partPath, metaPath, meta.destPath);
          return replyOnce(200, {
            completed: true,
            offset: newOffset,
            path: toRelPosix(meta.destPath),
          });
        } catch (err) {
          return replyOnce(500, { error: `Gagal menyelesaikan file: ${err.message}` });
        }
      }
      replyOnce(200, { completed: false, offset: newOffset });
    });

    writeStream.on('error', (err) => {
      replyOnce(500, { error: `Gagal menulis chunk: ${err.message}` });
    });
    return;
  }

  // 6c. API: Batalkan & Bersihkan Sesi Upload Sementara
  if (pathname === '/api/upload/cancel' && req.method === 'DELETE') {
    const uploadId = getSafeUploadId(parsedUrl.searchParams.get('uploadId'));
    if (!uploadId) {
      return sendJson(res, 400, { error: 'uploadId tidak valid' });
    }
    const { metaPath, partPath } = getUploadPaths(uploadId);
    try {
      if (fs.existsSync(partPath)) fs.unlinkSync(partPath);
      if (fs.existsSync(metaPath)) fs.unlinkSync(metaPath);
      return sendJson(res, 200, { message: 'Upload dibatalkan' });
    } catch (err) {
      return sendJson(res, 500, { error: err.message });
    }
  }

  // 6. API: Upload File Hemat RAM (Buffer Streaming 64 KB)
  if (pathname === '/api/upload' && req.method === 'POST') {
    const rawFilename = req.headers['x-file-name'] || parsedUrl.searchParams.get('name') || `file_${Date.now()}.bin`;
    const rawFolder = req.headers['x-target-folder'] || parsedUrl.searchParams.get('folder') || '/';
    const safeName = sanitizeName(safeDecodeURIComponent(rawFilename));
    const folderAbs = resolveSafePath(safeDecodeURIComponent(rawFolder));

    if (!safeName || !folderAbs) {
      return sendJson(res, 400, { error: 'Nama file atau folder tujuan tidak valid' });
    }

    if (!fs.existsSync(folderAbs)) {
      fs.mkdirSync(folderAbs, { recursive: true });
    }

    const destPath = path.join(folderAbs, safeName);
    const writeStream = fs.createWriteStream(destPath, { highWaterMark: STREAM_CHUNK_SIZE });
    let uploadedBytes = 0;

    req.on('data', (chunk) => {
      uploadedBytes += chunk.length;
    });

    req.pipe(writeStream);

    writeStream.on('finish', () => {
      invalidateStorageCache();
      runGC();
      sendJson(res, 200, {
        message: 'File berhasil diunggah',
        name: safeName,
        path: toRelPosix(destPath),
        size: uploadedBytes,
      });
    });

    writeStream.on('error', (err) => {
      sendJson(res, 500, { error: `Gagal menyimpan file: ${err.message}` });
    });
    return;
  }

  // 7. API: Hapus Item (Pindah ke Sampah default, atau ?permanent=1 untuk permanen)
  if ((pathname === '/api/item' || pathname.startsWith('/api/files/')) && req.method === 'DELETE') {
    const relTarget = pathname === '/api/item'
      ? parsedUrl.searchParams.get('path')
      : pathname.replace('/api/files/', '');
    const permanent = parsedUrl.searchParams.get('permanent') === '1';
    const targetAbs = resolveSafePath(relTarget);

    if (!targetAbs || targetAbs === SHARED_DIR || !fs.existsSync(targetAbs)) {
      return sendJson(res, 404, { error: 'Item tidak ditemukan' });
    }

    try {
      if (permanent) {
        fs.rmSync(targetAbs, { recursive: true, force: true });
        invalidateStorageCache();
        runGC();
        return sendJson(res, 200, { message: 'Berhasil dihapus permanen' });
      }
      const trashEntry = moveItemToTrash(targetAbs);
      return sendJson(res, 200, { message: 'Dipindahkan ke Sampah', trashId: trashEntry.id });
    } catch (err) {
      return sendJson(res, 500, { error: err.message });
    }
  }

  // 7b. API: Batch Move & Batch Delete untuk Multi-Select
  if (pathname === '/api/batch/delete' && req.method === 'POST') {
    try {
      const body = await readJsonBody(req);
      const paths = Array.isArray(body.paths) ? body.paths : [];
      const permanent = Boolean(body.permanent);
      let count = 0;
      const trashIds = [];
      for (const rel of paths) {
        const targetAbs = resolveSafePath(rel);
        if (!targetAbs || targetAbs === SHARED_DIR || !fs.existsSync(targetAbs)) continue;
        if (permanent) {
          fs.rmSync(targetAbs, { recursive: true, force: true });
        } else {
          trashIds.push(moveItemToTrash(targetAbs).id);
        }
        count++;
      }
      invalidateStorageCache();
      runGC();
      return sendJson(res, 200, { message: `${count} item diproses`, count, trashIds });
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }
  }

  if (pathname === '/api/batch/move' && req.method === 'POST') {
    try {
      const body = await readJsonBody(req);
      const paths = Array.isArray(body.paths) ? body.paths : [];
      const destFolderAbs = resolveSafePath(body.targetFolder || '/');
      if (!destFolderAbs || !fs.existsSync(destFolderAbs) || !fs.statSync(destFolderAbs).isDirectory()) {
        return sendJson(res, 400, { error: 'Folder tujuan tidak valid' });
      }
      let moved = 0;
      let skipped = 0;
      for (const rel of paths) {
        const oldAbs = resolveSafePath(rel);
        if (!oldAbs || oldAbs === SHARED_DIR || !fs.existsSync(oldAbs)) {
          skipped++;
          continue;
        }
        const newAbs = path.join(destFolderAbs, path.basename(oldAbs));
        if (newAbs === oldAbs || newAbs.startsWith(oldAbs + path.sep) || fs.existsSync(newAbs)) {
          skipped++;
          continue;
        }
        fs.renameSync(oldAbs, newAbs);
        moved++;
      }
      invalidateStorageCache();
      return sendJson(res, 200, { message: `${moved} dipindahkan${skipped ? `, ${skipped} dilewati` : ''}`, moved, skipped });
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }
  }

  // 7c. API: Sampah (Trash / Recycle Bin)
  if (pathname === '/api/trash' && req.method === 'GET') {
    const items = loadTrashIndex();
    const totalBytes = items.reduce((acc, it) => acc + (it.size || 0), 0);
    return sendJson(res, 200, { items, totalBytes });
  }

  if (pathname === '/api/trash/restore' && req.method === 'POST') {
    try {
      const body = await readJsonBody(req);
      const resData = restoreTrashItem(body.id);
      if (resData.error) {
        return sendJson(res, resData.status || 400, { error: resData.error });
      }
      return sendJson(res, 200, { message: 'Item berhasil dipulihkan', ...resData });
    } catch (err) {
      return sendJson(res, 400, { error: err.message });
    }
  }

  if (pathname === '/api/trash' && req.method === 'DELETE') {
    if (parsedUrl.searchParams.get('all') === '1') {
      emptyTrash();
      return sendJson(res, 200, { message: 'Sampah dikosongkan' });
    }
    const id = parsedUrl.searchParams.get('id');
    if (!id || !deleteTrashItem(id)) {
      return sendJson(res, 404, { error: 'Item sampah tidak ditemukan' });
    }
    return sendJson(res, 200, { message: 'Item dihapus permanen' });
  }

  // 8. Streaming, Preview & Download File Hemat RAM (64 KB Chunk + HTTP 206 Range)
  if (pathname.startsWith('/files/') && (req.method === 'GET' || req.method === 'HEAD')) {
    const relFile = pathname.slice('/files'.length);
    const targetPath = resolveSafePath(relFile);

    if (!targetPath || !fs.existsSync(targetPath) || !fs.statSync(targetPath).isFile()) {
      res.writeHead(404, { ...SECURITY_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end(req.method === 'HEAD' ? undefined : '404 - File tidak ditemukan');
    }

    const ext = path.extname(targetPath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    const stat = fs.statSync(targetPath);
    const forceDownload = parsedUrl.searchParams.get('download') === '1';
    const fileName = path.basename(targetPath);

    const commonFileHeaders = {
      ...SECURITY_HEADERS,
      'Content-Type': contentType,
      'Accept-Ranges': 'bytes',
      'Last-Modified': stat.mtime.toUTCString(),
      'Cache-Control': 'private, max-age=0, must-revalidate',
    };

    const range = req.headers.range;
    if (range && !forceDownload && req.method === 'GET' && stat.size > 0) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parts[0] === '' ? Math.max(0, stat.size - parseInt(parts[1], 10)) : parseInt(parts[0], 10);
      const end = parts[0] === '' ? stat.size - 1 : (parts[1] ? parseInt(parts[1], 10) : stat.size - 1);

      if (Number.isNaN(start) || Number.isNaN(end) || start < 0 || start > end || end >= stat.size) {
        res.writeHead(416, { ...SECURITY_HEADERS, 'Content-Range': `bytes */${stat.size}` });
        return res.end();
      }

      res.writeHead(206, {
        ...commonFileHeaders,
        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        'Content-Length': end - start + 1,
      });
      const rs = fs.createReadStream(targetPath, { start, end, highWaterMark: STREAM_CHUNK_SIZE });
      res.on('close', () => rs.destroy());
      rs.pipe(res);
      return;
    }

    const headers = {
      ...commonFileHeaders,
      'Content-Length': stat.size,
    };
    if (forceDownload) {
      headers['Content-Disposition'] = `attachment; filename="${encodeURIComponent(fileName)}"`;
    }

    res.writeHead(200, headers);
    if (req.method === 'HEAD' || stat.size === 0) {
      return res.end();
    }
    const rs = fs.createReadStream(targetPath, { highWaterMark: STREAM_CHUNK_SIZE });
    res.on('close', () => rs.destroy());
    rs.pipe(res);
    return;
  }

  // 9. API: Catatan / Clipboard Bersama
  if (pathname === '/api/notes') {
    if (req.method === 'GET') {
      try {
        const notes = JSON.parse(fs.readFileSync(NOTES_FILE, 'utf8'));
        return sendJson(res, 200, { notes });
      } catch {
        return sendJson(res, 200, { notes: [] });
      }
    }

    if (req.method === 'POST') {
      try {
        const data = await readJsonBody(req);
        if (!data.text || !data.text.trim()) {
          return sendJson(res, 400, { error: 'Pesan tidak boleh kosong' });
        }
        const notes = JSON.parse(fs.readFileSync(NOTES_FILE, 'utf8'));
        const newNote = {
          id: Date.now(),
          author: (data.author || clientIp || 'Anonim').slice(0, 40),
          text: data.text.trim().slice(0, 2000),
          time: new Date().toLocaleString('id-ID'),
        };
        notes.unshift(newNote);
        const trimmed = notes.slice(0, 30);
        fs.writeFileSync(NOTES_FILE, JSON.stringify(trimmed, null, 2), 'utf8');
        return sendJson(res, 200, { notes: trimmed });
      } catch (err) {
        return sendJson(res, 400, { error: err.message });
      }
    }
  }

  // 10. File Statis dari folder public/ (Dashboard Cloud)
  let filePath = pathname === '/' ? path.join(PUBLIC_DIR, 'index.html') : path.resolve(PUBLIC_DIR, pathname.replace(/^\/+/, ''));
  if (filePath !== PUBLIC_DIR && !filePath.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('403 - Akses Ditolak');
  }

  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, { ...SECURITY_HEADERS, 'Content-Type': contentType });
    const rs = fs.createReadStream(filePath, { highWaterMark: STREAM_CHUNK_SIZE });
    res.on('close', () => rs.destroy());
    rs.pipe(res);
    return;
  }

  res.writeHead(404, { ...SECURITY_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('404 - Halaman tidak ditemukan');
  } catch (err) {
    console.error('[SERVER ERROR]', err);
    if (!res.headersSent) {
      sendJson(res, 500, { error: 'Terjadi kesalahan internal server' });
    } else {
      try { res.end(); } catch {}
    }
  }
});

server.on('error', (err) => {
  console.error(`[SERVER FATAL] Gagal mendengar pada ${HOST}:${PORT}: ${err.message}`);
  process.exit(1);
});

function gracefulShutdown(sig) {
  console.log(`\n[*] Menerima ${sig}, menutup Linux Cloud Storage Server...`);
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(0), 2500).unref();
}

process.on('SIGINT', () => gracefulShutdown('SIGINT'));
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'));

// Optimasi Socket Timeout agar koneksi idle cepat dibersihkan tanpa memutus upload besar
server.keepAliveTimeout = 4000;
server.headersTimeout = 8000;
server.maxHeadersCount = 40;
server.requestTimeout = 0;
server.timeout = 0;

// Pembersihan sampah memori (GC) berkala setiap 60 detik
setInterval(runGC, 60000).unref();

server.listen(PORT, HOST, () => {
  runGC();
  const nets = getNetworkAddresses();
  const mem = process.memoryUsage();
  console.log('==============================================================');
  console.log('  LINUX CLOUD STORAGE SERVER (MODE ULTRA HEMAT RAM AKTIF)     ');
  console.log('==============================================================');
  console.log(`Status       : ONLINE (Mendengarkan pada ${HOST}:${PORT})`);
  console.log(`RAM Server   : Heap ${(mem.heapUsed / 1024 / 1024).toFixed(2)} MB | Total Proses ${(mem.rss / 1024 / 1024).toFixed(2)} MB`);
  console.log(`Folder Cloud : ${SHARED_DIR}`);
  console.log('--------------------------------------------------------------');
  console.log('AKSES DARI MESIN INI (LOKAL):');
  console.log(`  -> http://localhost:${PORT}`);
  console.log('');
  console.log('AKSES DARI PERANGKAT LAIN DI WIFI / LAN YANG SAMA:');
  if (nets.length === 0) {
    console.log('  -> (Tidak ada koneksi LAN/Wi-Fi yang terdeteksi saat ini)');
  } else {
    nets.forEach((n) => {
      console.log(`  -> ${n.url}   [${n.interface} - IP: ${n.address}]`);
    });
  }
  console.log('==============================================================');
  console.log('Tekan Ctrl + C untuk menghentikan server.');
});
