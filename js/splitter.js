// splitter.js
// ฟังก์ชันคำนวณล้วน ๆ (pure function) ไม่แตะ DOM เพื่อให้อ่านและทดสอบง่าย

/**
 * รวมยอดทั้งบิล: ยอดรวมรายการ, ค่าบริการ, ภาษี, ยอดสุทธิ
 *
 * ราคาที่กรอกไว้ถือว่ายังไม่รวม VAT เสมอ: บวกค่าบริการก่อน (ถ้าเปิด) แล้วค่อยคิด VAT
 * จากยอดที่รวมค่าบริการแล้ว (ถ้าเปิด settings.vatEnabled)
 * - settings.serviceEnabled: มี/ไม่มีค่าบริการ ถ้ามีใช้ settings.servicePercent
 */
export function calcBillTotals(items, settings) {
  const subtotal = items.reduce((sum, it) => sum + it.qty * it.price, 0);

  const vatRate = settings.vatEnabled ? (settings.vatPercent || 0) / 100 : 0;
  const serviceRate = settings.serviceEnabled ? (settings.servicePercent || 0) / 100 : 0;

  const serviceAmount = subtotal * serviceRate;
  const vatAmount = (subtotal + serviceAmount) * vatRate;
  const grandTotal = subtotal + serviceAmount + vatAmount;

  return { subtotal, serviceAmount, vatAmount, grandTotal };
}

/**
 * ปัดตัวเลขเป็นสตางค์ (2 ทศนิยม) ค่าที่ไม่ใช่ตัวเลขถือเป็น 0
 */
function roundMoney(n) {
  return Math.round((Number.isFinite(n) ? n : 0) * 100) / 100;
}

/**
 * ปัดยอดของแต่ละคนเป็นสตางค์ แล้วเกลี่ยเศษสตางค์ที่เหลือ (จากการปัดลงทุกคนก่อน)
 * ให้คนที่มีเศษทศนิยมมากที่สุดก่อน (largest-remainder method) เพื่อให้ผลรวมของยอดที่
 * ปัดแล้วตรงกับ targetTotal ที่ปัดแล้วเป๊ะ ไม่งั้นยอดที่แสดงต่อคนรวมกันจะไม่เท่ายอดบิลที่แสดง
 */
function distributeRounded(amounts, targetTotal) {
  if (amounts.length === 0) return [];

  const targetCents = Math.round(roundMoney(targetTotal) * 100);
  const rawCents = amounts.map((a) => (Number.isFinite(a) ? a : 0) * 100);
  const flooredCents = rawCents.map((c) => Math.floor(c));
  const flooredSum = flooredCents.reduce((sum, c) => sum + c, 0);

  const order = rawCents
    .map((c, i) => ({ i, frac: c - flooredCents[i] }))
    .sort((a, b) => b.frac - a.frac);

  const resultCents = flooredCents.slice();
  let remainder = targetCents - flooredSum;
  let idx = 0;
  while (remainder !== 0) {
    const slot = order[idx % order.length].i;
    resultCents[slot] += remainder > 0 ? 1 : -1;
    remainder += remainder > 0 ? -1 : 1;
    idx++;
  }

  return resultCents.map((c) => c / 100);
}

/**
 * หารเท่ากันทุกคน: เอายอดสุทธิทั้งบิลหารด้วยจำนวนคน
 * ปัดเศษสตางค์ให้ผลรวมของยอดที่แสดงต่อคนตรงกับยอดสุทธิที่แสดงเป๊ะ
 */
export function splitEqual(items, people, settings) {
  const totals = calcBillTotals(items, settings);
  const count = people.length || 1;
  const rawPerPerson = totals.grandTotal / count;
  const amounts = distributeRounded(people.map(() => rawPerPerson), totals.grandTotal);

  return {
    totals,
    perPerson: people.map((p, i) => ({
      personId: p.id,
      name: p.name,
      amount: amounts[i],
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

  const rawAmounts = people.map((p) => {
    const personSubtotal = perPersonSubtotal.get(p.id) || 0;
    const proportion = totals.subtotal > 0 ? personSubtotal / totals.subtotal : 1 / count;
    return personSubtotal + proportion * extraCharges;
  });
  const amounts = distributeRounded(rawAmounts, totals.grandTotal);

  const perPerson = people.map((p, i) => ({
    personId: p.id,
    name: p.name,
    subtotal: perPersonSubtotal.get(p.id) || 0,
    amount: amounts[i],
  }));

  return { totals, perPerson };
}

export function formatMoney(n) {
  const value = Number.isFinite(n) ? n : 0;
  const rounded = Math.round(value * 100) / 100;
  return (rounded === 0 ? 0 : rounded).toLocaleString('th-TH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * สรุปว่าแต่ละคนกินรายการอะไรบ้าง พร้อมส่วนแบ่งของรายการนั้น ๆ (ใช้แสดงผลอย่างเดียว)
 * ใช้กฎเดียวกับ splitItemized: ถ้ารายการไหนไม่ได้ระบุคนกิน (consumerIds ว่าง) ถือว่าทุกคนกินร่วมกัน
 *
 * คืนค่า Map<personId, Array<{ itemId, name, qty, unitPrice, lineTotal, sharedWith, share, isShared }>>
 * - sharedWith = จำนวนคนที่หารรายการนี้ร่วมกัน
 * - share      = ส่วนแบ่งค่าอาหารของคนนี้ในรายการนี้ (ยังไม่รวมค่าบริการ/ภาษี)
 */
export function getConsumptionSummary(items, people) {
  const map = new Map(people.map((p) => [p.id, []]));
  const allIds = people.map((p) => p.id);

  for (const item of items) {
    const consumers = item.consumerIds && item.consumerIds.length > 0 ? item.consumerIds : allIds;
    // นับเฉพาะคนที่ยังอยู่ในรายชื่อจริง เผื่อ consumerIds ค้างชื่อคนที่ถูกลบไปแล้ว
    const validConsumers = consumers.filter((id) => map.has(id));
    const sharedWith = validConsumers.length || allIds.length || 1;
    const lineTotal = item.qty * item.price;

    for (const personId of validConsumers) {
      map.get(personId).push({
        itemId: item.id,
        name: item.name || 'ไม่มีชื่อ',
        qty: item.qty,
        unitPrice: item.price,
        lineTotal,
        sharedWith,
        share: lineTotal / sharedWith,
        isShared: sharedWith > 1,
      });
    }
  }
  return map;
}

/**
 * นับรายการที่ยังไม่ได้ระบุว่าใครกิน — ใช้เตือนผู้ใช้ก่อนหารแบบ "ตามรายการที่กิน"
 * (รายการเหล่านี้ระบบจะหารให้ทุกคนโดยอัตโนมัติ ไม่ได้หายไปจากบิล)
 */
export function countUnassignedItems(items) {
  return items.filter((it) => !it.consumerIds || it.consumerIds.length === 0).length;
}
