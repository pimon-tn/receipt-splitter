// tests/ocr.test.js
// ทดสอบ heuristic แปลงข้อความ OCR ดิบ เป็นรายการอาหาร (ไม่ทดสอบ Tesseract จริง เพราะต้องใช้อินเทอร์เน็ต/รูปจริง)

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { parseReceiptLines } from '../js/ocr.js';

describe('parseReceiptLines', () => {
  test('อ่านรายการพื้นฐานที่มีจุดไข่ปลาคั่นระหว่างชื่อกับราคา', () => {
    const text = 'ต้มยำกุ้ง .......... 180.00\nข้าวผัดกุ้ง ..... 120.00';
    const items = parseReceiptLines(text);
    assert.equal(items.length, 2);
    assert.equal(items[0].name, 'ต้มยำกุ้ง');
    assert.equal(items[0].price, 180);
    assert.equal(items[0].qty, 1);
  });

  test('ดึงจำนวน (qty) จากรูปแบบ "2x ชื่อ" และ "ชื่อ x2"', () => {
    const text = '2x ข้าวผัดกุ้ง 120\nส้มตำ x3 90';
    const items = parseReceiptLines(text);
    assert.equal(items[0].qty, 2);
    assert.equal(items[0].name, 'ข้าวผัดกุ้ง');
    assert.equal(items[1].qty, 3);
    assert.equal(items[1].name, 'ส้มตำ');
  });

  test('ข้ามบรรทัดที่เป็นยอดรวม/ภาษี/ค่าบริการ/โต๊ะ ไม่เอามาเป็นรายการอาหาร', () => {
    const text = [
      'โต๊ะ 5',
      'ต้มยำกุ้ง 180.00',
      'Subtotal 180.00',
      'Service charge 18.00',
      'VAT 13.86',
      'Total 211.86',
      'ขอบคุณค่ะ',
    ].join('\n');
    const items = parseReceiptLines(text);
    assert.equal(items.length, 1);
    assert.equal(items[0].name, 'ต้มยำกุ้ง');
  });

  test('รองรับตัวเลขราคาที่มีคอมมาแบ่งหลักพัน', () => {
    const text = 'เซ็ตหมูกระทะใหญ่ 1,200.00';
    const items = parseReceiptLines(text);
    assert.equal(items.length, 1);
    assert.equal(items[0].price, 1200);
  });

  test('ข้อความว่างหรือไม่มีตัวเลขราคาเลย ต้องได้ array ว่างไม่ throw', () => {
    assert.deepEqual(parseReceiptLines(''), []);
    assert.deepEqual(parseReceiptLines('ไม่มีตัวเลขอะไรเลยในบรรทัดนี้'), []);
  });

  test('ราคาที่ดูไม่สมเหตุสมผล (0, ติดลบ, หรือมากเกินไป) ต้องถูกข้าม', () => {
    const text = 'ของแถม 0\nรายการประหลาด 999999';
    const items = parseReceiptLines(text);
    assert.equal(items.length, 0);
  });

  test('ชื่อรายการที่อ่านไม่ออกเลย (มีแต่ราคา) ยังคงถูกเก็บไว้พร้อมชื่อ placeholder', () => {
    const text = '150.00';
    const items = parseReceiptLines(text);
    assert.equal(items.length, 1);
    assert.equal(items[0].name, 'รายการที่อ่านไม่ชัด');
  });
});
