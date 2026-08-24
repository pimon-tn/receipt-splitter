// ocr.js
// ใช้ Tesseract.js (โหลดจาก CDN ในหน้า index.html) เพื่ออ่านตัวอักษรจากรูปใบเสร็จ
// ทำงานทั้งหมดในเบราว์เซอร์ของผู้ใช้ ไม่มีการอัปโหลดรูปไปที่ไหน

/**
 * อ่านข้อความจากไฟล์รูปภาพ
 * ประมวลผลรูปก่อน (grayscale + binarize ด้วย Otsu's method) เพื่อให้ Tesseract อ่านแม่นขึ้น
 * แล้วอ่านผ่าน worker ที่ตั้ง PSM/OEM เอง (ไม่ใช้ Tesseract.recognize() ตัวช่วยแบบเดิมที่ deprecate
 * ไปแล้ว และไม่รองรับการปรับ parameter พวกนี้)
 * @param {File} imageFile
 * @param {(status:string, progress:number)=>void} onProgress
 * @returns {Promise<string>} ข้อความดิบที่อ่านได้
 */
export async function recognizeReceiptText(imageFile, onProgress) {
  if (!window.Tesseract) {
    throw new Error('ไม่พบไลบรารี Tesseract.js กรุณาตรวจสอบการเชื่อมต่ออินเทอร์เน็ต');
  }

  let image = imageFile;
  try {
    image = await preprocessReceiptImage(imageFile);
  } catch (err) {
    // เบราว์เซอร์เก่าบางตัวอาจไม่รองรับ createImageBitmap/canvas API บางส่วน — อ่านรูปต้นฉบับต่อไปได้ ไม่บล็อกฟีเจอร์
    console.warn('ประมวลผลรูปก่อน OCR ไม่สำเร็จ ใช้รูปต้นฉบับแทน', err);
  }

  // ค่า enum ตัวเลขจริง (LSTM_ONLY=1, SINGLE_BLOCK=6) ตรงกับที่ Tesseract.js เองใช้ — กันไว้เผื่อ
  // UMD build ที่โหลดจาก CDN ไม่ได้ expose window.Tesseract.OEM/PSM ให้ใช้ตรง ๆ
  const oemLstmOnly = window.Tesseract.OEM?.LSTM_ONLY ?? 1;
  const psmSingleBlock = window.Tesseract.PSM?.SINGLE_BLOCK ?? 6;

  const worker = await window.Tesseract.createWorker('eng+tha', oemLstmOnly, {
    logger: (m) => {
      if (onProgress && m.status) {
        onProgress(m.status, m.progress ?? 0);
      }
    },
  });

  try {
    // เนื้อหาใบเสร็จเป็นข้อความไหลต่อกันในบล็อกเดียว (ไม่ใช่หน้าเอกสารหลายคอลัมน์จริง) — SINGLE_BLOCK
    // ช่วยลดปัญหา Tesseract เดา layout ผิดเมื่อรูปเอียง/ไม่ชัด เทียบกับ PSM แบบ AUTO ที่เป็นค่า default
    await worker.setParameters({ tessedit_pageseg_mode: psmSingleBlock });
    const result = await worker.recognize(image);
    return result?.data?.text ?? '';
  } finally {
    await worker.terminate();
  }
}

/**
 * ประมวลผลรูปใบเสร็จก่อนส่งเข้า OCR: ขยายรูปที่เล็กเกินไป, แปลง grayscale, binarize (ดำ-ขาวล้วน)
 * ด้วย threshold ที่คำนวณอัตโนมัติจาก Otsu's method — เป็นขั้นที่ช่วยความแม่นยำของ OCR มากที่สุด
 * เพราะรูปถ่ายใบเสร็จจากมือถือมักมีปัญหาแสง/contrast/กระดาษซีดจากเครื่องพิมพ์ความร้อน
 * @param {File} file
 * @returns {Promise<Blob>}
 */
async function preprocessReceiptImage(file) {
  const bitmap = await createImageBitmap(file);

  // ขยายรูปที่ด้านยาวสุดเล็กเกินไป (ตัวอักษรเตี้ยเกินไป Tesseract อ่านแม่นน้อยกว่า) ไม่ย่อรูปใหญ่ลง
  const MIN_LONG_SIDE = 1600;
  const MAX_SCALE = 2;
  const longSide = Math.max(bitmap.width, bitmap.height);
  const scale = longSide < MIN_LONG_SIDE ? Math.min(MAX_SCALE, MIN_LONG_SIDE / longSide) : 1;

  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d');
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  binarizeInPlace(imageData.data);
  ctx.putImageData(imageData, 0, 0);

  return await new Promise((resolve, reject) => {
    canvas.toBlob((blob) => (blob ? resolve(blob) : reject(new Error('แปลงรูปเป็น Blob ไม่สำเร็จ'))), 'image/png');
  });
}

/** แปลง pixel data (RGBA ต่อเนื่อง) เป็น grayscale แล้ว binarize ด้วย threshold จาก Otsu's method (แก้ไข data ในตำแหน่งเดิม) */
function binarizeInPlace(data) {
  const grayscale = new Uint8ClampedArray(data.length / 4);
  const histogram = new Array(256).fill(0);

  for (let i = 0; i < data.length; i += 4) {
    // luminance formula มาตรฐาน (ITU-R BT.601)
    const gray = Math.round(0.299 * data[i] + 0.587 * data[i + 1] + 0.114 * data[i + 2]);
    grayscale[i / 4] = gray;
    histogram[gray]++;
  }

  const threshold = computeOtsuThreshold(histogram);

  for (let i = 0; i < grayscale.length; i++) {
    const value = grayscale[i] > threshold ? 255 : 0;
    const offset = i * 4;
    data[offset] = data[offset + 1] = data[offset + 2] = value;
    // ช่อง alpha (data[offset + 3]) ไม่แตะ
  }
}

/**
 * คำนวณ threshold สำหรับแบ่งภาพเป็นดำ-ขาวด้วย Otsu's method (เลือกจุดแบ่งที่ variance ระหว่าง
 * 2 กลุ่มมากที่สุด) แยกออกมาเป็น pure function ต่างหากเพื่อให้ unit test ได้โดยไม่ต้องพึ่ง canvas/DOM
 * @param {number[]} histogram อาร์เรย์ 256 ช่อง นับจำนวนพิกเซลของแต่ละค่าความสว่าง (0-255)
 * @returns {number} threshold (0-255)
 */
export function computeOtsuThreshold(histogram) {
  const total = histogram.reduce((sum, count) => sum + count, 0);
  if (total === 0) return 128;

  let sumAll = 0;
  for (let i = 0; i < 256; i++) sumAll += i * histogram[i];

  let sumB = 0;
  let weightB = 0;
  let maxVariance = 0;
  let threshold = 0;

  for (let t = 0; t < 256; t++) {
    weightB += histogram[t];
    if (weightB === 0) continue;
    const weightF = total - weightB;
    if (weightF === 0) break;

    sumB += t * histogram[t];
    const meanB = sumB / weightB;
    const meanF = (sumAll - sumB) / weightF;
    const variance = weightB * weightF * (meanB - meanF) ** 2;

    if (variance > maxVariance) {
      maxVariance = variance;
      threshold = t;
    }
  }

  return threshold;
}

// ---------------------------------------------------------------------------
// ค่าคงที่ / heuristic constants
//
// แนวคิดหลัก: ใบเสร็จส่วนใหญ่แบ่งเป็น 3 ส่วนตามลำดับ
//   [หัวร้าน: ชื่อร้าน/วันเวลา/โต๊ะ] -> (เส้นคั่น ----/====/....) ->
//   [รายการอาหาร: จำนวน/ชื่อเมนู/ราคา] -> (เส้นคั่น) ->
//   [สรุปยอด: subtotal/ส่วนลด/ค่าบริการ/VAT/ยอดรวม]
// ถ้ามีเส้นคั่นจะใช้ตัดส่วนตามนั้น ถ้าไม่มีจะใช้บรรทัดว่างช่วยตัดหัว/ท้ายบิล
// แล้วจึงใช้คำสำคัญกรองบรรทัดที่ไม่ใช่รายการออกอีกชั้นหนึ่ง
// ---------------------------------------------------------------------------

// ตัวเลขราคาท้ายบรรทัด/ท้ายข้อความ: รองรับ 120, 120.00, 1,200.00
const PRICE_REGEX = /([0-9]+(?:,[0-9]{3})*(?:\.[0-9]{1,2})?)\s*$/;

// คำที่บ่งบอกว่าบรรทัดนี้เป็นข้อมูลร้าน/โต๊ะ/ที่อยู่/การชำระเงิน ไม่ใช่รายการอาหาร
const SKIP_WORDS = [
  'table', 'queue', 'no.', 'tel', 'โทร', 'ที่อยู่', 'โต๊ะ', 'คิว', 'เลขที่',
  'thank', 'ขอบคุณ', 'receipt', 'ใบเสร็จ', 'เงินสด', 'เงินทอน', 'cash', 'change',
];

// รูปแบบบรรทัด "สรุปยอด" ท้ายบิล — เรียงจากเฉพาะเจาะจงมากไปน้อย (matchFooterPattern เช็คตามลำดับนี้)
const FOOTER_PATTERNS = [
  { key: 'subtotal', re: /sub[\s-]?total|รวมย่อย|ยอดรวมก่อน/i },
  { key: 'discount', re: /discount|ส่วนลด/i },
  { key: 'serviceCharge', re: /service\s*charge|ค่าบริการ/i },
  { key: 'vat', re: /\bvat\b|ภาษีมูลค่าเพิ่ม|ภาษี/i },
  { key: 'total', re: /grand\s*total|net\s*total|ยอดสุทธิ|ยอดชำระ|ยอดรวมทั้งสิ้น|รวมทั้งสิ้น|รวมมูลค่า|\btotal\b|ยอดรวม/i },
];

// คำในหัวตารางรายการ แยกตามหน้าที่ของคอลัมน์ (ใช้ตอนพยายามยึด header เพื่อ split คอลัมน์)
const HEADER_KEYWORDS = {
  qty: ['จำนวน', 'ปริมาณ', 'qty', 'quantity'],
  unitPrice: ['หน่วย', 'unit', 'each'],
  total: ['รวม', 'total', 'จำนวนเงิน', 'sum', 'amount', 'amt'],
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

/**
 * รวมตัวอักษรไทย 2 ตัวที่มีแต่ช่องว่างคั่นกลับเป็นคำเดิม เช่น "ค ิ ว" -> "คิว"
 * OCR (โดยเฉพาะ Tesseract อ่านภาษาไทย) มักแทรกช่องว่างระหว่างตัวอักษรไทยแทบทุกตัวเวลาอ่านพลาด
 * ทำให้ SKIP_WORDS/FOOTER_PATTERNS ที่ match แบบ substring/regex ตรง ๆ ไม่เจอคำเลย
 * วนซ้ำจนสตริงนิ่ง เพราะ regex เดียวไม่ครอบคลุมโซ่ตัวอักษรที่เว้นวรรคติดกันหลายตัว (overlapping match)
 * จงใจจำกัดแค่ "ตัวอักษรไทยคั่นด้วยวรรค" ไม่แตะวรรคระหว่างคำอังกฤษ/ตัวเลข เพื่อไม่ทำให้ \b word
 * boundary ของ pattern อื่น (เช่น /\bvat\b/) พังไปด้วย
 */
function collapseThaiCharSpacing(line) {
  let prev;
  let result = line;
  do {
    prev = result;
    result = result.replace(/([฀-๿])\s+([฀-๿])/g, '$1$2');
  } while (result !== prev);
  return result;
}

function isSkipLine(line) {
  const lower = collapseThaiCharSpacing(line).toLowerCase();
  return SKIP_WORDS.some((w) => lower.includes(w));
}

/** คืน key ของรูปแบบสรุปยอดที่บรรทัดนี้ตรงกับ (ตามลำดับความเฉพาะเจาะจง) หรือ null ถ้าไม่ตรงเลย */
function matchFooterPattern(line) {
  const collapsed = collapseThaiCharSpacing(line);
  for (const pattern of FOOTER_PATTERNS) {
    if (pattern.re.test(collapsed)) return pattern.key;
  }
  return null;
}

function isNonItemLine(line) {
  return isSkipLine(line) || matchFooterPattern(line) !== null;
}

/** บรรทัดที่มีลักษณะเป็นรายการอาหาร: ไม่ใช่หัว/ท้ายบิล และมีราคาที่อ่านได้ท้ายบรรทัด */
function isPotentialItemLine(line) {
  return Boolean(line) && !isDividerLine(line) && !isNonItemLine(line) && extractTrailingAmount(line) !== null;
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

  if (dividerIdx.length === 0) return findBodyRangeFromBlankLines(lines);

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

/**
 * เมื่อไม่มีเส้นคั่น ใช้บรรทัดว่างช่วยระบุขอบเขตรายการอาหาร:
 * - หาแถวแรก/สุดท้ายที่ดูเป็นรายการจากราคาท้ายบรรทัด
 * - ตัดทุกอย่างก่อนบรรทัดว่างที่อยู่ก่อนรายการแรก (มักเป็นชื่อร้าน/เลขโต๊ะ)
 * - ตัดทุกอย่างหลังบรรทัดว่างที่อยู่หลังรายการสุดท้าย (มักเป็นยอดสรุป/คำขอบคุณ)
 *
 * บรรทัดว่างระหว่างเมนูไม่ทำให้เมนูหาย เพราะใช้รายการแรกและรายการสุดท้ายเป็นขอบเขต
 */
function findBodyRangeFromBlankLines(lines) {
  const itemIndexes = [];
  lines.forEach((line, index) => {
    if (isPotentialItemLine(line)) itemIndexes.push(index);
  });

  if (itemIndexes.length === 0) return { start: 0, end: lines.length };

  const firstItem = itemIndexes[0];
  const lastItem = itemIndexes[itemIndexes.length - 1];
  let start = 0;
  let end = lines.length;

  for (let i = firstItem - 1; i >= 0; i--) {
    if (!lines[i]) {
      start = i + 1;
      break;
    }
  }

  for (let i = lastItem + 1; i < lines.length; i++) {
    if (!lines[i]) {
      end = i;
      break;
    }
  }

  return { start, end };
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
 *    ถ้าไม่มีเส้นคั่น จะใช้บรรทัดว่างก่อน/หลังรายการที่มีราคาเป็นขอบเขต แล้วกรองด้วยคำสำคัญอีกชั้นหนึ่ง
 * 2. ในส่วนรายการอาหาร ถ้าเจอบรรทัด "หัวตาราง" (เช่น "รายการ จำนวน ราคา") จะยึดคอลัมน์ตามหัวตารางนั้น
 *    ถ้าไม่เจอหัวตาราง จะเดาจากรูปแบบ "ชื่อ ... ราคา" ท้ายบรรทัดแบบเดิม (ใกล้เคียงที่สุดที่ทำได้)
 * 3. สแกนทุกบรรทัดหายอดสรุป (subtotal/ส่วนลด/ค่าบริการ/VAT/ยอดรวม) แล้วเทียบกับยอดรวมที่พาร์สรายการได้
 *
 * @returns {{ items: Array<{name:string, qty:number, price:number}>, footerTotals: object, reconciliation: object }}
 */
export function parseReceiptLines(rawText) {
  const lines = (rawText || '')
    .split('\n')
    .map((l) => l.trim());

  const footerTotals = extractFooterTotals(lines);

  const { start, end } = findBodyRange(lines);
  const bodyLines = lines.slice(start, end).filter((l) => l && !isDividerLine(l));

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
