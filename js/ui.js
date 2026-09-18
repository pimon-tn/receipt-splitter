// ui.js
// หน้าที่เดียว: วาดสถานะ (state) ลงบน DOM
// ฟังก์ชันในไฟล์นี้ไม่แก้ไข state เอง มีแต่ "อ่านแล้ววาด"

import {
  calcBillTotals,
  splitEqual,
  splitItemized,
  getConsumptionSummary,
  countUnassignedItems,
  formatMoney,
} from './splitter.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $all = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/* ---------------- Flow / navigation ----------------
   โครงสร้างขั้นตอนทั้งหมดอยู่ที่ STEPS ที่เดียว — ทั้งแถบขั้นตอนด้านล่างและแท็บย่อย
   ล้วน derive จากตารางนี้ ผู้ใช้สลับหน้าโดยแตะแถบขั้นตอน/แท็บย่อยโดยตรง ไม่มีปุ่ม
   ย้อนกลับ/ถัดไปในตัวหน้าอีกต่อไป

   หนึ่งขั้นตอน (step) มีได้หลายหน้าจอ (panel) — หน้าจอในขั้นตอนเดียวกันจะโชว์
   เป็น "แท็บย่อย" ให้สลับกันได้
*/
const STEPS = [
  { step: 1, panels: ['items', 'charges'] },
  { step: 2, panels: ['people'] },
  { step: 3, panels: ['method'] },
  { step: 4, panels: ['split'] },
];

const PANEL_META = {
  landing: { title: '' },
  scan: { title: 'เริ่มต้นใช้งาน' },
  items: { title: 'รายการอาหาร', subLabel: 'รายการอาหาร' },
  charges: { title: 'ค่าใช้จ่ายเพิ่มเติม', subLabel: 'ภาษีและค่าบริการ' },
  people: { title: 'คนที่ร่วมกิน' },
  method: { title: 'เลือกวิธีแบ่งค่าใช้จ่าย', subLabel: 'วิธีหารบิล' },
  split: { title: 'สรุปผลการหารบิล' },
};

let currentTab = 'landing';
// โหมดการหารที่เลือกอยู่ เก็บเป็น view state เพราะมันกำหนดว่า flow มีหน้า assign หรือไม่
// (app.js เป็นเจ้าของค่าจริง แล้ว sync เข้ามาผ่าน renderSplitMode())
let currentMode = 'equal';

export function getCurrentTab() {
  return currentTab;
}

/** หน้าจอของขั้นตอนหนึ่ง */
function stepPanels(step) {
  const group = STEPS.find((s) => s.step === step);
  return group ? group.panels : [];
}

/** ลำดับหน้าจอทั้งหมด (ใช้กันไม่ให้ switchTab พาไปหน้าที่ไม่มีอยู่จริง) */
function flowFor() {
  return ['landing', 'scan', ...STEPS.flatMap((s) => stepPanels(s.step))];
}

function stepOf(panelName) {
  return STEPS.find((s) => s.panels.includes(panelName))?.step ?? 0;
}

export function switchTab(tabName) {
  let target = tabName;

  // กันหน้าที่ไม่มีอยู่ใน flow ของโหมดปัจจุบัน (เช่นสั่งไป assign ตอนเลือกหารเท่ากัน)
  // ให้เด้งไปหน้าแรกของขั้นตอนนั้นแทน ดีกว่าโชว์หน้าที่ผู้ใช้ไม่ควรต้องทำ
  if (!flowFor().includes(target)) {
    target = stepPanels(stepOf(target))[0] || 'landing';
  }

  const meta = PANEL_META[target];
  if (!meta) return;
  currentTab = target;

  $all('.panel').forEach((panel) => {
    panel.hidden = panel.dataset.panel !== target;
  });

  // แถบ step โชว์เฉพาะหน้าที่อยู่ในขั้นตอนการหารบิล (1-4)
  const step = stepOf(target);
  $('#tabs').hidden = step === 0;
  $all('.tab').forEach((btn) => {
    const btnStep = stepOf(btn.dataset.tab);
    btn.setAttribute('aria-selected', btnStep === step ? 'true' : 'false');
    btn.classList.toggle('is-done', btnStep < step);
  });

  // หน้า landing เต็มจอ ไม่มี app bar / footer มากวน
  const isLanding = target === 'landing';
  $('#appbar').hidden = isLanding;
  $('.app-foot').hidden = isLanding;

  // เปลี่ยนหน้าแล้วต้องเริ่มอ่านจากด้านบนเสมอ
  // (บนจอใหญ่ตัว .app เป็น scroll container เอง จึงต้องรีเซ็ตทั้งสองที่)
  window.scrollTo?.({ top: 0, behavior: 'auto' });
  const app = $('#app');
  if (app) app.scrollTop = 0;
}

/* ---------------- Step nav: แท็บย่อย ----------------
   เรียกทุกครั้งที่เปลี่ยนหน้า เปลี่ยนโหมดการหาร หรือข้อมูลบิลเปลี่ยน
*/
export function renderStepNav(mode = currentMode) {
  currentMode = mode;

  const step = stepOf(currentTab);
  const panels = stepPanels(step);
  const bar = $('#substeps');

  // --- แท็บย่อย: โชว์เฉพาะขั้นตอนที่มีมากกว่า 1 หน้า ---
  bar.innerHTML = '';
  bar.hidden = panels.length < 2;
  if (!bar.hidden) {
    panels.forEach((name) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'substep' + (name === currentTab ? ' is-active' : '');
      btn.dataset.substep = name;
      btn.setAttribute('aria-current', name === currentTab ? 'page' : 'false');
      btn.textContent = PANEL_META[name].subLabel || PANEL_META[name].title;
      bar.appendChild(btn);
    });
  }
}

/* ---------------- Toast ---------------- */

let toastTimer = null;
export function showToast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2600);
}

/* ---------------- Scan / OCR states ---------------- */

/** @param {'loading'|'ok'|'error'} kind */
export function setScanStatus(message, kind = 'loading') {
  const el = $('#scanStatus');
  el.hidden = !message;
  el.textContent = message || '';
  el.className = 'state-note' + (kind === 'error' ? ' state--error' : kind === 'ok' ? ' state--ok' : ' state--loading');
}

/* ---------------- Items ---------------- */

export function renderItems(bill, handlers) {
  const body = $('#itemsBody');
  body.innerHTML = '';
  $('#itemsEmptyHint').hidden = bill.items.length > 0;
  $('#itemsCount').textContent = `${bill.items.length} รายการ`;

  bill.items.forEach((item) => {
    const card = document.createElement('div');
    card.className = 'item-card';
    card.dataset.id = item.id;

    card.innerHTML = `
      <button type="button" class="item-main" aria-label="แก้ไขรายการ ${escapeHtml(item.name)}">
        <span class="item-name">${escapeHtml(item.name)}</span>
        <span class="item-price">฿${formatMoney(item.qty * item.price)}</span>
      </button>
      <div class="qty-stepper">
        <button type="button" class="qty-btn qty-btn--minus" aria-label="ลดจำนวน"><i class="uicon fi-br-minus" aria-hidden="true"></i></button>
        <span class="item-qty" aria-label="จำนวน">${item.qty}</span>
        <button type="button" class="qty-btn qty-btn--plus" aria-label="เพิ่มจำนวน"><i class="uicon fi-br-add" aria-hidden="true"></i></button>
      </div>
      <button type="button" class="row-edit" aria-label="แก้ไขรายการ ${escapeHtml(item.name)}"><i class="uicon fi-br-edit" aria-hidden="true"></i></button>
      <button type="button" class="row-del" aria-label="ลบรายการ ${escapeHtml(item.name)}"><i class="uicon fi-br-trash-xmark" aria-hidden="true"></i></button>
    `;

    $('.item-main', card).addEventListener('click', () => handlers.onEditItem(item.id));
    $('.row-edit', card).addEventListener('click', () => handlers.onEditItem(item.id));
    $('.row-del', card).addEventListener('click', () => handlers.onRemoveItem(item.id));
    $('.qty-btn--minus', card).addEventListener('click', () => handlers.onUpdateItem(item.id, { qty: Math.max(1, item.qty - 1) }));
    $('.qty-btn--plus', card).addEventListener('click', () => handlers.onUpdateItem(item.id, { qty: item.qty + 1 }));

    body.appendChild(card);
  });
}

export function renderTotals(bill) {
  const totals = calcBillTotals(bill.items, bill.settings);
  const { vatEnabled, vatPercent, serviceEnabled, servicePercent } = bill.settings;

  $('#itemsSubtotal').textContent = '฿' + formatMoney(totals.subtotal);
  $('#sumSubtotal').textContent = formatMoney(totals.subtotal);
  $('#sumService').textContent = formatMoney(totals.serviceAmount);
  $('#sumVat').textContent = formatMoney(totals.vatAmount);
  $('#sumGrand').textContent = formatMoney(totals.grandTotal);

  $('#lblSubtotal').textContent = 'ค่าอาหาร';
  $('#lblVat').textContent = vatEnabled ? `ภาษีมูลค่าเพิ่ม (${vatPercent}%)` : 'ภาษีมูลค่าเพิ่ม (ไม่มี)';
  $('#lblService').textContent = serviceEnabled ? `ค่าบริการ (${servicePercent}%)` : 'ค่าบริการ (ไม่มี)';
}

/* ---------------- Charge settings (VAT / service) ---------------- */

export function renderChargeSettings(bill) {
  const { vatEnabled, vatPercent, serviceEnabled, servicePercent } = bill.settings;

  $('#vatEnabledInput').checked = vatEnabled;
  $('#vatPercentInput').value = vatPercent;

  $('#serviceEnabledInput').checked = serviceEnabled;
  $('#servicePercentInput').value = servicePercent;
}

/* ---------------- People ---------------- */

export function renderPeople(bill, handlers) {
  const list = $('#peopleList');
  list.innerHTML = '';
  $('#peopleEmptyHint').hidden = bill.people.length > 0;
  $('#clearPeopleBtn').hidden = bill.people.length === 0;
  $('#peopleCount').textContent = `${bill.people.length} คน`;

  bill.people.forEach((person, index) => {
    const li = document.createElement('li');
    li.innerHTML = `
      <span class="avatar" data-tone="${toneOf(index)}">${getInitial(person.name)}</span>
      <input type="text" class="person-name" value="${escapeHtml(person.name)}" placeholder="ชื่อคน">
      <button type="button" class="row-del" aria-label="ลบ ${escapeHtml(person.name)}"><i class="uicon fi-br-trash-xmark" aria-hidden="true"></i></button>
    `;
    $('.person-name', li).addEventListener('input', (e) => {
      handlers.onUpdatePerson(person.id, e.target.value);
      $('.avatar', li).textContent = getInitial(e.target.value);
    });
    $('.row-del', li).addEventListener('click', () => handlers.onRemovePerson(person.id));
    list.appendChild(li);
  });
}

/* ---------------- Assign: ใครกินอะไร ---------------- */

export function renderAssignList(bill, handlers) {
  const wrap = $('#assignList');
  const warn = $('#assignWarn');
  wrap.innerHTML = '';

  if (bill.items.length === 0 || bill.people.length === 0) {
    warn.hidden = true;
    wrap.innerHTML = `
      <div class="empty-state">
        <i class="empty-state__icon uicon fi-br-restaurant" aria-hidden="true"></i>
        <p class="empty-state__title">ยังระบุคนกินไม่ได้</p>
        <p class="empty-state__desc">ต้องมีทั้งรายการอาหารและรายชื่อคนก่อน</p>
      </div>`;
    return;
  }

  const unassigned = countUnassignedItems(bill.items);
  warn.hidden = unassigned === 0;
  warn.textContent = `ยังมี ${unassigned} รายการที่ไม่ได้ระบุคน — ระบบจะหารรายการเหล่านั้นให้ทุกคนเท่า ๆ กัน`;

  bill.items.forEach((item) => {
    const card = document.createElement('div');
    card.className = 'assign-item';
    const consumerIds = item.consumerIds || [];
    const allSelected = bill.people.every((p) => consumerIds.includes(p.id));

    card.innerHTML = `
      <div class="assign-item__title">
        <span>${escapeHtml(item.name || 'ไม่มีชื่อ')}${item.qty > 1 ? ` &times;${item.qty}` : ''}</span>
        <span>฿${formatMoney(item.qty * item.price)}</span>
      </div>
      <div class="assign-people"></div>
      ${consumerIds.length === 0 ? '<p class="assign-item__note">ยังไม่ได้เลือกคน → ระบบจะหารรายการนี้ให้ทุกคน</p>' : ''}
    `;

    const tagWrap = $('.assign-people', card);

    const allBtn = document.createElement('button');
    allBtn.type = 'button';
    allBtn.className = 'assign-tag assign-tag--all' + (allSelected ? ' is-selected' : '');
    allBtn.textContent = 'ทุกคน';
    allBtn.addEventListener('click', () => handlers.onSelectAllConsumers(item.id));
    tagWrap.appendChild(allBtn);

    const sep = document.createElement('span');
    sep.className = 'assign-people__sep';
    tagWrap.appendChild(sep);

    bill.people.forEach((person, index) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'assign-tag' + (consumerIds.includes(person.id) ? ' is-selected' : '');
      btn.innerHTML = `<span class="avatar" data-tone="${toneOf(index)}">${getInitial(person.name)}</span><span>${escapeHtml(person.name || 'ไม่มีชื่อ')}</span>`;
      btn.addEventListener('click', () => handlers.onToggleConsumer(item.id, person.id));
      tagWrap.appendChild(btn);
    });

    wrap.appendChild(card);
  });
}

/* ---------------- Split mode selector ---------------- */

export function renderSplitMode(mode) {
  currentMode = mode;
  $all('.split-mode__btn').forEach((btn) => {
    const active = btn.dataset.mode === mode;
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-checked', active ? 'true' : 'false');
  });

  // บอกให้ชัดว่าตัวเลือกนี้ทำให้ต้องทำอะไรต่อ (หารตามรายการ = ต้องระบุใครกินอะไรด้านล่างนี้ก่อน)
  const note = $('#methodNextNote');
  if (note) {
    note.textContent = mode === 'itemized'
      ? 'ระบุว่าใครกินอะไรด้านล่าง แล้วดูสรุปผลได้เลย'
      : 'ขั้นตอนถัดไป: ดูสรุปผลได้เลย ไม่ต้องระบุว่าใครกินอะไร';
  }

  // โหมดหารตามรายการที่กิน: โชว์ส่วน "ใครกินอะไร" ต่อในหน้าเดียวกันเลย ไม่ต้องสลับแท็บ
  const assignSection = $('#assignSection');
  if (assignSection) assignSection.hidden = mode !== 'itemized';
}

/* ---------------- Split results ---------------- */

/** จำนวน chip รายการอาหารสูงสุดที่โชว์บนการ์ดสรุป ที่เหลือยุบเป็น "+N" (กดการ์ดดูทั้งหมดได้) */
const MAX_CHIPS = 10;

export function renderSplit(bill, mode, handlers = {}) {
  const wrap = $('#splitResult');
  const resultMain = wrap.closest('.result-main');
  const hint = $('#splitHint');
  wrap.innerHTML = '';

  if (bill.people.length === 0 || bill.items.length === 0) {
    const missingPeople = bill.people.length === 0;
    if (resultMain) resultMain.hidden = false;
    if (hint) hint.textContent = 'แตะที่ชื่อแต่ละคน เพื่อดูรายการอาหารที่หารและยอดของแต่ละรายการ';
    wrap.innerHTML = `
      <div class="empty-state">
        <i class="empty-state__icon uicon ${missingPeople ? 'fi-br-user-add' : 'fi-br-restaurant'}" aria-hidden="true"></i>
        <p class="empty-state__title">${missingPeople ? 'ยังไม่มีรายชื่อคนกิน' : 'ยังไม่มีรายการอาหาร'}</p>
        <p class="empty-state__desc">${missingPeople ? 'เพิ่มรายชื่อคนกินก่อน จึงจะหารบิลได้' : 'เพิ่มรายการอาหารก่อน จึงจะหารบิลได้'}</p>
      </div>`;
    renderSummaryPanel(bill, [], mode);
    return;
  }

  const result = computeSplit(bill, mode);

  // หารเท่ากัน: ทุกคนจ่ายเท่ากันอยู่แล้ว โชว์แค่การ์ดยอดรวมด้านบนพอ ไม่ต้องมีรายละเอียดต่อคนให้กดดู
  if (mode === 'equal') {
    if (resultMain) resultMain.hidden = true;
    if (hint) hint.textContent = 'หารเท่ากันทุกคน ดูยอดที่ต้องจ่ายได้จากการ์ดด้านบน';
    renderSummaryPanel(bill, result.perPerson, mode);
    return;
  }

  if (resultMain) resultMain.hidden = false;
  if (hint) hint.textContent = 'แตะชื่อเพื่อดูยอดของแต่ละรายการ หรือแตะลูกศรเพื่อดูรายการอาหารที่หาร';

  const consumption = getConsumptionSummary(bill.items, bill.people);

  result.perPerson.forEach((p, index) => {
    const name = p.name || 'ไม่มีชื่อ';
    const card = document.createElement('div');
    card.className = 'split-card';
    card.dataset.personId = p.personId;

    const items = consumption.get(p.personId) || [];
    const shown = items.slice(0, MAX_CHIPS);
    const rest = items.length - shown.length;
    const chips = items.length
      ? shown.map((it) => `<span class="split-card__item-chip">${escapeHtml(it.name)}${it.qty > 1 ? ` &times;${it.qty}` : ''}</span>`).join('')
        + (rest > 0 ? `<span class="split-card__item-chip split-card__item-chip--more">+${rest}</span>` : '')
      : '<span class="split-card__item-chip split-card__item-chip--more">ไม่ได้กินอะไรเลย</span>';

    card.innerHTML = `
      <div class="split-card__row">
        <button type="button" class="split-card__main" aria-label="ดูยอดของ ${escapeHtml(name)}">
          <span class="avatar avatar--lg" data-tone="${toneOf(index)}" aria-hidden="true">${getInitial(p.name)}</span>
          <span class="split-card__name">${escapeHtml(name)}</span>
          <span class="split-card__amount">฿${formatMoney(p.amount)}</span>
        </button>
        <button type="button" class="split-card__expand-btn" aria-expanded="false" aria-label="ดูรายการอาหารของ ${escapeHtml(name)}">
          <i class="uicon fi-br-angle-down" aria-hidden="true"></i>
        </button>
      </div>
      <div class="split-card__detail" hidden>
        <span class="split-card__sub">ค่าอาหาร ฿${formatMoney(p.subtotal)} + ส่วนแบ่งค่าบริการ/ภาษี</span>
        <div class="split-card__items">${chips}</div>
      </div>
    `;

    const mainBtn = card.querySelector('.split-card__main');
    const expandBtn = card.querySelector('.split-card__expand-btn');
    const detail = card.querySelector('.split-card__detail');

    if (handlers.onSelectPerson) {
      mainBtn.addEventListener('click', () => handlers.onSelectPerson(p.personId));
    }
    expandBtn.addEventListener('click', () => {
      const expanded = expandBtn.getAttribute('aria-expanded') === 'true';
      expandBtn.setAttribute('aria-expanded', String(!expanded));
      expandBtn.classList.toggle('is-expanded', !expanded);
      detail.hidden = expanded;
    });

    wrap.appendChild(card);
  });

  renderSummaryPanel(bill, result.perPerson, mode);
}

/** เรียกตัวคำนวณตามโหมดที่เลือก (ใช้ร่วมกันระหว่างการ์ดสรุปและ sheet รายละเอียด) */
function computeSplit(bill, mode) {
  return mode === 'itemized'
    ? splitItemized(bill.items, bill.people, bill.settings)
    : splitEqual(bill.items, bill.people, bill.settings);
}

function renderSummaryPanel(bill, perPerson, mode) {
  const panel = $('#summaryPanel');
  if (!panel) return;

  const totals = calcBillTotals(bill.items, bill.settings);
  const sumOfPeople = perPerson.reduce((sum, p) => sum + p.amount, 0);
  // ตรวจจริงว่ายอดที่แสดงต่อคนรวมกันแล้วตรงกับยอดบิลที่แสดง (ไม่ใช่ข้อความตายตัว)
  const matches = perPerson.length > 0
    && Math.round(sumOfPeople * 100) === Math.round(totals.grandTotal * 100);

  // หารไม่เท่ากัน: การ์ดนี้โชว์แค่ยอดรวม รายชื่อรายคนไปอยู่ในการ์ดด้านล่างแทน (กดขยายดูได้)
  const showPeopleList = mode !== 'itemized';

  panel.innerHTML = `
    <p class="summary-panel__label">ยอดรวมทั้งหมด</p>
    <strong class="summary-panel__total">฿${formatMoney(totals.grandTotal)}</strong>
    ${showPeopleList ? `
    <div class="summary-panel__people">
      ${perPerson.length
        ? perPerson.map((person, index) => `
          <div class="summary-person">
            <span class="avatar avatar--sm" data-tone="${toneOf(index)}" aria-hidden="true">${getInitial(person.name)}</span>
            <span>${escapeHtml(person.name || 'ไม่มีชื่อ')}</span>
            <strong>฿${formatMoney(person.amount)}</strong>
          </div>`).join('')
        : '<p class="summary-empty">เพิ่มรายการและรายชื่อเพื่อดูยอดสรุป</p>'}
    </div>` : ''}
    ${matches
      ? '<div class="summary-note"><i class="uicon fi-br-check-circle" aria-hidden="true"></i><span>ยอดของทุกคนรวมกันตรงกับยอดบิลแล้ว</span></div>'
      : ''}
  `;
}

/* ---------------- Person detail sheet (รายการอาหารที่แต่ละคนหาร) ---------------- */

export function openPersonSheet(bill, mode, personId) {
  const body = $('#personSheetBody');
  const index = bill.people.findIndex((p) => p.id === personId);
  if (index < 0) return;

  const person = bill.people[index];
  const result = computeSplit(bill, mode);
  const row = result.perPerson.find((p) => p.personId === personId);
  if (!row) return;

  const items = getConsumptionSummary(bill.items, bill.people).get(personId) || [];

  const itemsHtml = items.length
    ? items.map((it) => `
        <div class="person-item">
          <div>
            <div class="person-item__name">${escapeHtml(it.name)}${it.qty > 1 ? ` &times;${it.qty}` : ''}</div>
            <div class="person-item__meta">฿${formatMoney(it.lineTotal)}${it.isShared ? ` &divide; ${it.sharedWith} คน` : ' · กินคนเดียว'}</div>
          </div>
          <div class="person-item__share">฿${formatMoney(it.share)}</div>
        </div>`).join('')
    : '<p class="summary-empty">ไม่ได้ระบุว่ากินรายการไหนเลย</p>';

  // โหมด "หารตามรายการที่กิน": ยอดของแต่ละคนอ้างจากรายการที่กินจริง จึงกระทบยอดกันได้ตรง ๆ
  // โหมด "หารเท่ากัน": ยอดมาจากการหารยอดบิลด้วยจำนวนคน รายการด้านบนจึงเป็นข้อมูลอ้างอิงเท่านั้น
  const breakdown = mode === 'itemized'
    ? `
      <div class="totals-row"><span>ค่าอาหารของ ${escapeHtml(person.name || 'คนนี้')}</span><span>฿${formatMoney(row.subtotal)}</span></div>
      <div class="totals-row"><span>ส่วนแบ่งค่าบริการ/ภาษี</span><span>฿${formatMoney(row.amount - row.subtotal)}</span></div>
      <div class="totals-row totals-row--grand"><span>รวมที่ต้องจ่าย</span><span>฿${formatMoney(row.amount)}</span></div>`
    : `
      <div class="totals-row"><span>ยอดรวมทั้งบิล</span><span>฿${formatMoney(result.totals.grandTotal)}</span></div>
      <div class="totals-row"><span>หารเท่ากัน</span><span>&divide; ${bill.people.length} คน</span></div>
      <div class="totals-row totals-row--grand"><span>รวมที่ต้องจ่าย</span><span>฿${formatMoney(row.amount)}</span></div>`;

  body.innerHTML = `
    <div class="person-head">
      <span class="avatar avatar--lg" data-tone="${toneOf(index)}" aria-hidden="true">${getInitial(person.name)}</span>
      <div>
        <p class="person-head__name" id="personSheetName">${escapeHtml(person.name || 'ไม่มีชื่อ')}</p>
        <p class="person-head__mode">${mode === 'itemized' ? 'หารตามรายการที่กิน' : 'หารเท่ากันทุกคน'}</p>
      </div>
    </div>

    <div class="person-breakdown">${breakdown}</div>

    <p class="field-label"><i class="uicon fi-br-restaurant inline-icon" aria-hidden="true"></i> รายการที่หาร <span class="items-count">${items.length} รายการ</span></p>
    <div class="person-items">${itemsHtml}</div>

    ${mode === 'equal'
      ? '<p class="assign-item__note">โหมดหารเท่ากันไม่คิดตามรายการที่กิน รายการด้านบนแสดงไว้ให้ดูอ้างอิงเท่านั้น</p>'
      : ''}
  `;

  openSheet('#personSheetOverlay');
}

/* ---------------- Sheets & modal ---------------- */

function openSheet(selector) {
  $(selector).hidden = false;
  document.body.style.overflow = 'hidden';
}

export function closeSheet(selector) {
  $(selector).hidden = true;
  if (!isAnyOverlayOpen()) document.body.style.overflow = '';
}

export function openShareSheet() {
  openSheet('#shareSheetOverlay');
}

function isAnyOverlayOpen() {
  return ['#personSheetOverlay', '#shareSheetOverlay', '#itemModalOverlay']
    .some((sel) => !$(sel).hidden);
}

/** ปิดทุก overlay ที่เปิดอยู่ (ใช้กับปุ่ม Escape / เริ่มบิลใหม่) */
export function closeAllOverlays() {
  ['#personSheetOverlay', '#shareSheetOverlay', '#itemModalOverlay'].forEach((sel) => { $(sel).hidden = true; });
  document.body.style.overflow = '';
}

export function openItemModal(item) {
  const overlay = $('#itemModalOverlay');
  const nameInput = $('#modalItemName');
  const qtyInput = $('#modalItemQty');
  const priceInput = $('#modalItemPrice');

  if (item) {
    overlay.dataset.editingId = item.id;
    $('#itemModalTitle').innerHTML = '<i class="uicon fi-br-restaurant inline-icon" aria-hidden="true"></i> แก้ไขรายการอาหาร';
    $('#modalSubmitBtn').textContent = 'บันทึกการแก้ไข';
    nameInput.value = item.name;
    qtyInput.value = item.qty;
    priceInput.value = item.price;
  } else {
    delete overlay.dataset.editingId;
    $('#itemModalTitle').innerHTML = '<i class="uicon fi-br-restaurant inline-icon" aria-hidden="true"></i> เพิ่มรายการอาหาร';
    $('#modalSubmitBtn').textContent = '+ เพิ่มรายการ';
    nameInput.value = '';
    qtyInput.value = '1';
    priceInput.value = '';
  }
  nameInput.removeAttribute('aria-invalid');
  priceInput.removeAttribute('aria-invalid');

  openSheet('#itemModalOverlay');
  nameInput.focus();
}

export function closeItemModal() {
  closeSheet('#itemModalOverlay');
  delete $('#itemModalOverlay').dataset.editingId;
}

export function isItemModalOpen() {
  return !$('#itemModalOverlay').hidden;
}

export function getEditingItemId() {
  return $('#itemModalOverlay').dataset.editingId || null;
}

/* ---------------- Helpers ---------------- */

/** สีประจำคน วนซ้ำใน 8 โทน — ใช้ช่วยจำ ไม่ได้ใช้สื่อความหมายเพียงอย่างเดียว */
function toneOf(index) {
  return index % 8;
}

function getInitial(name) {
  const trimmed = (name || '').trim();
  return trimmed ? trimmed[0].toUpperCase() : '?';
}

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
  }[c]));
}
