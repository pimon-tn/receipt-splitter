// tests/bill.test.js
// ทดสอบกติกาการแก้ไขบิล (bill.js) ผ่าน interface ของ session ด้วย storage แบบ in-memory — ไม่ต้องใช้ DOM

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { createBillSession } from '../js/bill.js';
import { createEmptyBill } from '../js/storage.js';

/** storage ปลอม: เก็บสำเนาของบิลล่าสุดที่ถูก save ไว้ให้เทสต์ตรวจ */
function memoryStorage(initial = createEmptyBill()) {
  const store = { saved: null, saves: 0 };
  store.load = () => structuredClone(initial);
  store.save = (bill) => { store.saved = structuredClone(bill); store.saves++; };
  return store;
}

function newSession(initial) {
  let n = 0;
  const storage = memoryStorage(initial);
  const session = createBillSession(storage, () => `id${++n}`);
  return { session, storage };
}

/** session ที่มีอาหาร 2 รายการ (id1, id2) และคน 2 คน (id3, id4) */
function seeded() {
  const ctx = newSession();
  ctx.session.addItem({ name: 'ต้มยำ', qty: 1, price: 180 });
  ctx.session.addItem({ name: 'ข้าวผัด', qty: 2, price: 60 });
  ctx.session.addPerson();
  ctx.session.addPerson();
  return ctx;
}

describe('bill session: บันทึกให้เองทุกคำสั่ง', () => {
  test('ทุกคำสั่งที่แก้ข้อมูลบันทึกลง storage ทันที', () => {
    const { session, storage } = newSession();
    session.addItem({ name: 'น้ำ', qty: 1, price: 20 });
    assert.equal(storage.saved.items[0].name, 'น้ำ');
    session.setCharge('vatEnabled', true);
    assert.equal(storage.saved.settings.vatEnabled, true);
    session.addPerson();
    assert.equal(storage.saved.people.length, 1);
  });

  test('เริ่มจากบิลที่ storage โหลดมาให้', () => {
    const initial = createEmptyBill();
    initial.items.push({ id: 'x', name: 'เก่า', qty: 1, price: 5, consumerIds: [] });
    assert.equal(newSession(initial).session.bill.items[0].name, 'เก่า');
  });
});

describe('bill session: รายการอาหาร', () => {
  test('addItem ได้ id ใหม่และยังไม่ระบุผู้กิน', () => {
    const { session } = newSession();
    session.addItem({ name: 'น้ำ', qty: 2, price: 20 });
    assert.deepEqual(session.bill.items[0], { id: 'id1', name: 'น้ำ', qty: 2, price: 20, consumerIds: [] });
  });

  test('updateItem คืน false ถ้าไม่พบ id และไม่บันทึก', () => {
    const { session, storage } = newSession();
    assert.equal(session.updateItem('nope', { qty: 3 }), false);
    assert.equal(storage.saves, 0);
  });

  test('updateItem แก้เฉพาะฟิลด์ที่ส่งมา', () => {
    const { session } = seeded();
    assert.equal(session.updateItem('id1', { qty: 3 }), true);
    assert.equal(session.bill.items[0].qty, 3);
    assert.equal(session.bill.items[0].price, 180);
  });

  test('addItems เพิ่มหลายรายการพร้อม id ไม่ซ้ำ และบันทึกครั้งเดียว', () => {
    const { session, storage } = newSession();
    session.addItems([{ name: 'a', qty: 1, price: 1 }, { name: 'b', qty: 2, price: 2 }]);
    assert.deepEqual(session.bill.items.map((i) => i.id), ['id1', 'id2']);
    assert.equal(storage.saves, 1);
  });

  test('removeItem เอารายการออก', () => {
    const { session } = seeded();
    session.removeItem('id1');
    assert.deepEqual(session.bill.items.map((i) => i.id), ['id2']);
  });
});

describe('bill session: คน', () => {
  test('addPerson ตั้งชื่ออัตโนมัติตามลำดับ', () => {
    const { session } = seeded();
    assert.deepEqual(session.bill.people.map((p) => p.name), ['คนที่ 1', 'คนที่ 2']);
  });

  test('removePerson เอาคนนั้นออกจากผู้กินของทุกรายการ แต่ไม่แตะคนอื่น', () => {
    const { session } = seeded();
    session.toggleConsumer('id1', 'id3');
    session.toggleConsumer('id1', 'id4');
    session.toggleConsumer('id2', 'id3');
    session.removePerson('id3');
    assert.deepEqual(session.bill.people.map((p) => p.id), ['id4']);
    assert.deepEqual(session.bill.items[0].consumerIds, ['id4']);
    assert.deepEqual(session.bill.items[1].consumerIds, []);
  });

  test('clearPeople ล้างคนและผู้กินทุกรายการ แต่เก็บรายการอาหารไว้', () => {
    const { session } = seeded();
    session.toggleConsumer('id1', 'id3');
    session.clearPeople();
    assert.equal(session.bill.people.length, 0);
    assert.equal(session.bill.items.length, 2);
    assert.deepEqual(session.bill.items[0].consumerIds, []);
  });

  test('renamePerson เปลี่ยนชื่อ และเงียบถ้าไม่พบ id', () => {
    const { session } = seeded();
    session.renamePerson('id3', 'เอ');
    session.renamePerson('nope', 'x');
    assert.equal(session.bill.people[0].name, 'เอ');
  });
});

describe('bill session: ใครกินอะไร', () => {
  test('toggleConsumer เพิ่มแล้วถอดออกเมื่อกดซ้ำ', () => {
    const { session } = seeded();
    session.toggleConsumer('id1', 'id3');
    assert.deepEqual(session.bill.items[0].consumerIds, ['id3']);
    session.toggleConsumer('id1', 'id3');
    assert.deepEqual(session.bill.items[0].consumerIds, []);
  });

  test('toggleAllConsumers: เลือกทุกคน แล้วกดซ้ำเคลียร์เป็น [] (ทุกคนกินร่วมกันโดยปริยาย)', () => {
    const { session } = seeded();
    session.toggleAllConsumers('id1');
    assert.deepEqual(session.bill.items[0].consumerIds, ['id3', 'id4']);
    session.toggleAllConsumers('id1');
    assert.deepEqual(session.bill.items[0].consumerIds, []);
  });

  test('toggleAllConsumers เมื่อเลือกไม่ครบ จะเลือกให้ครบ', () => {
    const { session } = seeded();
    session.toggleConsumer('id1', 'id3');
    session.toggleAllConsumers('id1');
    assert.deepEqual(session.bill.items[0].consumerIds, ['id3', 'id4']);
  });

  test('ไม่มีคนเลย toggleAllConsumers ไม่ทำให้เป็น "เลือกครบ"', () => {
    const { session } = newSession();
    session.addItem({ name: 'น้ำ', qty: 1, price: 20 });
    session.toggleAllConsumers('id1');
    assert.deepEqual(session.bill.items[0].consumerIds, []);
  });
});

describe('bill session: เริ่มบิลใหม่', () => {
  test('ล้างรายการและตั้งค่า แต่เก็บรายชื่อคนไว้', () => {
    const { session, storage } = seeded();
    session.setCharge('vatEnabled', true);
    session.startNew();
    assert.equal(session.bill.items.length, 0);
    assert.equal(session.bill.settings.vatEnabled, false);
    assert.equal(session.bill.people.length, 2);
    assert.equal(storage.saved.people.length, 2);
  });
});
