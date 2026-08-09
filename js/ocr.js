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

// ---------------------------------------------------------------------------
// ค่าคงที่ / heuristic constants
//
// แนวคิดหลัก: ใบเสร็จส่วนใหญ่แบ่งเป็น 3 ส่วนตามลำดับ
//   [หัวร้าน: ชื่อร้าน/วันเวลา/โต๊ะ] -> (เส้นคั่น ----/====/....) ->
//   [รายการอาหาร: จำนวน/ชื่อเมนู/ราคา] -> (เส้นคั่น) ->
//   [สรุปยอด: subtotal/ส่วนลด/ค่าบริการ/VAT/ยอดรวม]
// ถ้ามีเส้นคั่นจะใช้ตัดส่วนตามนั้น ถ้าไม่มีจะใช้คำสำคัญกรองบรรทัดที่ไม่ใช่รายการออกแทน
// ---------------------------------------------------------------------------

// ตัวเลขราคาท้ายบรรทัด/ท้ายข้อความ: รองรับ 120, 120.00, 1,200.00
const PRICE_REGEX = /([0-9]+(?:,[0-9]{3})*(?:\.[0-9]{1,2})?)\s*$/;

// คำที่บ่งบอกว่าบรรทัดนี้เป็นข้อมูลร้าน/โต๊ะ/ที่อยู่ ไม่ใช่รายการอาหาร
const SKIP_WORDS = [
  'table', 'queue', 'no.', 'tel', 'โทร', 'ที่อยู่', 'โต๊ะ', 'คิว', 'เลขที่',
  'thank', 'ขอบคุณ', 'receipt', 'ใบเสร็จ',
];

// รูปแบบบรรทัด "สรุปยอด" ท้ายบิล — เรียงจากเฉพาะเจาะจงมากไปน้อย (matchFooterPattern เช็คตามลำดับนี้)
const FOOTER_PATTERNS = [
  { key: 'subtotal', re: /sub[\s-]?total|รวมย่อย|ยอดรวมก่อน/i },
  { key: 'discount', re: /discount|ส่วนลด/i },
  { key: 'serviceCharge', re: /service\s*charge|ค่าบริการ/i },
  { key: 'vat', re: /\bvat\b|ภาษีมูลค่าเพิ่ม|ภาษี/i },
  { key: 'total', re: /grand\s*total|net\s*total|ยอดสุทธิ|ยอดชำระ|ยอดรวมทั้งสิ้น|รวมทั้งสิ้น|\btotal\b|ยอดรวม/i },
];

// คำในหัวตารางรายการ แยกตามหน้าที่ของคอลัมน์ (ใช้ตอนพยายามยึด header เพื่อ split คอลัมน์)
const HEADER_KEYWORDS = {
  qty: ['จำนวน', 'ปริมาณ', 'qty', 'quantity'],
  unitPrice: ['หน่วย', 'unit', 'each'],
  total: ['รวม', 'total', 'จำนวนเงิน', 'sum', 'amount'],
  price: ['ราคา', 'price', 'บาท'],
  name: ['รายการ', 'ชื่อ', 'สินค้า', 'เมนู', 'description', 'item', 'name', 'product', 'menu'],
};

// ---------------------------------------------------------------------------
// ฟังก์ชันช่วยระดับล่าง
// ---------------------------------------------------------------------------

/** บรรทัดที่เป็นเส้นคั่นส่วน (ประกอบด้วย -, =, _, *, ., ~ อย่างน้อย 80% ของความยาว) */
function isDividerLine(line) {
  const compact = line.replace(/\s/g, '');
  if (compact.length < 4) return false;
  const dividerChars = compact.match(/[-=_*.~]/g) || [];
  return dividerChars.length / compact.length >= 0.8;
}

function isSkipLine(line) {
  const lower = line.toLowerCase();
  return SKIP_WORDS.some((w) => lower.includes(w));
}

/** คืน key ของรูปแบบสรุปยอดที่บรรทัดนี้ตรงกับ (ตามลำดับความเฉพาะเจาะจง) หรือ null ถ้าไม่ตรงเลย */
function matchFooterPattern(line) {
  for (const pattern of FOOTER_PATTERNS) {
    if (pattern.re.test(line)) return pattern.key;
  }
  return null;
}

function isNonItemLine(line) {
  return isSkipLine(line) || matchFooterPattern(line) !== null;
}

/** ดึงตัวเลขท้ายบรรทัดออกมาเป็นตัวเลข คืนค่า null ถ้าไม่เจอหรือดูไม่สมเหตุสมผล (<=0 หรือเกิน max) */
function extractTrailingAmount(line, { max = 100000 } = {}) {
  const match = line.match(PRICE_REGEX);
  if (!match) return null;
  const value = parseFloat(match[1].replace(/,/g, ''));
  if (!isFinite(value) || value <= 0 || value > max) return null;
  return { value, matchIndex: match.index };
}

/** ดึงจำนวน (qty) ออกจากชื่อรายการ รองรับรูปแบบ "2x ชื่อ", "x2 ชื่อ", "ชื่อ 2x", "ชื่อ x2" */
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
      if (qty > 0 && qty < 100) return { qty, name: m[nameGroup].trim() };
    }
  }
  return { qty: 1, name: rawName };
}

/** ตัดจุดไข่ปลา/เส้นคั่นท้ายชื่อรายการออก เช่น "ต้มยำกุ้ง .... 180" -> "ต้มยำกุ้ง" */
function cleanName(name) {
  return name.replace(/[.\-_·•\s]{2,}$/, '').trim();
}

/** แยกบรรทัดเป็น "คอลัมน์" โดยถือว่าช่องว่าง 2 ตัวขึ้นไป (หรือ tab) คือขอบคอลัมน์ */
function splitColumns(line) {
  return line.split(/\s{2,}|\t+/).map((s) => s.trim()).filter(Boolean);
}

function classifyHeaderColumn(label) {
  const l = label.toLowerCase();
  if (HEADER_KEYWORDS.qty.some((k) => l.includes(k))) return 'qty';
  if (HEADER_KEYWORDS.unitPrice.some((k) => l.includes(k))) return 'unitPrice';
  if (HEADER_KEYWORDS.total.some((k) => l.includes(k)) && !HEADER_KEYWORDS.name.some((k) => l.includes(k))) return 'total';
  if (HEADER_KEYWORDS.price.some((k) => l.includes(k))) return 'price';
  if (HEADER_KEYWORDS.name.some((k) => l.includes(k))) return 'name';
  return null;
}

/**
 * พยายามหาบรรทัด "หัวตาราง" ของลิสรายการในไม่กี่บรรทัดแรกของส่วนรายการอาหาร
 * (เช่น "รายการ    จำนวน    ราคา") เพื่อรู้ตำแหน่งคอลัมน์ไว้ช่วย split บรรทัดข้อมูลถัดไปให้แม่นขึ้น
 * คืนค่า null ถ้าหาไม่เจอ (ใบเสร็จจำนวนมากไม่มีหัวตารางชัดเจนแบบนี้ ต้องใช้ fallback แทน)
 */
function detectHeaderRow(lines) {
  for (let i = 0; i < Math.min(lines.length, 3); i++) {
    const line = lines[i];
    if (/\d\s*$/.test(line)) continue; // หัวตารางไม่ควรลงท้ายด้วยตัวเลข (นั่นคือแถวข้อมูลจริง ไม่ใช่หัว)
    const cols = splitColumns(line);
    if (cols.length < 2) continue;
    const roles = cols.map(classifyHeaderColumn);
    const matchedCount = roles.filter(Boolean).length;
    if (matchedCount >= 2 && roles.includes('name')) {
      return { lineIndex: i, columnCount: cols.length, roles };
    }
  }
  return null;
}

/**
 * หาช่วงบรรทัดที่เป็น "รายการอาหาร" (body) จากเส้นคั่นที่เจอ:
 * - ไม่มีเส้นคั่นเลย -> ใช้ทั้งหมด (จะกรองด้วยคำสำคัญอีกชั้นหนึ่งใน isNonItemLine)
 * - เส้นคั่น 1 เส้น -> ฝั่งที่มีคำว่ายอดรวม/ภาษี/ค่าบริการเยอะกว่าคือส่วนท้ายบิล อีกฝั่งคือหัว+รายการ
 * - เส้นคั่น 2 เส้นขึ้นไป -> เส้นแรกคือขอบหัว/รายการ เส้นสุดท้ายคือขอบรายการ/ท้ายบิล
 */
function findBodyRange(lines) {
  const dividerIdx = [];
  lines.forEach((l, i) => { if (isDividerLine(l)) dividerIdx.push(i); });

  if (dividerIdx.length === 0) return { start: 0, end: lines.length };

  if (dividerIdx.length === 1) {
    const d = dividerIdx[0];
    const before = lines.slice(0, d);
    const after = lines.slice(d + 1);
    const beforeFooterHits = before.filter((l) => matchFooterPattern(l)).length;
    const afterFooterHits = after.filter((l) => matchFooterPattern(l)).length;
    return afterFooterHits >= beforeFooterHits
      ? { start: 0, end: d }
      : { start: d + 1, end: lines.length };
  }

  const first = dividerIdx[0];
  const last = dividerIdx[dividerIdx.length - 1];
  return { start: first + 1, end: last };
}

/** สแกนทุกบรรทัดของใบเสร็จ หายอดสรุปท้ายบิล (subtotal / ส่วนลด / ค่าบริการ / VAT / ยอดรวม) */
function extractFooterTotals(lines) {
  const totals = {};
  for (const line of lines) {
    const key = matchFooterPattern(line);
    if (!key || totals[key] != null) continue; // เอาค่าที่เจอครั้งแรกของแต่ละประเภทพอ
    const amount = extractTrailingAmount(line, { max: 10000000 });
    if (amount) totals[key] = amount.value;
  }
  return totals;
}

/**
 * เทียบยอดรวมที่พาร์สรายการอาหารได้ กับยอดที่ระบุไว้ในใบเสร็จ (ถ้าอ่านเจอ)
 * ใช้ subtotal ก่อนถ้ามี ไม่มีค่อยใช้ total (เฉพาะกรณีไม่มีส่วนลด/ค่าบริการ/VAT แยก เพราะงั้น total จะไม่เท่ากับยอดอาหารเปล่า ๆ)
 * ยอมรับความคลาดเคลื่อนได้ไม่เกิน 1 บาท (เผื่อปัดเศษ/อ่านตัวเลขคลาดเล็กน้อย)
 */
function reconcileTotals(items, footerTotals) {
  const itemsSum = items.reduce((sum, it) => sum + it.qty * it.price, 0);

  let expected = null;
  let label = null;
  if (footerTotals.subtotal != null) {
    expected = footerTotals.subtotal;
    label = 'subtotal';
  } else if (
    footerTotals.total != null &&
    footerTotals.serviceCharge == null &&
    footerTotals.vat == null &&
    footerTotals.discount == null
  ) {
    expected = footerTotals.total;
    label = 'total';
  }

  if (expected == null) {
    return { checked: false, matches: true, itemsSum, expected: null, diff: 0, label: null };
  }

  const diff = Math.abs(itemsSum - expected);
  return { checked: true, matches: diff <= 1, itemsSum, expected, diff, label };
}

// ---------------------------------------------------------------------------
// ตัวแยกรายการต่อบรรทัด: แบบยึดคอลัมน์ตามหัวตาราง และแบบเดา (fallback)
// ---------------------------------------------------------------------------

/** แยกรายการจากบรรทัดข้อมูลโดยยึดตำแหน่งคอลัมน์จากหัวตารางที่เจอ คืน null ถ้าข้อมูลไม่ครบพอจะสร้างรายการ */
function parseItemFromColumns(cols, headerInfo) {
  const byRole = {};
  headerInfo.roles.forEach((role, i) => { if (role) byRole[role] = cols[i]; });

  const name = byRole.name ? cleanName(byRole.name) : null;
  if (!name) return null;

  let qty = 1;
  if (byRole.qty != null) {
    const q = parseInt(String(byRole.qty).replace(/[^\d]/g, ''), 10);
    if (q > 0) qty = q;
  }

  let price = null;
  if (byRole.unitPrice != null) {
    const amt = extractTrailingAmount(String(byRole.unitPrice));
    if (amt) price = amt.value;
  } else if (byRole.total != null) {
    const amt = extractTrailingAmount(String(byRole.total), { max: 1000000 });
    if (amt) price = amt.value / qty; // คอลัมน์นี้คือยอดรวมต่อแถว หารด้วยจำนวนกลับมาเป็นราคาต่อหน่วย
  } else if (byRole.price != null) {
    const amt = extractTrailingAmount(String(byRole.price));
    if (amt) price = amt.value;
  }

  if (price == null) return null;
  return { name, qty, price };
}

/** แยกรายการแบบเดา heuristic เดิม: มองหาตัวเลขราคาท้ายบรรทัด แล้วดึง qty จากรูปแบบ "2x ชื่อ" ถ้ามี */
function parseItemFromFreeText(line) {
  const amount = extractTrailingAmount(line);
  if (!amount) return null;

  const rawName = cleanName(line.slice(0, amount.matchIndex));
  const extracted = extractQty(rawName);
  const name = extracted.name || 'รายการที่อ่านไม่ชัด';

  return { name, qty: extracted.qty, price: amount.value };
}

// ---------------------------------------------------------------------------
// จุดเข้าหลัก
// ---------------------------------------------------------------------------

/**
 * แปลงข้อความดิบจาก OCR ให้เป็นรายการอาหารแบบมีโครงสร้าง พร้อมยอดสรุปท้ายบิล (ถ้าอ่านได้)
 * และผลเทียบยอด (reconciliation) ว่ารายการที่พาร์สได้รวมกันตรงกับยอดที่พิมพ์ไว้ในใบเสร็จหรือไม่
 *
 * ขั้นตอน:
 * 1. หาเส้นคั่นส่วน (----/====/....) ถ้ามี ใช้ตัดหา "ส่วนรายการอาหาร" (body) ออกจากหัวร้าน/ท้ายบิล
 *    ถ้าไม่มีเส้นคั่นเลย จะใช้ทั้งข้อความ แล้วกรองด้วยคำสำคัญ (skip words / รูปแบบสรุปยอด) แทน
 * 2. ในส่วนรายการอาหาร ถ้าเจอบรรทัด "หัวตาราง" (เช่น "รายการ จำนวน ราคา") จะยึดคอลัมน์ตามหัวตารางนั้น
 *    ถ้าไม่เจอหัวตาราง จะเดาจากรูปแบบ "ชื่อ ... ราคา" ท้ายบรรทัดแบบเดิม (ใกล้เคียงที่สุดที่ทำได้)
 * 3. สแกนทุกบรรทัดหายอดสรุป (subtotal/ส่วนลด/ค่าบริการ/VAT/ยอดรวม) แล้วเทียบกับยอดรวมที่พาร์สรายการได้
 *
 * @returns {{ items: Array<{name:string, qty:number, price:number}>, footerTotals: object, reconciliation: object }}
 */
export function parseReceiptLines(rawText) {
  const lines = (rawText || '')
    .split('\n')
    .map((l) => l.trim())
    .filter(Boolean);

  const footerTotals = extractFooterTotals(lines);

  const { start, end } = findBodyRange(lines);
  const bodyLines = lines.slice(start, end).filter((l) => !isDividerLine(l));

  const headerInfo = detectHeaderRow(bodyLines);
  const dataLines = headerInfo
    ? bodyLines.filter((_, i) => i !== headerInfo.lineIndex)
    : bodyLines;

  const items = [];
  for (const line of dataLines) {
    if (isNonItemLine(line)) continue;

    let parsed = null;
    if (headerInfo) {
      const cols = splitColumns(line);
      if (cols.length === headerInfo.columnCount) {
        parsed = parseItemFromColumns(cols, headerInfo);
      }
    }
    if (!parsed) {
      parsed = parseItemFromFreeText(line);
    }
    if (parsed) items.push(parsed);
  }

  const reconciliation = reconcileTotals(items, footerTotals);

  return { items, footerTotals, reconciliation };
}
