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

/** import แอปตัวจริงแบบ "สด" ทุกครั้ง (ผ่าน query string กัน cache) เพื่อไม่ให้ state ค้างข้ามเทสต์ */
async function bootApp() {
  await import(`../js/app.js?fresh=${Date.now()}-${Math.random()}`);
}

describe('การใช้งานจริงทั้งวงจร: สแกน → รายการ → คนกิน → ตั้งค่า VAT/ค่าบริการ → หารบิล', () => {
  test('ผู้ใช้วางข้อความ OCR, เพิ่มรายการเอง, เพิ่มคน, เปิด VAT+ค่าบริการ แล้วดูผลหารบิลทั้ง 2 โหมด', async () => {
    setupDom();
    await bootApp();

    // ---- แท็บสแกน: วางข้อความที่ "อ่านได้" จากใบเสร็จ แล้วกดแปลงเป็นรายการ ----
    setValue($('#ocrRawText'), 'ต้มยำกุ้ง 180.00\nข้าวผัดกุ้ง x2 60.00');
    click($('#parseBtn'));

    let itemCards = $$('#itemsBody .item-card');
    assert.equal(itemCards.length, 2, 'ควรมี 2 รายการหลังแปลงข้อความ OCR');
    assert.equal(itemCards[0].querySelector('.item-name').value, 'ต้มยำกุ้ง');
    assert.equal(itemCards[1].querySelector('.item-qty').value, '2');

    // ---- แท็บรายการ: เพิ่มรายการเองอีก 1 รายการ ----
    click($('#addItemBtn'));
    itemCards = $$('#itemsBody .item-card');
    assert.equal(itemCards.length, 3);
    setValue(itemCards[2].querySelector('.item-name'), 'น้ำเปล่า');
    setValue(itemCards[2].querySelector('.item-price'), '20');

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
    click(firstAssignItem.querySelectorAll('.assign-tag')[0]);

    click($('.tab[data-tab="split"]'));
    splitCards = $$('#splitResult .split-card');
    const total = splitCards
      .map((c) => parseFloat(c.querySelector('.split-card__amount').textContent.replace('฿', '')))
      .reduce((a, b) => a + b, 0);
    assert.ok(Math.abs(total - 376.64) < 0.02, 'ไม่ว่าจะแบ่งกันยังไง รวมกันต้องได้ยอดสุทธิทั้งบิลเท่าเดิม');

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

    click($('#addItemBtn'));
    const card = $$('#itemsBody .item-card')[0];
    setValue(card.querySelector('.item-price'), '100');
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

  test('กด "เริ่มบิลใหม่" ต้องล้างรายการ/คน/การตั้งค่ากลับเป็นค่าเริ่มต้นทั้งหมด', async () => {
    setupDom();
    await bootApp();

    click($('#addItemBtn'));
    click($('#addPersonBtn'));
    setChecked($('#vatEnabledInput'), true);
    assert.equal($$('#itemsBody .item-card').length, 1);
    assert.equal($$('#peopleList li').length, 1);

    click($('#newBillBtn')); // window.confirm ถูก stub ให้คืนค่า true ไว้แล้วใน setupDom()

    assert.equal($$('#itemsBody .item-card').length, 0);
    assert.equal($$('#peopleList li').length, 0);
    assert.equal($('#vatEnabledInput').checked, false);

    const saved = JSON.parse(global.localStorage.getItem('receipt-splitter:bill'));
    assert.equal(saved.items.length, 0);
    assert.equal(saved.settings.vatEnabled, false);
  });

  test('ลบรายการอาหารออก ต้องหายไปจากทั้งการ์ดรายการและยอดรวมทันที', async () => {
    setupDom();
    await bootApp();

    click($('#addItemBtn'));
    click($('#addItemBtn'));
    let cards = $$('#itemsBody .item-card');
    setValue(cards[0].querySelector('.item-price'), '50');
    setValue(cards[1].querySelector('.item-price'), '75');
    assert.equal($('#sumSubtotal').textContent, '125.00');

    click(cards[0].querySelector('.row-del'));
    cards = $$('#itemsBody .item-card');
    assert.equal(cards.length, 1);
    assert.equal($('#sumSubtotal').textContent, '75.00');
  });

  test('พิมพ์ข้อความ OCR ที่อ่านรายการไม่ได้เลย ต้องไม่เพิ่มรายการอะไรและไม่ล้ม (แสดง toast แจ้งเตือนแทน)', async () => {
    setupDom();
    await bootApp();

    setValue($('#ocrRawText'), 'ข้อความมั่ว ๆ ที่ไม่มีราคาอยู่เลย');
    click($('#parseBtn'));

    assert.equal($$('#itemsBody .item-card').length, 0);
    assert.equal($('#toast').hidden, false, 'ควรแสดง toast แจ้งว่าอ่านรายการไม่ได้');
  });

  test('เริ่มบิลใหม่ด้วยตัวเอง (ไม่สแกน) ต้องพาไปแท็บรายการพร้อมรายการเปล่าให้กรอกทันที', async () => {
    setupDom();
    await bootApp();

    assert.equal($$('#itemsBody .item-card').length, 0);
    click($('#manualStartBtn'));

    // ต้องสลับไปแท็บ "รายการ" โดยอัตโนมัติ
    assert.equal($('.tab[data-tab="items"]').getAttribute('aria-selected'), 'true');
    assert.equal($('#panel-items').hidden, false);

    // ต้องมีรายการเปล่าเตรียมไว้ให้กรอกทันที ไม่ต้องกด "+ เพิ่มรายการ" อีกที
    const cards = $$('#itemsBody .item-card');
    assert.equal(cards.length, 1);
    assert.equal(cards[0].querySelector('.item-name').value, '');

    // กดซ้ำอีกครั้งไม่ควรเพิ่มรายการเปล่าซ้อนอีกใบ (เช็คว่าไม่ duplicate ถ้ามีรายการอยู่แล้ว)
    click($('#manualStartBtn'));
    assert.equal($$('#itemsBody .item-card').length, 1);
  });

  test('การใช้งานผ่านแท็บ "รายการ" ล้วน ๆ โดยไม่แตะแท็บสแกน/เริ่มต้นเลย ก็ต้องหารบิลได้ปกติ', async () => {
    setupDom();
    await bootApp();

    // ผู้ใช้ไปที่แท็บรายการตรง ๆ เพิ่มรายการเองทั้งหมด ไม่ผ่านการสแกนหรือปุ่มเริ่มต้นใด ๆ
    click($('.tab[data-tab="items"]'));
    click($('#addItemBtn'));
    click($('#addItemBtn'));
    const cards = $$('#itemsBody .item-card');
    setValue(cards[0].querySelector('.item-name'), 'กาแฟเย็น');
    setValue(cards[0].querySelector('.item-price'), '65');
    setValue(cards[1].querySelector('.item-name'), 'ชาเขียว');
    setValue(cards[1].querySelector('.item-price'), '55');

    click($('#addPersonBtn'));
    click($('.tab[data-tab="split"]'));

    const amounts = $$('#splitResult .split-card').map((c) => c.querySelector('.split-card__amount').textContent);
    assert.deepEqual(amounts, ['฿120.00']);
  });
});
