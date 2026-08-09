// tests/ocr.test.js
// ทดสอบ parseReceiptLines() ซึ่งตอนนี้คืนค่าเป็น { items, footerTotals, reconciliation }
// (ไม่ใช่ array เปล่า ๆ เหมือนเวอร์ชันก่อน — ทุกเทสต์จึงเข้าถึงผ่าน .items)

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseReceiptLines } from '../js/ocr.js';

describe('parseReceiptLines — การแยกรายการพื้นฐาน (ไม่มีเส้นคั่นส่วน)', () => {
  test('อ่านรายการพื้นฐานที่มีจุดไข่ปลาคั่นระหว่างชื่อกับราคา', () => {
    const { items } = parseReceiptLines('ต้มยำกุ้ง .......... 180.00\nข้าวผัดกุ้ง ..... 120.00');
    assert.equal(items.length, 2);
    assert.equal(items[0].name, 'ต้มยำกุ้ง');
    assert.equal(items[0].price, 180);
    assert.equal(items[0].qty, 1);
  });

  test('ดึงจำนวน (qty) จากรูปแบบ "2x ชื่อ" และ "ชื่อ x2"', () => {
    const { items } = parseReceiptLines('2x ข้าวผัดกุ้ง 120\nส้มตำ x3 90');
    assert.equal(items[0].qty, 2);
    assert.equal(items[0].name, 'ข้าวผัดกุ้ง');
    assert.equal(items[1].qty, 3);
    assert.equal(items[1].name, 'ส้มตำ');
  });

  test('ข้ามบรรทัดที่เป็นยอดรวม/ภาษี/ค่าบริการ/โต๊ะ ไม่เอามาเป็นรายการอาหาร (กรองด้วยคำสำคัญเมื่อไม่มีเส้นคั่น)', () => {
    const text = [
      'โต๊ะ 5',
      'ต้มยำกุ้ง 180.00',
      'Subtotal 180.00',
      'Service charge 18.00',
      'VAT 13.86',
      'Total 211.86',
      'ขอบคุณค่ะ',
    ].join('\n');
    const { items } = parseReceiptLines(text);
    assert.equal(items.length, 1);
    assert.equal(items[0].name, 'ต้มยำกุ้ง');
  });

  test('รองรับตัวเลขราคาที่มีคอมมาแบ่งหลักพัน', () => {
    const { items } = parseReceiptLines('เซ็ตหมูกระทะใหญ่ 1,200.00');
    assert.equal(items.length, 1);
    assert.equal(items[0].price, 1200);
  });

  test('ข้อความว่างหรือไม่มีตัวเลขราคาเลย ต้องได้รายการว่างไม่ throw', () => {
    assert.deepEqual(parseReceiptLines('').items, []);
    assert.deepEqual(parseReceiptLines('ไม่มีตัวเลขอะไรเลยในบรรทัดนี้').items, []);
  });

  test('ราคาที่ดูไม่สมเหตุสมผล (0, ติดลบ, หรือมากเกินไป) ต้องถูกข้าม', () => {
    const { items } = parseReceiptLines('ของแถม 0\nรายการประหลาด 999999');
    assert.equal(items.length, 0);
  });

  test('ชื่อรายการที่อ่านไม่ออกเลย (มีแต่ราคา) ยังคงถูกเก็บไว้พร้อมชื่อ placeholder', () => {
    const { items } = parseReceiptLines('150.00');
    assert.equal(items.length, 1);
    assert.equal(items[0].name, 'รายการที่อ่านไม่ชัด');
  });
});

describe('parseReceiptLines — แบ่งส่วนด้วยเส้นคั่น (----/====/....)', () => {
  test('ตัดหัวร้าน (ชื่อร้าน/วันเวลา) ออกได้ถูกต้องแม้ไม่มีคำอยู่ใน skip words เลย เพราะโครงสร้างเส้นคั่นบอกตำแหน่ง', () => {
    const text = [
      'ร้านอาหารทดสอบ',
      'ABC Restaurant',
      '12 มกราคม 2569 18:30',
      '------------------------------',
      'ต้มยำกุ้ง 180.00',
      'ข้าวผัดกุ้ง x2 60.00',
      '------------------------------',
      'Subtotal 300.00',
      'Total 300.00',
    ].join('\n');

    const { items, footerTotals, reconciliation } = parseReceiptLines(text);

    assert.equal(items.length, 2, 'ควรมีแค่ 2 รายการอาหาร ไม่รวมชื่อร้าน/วันเวลาที่อยู่นอกเส้นคั่น');
    assert.equal(items[0].name, 'ต้มยำกุ้ง');
    assert.equal(items[1].name, 'ข้าวผัดกุ้ง');
    assert.equal(items[1].qty, 2);

    assert.equal(footerTotals.subtotal, 300);
    assert.equal(footerTotals.total, 300);
    assert.equal(reconciliation.checked, true);
    assert.equal(reconciliation.matches, true);
  });

  test('เส้นคั่นเส้นเดียว: ฝั่งที่มีคำว่ายอดรวม/VAT มากกว่าถือเป็นส่วนท้ายบิล อีกฝั่งคือหัว+รายการ', () => {
    const text = [
      'ร้านกาแฟทดสอบ',
      'กาแฟเย็น 65.00',
      'ชาเขียว 55.00',
      '----------',
      'Subtotal 120.00',
      'VAT 8.40',
      'Total 128.40',
    ].join('\n');

    const { items } = parseReceiptLines(text);
    assert.equal(items.length, 2);
    assert.equal(items[0].name, 'กาแฟเย็น');
    assert.equal(items[1].name, 'ชาเขียว');
  });
});

describe('parseReceiptLines — แบ่งส่วนด้วยบรรทัดว่าง', () => {
  test('ตัดหัวใบเสร็จและยอดสรุปที่คั่นด้วยบรรทัดว่าง โดยยังเก็บหัวตารางรายการไว้', () => {
    const text = [
      'ร้านอาหารทดสอบ',
      'เลขที่ 0142',
      '',
      'รายการ         จำนวน    ราคา',
      'ต้มยำกุ้ง        1        180.00',
      'ข้าวผัดกุ้ง       2        60.00',
      '',
      'Subtotal 300.00',
      'VAT 21.00',
      'Total 321.00',
      '',
      'ขอบคุณค่ะ',
    ].join('\n');

    const { items, footerTotals } = parseReceiptLines(text);
    assert.deepEqual(items, [
      { name: 'ต้มยำกุ้ง', qty: 1, price: 180 },
      { name: 'ข้าวผัดกุ้ง', qty: 2, price: 60 },
    ]);
    assert.equal(footerTotals.subtotal, 300);
    assert.equal(footerTotals.total, 321);
  });

  test('ไม่ทิ้งรายการเมื่อ OCR เว้นบรรทัดว่างระหว่างเมนู', () => {
    const text = [
      'ร้านกาแฟ',
      '',
      'กาแฟเย็น 65.00',
      '',
      'ชาเขียว 55.00',
      '',
      'Total 120.00',
    ].join('\n');

    const { items } = parseReceiptLines(text);
    assert.deepEqual(items, [
      { name: 'กาแฟเย็น', qty: 1, price: 65 },
      { name: 'ชาเขียว', qty: 1, price: 55 },
    ]);
  });
});

describe('parseReceiptLines — ยึดหัวตารางเมื่อมี (column-aware parsing)', () => {
  test('มีหัวตาราง "รายการ / จำนวน / ราคา" ต้องยึดคอลัมน์ตามหัวตาราง แม่นยำกว่าการเดา', () => {
    const text = [
      'รายการ         จำนวน    ราคา',
      'ต้มยำกุ้ง        1        180.00',
      'ข้าวผัดกุ้ง       2        60.00',
    ].join('\n');

    const { items } = parseReceiptLines(text);
    assert.equal(items.length, 2);
    assert.equal(items[0].name, 'ต้มยำกุ้ง');
    assert.equal(items[0].qty, 1);
    assert.equal(items[0].price, 180);
    assert.equal(items[1].name, 'ข้าวผัดกุ้ง');
    assert.equal(items[1].qty, 2);
    assert.equal(items[1].price, 60);
  });

  test('หัวตารางที่คอลัมน์สุดท้ายเป็น "รวม" (ยอดรวมต่อแถว ไม่ใช่ราคาต่อหน่วย) ต้องหารด้วยจำนวนกลับมาเป็นราคาต่อหน่วยให้ถูก', () => {
    const text = [
      'รายการ      จำนวน      รวม',
      'น้ำเปล่า     3      30.00',
    ].join('\n');

    const { items } = parseReceiptLines(text);
    assert.equal(items.length, 1);
    assert.equal(items[0].qty, 3);
    assert.equal(items[0].price, 10, 'ยอดรวม 30 หาร 3 = ราคาต่อหน่วย 10');
  });

  test('ไม่มีหัวตารางชัดเจน ต้องเดาแบบ heuristic เดิม (ใกล้เคียงที่สุดที่ทำได้) โดยไม่ throw', () => {
    const text = 'ต้มยำกุ้ง .......... 180.00';
    const { items } = parseReceiptLines(text);
    assert.equal(items.length, 1);
    assert.equal(items[0].price, 180);
  });
});

describe('parseReceiptLines — ดึงยอดสรุปท้ายบิล (footerTotals)', () => {
  test('ดึง subtotal / ส่วนลด / ค่าบริการ / VAT / ยอดรวม ได้ถูกต้องครบทุกรายการ', () => {
    const text = [
      'Subtotal 500.00',
      'Discount 50.00',
      'Service charge 45.00',
      'VAT 34.65',
      'Grand Total 529.65',
    ].join('\n');

    const { footerTotals } = parseReceiptLines(text);
    assert.equal(footerTotals.subtotal, 500);
    assert.equal(footerTotals.discount, 50);
    assert.equal(footerTotals.serviceCharge, 45);
    assert.equal(footerTotals.vat, 34.65);
    assert.equal(footerTotals.total, 529.65);
  });

  test('บรรทัด "ยอดรวมย่อย" ต้องถูกจัดเป็น subtotal ไม่ใช่ total (แม้จะมีคำว่า "รวม" อยู่ในนั้น)', () => {
    const text = 'ยอดรวมย่อย 300.00';
    const { footerTotals } = parseReceiptLines(text);
    assert.equal(footerTotals.subtotal, 300);
    assert.equal(footerTotals.total, undefined);
  });
});

describe('parseReceiptLines — เทียบยอดรวมที่พาร์สได้กับยอดในใบเสร็จ (reconciliation)', () => {
  test('ยอดตรงกัน -> matches = true', () => {
    const text = ['ต้มยำกุ้ง 180.00', 'ข้าวผัดกุ้ง 120.00', 'Subtotal 300.00'].join('\n');
    const { reconciliation } = parseReceiptLines(text);
    assert.equal(reconciliation.checked, true);
    assert.equal(reconciliation.matches, true);
    assert.equal(reconciliation.itemsSum, 300);
    assert.equal(reconciliation.expected, 300);
  });

  test('ยอดไม่ตรงกัน (พาร์สรายการไม่ครบ เช่น OCR อ่านบางบรรทัดไม่ออก) -> matches = false พร้อมค่า diff', () => {
    const text = ['ต้มยำกุ้ง 180.00', 'Subtotal 300.00'].join('\n');
    const { reconciliation } = parseReceiptLines(text);
    assert.equal(reconciliation.checked, true);
    assert.equal(reconciliation.matches, false);
    assert.equal(reconciliation.itemsSum, 180);
    assert.equal(reconciliation.expected, 300);
    assert.equal(reconciliation.diff, 120);
  });

  test('ไม่มี subtotal/total ให้เทียบเลย -> checked = false (ไม่ฟ้องเตือนเพราะไม่มีอะไรให้เทียบ)', () => {
    const { reconciliation } = parseReceiptLines('ต้มยำกุ้ง 180.00');
    assert.equal(reconciliation.checked, false);
    assert.equal(reconciliation.matches, true);
  });

  test('ไม่มี subtotal แต่มี total เปล่า ๆ (ไม่มีค่าบริการ/VAT/ส่วนลดแยก) -> ใช้ total แทนได้', () => {
    const text = ['ต้มยำกุ้ง 180.00', 'ข้าวผัดกุ้ง 120.00', 'Total 300.00'].join('\n');
    const { reconciliation } = parseReceiptLines(text);
    assert.equal(reconciliation.checked, true);
    assert.equal(reconciliation.matches, true);
    assert.equal(reconciliation.label, 'total');
  });

  test('มี VAT/ค่าบริการแยกอยู่ แต่ไม่มี subtotal -> ห้ามเอา total มาเทียบกับยอดอาหารเปล่า ๆ (จะ false alarm)', () => {
    const text = ['ต้มยำกุ้ง 180.00', 'ข้าวผัดกุ้ง 120.00', 'VAT 21.00', 'Total 321.00'].join('\n');
    const { reconciliation } = parseReceiptLines(text);
    assert.equal(reconciliation.checked, false, 'ไม่มี subtotal และ total ก็ไม่ควรเอามาเทียบตรง ๆ เพราะรวม VAT อยู่แล้ว');
    assert.equal(reconciliation.matches, true);
  });
});
