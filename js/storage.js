// storage.js
// รับผิดชอบเรื่องเดียว: อ่าน/เขียนสถานะบิลลง localStorage ของเบราว์เซอร์
// ไม่มีการส่งข้อมูลออกไปที่เซิร์ฟเวอร์ใด ๆ ทั้งสิ้น

const STORAGE_KEY = 'receipt-splitter:bill';

/**
 * โครงสร้างสถานะเริ่มต้นของบิลใหม่
 */
export function createEmptyBill() {
  return {
    items: [],
    people: [],
    settings: {
      vatEnabled: false,
      vatMode: 'exclusive', // 'exclusive' = ราคายังไม่รวม VAT (บวกเพิ่ม) | 'inclusive' = ราคารวม VAT แล้ว (แยกให้)
      vatPercent: 7,
      serviceEnabled: false,
      servicePercent: 10,
    },
  };
}

export function loadBill() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return createEmptyBill();
    const parsed = JSON.parse(raw);
    const s = parsed.settings || {};

    // รองรับข้อมูลเก่า (เวอร์ชันก่อนมีตัวเลือก VAT รวม/ไม่รวม และเปิด/ปิดค่าบริการ)
    const isLegacy = s.vatEnabled === undefined && s.serviceEnabled === undefined;
    const settings = isLegacy
      ? {
          vatEnabled: (s.vatPercent || 0) > 0,
          vatMode: 'exclusive',
          vatPercent: s.vatPercent || 7,
          serviceEnabled: (s.serviceChargePercent || 0) > 0,
          servicePercent: s.serviceChargePercent || 10,
        }
      : {
          vatEnabled: s.vatEnabled ?? false,
          vatMode: s.vatMode === 'inclusive' ? 'inclusive' : 'exclusive',
          vatPercent: s.vatPercent ?? 7,
          serviceEnabled: s.serviceEnabled ?? false,
          servicePercent: s.servicePercent ?? 10,
        };

    return {
      items: parsed.items || [],
      people: parsed.people || [],
      settings,
    };
  } catch (err) {
    console.warn('โหลดข้อมูลบิลไม่สำเร็จ เริ่มบิลใหม่แทน', err);
    return createEmptyBill();
  }
}

export function saveBill(bill) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(bill));
  } catch (err) {
    console.warn('บันทึกข้อมูลไม่สำเร็จ (พื้นที่จัดเก็บอาจเต็ม)', err);
  }
}

export function clearBill() {
  localStorage.removeItem(STORAGE_KEY);
}

/** สร้าง id สั้น ๆ ที่ไม่ซ้ำ ใช้แทน crypto.randomUUID เผื่อเบราว์เซอร์เก่าไม่รองรับ */
export function cryptoId() {
  if (window.crypto?.randomUUID) return window.crypto.randomUUID();
  return 'id-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}
