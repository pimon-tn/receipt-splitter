// tests/storage.test.js
// ทดสอบการอ่าน/เขียน localStorage และการ migrate ข้อมูลบิลเวอร์ชันเก่า
// storage.js อ้างอิง `localStorage` และ `window.crypto` แบบ global (เหมือนในเบราว์เซอร์จริง)
// จึงต้อง stub ค่าเหล่านี้ไว้ที่ global ก่อนเรียกใช้ฟังก์ชันในไฟล์นี้

import { test, describe, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { createEmptyBill, loadBill, saveBill, clearBill, cryptoId } from '../js/storage.js';

// --- stub localStorage แบบ in-memory เหมือนเบราว์เซอร์ ---
class MemoryStorage {
  constructor() { this._data = new Map(); }
  getItem(key) { return this._data.has(key) ? this._data.get(key) : null; }
  setItem(key, value) { this._data.set(key, String(value)); }
  removeItem(key) { this._data.delete(key); }
  clear() { this._data.clear(); }
}

beforeEach(() => {
  global.localStorage = new MemoryStorage();
  global.window = { crypto: undefined }; // จำลองเบราว์เซอร์ที่ไม่มี crypto.randomUUID เพื่อทดสอบ fallback ด้วย
});

describe('createEmptyBill', () => {
  test('ได้โครงสร้างเริ่มต้นครบ พร้อมหมวดหมู่เริ่มต้น 2 อัน และไม่มี VAT/ค่าบริการ', () => {
    const bill = createEmptyBill();
    assert.equal(bill.categories.length, 2);
    assert.equal(bill.items.length, 0);
    assert.equal(bill.people.length, 0);
    assert.equal(bill.settings.vatEnabled, false);
    assert.equal(bill.settings.serviceEnabled, false);
    assert.equal(bill.settings.vatPercent, 7);
    assert.equal(bill.settings.servicePercent, 10);
  });

  test('แต่ละครั้งที่สร้างบิลใหม่ ต้องได้ id หมวดหมู่ที่ไม่ซ้ำกัน', () => {
    const bill = createEmptyBill();
    const ids = bill.categories.map((c) => c.id);
    assert.equal(new Set(ids).size, ids.length);
  });
});

describe('cryptoId', () => {
  test('เมื่อไม่มี crypto.randomUUID ต้อง fallback เป็น id แบบสุ่มที่ไม่ซ้ำกัน', () => {
    const a = cryptoId();
    const b = cryptoId();
    assert.notEqual(a, b);
    assert.ok(a.startsWith('id-'));
  });

  test('เมื่อมี crypto.randomUUID ต้องใช้ค่านั้นโดยตรง', () => {
    global.window.crypto = { randomUUID: () => 'fixed-uuid-1234' };
    assert.equal(cryptoId(), 'fixed-uuid-1234');
  });
});

describe('saveBill / loadBill', () => {
  test('บันทึกแล้วโหลดกลับมาต้องได้ข้อมูลเดิมครบถ้วน', () => {
    const bill = createEmptyBill();
    bill.items.push({ id: 'i1', name: 'ต้มยำ', qty: 1, price: 180, categoryId: bill.categories[0].id, consumerIds: [] });
    bill.people.push({ id: 'p1', name: 'เอ' });
    bill.settings.vatEnabled = true;
    bill.settings.vatMode = 'inclusive';

    saveBill(bill);
    const loaded = loadBill();

    assert.equal(loaded.items.length, 1);
    assert.equal(loaded.items[0].name, 'ต้มยำ');
    assert.equal(loaded.people[0].name, 'เอ');
    assert.equal(loaded.settings.vatEnabled, true);
    assert.equal(loaded.settings.vatMode, 'inclusive');
  });

  test('ยังไม่มีข้อมูลบันทึกไว้เลย ต้องได้บิลเปล่าเริ่มต้น ไม่ throw', () => {
    const loaded = loadBill();
    assert.equal(loaded.items.length, 0);
    assert.equal(loaded.settings.vatEnabled, false);
  });

  test('ข้อมูลใน localStorage เสีย (ไม่ใช่ JSON ที่ถูกต้อง) ต้อง fallback เป็นบิลเปล่าโดยไม่ throw', () => {
    global.localStorage.setItem('receipt-splitter:bill', '{invalid json...');
    const loaded = loadBill();
    assert.equal(loaded.items.length, 0);
    assert.equal(loaded.categories.length, 2);
  });

  test('ข้อมูลบิลเวอร์ชันเก่า (serviceChargePercent/vatPercent แบบเดิม) ต้องถูก migrate เป็นโครงสร้างใหม่ถูกต้อง', () => {
    global.localStorage.setItem('receipt-splitter:bill', JSON.stringify({
      categories: [{ id: 'c1', name: 'อาหาร' }],
      items: [{ id: 'i1', name: 'ต้มยำ', qty: 1, price: 180, categoryId: 'c1', consumerIds: [] }],
      people: [{ id: 'p1', name: 'เอ' }],
      settings: { serviceChargePercent: 10, vatPercent: 7 },
    }));

    const loaded = loadBill();
    assert.equal(loaded.settings.vatEnabled, true);
    assert.equal(loaded.settings.vatMode, 'exclusive');
    assert.equal(loaded.settings.vatPercent, 7);
    assert.equal(loaded.settings.serviceEnabled, true);
    assert.equal(loaded.settings.servicePercent, 10);
    // ข้อมูลรายการ/คนเดิมต้องไม่หายไปตอน migrate
    assert.equal(loaded.items.length, 1);
    assert.equal(loaded.people.length, 1);
  });

  test('ข้อมูลบิลเวอร์ชันเก่าที่ปิดค่าบริการ/VAT ไว้ (ค่าเป็น 0) ต้อง migrate เป็นปิดสวิตช์ (ไม่ใช่เปิดแล้วเป็น 0%)', () => {
    global.localStorage.setItem('receipt-splitter:bill', JSON.stringify({
      categories: [], items: [], people: [],
      settings: { serviceChargePercent: 0, vatPercent: 0 },
    }));
    const loaded = loadBill();
    assert.equal(loaded.settings.vatEnabled, false);
    assert.equal(loaded.settings.serviceEnabled, false);
  });
});

describe('clearBill', () => {
  test('ล้างข้อมูลแล้วโหลดใหม่ต้องได้บิลเปล่า', () => {
    const bill = createEmptyBill();
    bill.people.push({ id: 'p1', name: 'เอ' });
    saveBill(bill);

    clearBill();
    const loaded = loadBill();
    assert.equal(loaded.people.length, 0);
  });
});
