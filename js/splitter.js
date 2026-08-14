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
  return (Number.isFinite(n) ? n : 0).toLocaleString('th-TH', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  });
}

/**
 * สรุปว่าแต่ละคนกินรายการอะไรบ้าง (ไม่เกี่ยวกับการคำนวณเงิน ใช้แสดงผลอย่างเดียว)
 * ใช้กฎเดียวกับ splitItemized: ถ้ารายการไหนไม่ได้ระบุคนกิน (consumerIds ว่าง) ถือว่าทุกคนกินร่วมกัน
 * คืนค่า Map<personId, Array<{name, qty}>>
 */
export function getConsumptionSummary(items, people) {
  const map = new Map(people.map((p) => [p.id, []]));
  for (const item of items) {
    const consumers = item.consumerIds && item.consumerIds.length > 0
      ? item.consumerIds
      : people.map((p) => p.id);
    for (const personId of consumers) {
      if (map.has(personId)) {
        map.get(personId).push({ name: item.name || 'ไม่มีชื่อ', qty: item.qty });
      }
    }
  }
  return map;
}
