// tests/integration.test.js
// ทดสอบแบบ end-to-end โดยใช้โค้ดจริงของแอป (js/app.js, js/ui.js) รันอยู่บน DOM จริง
// (สร้างจาก index.html ตัวจริงผ่าน jsdom) แล้วจำลองการกด/พิมพ์ของผู้ใช้จริง ๆ
// ไม่ได้ reimplement logic ขึ้นมาใหม่ — นี่คือการรันแอปตัวจริงเพื่อพิสูจน์ว่าใช้งานได้จริง

import { test, describe } from 'node:test';
import assert from 'node:assert/strict';
import { JSDOM } from 'jsdom';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const projectRoot = path.join(__dirname, '..');
const indexHtml = fs.readFileSync(path.join(projectRoot, 'index.html'), 'utf-8');

/**
 * สร้าง jsdom ใหม่จาก index.html ตัวจริง แล้วตั้งค่า global ที่ app.js ต้องใช้
 * (เหมือนเบราว์เซอร์จริง: document, navigator, localStorage, ฯลฯ)
 */
function setupDom() {
  const dom = new JSDOM(indexHtml, { url: 'http://localhost/', pretendToBeVisual: true });
  const { window } = dom;

  global.window = window;
  global.document = window.document;
  // Node เองมี global.navigator แบบ getter-only มาให้แล้ว (สำหรับ fetch API) ต้อง defineProperty ทับ ไม่ใช่ assign ตรง ๆ
  Object.defineProperty(global, 'navigator', { value: window.navigator, configurable: true });
  global.localStorage = window.localStorage;
  global.Event = window.Event;
  global.KeyboardEvent = window.KeyboardEvent;

  // jsdom ไม่ implement prompt/confirm จริง (ของเบราว์เซอร์) — stub ไว้ให้ทดสอบได้
  window.prompt = () => null;
  window.confirm = () => true;
  global.prompt = window.prompt;
  global.confirm = window.confirm;

  window.localStorage.clear();
  return dom;
}

const $ = (sel) => global.document.querySelector(sel);
const $$ = (sel) => Array.from(global.document.querySelectorAll(sel));

function click(el) { el.dispatchEvent(new global.window.Event('click', { bubbles: true })); }
function setValue(el, value) {
  el.value = value;
  el.dispatchEvent(new global.window.Event('input', { bubbles: true }));
}
function setChecked(el, checked) {
  el.checked = checked;
  el.dispatchEvent(new global.window.Event('change', { bubbles: true }));
}
function pressEscape() {
  global.document.dispatchEvent(new global.window.KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
}

/** import แอปตัวจริงแบบ "สด" ทุกครั้ง (ผ่าน query string กัน cache) เพื่อไม่ให้ state ค้างข้ามเทสต์ */
async function bootApp() {
  await import(`../js/app.js?fresh=${Date.now()}-${Math.random()}`);
}

/**
 * เพิ่มรายการอาหารผ่าน popup จริง (กด "+ เพิ่มรายการ" -> กรอกฟอร์ม -> กด "+ เพิ่มรายการ" ใน popup)
 * แทนการเซ็ตค่าลงการ์ดตรง ๆ เพราะตอนนี้การเพิ่มรายการใหม่ต้องผ่าน popup เท่านั้น
 */
function addItemViaModal({ name = '', qty = 1, price = 0 } = {}) {
  click($('#addItemBtn'));
  assert.equal($('#itemModalOverlay').hidden, false, 'popup เพิ่มรายการควรเปิดขึ้นมาหลังกด "+ เพิ่มรายการ"');
  setValue($('#modalItemName'), name);
  setValue($('#modalItemQty'), String(qty));
  setValue($('#modalItemPrice'), String(price));
  click($('#modalSubmitBtn'));
  assert.equal($('#itemModalOverlay').hidden, true, 'popup ควรปิดตัวเองหลังกดเพิ่มรายการสำเร็จ');
}

describe('การใช้งานจริงทั้งวงจร: เริ่มต้น → รายการ → คนกิน → ตั้งค่า VAT/ค่าบริการ → หารบิล', () => {
  test('ผู้ใช้วางข้อความ OCR, เพิ่มรายการผ่าน popup, เพิ่มคน, เปิด VAT+ค่าบริการ แล้วดูผลหารบิลทั้ง 2 โหมด', async () => {
    setupDom();
    await bootApp();

    // ---- แท็บเริ่มต้น: วางข้อความที่ "อ่านได้" จากใบเสร็จ แล้วกดแปลงเป็นรายการ ----
    setValue($('#ocrRawText'), 'ต้มยำกุ้ง 180.00\nข้าวผัดกุ้ง x2 60.00');
    click($('#parseBtn'));

    let itemCards = $$('#itemsBody .item-card');
    assert.equal(itemCards.length, 2, 'ควรมี 2 รายการหลังแปลงข้อความ OCR');
    assert.equal(itemCards[0].querySelector('.item-name').value, 'ต้มยำกุ้ง');
    assert.equal(itemCards[1].querySelector('.item-qty').value, '2');

    // ---- แท็บรายการ: เพิ่มรายการเองอีก 1 รายการผ่าน popup ----
    addItemViaModal({ name: 'น้ำเปล่า', qty: 1, price: 20 });
    itemCards = $$('#itemsBody .item-card');
    assert.equal(itemCards.length, 3);
    assert.equal(itemCards[2].querySelector('.item-name').value, 'น้ำเปล่า');

    // ---- แท็บคนกิน: เพิ่ม 2 คน ----
    click($('#addPersonBtn'));
    click($('#addPersonBtn'));
    const peopleRows = $$('#peopleList li');
    assert.equal(peopleRows.length, 2);
    setValue(peopleRows[0].querySelector('.person-name'), 'เอ');
    setValue(peopleRows[1].querySelector('.person-name'), 'บี');

    // ---- เปิด VAT (ยังไม่รวม 7%) และเปิดค่าบริการ 10% ----
    setChecked($('#vatEnabledInput'), true);
    click($('#vatModeSegmented [data-vatmode="exclusive"]'));
    setValue($('#vatPercentInput'), '7');
    setChecked($('#serviceEnabledInput'), true);
    setValue($('#servicePercentInput'), '10');

    // subtotal = 180 + (60*2) + 20 = 320
    // service 10% = 32 -> vat 7% ของ (320+32=352) = 24.64 -> grand = 376.64
    assert.equal($('#sumSubtotal').textContent, '320.00');
    assert.equal($('#sumService').textContent, '32.00');
    assert.equal($('#sumVat').textContent, '24.64');
    assert.equal($('#sumGrand').textContent, '376.64');

    // ---- แท็บหารบิล โหมด "หารเท่ากัน" ----
    click($('.tab[data-tab="split"]'));
    let splitCards = $$('#splitResult .split-card');
    assert.equal(splitCards.length, 2);
    let amounts = splitCards.map((c) => c.querySelector('.split-card__amount').textContent);
    assert.deepEqual(amounts, ['฿188.32', '฿188.32'], 'หารเท่ากัน 376.64 / 2 คน = 188.32 ต่อคน');

    // ---- สลับเป็น "หารตามรายการที่กิน" โดยยังไม่ระบุใครกินอะไรเลย (ควรเฉลี่ยเท่ากันเหมือนโหมดแรก) ----
    click($('.split-mode__btn[data-mode="itemized"]'));
    splitCards = $$('#splitResult .split-card');
    amounts = splitCards.map((c) => c.querySelector('.split-card__amount').textContent);
    assert.deepEqual(amounts, ['฿188.32', '฿188.32']);

    // ---- ระบุว่า "เอ" กินต้มยำกุ้งคนเดียว (คนแรกในรายชื่อ x รายการแรก) ----
    click($('.tab[data-tab="people"]'));
    const firstAssignItem = $$('#assignList .assign-item')[0];
    click(firstAssignItem.querySelectorAll('.assign-tag:not(.assign-tag--all)')[0]);

    click($('.tab[data-tab="split"]'));
    splitCards = $$('#splitResult .split-card');
    const total = splitCards
      .map((c) => parseFloat(c.querySelector('.split-card__amount').textContent.replace('฿', '')))
      .reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(total - 376.64) < 1e-9, 'ไม่ว่าจะแบ่งกันยังไง รวมกันต้องได้ยอดสุทธิทั้งบิลเท่าเดิมเป๊ะ (ปัดเศษสตางค์เกลี่ยแล้ว)');

    // ---- ข้อมูลต้องถูกบันทึกลง localStorage จริง ไม่ใช่แค่ค้างอยู่ในหน่วยความจำ ----
    const saved = JSON.parse(global.localStorage.getItem('receipt-splitter:bill'));
    assert.equal(saved.items.length, 3);
    assert.equal(saved.people.length, 2);
    assert.equal(saved.settings.vatEnabled, true);
    assert.equal(saved.settings.serviceEnabled, true);
  });

  test('ปิด VAT และปิดค่าบริการ กลับไปหารแบบราคาล้วน ๆ ได้ถูกต้อง (ทดสอบสวิตช์ปิด ไม่ใช่แค่เปิด)', async () => {
    setupDom();
    await bootApp();

    addItemViaModal({ name: 'อาหารทดสอบ', qty: 1, price: 100 });
    const card = $$('#itemsBody .item-card')[0];
    click(card.querySelector('.qty-btn--plus')); // qty: 1 -> 2

    click($('#addPersonBtn'));
    click($('#addPersonBtn'));

    // VAT/ค่าบริการ ปิดอยู่โดย default (ไม่ได้เปิดเลยในเทสต์นี้)
    assert.equal($('#sumSubtotal').textContent, '200.00');
    assert.equal($('#sumService').textContent, '0.00');
    assert.equal($('#sumVat').textContent, '0.00');
    assert.equal($('#sumGrand').textContent, '200.00');

    click($('.tab[data-tab="split"]'));
    const amounts = $$('#splitResult .split-card').map((c) => c.querySelector('.split-card__amount').textContent);
    assert.deepEqual(amounts, ['฿100.00', '฿100.00']);
  });

  test('กด "เริ่มบิลใหม่" ต้องล้างรายการ/หมวดหมู่/การตั้งค่ากลับเป็นค่าเริ่มต้น แต่ต้องเก็บรายชื่อคนไว้เหมือนเดิม', async () => {
    setupDom();
    await bootApp();

    addItemViaModal({ name: 'ต้มยำ', qty: 1, price: 180 });
    click($('#addPersonBtn'));
    setValue($$('#peopleList li')[0].querySelector('.person-name'), 'เอ');
    setChecked($('#vatEnabledInput'), true);

    assert.equal($$('#itemsBody .item-card').length, 1);
    assert.equal($$('#peopleList li').length, 1);

    click($('#newBillBtn')); // window.confirm ถูก stub ให้คืนค่า true ไว้แล้วใน setupDom()

    assert.equal($$('#itemsBody .item-card').length, 0, 'รายการอาหารต้องถูกล้าง');
    assert.equal($('#vatEnabledInput').checked, false, 'การตั้งค่า VAT ต้องรีเซ็ตกลับเป็นค่าเริ่มต้น');

    const peopleRows = $$('#peopleList li');
    assert.equal(peopleRows.length, 1, 'รายชื่อคนต้องยังอยู่เหมือนเดิม ไม่ถูกล้างไปด้วย');
    assert.equal(peopleRows[0].querySelector('.person-name').value, 'เอ');

    const saved = JSON.parse(global.localStorage.getItem('receipt-splitter:bill'));
    assert.equal(saved.items.length, 0);
    assert.equal(saved.people.length, 1);
    assert.equal(saved.people[0].name, 'เอ');
    assert.equal(saved.settings.vatEnabled, false);
  });

  test('ลบรายการอาหารออก ต้องหายไปจากทั้งการ์ดรายการและยอดรวมทันที', async () => {
    setupDom();
    await bootApp();

    addItemViaModal({ name: 'รายการ 1', qty: 1, price: 50 });
    addItemViaModal({ name: 'รายการ 2', qty: 1, price: 75 });

    let cards = $$('#itemsBody .item-card');
    assert.equal($('#sumSubtotal').textContent, '125.00');

    click(cards[0].querySelector('.row-del'));
    cards = $$('#itemsBody .item-card');
    assert.equal(cards.length, 1);
    assert.equal($('#sumSubtotal').textContent, '75.00');
  });

  test('แสดงจำนวนรายการ และล้างรายชื่อพร้อมการระบุผู้กินได้', async () => {
    setupDom();
    await bootApp();

    assert.equal($('#itemsCount').textContent, '0 รายการ');
    assert.equal($('#categoryChips'), null, 'ไม่ควรแสดงส่วนหมวดหมู่แล้ว');

    addItemViaModal({ name: 'ข้าวผัด', qty: 1, price: 80 });
    assert.equal($('#itemsCount').textContent, '1 รายการ');

    click($('#addPersonBtn'));
    click($('#addPersonBtn'));
    assert.equal($('#clearPeopleBtn').hidden, false);

    click($('.tab[data-tab="people"]'));
    click($$('#assignList .assign-item')[0].querySelectorAll('.assign-tag:not(.assign-tag--all)')[0]);
    click($('#clearPeopleBtn'));

    assert.equal($$('#peopleList li').length, 0);
    assert.equal($('#clearPeopleBtn').hidden, true);
    const saved = JSON.parse(global.localStorage.getItem('receipt-splitter:bill'));
    assert.deepEqual(saved.people, []);
    assert.deepEqual(saved.items[0].consumerIds, []);
  });

  test('ถ้ายอดที่พาร์สรายการได้ไม่ตรงกับ subtotal ที่พิมพ์ไว้ในใบเสร็จ ต้องเพิ่มรายการให้และแจ้งเตือนผ่าน toast', async () => {
    setupDom();
    await bootApp();

    // จำลอง OCR อ่านราคารายการที่ 2 ผิดพลาด (เช่น อ่านเลขเพี้ยน) ทำให้ยอดรวมไม่ตรงกับ Subtotal ที่พิมพ์ไว้จริง
    setValue($('#ocrRawText'), 'ต้มยำกุ้ง 180.00\nข้าวผัดกุ้ง 60.00\nSubtotal 300.00');
    click($('#parseBtn'));

    const itemCards = $$('#itemsBody .item-card');
    assert.equal(itemCards.length, 2, 'ยังต้องเพิ่มรายการที่อ่านได้ให้ก่อนเสมอ แม้ยอดจะไม่ตรงก็ตาม');
    assert.equal($('#toast').hidden, false);
    assert.match($('#toast').textContent, /ไม่ตรงกับยอดในใบเสร็จ/, 'ควรมี toast เตือนว่ายอดไม่ตรงกัน');
  });

  test('พิมพ์ข้อความ OCR ที่อ่านรายการไม่ได้เลย ต้องไม่เพิ่มรายการอะไรและไม่ล้ม (แสดง toast แจ้งเตือนแทน)', async () => {
    setupDom();
    await bootApp();

    setValue($('#ocrRawText'), 'ข้อความมั่ว ๆ ที่ไม่มีราคาอยู่เลย');
    click($('#parseBtn'));

    assert.equal($$('#itemsBody .item-card').length, 0);
    assert.equal($('#toast').hidden, false, 'ควรแสดง toast แจ้งว่าอ่านรายการไม่ได้');
  });

  test('เริ่มบิลใหม่ด้วยตัวเอง (ไม่สแกน) ต้องสลับไปแท็บรายการและเปิด popup เพิ่มรายการให้ทันที', async () => {
    setupDom();
    await bootApp();

    assert.equal($$('#itemsBody .item-card').length, 0);
    click($('#manualStartBtn'));

    // ต้องสลับไปแท็บ "รายการ" โดยอัตโนมัติ
    assert.equal($('.tab[data-tab="items"]').getAttribute('aria-selected'), 'true');
    assert.equal($('#panel-items').hidden, false);

    // ต้องเปิด popup เพิ่มรายการให้ทันที ไม่ต้องกด "+ เพิ่มรายการ" ซ้ำอีกที
    assert.equal($('#itemModalOverlay').hidden, false, 'ควรเปิด popup เพิ่มรายการทันทีที่เริ่มกรอกเอง');

    setValue($('#modalItemName'), 'ต้มยำกุ้ง');
    setValue($('#modalItemPrice'), '180');
    click($('#modalSubmitBtn'));

    const cards = $$('#itemsBody .item-card');
    assert.equal(cards.length, 1);
    assert.equal(cards[0].querySelector('.item-name').value, 'ต้มยำกุ้ง');
  });

  test('การใช้งานผ่านแท็บ "รายการ" ล้วน ๆ โดยไม่แตะแท็บเริ่มต้นเลย ก็ต้องหารบิลได้ปกติ', async () => {
    setupDom();
    await bootApp();

    click($('.tab[data-tab="items"]'));
    addItemViaModal({ name: 'กาแฟเย็น', qty: 1, price: 65 });
    addItemViaModal({ name: 'ชาเขียว', qty: 1, price: 55 });

    click($('#addPersonBtn'));
    click($('.tab[data-tab="split"]'));

    const amounts = $$('#splitResult .split-card').map((c) => c.querySelector('.split-card__amount').textContent);
    assert.deepEqual(amounts, ['฿120.00']);
  });
});

describe('Popup เพิ่มรายการ: ตรวจข้อมูล / ยกเลิก / ปิด', () => {
  test('ต้องกรอกชื่อรายการและราคาก่อน จึงจะเพิ่มรายการได้', async () => {
    setupDom();
    await bootApp();

    click($('#addItemBtn'));
    click($('#modalSubmitBtn'));
    assert.equal($('#itemModalOverlay').hidden, false, 'ห้ามปิด popup หากยังไม่มีชื่อและราคา');
    assert.equal($$('#itemsBody .item-card').length, 0);
    assert.equal($('#modalItemName').getAttribute('aria-invalid'), 'true');

    setValue($('#modalItemName'), 'รายการทดสอบ');
    click($('#modalSubmitBtn'));
    assert.equal($('#itemModalOverlay').hidden, false, 'ห้ามเพิ่มหากยังไม่มีราคา');
    assert.equal($('#modalItemPrice').getAttribute('aria-invalid'), 'true');

    setValue($('#modalItemPrice'), '45');
    click($('#modalSubmitBtn'));
    assert.equal($('#itemModalOverlay').hidden, true, 'ต้องปิด popup เมื่อเพิ่มรายการสำเร็จ');
    assert.equal($$('#itemsBody .item-card').length, 1);
  });

  test('กด "ยกเลิก" ต้องปิด popup โดยไม่เพิ่มรายการ', async () => {
    setupDom();
    await bootApp();

    click($('#addItemBtn'));
    setValue($('#modalItemName'), 'ไม่ควรถูกเพิ่ม');
    click($('#modalCancelBtn'));

    assert.equal($('#itemModalOverlay').hidden, true);
    assert.equal($$('#itemsBody .item-card').length, 0);
  });

  test('กดปุ่ม × ต้องปิด popup โดยไม่เพิ่มรายการ', async () => {
    setupDom();
    await bootApp();

    click($('#addItemBtn'));
    click($('#modalCloseBtn'));

    assert.equal($('#itemModalOverlay').hidden, true);
    assert.equal($$('#itemsBody .item-card').length, 0);
  });

  test('กด Escape ต้องปิด popup โดยไม่เพิ่มรายการ', async () => {
    setupDom();
    await bootApp();

    click($('#addItemBtn'));
    assert.equal($('#itemModalOverlay').hidden, false);
    pressEscape();

    assert.equal($('#itemModalOverlay').hidden, true);
    assert.equal($$('#itemsBody .item-card').length, 0);
  });

  test('คลิกพื้นหลังนอกกล่อง (overlay) ต้องปิด popup โดยไม่เพิ่มรายการ', async () => {
    setupDom();
    await bootApp();

    click($('#addItemBtn'));
    click($('#itemModalOverlay')); // คลิกที่ overlay เอง ไม่ใช่คลิกในกล่อง modal

    assert.equal($('#itemModalOverlay').hidden, true);
    assert.equal($$('#itemsBody .item-card').length, 0);
  });
});

describe('"ใครกินอะไรบ้าง" — ปุ่มเลือกทั้งหมด (ทุกคน)', () => {
  test('กดปุ่ม "ทุกคน" ต้องเลือกคนทุกคนเป็นคนกินรายการนั้นทีเดียว', async () => {
    setupDom();
    await bootApp();

    addItemViaModal({ name: 'ต้มยำกุ้ง', qty: 1, price: 180 });
    click($('#addPersonBtn'));
    click($('#addPersonBtn'));
    click($('#addPersonBtn'));

    click($('.tab[data-tab="people"]'));
    const allBtnBefore = $$('#assignList .assign-item')[0].querySelector('.assign-tag--all');
    assert.ok(allBtnBefore, 'ต้องมีปุ่ม "ทุกคน" ในแต่ละรายการ');
    assert.equal(allBtnBefore.classList.contains('is-selected'), false);

    click(allBtnBefore);

    // ต้อง re-query ใหม่เพราะ renderAssignList วาด DOM ใหม่ทั้งหมดหลังกด
    const assignItemAfter = $$('#assignList .assign-item')[0];
    const personTags = assignItemAfter.querySelectorAll('.assign-tag:not(.assign-tag--all)');
    assert.equal(personTags.length, 3);
    personTags.forEach((tag) => assert.equal(tag.classList.contains('is-selected'), true, 'ทุกคนต้องถูกเลือกหลังกดปุ่ม "ทุกคน"'));
    assert.equal(assignItemAfter.querySelector('.assign-tag--all').classList.contains('is-selected'), true);
  });

  test('หลังกด "ทุกคน" แล้ว ยังสามารถแตะเอาคนใดคนหนึ่งออกได้ตามปกติ', async () => {
    setupDom();
    await bootApp();

    addItemViaModal({ name: 'ข้าวผัด', qty: 1, price: 60 });
    click($('#addPersonBtn'));
    click($('#addPersonBtn'));

    click($('.tab[data-tab="people"]'));
    click($$('#assignList .assign-item')[0].querySelector('.assign-tag--all'));

    let assignItem = $$('#assignList .assign-item')[0];
    const firstPersonTag = assignItem.querySelectorAll('.assign-tag:not(.assign-tag--all)')[0];
    click(firstPersonTag);

    assignItem = $$('#assignList .assign-item')[0];
    const personTags = assignItem.querySelectorAll('.assign-tag:not(.assign-tag--all)');
    assert.equal(personTags[0].classList.contains('is-selected'), false, 'คนที่แตะออกต้องถูก deselect');
    assert.equal(personTags[1].classList.contains('is-selected'), true, 'อีกคนต้องยังถูกเลือกอยู่');
  });

  test('กดปุ่ม "ทุกคน" อีกครั้งตอนเลือกทุกคนอยู่แล้ว ต้องยกเลิกเลือกทุกคนพร้อมกัน (toggle)', async () => {
    setupDom();
    await bootApp();

    addItemViaModal({ name: 'ส้มตำ', qty: 1, price: 90 });
    click($('#addPersonBtn'));
    click($('#addPersonBtn'));

    click($('.tab[data-tab="people"]'));
    const allBtn = () => $$('#assignList .assign-item')[0].querySelector('.assign-tag--all');

    click(allBtn()); // ครั้งที่ 1: เลือกทุกคน
    assert.equal(allBtn().classList.contains('is-selected'), true);

    click(allBtn()); // ครั้งที่ 2: ต้องยกเลิกเลือกทุกคนพร้อมกัน

    const assignItemAfter = $$('#assignList .assign-item')[0];
    assert.equal(assignItemAfter.querySelector('.assign-tag--all').classList.contains('is-selected'), false);
    const personTags = assignItemAfter.querySelectorAll('.assign-tag:not(.assign-tag--all)');
    personTags.forEach((tag) => assert.equal(tag.classList.contains('is-selected'), false, 'ทุกคนต้องถูกยกเลิกเลือกหลังกด "ทุกคน" ครั้งที่ 2'));
  });
});

describe('เมนูหารบิล: สรุปรายการที่แต่ละคนกิน', () => {
  test('การ์ดสรุปผลของแต่ละคนต้องแสดงรายการอาหารที่คนนั้นกินด้วย', async () => {
    setupDom();
    await bootApp();

    addItemViaModal({ name: 'ต้มยำกุ้ง', qty: 1, price: 180 });
    addItemViaModal({ name: 'ข้าวผัดกุ้ง', qty: 1, price: 120 });
    click($('#addPersonBtn'));
    click($('#addPersonBtn'));

    // ให้คนแรกกินแค่ต้มยำกุ้งคนเดียว (ข้าวผัดกุ้งไม่ระบุ = ทุกคนกินร่วมกัน)
    click($('.tab[data-tab="people"]'));
    click($$('#assignList .assign-item')[0].querySelectorAll('.assign-tag:not(.assign-tag--all)')[0]);

    click($('.tab[data-tab="split"]'));
    const splitCards = $$('#splitResult .split-card');
    const firstPersonChips = Array.from(splitCards[0].querySelectorAll('.split-card__item-chip')).map((c) => c.textContent);
    assert.ok(firstPersonChips.some((t) => t.includes('ต้มยำกุ้ง')), 'คนแรกควรเห็นในสรุปว่ากินต้มยำกุ้ง');
    assert.ok(firstPersonChips.some((t) => t.includes('ข้าวผัดกุ้ง')), 'คนแรกควรเห็นข้าวผัดกุ้งด้วย (ไม่ระบุ = กินร่วมกันทุกคน)');

    // สลับโหมดหารก็ต้องยังเห็นสรุปเดิม (ไม่เกี่ยวกับโหมดคำนวณเงิน)
    click($('.split-mode__btn[data-mode="itemized"]'));
    const firstPersonChipsItemized = Array.from($$('#splitResult .split-card')[0].querySelectorAll('.split-card__item-chip')).map((c) => c.textContent);
    assert.ok(firstPersonChipsItemized.some((t) => t.includes('ต้มยำกุ้ง')));
  });
});

describe('แท็บเมนู: ไม่มีตัวเลขลำดับกำกับ', () => {
  test('ไอคอนแท็บต้องไม่มี badge เลขลำดับอีกต่อไป', async () => {
    setupDom();
    await bootApp();
    assert.equal($$('.tab__num').length, 0);
  });
});
