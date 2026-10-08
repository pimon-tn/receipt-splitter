// bill.js
// เจ้าของสถานะบิลปัจจุบัน + กติกาการแก้ไขทั้งหมด (invariant) + การบันทึก
// ทุกคำสั่งแก้ข้อมูลแล้วบันทึกผ่าน storage ให้เอง ผู้เรียกไม่ต้องจำเรียก persist
// ไม่แตะ DOM และไม่รู้จัก localStorage โดยตรง — รับ storage เป็น adapter { load, save }
// (ของจริง: storage.js, ในเทสต์: in-memory)

import { createEmptyBill } from './storage.js';

/**
 * @param {{ load(): object, save(bill: object): void }} storage
 * @param {() => string} newId สร้าง id ใหม่ (ฉีดเข้ามาเพื่อให้เทสต์ได้ id คงที่)
 */
export function createBillSession(storage, newId) {
  let bill = storage.load();

  const commit = () => storage.save(bill);
  const findItem = (id) => bill.items.find((it) => it.id === id);

  return {
    /** บิลปัจจุบัน — อ่านอย่างเดียว ห้ามแก้ตรง ๆ ให้ผ่านคำสั่งด้านล่าง */
    get bill() {
      return bill;
    },

    /* ---- รายการอาหาร ---- */

    addItem({ name, qty, price }) {
      bill.items.push({ id: newId(), name, qty, price, consumerIds: [] });
      commit();
    },

    /** เพิ่มหลายรายการพร้อมกัน (จากผลอ่านใบเสร็จ) */
    addItems(list) {
      list.forEach((p) => bill.items.push({ id: newId(), name: p.name, qty: p.qty, price: p.price, consumerIds: [] }));
      commit();
    },

    /** @returns {boolean} false ถ้าไม่พบรายการ */
    updateItem(id, patch) {
      const item = findItem(id);
      if (!item) return false;
      Object.assign(item, patch);
      commit();
      return true;
    },

    removeItem(id) {
      bill.items = bill.items.filter((it) => it.id !== id);
      commit();
    },

    /* ---- คน ---- */

    addPerson() {
      bill.people.push({ id: newId(), name: `คนที่ ${bill.people.length + 1}` });
      commit();
    },

    renamePerson(id, name) {
      const person = bill.people.find((p) => p.id === id);
      if (!person) return;
      person.name = name;
      commit();
    },

    /** ลบคนและเอาออกจากผู้กินของทุกรายการ */
    removePerson(id) {
      bill.people = bill.people.filter((p) => p.id !== id);
      bill.items.forEach((it) => { it.consumerIds = (it.consumerIds || []).filter((cid) => cid !== id); });
      commit();
    },

    clearPeople() {
      bill.people = [];
      bill.items.forEach((it) => { it.consumerIds = []; });
      commit();
    },

    /* ---- ใครกินอะไร ---- */

    toggleConsumer(itemId, personId) {
      const item = findItem(itemId);
      if (!item) return;
      item.consumerIds = item.consumerIds || [];
      const idx = item.consumerIds.indexOf(personId);
      if (idx >= 0) item.consumerIds.splice(idx, 1);
      else item.consumerIds.push(personId);
      commit();
    },

    /**
     * เลือกทุกคน; กดซ้ำตอนเลือกครบแล้วจะเคลียร์เป็น [] ซึ่งแปลว่า "ทุกคนกินร่วมกัน" โดยปริยาย
     * (ไม่ใช่ "ไม่มีใครกิน" — ถ้าต้องการแบบนั้นต้องถอดทีละคน)
     */
    toggleAllConsumers(itemId) {
      const item = findItem(itemId);
      if (!item) return;
      const consumerIds = item.consumerIds || [];
      const allSelected = bill.people.length > 0 && bill.people.every((p) => consumerIds.includes(p.id));
      item.consumerIds = allSelected ? [] : bill.people.map((p) => p.id);
      commit();
    },

    /* ---- VAT / ค่าบริการ ---- */

    /** @param {'vatEnabled'|'vatPercent'|'serviceEnabled'|'servicePercent'} key */
    setCharge(key, value) {
      bill.settings[key] = value;
      commit();
    },

    /* ---- เริ่มบิลใหม่: เก็บรายชื่อคนไว้ ---- */

    startNew() {
      const keptPeople = bill.people;
      bill = createEmptyBill();
      bill.people = keptPeople;
      commit();
    },
  };
}
