// Batasi jumlah thread worker libuv menjadi 2 agar hemat RAM native
process.env.UV_THREADPOOL_SIZE = '2';

const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = process.env.PORT ? parseInt(process.env.PORT, 10) : 8080;
const HOST = '0.0.0.0';

// Ukuran buffer streaming dibatasi 64 KB agar upload/streaming file bergiga-giga tetap hemat RAM
const STREAM_CHUNK_SIZE = 64 * 1024;

const SHARED_DIR = path.join(__dirname, 'shared_files');
const PUBLIC_DIR = path.join(__dirname, 'public');
const NOTES_FILE = path.join(__dirname, 'shared_notes.json');

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

// Pembacaan URL Cloudflared hemat RAM (Hanya membaca 8 KB bagian awal file & menyimpannya di cache)
let cachedTunnelUrl = null;
let lastLogBirthTime = 0;

function getCloudflaredUrl() {
  const logFile = path.join(__dirname, 'cloudflared.log');
  if (!fs.existsSync(logFile)) {
    cachedTunnelUrl = null;
    return null;
  }
  try {
    const stat = fs.statSync(logFile);
    if (cachedTunnelUrl && stat.birthtimeMs === lastLogBirthTime) {
      return cachedTunnelUrl;
    }
    lastLogBirthTime = stat.birthtimeMs;
    const readSize = Math.min(stat.size, 8192);
    if (readSize <= 0) return null;
    const buf = Buffer.allocUnsafe(readSize);
    const fd = fs.openSync(logFile, 'r');
    fs.readSync(fd, buf, 0, readSize, 0);
    fs.closeSync(fd);
    const content = buf.toString('utf8');
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
        addresses.push({
          interface: name,
          address: iface.address,
          netmask: iface.netmask,
          mac: iface.mac,
          url: `http://${iface.address}:${PORT}`,
        });
      }
    }
  }
  return addresses;
}

function resolveSafePath(relPath = '') {
  const cleaned = String(relPath || '')
    .replace(/\\/g, '/')
    .replace(/^\/+/, '');
  const resolved = path.resolve(SHARED_DIR, cleaned);
  if (!resolved.startsWith(SHARED_DIR)) {
    return null;
  }
  return resolved;
}

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
          const matchCat = !categoryFilter || categoryFilter === 'all' || cat === categoryFilter;
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

function sendJson(res, statusCode, data) {
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Connection': 'close',
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

const server = http.createServer(async (req, res) => {
  const parsedUrl = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  const pathname = decodeURIComponent(parsedUrl.pathname);

  const clientIp = (req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').replace('::ffff:', '');

  if (req.method === 'OPTIONS') {
    res.writeHead(204, {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, PUT, DELETE, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, X-File-Name, X-Target-Folder',
    });
    return res.end();
  }

  // 1. API: Info Sistem, Penggunaan RAM Proses Server, Jaringan & Cloud Storage
  if (pathname === '/api/info' && req.method === 'GET') {
    const totalMem = os.totalmem();
    const freeMem = os.freemem();
    const procMem = process.memoryUsage();
    return sendJson(res, 200, {
      hostname: os.hostname(),
      platform: `${os.type()} ${os.release()} (${os.arch()})`,
      uptimeSeconds: Math.floor(os.uptime()),
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
      publicTunnelUrl: getCloudflaredUrl(),
      storage: getStorageStats(),
      serverTime: new Date().toLocaleString('id-ID'),
    });
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

  // 6. API: Upload File Hemat RAM (Buffer Streaming 64 KB)
  if (pathname === '/api/upload' && req.method === 'POST') {
    const rawFilename = req.headers['x-file-name'] || parsedUrl.searchParams.get('name') || `file_${Date.now()}.bin`;
    const rawFolder = req.headers['x-target-folder'] || parsedUrl.searchParams.get('folder') || '/';
    const safeName = sanitizeName(decodeURIComponent(rawFilename));
    const folderAbs = resolveSafePath(decodeURIComponent(rawFolder));

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

  // 7. API: Hapus File atau Folder
  if ((pathname === '/api/item' || pathname.startsWith('/api/files/')) && req.method === 'DELETE') {
    const relTarget = pathname === '/api/item'
      ? parsedUrl.searchParams.get('path')
      : pathname.replace('/api/files/', '');
    const targetAbs = resolveSafePath(relTarget);

    if (!targetAbs || targetAbs === SHARED_DIR || !fs.existsSync(targetAbs)) {
      return sendJson(res, 404, { error: 'Item tidak ditemukan' });
    }

    try {
      fs.rmSync(targetAbs, { recursive: true, force: true });
      invalidateStorageCache();
      runGC();
      return sendJson(res, 200, { message: 'Berhasil dihapus' });
    } catch (err) {
      return sendJson(res, 500, { error: err.message });
    }
  }

  // 8. Streaming, Preview & Download File Hemat RAM (64 KB Chunk + HTTP 206 Range)
  if (pathname.startsWith('/files/') && req.method === 'GET') {
    const relFile = pathname.slice('/files'.length);
    const targetPath = resolveSafePath(relFile);

    if (!targetPath || !fs.existsSync(targetPath) || !fs.statSync(targetPath).isFile()) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('404 - File tidak ditemukan');
    }

    const ext = path.extname(targetPath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    const stat = fs.statSync(targetPath);
    const forceDownload = parsedUrl.searchParams.get('download') === '1';
    const fileName = path.basename(targetPath);

    const range = req.headers.range;
    if (range && !forceDownload) {
      const parts = range.replace(/bytes=/, '').split('-');
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;

      if (start >= stat.size || end >= stat.size) {
        res.writeHead(416, { 'Content-Range': `bytes */${stat.size}` });
        return res.end();
      }

      res.writeHead(206, {
        'Content-Range': `bytes ${start}-${end}/${stat.size}`,
        'Accept-Ranges': 'bytes',
        'Content-Length': end - start + 1,
        'Content-Type': contentType,
      });
      fs.createReadStream(targetPath, { start, end, highWaterMark: STREAM_CHUNK_SIZE }).pipe(res);
      return;
    }

    const headers = {
      'Content-Type': contentType,
      'Content-Length': stat.size,
      'Accept-Ranges': 'bytes',
    };
    if (forceDownload) {
      headers['Content-Disposition'] = `attachment; filename="${encodeURIComponent(fileName)}"`;
    }

    res.writeHead(200, headers);
    fs.createReadStream(targetPath, { highWaterMark: STREAM_CHUNK_SIZE }).pipe(res);
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
  let filePath = pathname === '/' ? path.join(PUBLIC_DIR, 'index.html') : path.join(PUBLIC_DIR, pathname);
  if (!filePath.startsWith(PUBLIC_DIR)) {
    res.writeHead(403, { 'Content-Type': 'text/plain; charset=utf-8' });
    return res.end('403 - Akses Ditolak');
  }

  if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
    const ext = path.extname(filePath).toLowerCase();
    const contentType = MIME_TYPES[ext] || 'application/octet-stream';
    res.writeHead(200, { 'Content-Type': contentType });
    fs.createReadStream(filePath, { highWaterMark: STREAM_CHUNK_SIZE }).pipe(res);
    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('404 - Halaman tidak ditemukan');
});

// Optimasi Socket Timeout agar koneksi menggantung tidak memakan RAM
server.keepAliveTimeout = 4000;
server.headersTimeout = 8000;
server.maxHeadersCount = 40;

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
