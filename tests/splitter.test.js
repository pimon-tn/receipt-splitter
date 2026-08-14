// tests/splitter.test.js
// ทดสอบตรรกะการคำนวณหารบิลทั้งหมด (pure functions ไม่แตะ DOM)
// รันด้วย: npm test  (หรือ node --test tests/)

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { calcBillTotals, splitEqual, splitItemized, getConsumptionSummary, formatMoney } from '../js/splitter.js';

// ค่าเริ่มต้นของ settings แบบไม่มี VAT ไม่มีค่าบริการ (baseline)
const noCharges = { vatEnabled: false, vatMode: 'exclusive', vatPercent: 7, serviceEnabled: false, servicePercent: 10 };

const sampleItems = () => [
  { id: 'i1', name: 'ต้มยำกุ้ง', qty: 1, price: 180, consumerIds: ['p1', 'p2'] },
  { id: 'i2', name: 'ข้าวผัดกุ้ง', qty: 2, price: 60, consumerIds: ['p1'] },
];
const samplePeople = () => [
  { id: 'p1', name: 'เอ' },
  { id: 'p2', name: 'บี' },
  { id: 'p3', name: 'ซี' },
];

describe('calcBillTotals', () => {
  test('ไม่มี VAT ไม่มีค่าบริการ: grandTotal = subtotal เฉย ๆ', () => {
    const t = calcBillTotals(sampleItems(), noCharges);
    assert.equal(t.subtotal, 300);
    assert.equal(t.serviceAmount, 0);
    assert.equal(t.vatAmount, 0);
    assert.equal(t.grandTotal, 300);
  });

  test('VAT แบบ "ยังไม่รวม" (exclusive) + มีค่าบริการ: บวกค่าบริการก่อน แล้วคิด VAT จากยอดที่รวมค่าบริการแล้ว', () => {
    const settings = { vatEnabled: true, vatMode: 'exclusive', vatPercent: 7, serviceEnabled: true, servicePercent: 10 };
    const t = calcBillTotals(sampleItems(), settings);
    assert.equal(t.subtotal, 300);
    assert.equal(t.serviceAmount, 30); // 10% ของ 300
    // VAT 7% ของ (300+30) = 330 -> 23.1
    assert.ok(Math.abs(t.vatAmount - 23.1) < 1e-9);
    assert.ok(Math.abs(t.grandTotal - 353.1) < 1e-9);
  });

  test('VAT แบบ "รวมแล้ว" (inclusive) ไม่มีค่าบริการ: แยกยอด VAT ออกจากราคาโดยไม่บวกซ้ำ grandTotal เท่ากับ subtotal เดิม', () => {
    const settings = { vatEnabled: true, vatMode: 'inclusive', vatPercent: 7, serviceEnabled: false, servicePercent: 10 };
    const t = calcBillTotals(sampleItems(), settings);
    assert.equal(t.subtotal, 300);
    assert.equal(t.serviceAmount, 0);
    // ฐานราคาก่อน VAT = 300 / 1.07
    assert.ok(Math.abs(t.foodBase - 300 / 1.07) < 1e-9);
    assert.ok(Math.abs(t.vatAmount - (300 - 300 / 1.07)) < 1e-9);
    // ยอดสุทธิต้องเท่ากับ 300 เดิม ไม่บวก VAT ซ้ำ
    assert.ok(Math.abs(t.grandTotal - 300) < 1e-9);
  });

  test('VAT แบบ "รวมแล้ว" (inclusive) + มีค่าบริการ: ค่าบริการคิดจากฐานก่อน VAT และตัวค่าบริการเองก็โดน VAT ด้วย', () => {
    const settings = { vatEnabled: true, vatMode: 'inclusive', vatPercent: 7, serviceEnabled: true, servicePercent: 10 };
    const t = calcBillTotals(sampleItems(), settings);
    const foodBase = 300 / 1.07;
    const expectedService = foodBase * 0.10;
    const expectedVatOnService = expectedService * 0.07;
    assert.ok(Math.abs(t.serviceAmount - expectedService) < 1e-9);
    // grandTotal = subtotal (300, VAT ของอาหารรวมอยู่แล้ว) + serviceAmount + VAT ของค่าบริการ (ค่าบริการเองก็ถูก VAT ด้วย)
    assert.ok(Math.abs(t.grandTotal - (300 + expectedService + expectedVatOnService)) < 1e-6);
  });

  test('รายการว่าง (ยังไม่มีอะไรในบิล) ต้องไม่พังและได้ 0 ทุกยอด', () => {
    const t = calcBillTotals([], { vatEnabled: true, vatMode: 'exclusive', vatPercent: 7, serviceEnabled: true, servicePercent: 10 });
    assert.equal(t.subtotal, 0);
    assert.equal(t.grandTotal, 0);
  });
});

describe('splitEqual', () => {
  test('หารเท่ากันทุกคนได้ค่าเท่ากันเป๊ะ และรวมกันได้ grandTotal', () => {
    const settings = { vatEnabled: true, vatMode: 'exclusive', vatPercent: 7, serviceEnabled: true, servicePercent: 10 };
    const result = splitEqual(sampleItems(), samplePeople(), settings);
    const amounts = result.perPerson.map((p) => p.amount);
    assert.equal(new Set(amounts).size, 1); // ทุกคนได้เท่ากัน
    const sum = amounts.reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(sum - result.totals.grandTotal) < 1e-9);
  });

  test('ไม่มีคนกินเลย (people ว่าง) ต้องไม่หารด้วยศูนย์จนพัง', () => {
    const result = splitEqual(sampleItems(), [], noCharges);
    assert.equal(result.perPerson.length, 0);
    assert.ok(Number.isFinite(result.totals.grandTotal));
  });

  test('หารไม่ลงตัว (฿100 ÷ 3 คน) ต้องปัดเศษสตางค์แล้วเกลี่ยเศษให้ผลรวมตรงกับยอดบิลเป๊ะ ไม่ใช่ 99.99', () => {
    const items = [{ id: 'i1', name: 'ของกิน', qty: 1, price: 100, consumerIds: [] }];
    const people = samplePeople(); // 3 คน
    const result = splitEqual(items, people, noCharges);
    const amounts = result.perPerson.map((p) => p.amount);
    const sum = amounts.reduce((a, b) => a + b, 0);

    assert.ok(Math.abs(sum - 100) < 1e-9, `ผลรวม ${sum} ต้องเท่ากับ 100.00 เป๊ะ`);

    // 100/3 = 33.333... -> ปัดลงทุกคนได้ 33.33 เหลือเศษ 1 สตางค์ ต้องมีคนได้ 33.34 พอดี 1 คน
    const formatted = amounts.map((a) => a.toFixed(2));
    assert.equal(formatted.filter((s) => s === '33.34').length, 1);
    assert.equal(formatted.filter((s) => s === '33.33').length, 2);
  });
});

describe('splitItemized', () => {
  test('คนที่ไม่ได้ระบุคนกิน (consumerIds ว่าง) ต้องถูกหารเฉลี่ยให้ทุกคนอัตโนมัติ', () => {
    const items = [{ id: 'i1', name: 'น้ำเปล่า', qty: 3, price: 10, consumerIds: [] }];
    const people = samplePeople();
    const result = splitItemized(items, people, noCharges);
    // ราคารวม 30 หารให้ 3 คนเท่า ๆ กัน = 10 ต่อคน
    result.perPerson.forEach((p) => assert.ok(Math.abs(p.amount - 10) < 1e-9));
  });

  test('ผลรวมของยอดที่ปัดเศษแล้วของทุกคนต้องเท่ากับ grandTotal เสมอ ไม่ว่าจะเลือกโหมด VAT แบบไหน', () => {
    const scenarios = [
      noCharges,
      { vatEnabled: true, vatMode: 'exclusive', vatPercent: 7, serviceEnabled: true, servicePercent: 10 },
      { vatEnabled: true, vatMode: 'inclusive', vatPercent: 7, serviceEnabled: false, servicePercent: 10 },
      { vatEnabled: true, vatMode: 'inclusive', vatPercent: 7, serviceEnabled: true, servicePercent: 10 },
    ];
    for (const settings of scenarios) {
      const result = splitItemized(sampleItems(), samplePeople(), settings);
      const sum = result.perPerson.reduce((a, p) => a + p.amount, 0);
      assert.ok(
        Math.abs(sum - result.totals.grandTotal) < 1e-9,
        `sum ${sum} should equal grandTotal ${result.totals.grandTotal} for settings ${JSON.stringify(settings)}`
      );
    }
  });

  test('สัดส่วนไม่ลงตัว ต้องปัดเศษสตางค์แล้วเกลี่ยเศษให้ผลรวมตรงกับยอดบิลเป๊ะ', () => {
    // ต้มยำ 100 บาท คนกินร่วมกัน 3 คน (ไม่ระบุ consumerIds = ทุกคนกิน) -> 33.33/33.33/33.34
    const items = [{ id: 'i1', name: 'ต้มยำ', qty: 1, price: 100, consumerIds: [] }];
    const settings = { vatEnabled: true, vatMode: 'exclusive', vatPercent: 7, serviceEnabled: true, servicePercent: 10 };
    const result = splitItemized(items, samplePeople(), settings);
    const amounts = result.perPerson.map((p) => p.amount);
    const sum = amounts.reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(sum - result.totals.grandTotal) < 1e-9);
    assert.equal(Math.round(sum * 100) / 100, Math.round(result.totals.grandTotal * 100) / 100);
  });

  test('คนที่ไม่ได้กินอะไรเลยต้องได้ยอด 0 ไม่ใช่ค่าติดลบหรือ NaN', () => {
    const items = [{ id: 'i1', name: 'ต้มยำ', qty: 1, price: 180, consumerIds: ['p1'] }];
    const people = samplePeople(); // p3 ไม่ได้กินอะไรเลย
    const result = splitItemized(items, people, noCharges);
    const p3 = result.perPerson.find((p) => p.personId === 'p3');
    assert.equal(p3.amount, 0);
  });

  test('ไม่มีรายการอาหารเลย (items ว่าง) ต้องได้ยอด 0 ทุกคนโดยไม่พัง', () => {
    const result = splitItemized([], samplePeople(), noCharges);
    result.perPerson.forEach((p) => assert.equal(p.amount, 0));
  });
});

describe('getConsumptionSummary', () => {
  test('รายการที่ระบุคนกินไว้ ต้องปรากฏเฉพาะในสรุปของคนที่ถูกระบุเท่านั้น', () => {
    const items = sampleItems(); // i1 -> [p1,p2], i2 -> [p1]
    const people = samplePeople(); // p1,p2,p3
    const summary = getConsumptionSummary(items, people);

    assert.deepEqual(summary.get('p1').map((i) => i.name), ['ต้มยำกุ้ง', 'ข้าวผัดกุ้ง']);
    assert.deepEqual(summary.get('p2').map((i) => i.name), ['ต้มยำกุ้ง']);
    assert.deepEqual(summary.get('p3'), [], 'p3 ไม่ได้ถูกระบุว่ากินอะไรเลย ควรได้ list ว่าง');
  });

  test('รายการที่ไม่ได้ระบุคนกิน (consumerIds ว่าง) ต้องนับว่าทุกคนกินร่วมกัน', () => {
    const items = [{ id: 'i1', name: 'น้ำเปล่า', qty: 2, price: 10, consumerIds: [] }];
    const people = samplePeople();
    const summary = getConsumptionSummary(items, people);
    people.forEach((p) => {
      assert.equal(summary.get(p.id).length, 1);
      assert.equal(summary.get(p.id)[0].name, 'น้ำเปล่า');
    });
  });

  test('ไม่มีรายการอาหารเลย ต้องได้ list ว่างสำหรับทุกคนโดยไม่ throw', () => {
    const summary = getConsumptionSummary([], samplePeople());
    samplePeople().forEach((p) => assert.deepEqual(summary.get(p.id), []));
  });
});

describe('formatMoney', () => {
  test('จัดรูปแบบทศนิยม 2 ตำแหน่งเสมอ', () => {
    assert.equal(formatMoney(180), '180.00');
    assert.equal(formatMoney(23.1), '23.10');
  });

  test('ค่าที่ไม่ใช่ตัวเลข (NaN/undefined) ต้องไม่ทำให้พัง ให้ถือเป็น 0', () => {
    assert.equal(formatMoney(NaN), '0.00');
    assert.equal(formatMoney(undefined), '0.00');
  });
});
