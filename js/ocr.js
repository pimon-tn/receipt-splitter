// ocr.js
// ใช้ Tesseract.js (โหลดจาก CDN ในหน้า index.html) เพื่ออ่านตัวอักษรจากรูปใบเสร็จ
// ทำงานทั้งหมดในเบราว์เซอร์ของผู้ใช้ ไม่มีการอัปโหลดรูปไปที่ไหน

/**
 * อ่านข้อความจากไฟล์รูปภาพ
 * @param {File} imageFile
 * @param {(status:string, progress:number)=>void} onProgress
 * @returns {Promise<string>} ข้อความดิบที่อ่านได้
 */
export async function recognizeReceiptText(imageFile, onProgress) {
  if (!window.Tesseract) {
    throw new Error('ไม่พบไลบรารี Tesseract.js กรุณาตรวจสอบการเชื่อมต่ออินเทอร์เน็ต');
  }

  const result = await window.Tesseract.recognize(imageFile, 'eng+tha', {
    logger: (m) => {
      if (onProgress && m.status) {
        onProgress(m.status, m.progress ?? 0);
      }
    },
  });

  return result?.data?.text ?? '';
}

/**
 * แปลงข้อความดิบจาก OCR ให้เป็นรายการ [{name, price, qty}]
 * ใช้หลักการ heuristic ง่าย ๆ: มองหาตัวเลขราคาที่ท้ายบรรทัด
 * เนื่องจากใบเสร็จมีรูปแบบหลากหลายมาก ผลลัพธ์นี้เป็นแค่ "ค่าเดา" เริ่มต้น
 * ผู้ใช้ควรตรวจสอบและแก้ไขก่อนใช้จริงเสมอ
 */
export function parseReceiptLines(rawText) {
  const lines = rawText
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  const items = [];
  // ตัวเลขราคา: รองรับ 120, 120.00, 1,200.00 ที่อยู่ท้ายบรรทัด
  // ใช้ [0-9]+ (ไม่ใช่ {1,3}) เพื่อจับตัวเลขยาว ๆ ที่ไม่มีคอมมาแบ่งหลักด้วย เช่น "999999"
  // ไม่งั้นจะจับได้แค่ 3 ตัวท้าย ("999") ทำให้ตัวกรองราคาที่ดูไม่สมเหตุสมผล (> 100,000) หลุดไป
  const priceRegex = /([0-9]+(?:,[0-9]{3})*(?:\.[0-9]{1,2})?)\s*$/;
  // คำที่มักไม่ใช่รายการอาหาร ให้ข้ามบรรทัดนั้นไปเลย
  const skipWords = [
    'total', 'subtotal', 'vat', 'tax', 'service', 'change', 'cash', 'table', 'queue', 'no.',
    'รวม', 'ยอดรวม', 'ภาษี', 'เงินสด', 'เงินทอน', 'บริการ', 'ใบเสร็จ', 'โต๊ะ', 'คิว', 'เลขที่',
    'ขอบคุณ', 'thank', 'receipt', 'tel', 'โทร', 'ที่อยู่',
  ];

  for (const line of lines) {
    const lower = line.toLowerCase();
    if (skipWords.some((w) => lower.includes(w))) continue;

    const match = line.match(priceRegex);
    if (!match) continue;

    const priceStr = match[1].replace(/,/g, '');
    const price = parseFloat(priceStr);
    if (!isFinite(price) || price <= 0 || price > 100000) continue;

    let name = line.slice(0, match.index).trim();
    // ตัดสัญลักษณ์คั่นท้ายชื่อ เช่น "ต้มยำกุ้ง .... 180"
    name = name.replace(/[.\-_·•\s]{2,}$/, '').trim();

    const { qty, name: cleanName } = extractQty(name);
    items.push({ name: cleanName || 'รายการที่อ่านไม่ชัด', price, qty });
  }

  return items;
}

/**
 * ดึงจำนวน (qty) ออกจากชื่อรายการ รองรับรูปแบบ "2x ชื่อ", "x2 ชื่อ", "ชื่อ 2x", "ชื่อ x2"
 * คืนค่า { qty, name } โดย name คือชื่อที่ตัดตัวเลขจำนวนออกแล้ว
 */
function extractQty(rawName) {
  const patterns = [
    { re: /^(\d+)\s*[xX]\s+(.+)$/, qtyGroup: 1, nameGroup: 2 },
    { re: /^[xX]\s*(\d+)\s+(.+)$/, qtyGroup: 1, nameGroup: 2 },
    { re: /^(.+?)\s+(\d+)\s*[xX]$/, qtyGroup: 2, nameGroup: 1 },
    { re: /^(.+?)\s+[xX]\s*(\d+)$/, qtyGroup: 2, nameGroup: 1 },
  ];
  for (const { re, qtyGroup, nameGroup } of patterns) {
    const m = rawName.match(re);
    if (m) {
      const qty = parseInt(m[qtyGroup], 10);
      if (qty > 0 && qty < 100) {
        return { qty, name: m[nameGroup].trim() };
      }
    }
  }
  return { qty: 1, name: rawName };
}
