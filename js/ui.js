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
   โครงสร้างขั้นตอนทั้งหมดอยู่ที่ STEPS ที่เดียว — ทั้งแถบขั้นตอน, แท็บย่อย,
   ปุ่มย้อนกลับ/ถัดไป และข้อความ "ขั้นตอนที่ N จาก M" ล้วน derive จากตารางนี้
   (เดิมเก็บเลข step ไว้ในแต่ละ panel + hard-code ข้อความใน HTML ทำให้ 2 หน้า
   ที่อยู่ขั้นตอนเดียวกันแสดงหัวข้อเหมือนกันเป๊ะ จนแยกไม่ออกว่าเปลี่ยนหน้าแล้ว)

   หนึ่งขั้นตอน (step) มีได้หลายหน้าจอ (panel) — หน้าจอในขั้นตอนเดียวกันจะโชว์
   เป็น "แท็บย่อย" ให้สลับกันได้ และบอกตำแหน่งว่าเป็นหน้าที่เท่าไรของขั้นตอนนั้น
*/
const STEPS = [
  { step: 1, label: 'รายการ', panels: ['items', 'charges'] },
  { step: 2, label: 'คนกิน', panels: ['people'] },
  { step: 3, label: 'แบ่งบิล', panels: ['method', 'assign'] },
  { step: 4, label: 'สรุป', panels: ['split'] },
];

/** หน้าจอที่มีเฉพาะบางโหมดการหาร (ไม่ต้องให้ผู้ใช้ทำถ้าโหมดนั้นไม่ได้ใช้ผลลัพธ์) */
const MODE_ONLY_PANELS = { assign: 'itemized' };

const PANEL_META = {
  landing: { title: '' },
  scan: { title: 'เริ่มต้นใช้งาน' },
  items: { title: 'รายการอาหาร', subLabel: 'รายการอาหาร' },
  charges: { title: 'ค่าใช้จ่ายเพิ่มเติม', subLabel: 'ค่าใช้จ่าย' },
  people: { title: 'คนที่ร่วมกิน' },
  method: { title: 'เลือกวิธีแบ่งค่าใช้จ่าย', subLabel: 'วิธีหารบิล' },
  assign: { title: 'ใครกินอะไร', subLabel: 'ใครกินอะไร' },
  split: { title: 'สรุปผลการหารบิล' },
};

const TOTAL_STEPS = STEPS.length;

/* ไอคอนลูกศรของปุ่มนำทาง — path มาจาก Material Icons ธีม Rounded ของ MUI
   (ArrowBackIosRounded / ArrowForwardIosRounded) ฝัง SVG ไว้ในโค้ดตรง ๆ
   ไม่โหลดจาก CDN เพราะแอปนี้ต้องทำงานแบบออฟไลน์ได้ */
const ICON_BACK = '<svg class="btn__ico" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M16.62 2.99c-.49-.49-1.28-.49-1.77 0L6.54 11.3c-.39.39-.39 1.02 0 1.41l8.31 8.31c.49.49 1.28.49 1.77 0s.49-1.28 0-1.77L9.38 12l7.25-7.25c.48-.48.48-1.28-.01-1.76"/></svg>';
const ICON_NEXT = '<svg class="btn__ico" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path d="M7.38 21.01c.49.49 1.28.49 1.77 0l8.31-8.31c.39-.39.39-1.02 0-1.41L9.15 2.98c-.49-.49-1.28-.49-1.77 0s-.49 1.28 0 1.77L14.62 12l-7.25 7.25c-.48.48-.48 1.28.01 1.76"/></svg>';

let currentTab = 'landing';
// โหมดการหารที่เลือกอยู่ เก็บเป็น view state เพราะมันกำหนดว่า flow มีหน้า assign หรือไม่
// (app.js เป็นเจ้าของค่าจริง แล้ว sync เข้ามาผ่าน renderSplitMode())
let currentMode = 'equal';

export function getCurrentTab() {
  return currentTab;
}

/** หน้าจอของขั้นตอนหนึ่ง ตัดหน้าที่โหมดปัจจุบันไม่ได้ใช้ออก */
function stepPanels(step, mode = currentMode) {
  const group = STEPS.find((s) => s.step === step);
  if (!group) return [];
  return group.panels.filter((p) => !MODE_ONLY_PANELS[p] || MODE_ONLY_PANELS[p] === mode);
}

/** ลำดับหน้าจอทั้งหมดของโหมดนั้น ๆ (ใช้คำนวณปุ่มย้อนกลับ/ถัดไป) */
function flowFor(mode = currentMode) {
  return ['landing', 'scan', ...STEPS.flatMap((s) => stepPanels(s.step, mode))];
}

function stepOf(panelName) {
  return STEPS.find((s) => s.panels.includes(panelName))?.step ?? 0;
}

/** หน้าจอก่อนหน้า/ถัดไปใน flow ของโหมดปัจจุบัน (undefined = ไม่มีหน้าถัดไป) */
export function previousTab(tabName = currentTab) {
  const flow = flowFor();
  const idx = flow.indexOf(tabName);
  return idx > 0 ? flow[idx - 1] : 'landing';
}

export function nextTab(tabName = currentTab) {
  const flow = flowFor();
  const idx = flow.indexOf(tabName);
  return idx >= 0 ? flow[idx + 1] : undefined;
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
  $('#appbarTitle').textContent = meta.title;

  // เปลี่ยนหน้าแล้วต้องเริ่มอ่านจากด้านบนเสมอ
  // (บนจอใหญ่ตัว .app เป็น scroll container เอง จึงต้องรีเซ็ตทั้งสองที่)
  window.scrollTo?.({ top: 0, behavior: 'auto' });
  const app = $('#app');
  if (app) app.scrollTop = 0;
}

/* ---------------- Step nav: แท็บย่อย + eyebrow + ป้ายปุ่มนำทาง ----------------
   เรียกทุกครั้งที่เปลี่ยนหน้า เปลี่ยนโหมดการหาร หรือข้อมูลบิลเปลี่ยน
   เพื่อให้ผู้ใช้เห็นตลอดว่า "อยู่ขั้นตอนไหน / หน้าที่เท่าไรของขั้นตอน / หน้าต่อไปคืออะไร"
*/
export function renderStepNav(bill, mode = currentMode) {
  currentMode = mode;

  const step = stepOf(currentTab);
  const panels = stepPanels(step);
  const bar = $('#substeps');
  const activePanel = $(`.panel[data-panel="${currentTab}"]`);

  // --- แท็บย่อย: โชว์เฉพาะขั้นตอนที่มีมากกว่า 1 หน้า ---
  bar.innerHTML = '';
  bar.hidden = panels.length < 2;
  if (!bar.hidden) {
    panels.forEach((name, i) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'substep' + (name === currentTab ? ' is-active' : '');
      btn.dataset.substep = name;
      btn.setAttribute('aria-current', name === currentTab ? 'page' : 'false');
      btn.innerHTML = `<span class="substep__num" aria-hidden="true">${i + 1}</span>${escapeHtml(PANEL_META[name].subLabel || PANEL_META[name].title)}`;
      bar.appendChild(btn);
    });
  }

  if (!activePanel || step === 0) return;

  // --- eyebrow: ขั้นตอนที่ N จาก 4 · ชื่อขั้นตอน (หน้าที่ i จาก n) ---
  const eyebrow = $('.eyebrow', activePanel);
  if (eyebrow) {
    const label = STEPS.find((s) => s.step === step)?.label ?? '';
    const pos = panels.length > 1 ? ` (${panels.indexOf(currentTab) + 1}/${panels.length})` : '';
    eyebrow.textContent = `ขั้นตอนที่ ${step} จาก ${TOTAL_STEPS} · ${label}${pos}`;
  }

  // --- บรรทัดสรุปบริบทที่ยกมาจากขั้นตอนก่อน ---
  const recap = $('.panel-recap', activePanel);
  if (recap) {
    const text = recapFor(currentTab, bill);
    recap.textContent = text;
    recap.hidden = !text;
  }

  // --- ปุ่มนำทาง: แสดงเป็นไอคอนลูกศรเท่านั้น ไม่มีข้อความ ---
  // ชื่อหน้าปลายทางย้ายไปอยู่ใน aria-label/title แทน เพื่อให้ screen reader
  // และการชี้ค้าง (tooltip) ยังบอกได้ว่าปุ่มนี้พาไปไหน
  const prev = previousTab();
  const next = nextTab();
  const backBtn = $('[data-go="back"]', activePanel);
  const nextBtn = $('[data-go="next"]', activePanel);
  if (backBtn) {
    const label = prev && PANEL_META[prev]?.title ? `ย้อนกลับ: ${PANEL_META[prev].title}` : 'ย้อนกลับ';
    backBtn.innerHTML = ICON_BACK;
    backBtn.setAttribute('aria-label', label);
    backBtn.setAttribute('title', label);
  }
  if (nextBtn) {
    nextBtn.hidden = !next;
    if (next) {
      const label = nextLabel(next);
      nextBtn.innerHTML = ICON_NEXT;
      nextBtn.setAttribute('aria-label', label);
      nextBtn.setAttribute('title', label);
    }
  }
}

/** ชื่อที่ใช้บอกปลายทางของปุ่มถัดไป (ไม่แสดงบนจอ ใช้กับ aria-label/tooltip) */
function nextLabel(next) {
  if (next === 'split') return 'ดูสรุปผล';
  return `ถัดไป: ${PANEL_META[next]?.title || ''}`;
}

/**
 * บรรทัดสรุปสิ่งที่ทำมาแล้ว แสดงบนหัวของหน้าถัด ๆ ไป
 * ช่วยให้รู้ว่า "กำลังทำอะไรอยู่บนข้อมูลชุดไหน" ไม่ใช่แค่รู้ว่าอยู่หน้าไหน
 */
function recapFor(panelName, bill) {
  if (!bill) return '';
  const totals = calcBillTotals(bill.items, bill.settings);
  const itemCount = bill.items.length;
  const peopleCount = bill.people.length;

  switch (panelName) {
    case 'charges':
      return `รายการอาหาร ${itemCount} อย่าง · ฿${formatMoney(totals.subtotal)}`;
    case 'people':
      return `ยอดบิลรวม ฿${formatMoney(totals.grandTotal)} · ${itemCount} รายการ`;
    case 'method':
      return `${peopleCount} คน · ยอดรวม ฿${formatMoney(totals.grandTotal)}`;
    case 'assign':
      return `${peopleCount} คน · ${itemCount} รายการ`;
    default:
      return '';
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
      <div class="item-card__row1">
        <input type="text" class="item-name" value="${escapeHtml(item.name)}" placeholder="ชื่อรายการ เช่น ต้มยำกุ้ง">
        <button type="button" class="row-del" aria-label="ลบรายการ ${escapeHtml(item.name)}">&times;</button>
      </div>
      <div class="item-card__row2">
        <div class="qty-stepper">
          <button type="button" class="qty-btn qty-btn--minus" aria-label="ลดจำนวน">&minus;</button>
          <input type="number" class="item-qty" min="1" step="1" value="${item.qty}" aria-label="จำนวน">
          <button type="button" class="qty-btn qty-btn--plus" aria-label="เพิ่มจำนวน">+</button>
        </div>
        <label class="price-field"><span>฿</span><input type="number" class="item-price" min="0" step="0.01" value="${item.price}" aria-label="ราคาต่อหน่วย"></label>
        <span class="item-line-total" aria-label="ยอดรวมรายการ">฿${formatMoney(item.qty * item.price)}</span>
      </div>
    `;

    $('.item-name', card).addEventListener('input', (e) => handlers.onUpdateItem(item.id, { name: e.target.value }));
    $('.item-qty', card).addEventListener('input', (e) => handlers.onUpdateItem(item.id, { qty: clampNumber(e.target.value, 1) }));
    $('.item-price', card).addEventListener('input', (e) => handlers.onUpdateItem(item.id, { price: clampNumber(e.target.value, 0) }));
    $('.row-del', card).addEventListener('click', () => handlers.onRemoveItem(item.id));
    $('.qty-btn--minus', card).addEventListener('click', () => handlers.onUpdateItem(item.id, { qty: Math.max(1, item.qty - 1) }));
    $('.qty-btn--plus', card).addEventListener('click', () => handlers.onUpdateItem(item.id, { qty: item.qty + 1 }));

    body.appendChild(card);
  });
}

export function renderTotals(bill) {
  const totals = calcBillTotals(bill.items, bill.settings);
  $('#itemsSubtotal').textContent = '฿' + formatMoney(totals.subtotal);
  $('#sumSubtotal').textContent = formatMoney(totals.subtotal);
  $('#sumService').textContent = formatMoney(totals.serviceAmount);
  $('#sumVat').textContent = formatMoney(totals.vatAmount);
  $('#sumGrand').textContent = formatMoney(totals.grandTotal);

  const isInclusive = bill.settings.vatEnabled && bill.settings.vatMode === 'inclusive';
  $('#lblSubtotal').textContent = isInclusive ? 'ค่าอาหาร (รวม VAT แล้ว)' : 'ค่าอาหาร';
  $('#lblVat').textContent = !bill.settings.vatEnabled
    ? 'ภาษี VAT (ไม่มี)'
    : isInclusive ? 'VAT ที่รวมอยู่ในราคาแล้ว' : 'ภาษี VAT (บวกเพิ่ม)';
}

/* ---------------- Charge settings (VAT / service) ---------------- */

export function renderChargeSettings(bill) {
  const { vatEnabled, vatMode, vatPercent, serviceEnabled, servicePercent } = bill.settings;

  $('#vatEnabledInput').checked = vatEnabled;
  $('#vatSubOptions').hidden = !vatEnabled;
  $('#vatPercentInput').value = vatPercent;
  $all('.segmented__btn', $('#vatModeSegmented')).forEach((btn) => {
    btn.classList.toggle('is-active', btn.dataset.vatmode === vatMode);
  });

  $('#serviceEnabledInput').checked = serviceEnabled;
  $('#serviceSubOptions').hidden = !serviceEnabled;
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
      <button type="button" class="row-del" aria-label="ลบ ${escapeHtml(person.name)}">&times;</button>
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
        <span class="empty-state__icon" aria-hidden="true">🍴</span>
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

  // บอกให้ชัดว่าตัวเลือกนี้ทำให้ต้องทำอะไรต่อ (หารตามรายการ = มีงานเพิ่มอีก 1 หน้า)
  const note = $('#methodNextNote');
  if (note) {
    note.textContent = mode === 'itemized'
      ? 'ขั้นตอนถัดไป: ระบุว่าใครกินอะไร แล้วจึงดูสรุปผล'
      : 'ขั้นตอนถัดไป: ดูสรุปผลได้เลย ไม่ต้องระบุว่าใครกินอะไร';
  }
}

/* ---------------- Split results ---------------- */

/** จำนวน chip รายการอาหารสูงสุดที่โชว์บนการ์ดสรุป ที่เหลือยุบเป็น "+N" (กดการ์ดดูทั้งหมดได้) */
const MAX_CHIPS = 10;

export function renderSplit(bill, mode, handlers = {}) {
  const wrap = $('#splitResult');
  wrap.innerHTML = '';

  if (bill.people.length === 0 || bill.items.length === 0) {
    const missingPeople = bill.people.length === 0;
    wrap.innerHTML = `
      <div class="empty-state">
        <span class="empty-state__icon" aria-hidden="true">${missingPeople ? '🙋' : '🍽️'}</span>
        <p class="empty-state__title">${missingPeople ? 'ยังไม่มีรายชื่อคนกิน' : 'ยังไม่มีรายการอาหาร'}</p>
        <p class="empty-state__desc">${missingPeople ? 'เพิ่มรายชื่อคนกินก่อน จึงจะหารบิลได้' : 'เพิ่มรายการอาหารก่อน จึงจะหารบิลได้'}</p>
      </div>`;
    renderSummaryPanel(bill, []);
    return;
  }

  const result = computeSplit(bill, mode);
  const consumption = getConsumptionSummary(bill.items, bill.people);

  result.perPerson.forEach((p, index) => {
    const card = document.createElement('button');
    card.type = 'button';
    card.className = 'split-card';
    card.dataset.personId = p.personId;
    card.setAttribute('aria-label', `ดูรายการอาหารของ ${p.name || 'ไม่มีชื่อ'}`);

    const sub = mode === 'itemized'
      ? `ค่าอาหาร ฿${formatMoney(p.subtotal)} + ส่วนแบ่งค่าบริการ/ภาษี`
      : 'หารเท่ากันทุกคน';

    const items = consumption.get(p.personId) || [];
    const shown = items.slice(0, MAX_CHIPS);
    const rest = items.length - shown.length;
    const chips = items.length
      ? shown.map((it) => `<span class="split-card__item-chip">${escapeHtml(it.name)}${it.qty > 1 ? ` &times;${it.qty}` : ''}</span>`).join('')
        + (rest > 0 ? `<span class="split-card__item-chip split-card__item-chip--more">+${rest}</span>` : '')
      : '<span class="split-card__item-chip split-card__item-chip--more">ไม่ได้กินอะไรเลย</span>';

    card.innerHTML = `
      <span class="avatar avatar--lg" data-tone="${toneOf(index)}" aria-hidden="true">${getInitial(p.name)}</span>
      <span class="split-card__info">
        <span class="split-card__name">${escapeHtml(p.name || 'ไม่มีชื่อ')}</span>
        <span class="split-card__sub">${sub}</span>
        <span class="split-card__items">${chips}</span>
      </span>
      <span class="split-card__end">
        <span class="split-card__amount">฿${formatMoney(p.amount)}</span>
        <span class="split-card__chev" aria-hidden="true">&rsaquo;</span>
      </span>
    `;

    if (handlers.onSelectPerson) {
      card.addEventListener('click', () => handlers.onSelectPerson(p.personId));
    }
    wrap.appendChild(card);
  });

  renderSummaryPanel(bill, result.perPerson);
}

/** เรียกตัวคำนวณตามโหมดที่เลือก (ใช้ร่วมกันระหว่างการ์ดสรุปและ sheet รายละเอียด) */
function computeSplit(bill, mode) {
  return mode === 'itemized'
    ? splitItemized(bill.items, bill.people, bill.settings)
    : splitEqual(bill.items, bill.people, bill.settings);
}

function renderSummaryPanel(bill, perPerson) {
  const panel = $('#summaryPanel');
  if (!panel) return;

  const totals = calcBillTotals(bill.items, bill.settings);
  const sumOfPeople = perPerson.reduce((sum, p) => sum + p.amount, 0);
  // ตรวจจริงว่ายอดที่แสดงต่อคนรวมกันแล้วตรงกับยอดบิลที่แสดง (ไม่ใช่ข้อความตายตัว)
  const matches = perPerson.length > 0
    && Math.round(sumOfPeople * 100) === Math.round(totals.grandTotal * 100);

  panel.innerHTML = `
    <p class="summary-panel__label">ยอดรวมทั้งหมด</p>
    <strong class="summary-panel__total">฿${formatMoney(totals.grandTotal)}</strong>
    <div class="summary-panel__people">
      ${perPerson.length
        ? perPerson.map((person, index) => `
          <div class="summary-person">
            <span class="avatar avatar--sm" data-tone="${toneOf(index)}" aria-hidden="true">${getInitial(person.name)}</span>
            <span>${escapeHtml(person.name || 'ไม่มีชื่อ')}</span>
            <strong>฿${formatMoney(person.amount)}</strong>
          </div>`).join('')
        : '<p class="summary-empty">เพิ่มรายการและรายชื่อเพื่อดูยอดสรุป</p>'}
    </div>
    ${matches
      ? '<div class="summary-note"><span aria-hidden="true">✓</span><span>ยอดของทุกคนรวมกันตรงกับยอดบิลแล้ว<small>เยี่ยมเลย!</small></span></div>'
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

    <div class="person-total"><span>ยอดที่ต้องจ่าย</span><strong>฿${formatMoney(row.amount)}</strong></div>

    <p class="field-label">🍴 รายการที่หาร <span class="items-count">${items.length} รายการ</span></p>
    <div class="person-items">${itemsHtml}</div>

    <div class="person-breakdown">${breakdown}</div>
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

export function openItemModal() {
  const nameInput = $('#modalItemName');
  const qtyInput = $('#modalItemQty');
  const priceInput = $('#modalItemPrice');

  nameInput.value = '';
  nameInput.removeAttribute('aria-invalid');
  qtyInput.value = '1';
  priceInput.value = '';
  priceInput.removeAttribute('aria-invalid');

  openSheet('#itemModalOverlay');
  nameInput.focus();
}

export function closeItemModal() {
  closeSheet('#itemModalOverlay');
}

export function isItemModalOpen() {
  return !$('#itemModalOverlay').hidden;
}

/* ---------------- Helpers ---------------- */

/** สีประจำคน วนซ้ำใน 8 โทน — ใช้ช่วยจำ ไม่ได้ใช้สื่อความหมายเพียงอย่างเดียว */
function toneOf(index) {
  return index % 8;
}

function clampNumber(value, min) {
  const n = parseFloat(value);
  if (!isFinite(n)) return min;
  return Math.max(min, n);
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
