// splitter.js
// ฟังก์ชันคำนวณล้วน ๆ (pure function) ไม่แตะ DOM เพื่อให้อ่านและทดสอบง่าย

/**
 * รวมยอดทั้งบิล: ยอดรวมรายการ, ค่าบริการ, ภาษี, ยอดสุทธิ
 *
 * รองรับ 2 ตัวเลือกที่ผู้ใช้กำหนดได้:
 * - settings.vatEnabled + settings.vatMode: 'exclusive' (ราคายังไม่รวม VAT → บวกเพิ่ม)
 *   หรือ 'inclusive' (ราคารวม VAT แล้ว → แยกยอดภาษีออกมาให้ดู ไม่บวกซ้ำ)
 * - settings.serviceEnabled: มี/ไม่มีค่าบริการ ถ้ามีใช้ settings.servicePercent
 */
export function calcBillTotals(items, settings) {
  const subtotal = items.reduce((sum, it) => sum + it.qty * it.price, 0);

  const vatRate = settings.vatEnabled ? (settings.vatPercent || 0) / 100 : 0;
  const serviceRate = settings.serviceEnabled ? (settings.servicePercent || 0) / 100 : 0;
  const isInclusive = settings.vatEnabled && settings.vatMode === 'inclusive';

  let foodBase, vatOnFood, serviceAmount, vatAmount, grandTotal;

  if (isInclusive) {
    // ราคาที่กรอกไว้รวม VAT แล้ว: แยกฐานราคาก่อน VAT ออกมาก่อน
    foodBase = subtotal / (1 + vatRate);
    vatOnFood = subtotal - foodBase;
    serviceAmount = foodBase * serviceRate;
    const vatOnService = serviceAmount * vatRate;
    vatAmount = vatOnFood + vatOnService;
    grandTotal = foodBase + serviceAmount + vatAmount;
  } else {
    // ราคาที่กรอกไว้ยังไม่รวม VAT (หรือไม่มี VAT เลย): บวกค่าบริการและ VAT เพิ่มตามปกติ
    foodBase = subtotal;
    serviceAmount = foodBase * serviceRate;
    vatAmount = (foodBase + serviceAmount) * vatRate;
    grandTotal = foodBase + serviceAmount + vatAmount;
  }

  return { subtotal, foodBase, serviceAmount, vatAmount, grandTotal };
}

/**
 * หารเท่ากันทุกคน: เอายอดสุทธิทั้งบิลหารด้วยจำนวนคน
 */
export function splitEqual(items, people, settings) {
  const totals = calcBillTotals(items, settings);
  const count = people.length || 1;
  const perPerson = totals.grandTotal / count;

  return {
    totals,
    perPerson: people.map((p) => ({
      personId: p.id,
      name: p.name,
      amount: perPerson,
    })),
  };
}

/**
 * หารตามรายการที่แต่ละคนกิน
 * - ถ้ารายการไหนไม่ได้ระบุคนกิน (consumerIds ว่าง) จะหารเฉลี่ยให้ทุกคนโดยอัตโนมัติ
 * - ค่าบริการและภาษี จะหารตามสัดส่วนยอดอาหารที่แต่ละคนกิน
 */
export function splitItemized(items, people, settings) {
  const totals = calcBillTotals(items, settings);
  const count = people.length || 1;

  const perPersonSubtotal = new Map(people.map((p) => [p.id, 0]));

  for (const item of items) {
    const lineTotal = item.qty * item.price;
    const consumers = item.consumerIds && item.consumerIds.length > 0
      ? item.consumerIds
      : people.map((p) => p.id); // ไม่ระบุ = หารทุกคน

    const share = lineTotal / (consumers.length || count);
    for (const personId of consumers) {
      if (!perPersonSubtotal.has(personId)) continue;
      perPersonSubtotal.set(personId, perPersonSubtotal.get(personId) + share);
    }
  }

  const extraCharges = totals.grandTotal - totals.subtotal;

  const perPerson = people.map((p) => {
    const personSubtotal = perPersonSubtotal.get(p.id) || 0;
    const proportion = totals.subtotal > 0 ? personSubtotal / totals.subtotal : 1 / count;
    const amount = personSubtotal + proportion * extraCharges;
    return {
      personId: p.id,
      name: p.name,
      subtotal: personSubtotal,
      amount,
    };
  });

  return { totals, perPerson };
}

export function formatMoney(n) {
  return (Number.isFinite(n) ? n : 0).toLocaleString('th-TH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}
