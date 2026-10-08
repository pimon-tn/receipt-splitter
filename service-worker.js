// service-worker.js
// แคชไฟล์หลักของแอปไว้ ทำให้เปิดใช้งานได้แม้ไม่มีอินเทอร์เน็ต (ยกเว้นตอนสแกน OCR ครั้งแรก
// ที่ต้องโหลดชุดภาษาจาก CDN) และทำให้เบราว์เซอร์เสนอ "เพิ่มลงหน้าจอโฮม" ได้

const CACHE_NAME = 'receipt-splitter-v21';
const APP_SHELL = [
  './',
  './index.html',
  './manifest.json',
  './css/style.css',
  './js/app.js',
  './js/ui.js',
  './js/storage.js',
  './js/ocr.js',
  './js/splitter.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(CACHE_NAME).then((cache) => cache.addAll(APP_SHELL))
  );
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(keys.filter((k) => k !== CACHE_NAME).map((k) => caches.delete(k)))
    )
  );
  self.clients.claim();
});

self.addEventListener('fetch', (event) => {
  const req = event.request;

  // ไม่แคช request ที่ไปยัง CDN ภายนอก (เช่น tesseract.js, google fonts) ปล่อยให้เบราว์เซอร์จัดการ/แคชเอง
  if (new URL(req.url).origin !== self.location.origin) return;

  if (req.method !== 'GET') return;

  const saveCopy = (res) => {
    if (res.ok) {
      const resClone = res.clone();
      caches.open(CACHE_NAME).then((cache) => cache.put(req, resClone));
    }
    return res;
  };

  // หน้า/CSS/JS: ลองโหลดจากเน็ตก่อนเสมอ เพื่อให้อัปเดตแอปแล้วเครื่องผู้ใช้ได้ของใหม่ทันที
  // (เดิมใช้แคชก่อน ทำให้มือถือค้างโค้ดเก่า) ถ้าออฟไลน์ค่อยใช้ชุดที่แคชไว้
  const url = new URL(req.url);
  const isShell = req.mode === 'navigate' || /\.(html|css|js)$/.test(url.pathname) || url.pathname.endsWith('/');
  if (isShell) {
    event.respondWith(
      fetch(req).then(saveCopy).catch(() => caches.match(req).then((c) => c || caches.match('./index.html')))
    );
    return;
  }

  // ไอคอน/manifest/ไฟล์อื่น ๆ: ใช้แคชก่อน
  event.respondWith(
    caches.match(req).then((cached) => cached || fetch(req).then(saveCopy))
  );
});
