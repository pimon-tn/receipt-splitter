// ui.js
// หน้าที่เดียว: วาดสถานะ (state) ลงบน DOM
// ฟังก์ชันในไฟล์นี้ไม่แก้ไข state เอง มีแต่ "อ่านแล้ววาด"

import { calcBillTotals, splitEqual, splitItemized, formatMoney } from './splitter.js';

const $ = (sel, root = document) => root.querySelector(sel);
const $all = (sel, root = document) => Array.from(root.querySelectorAll(sel));

/* ---------------- Tabs ---------------- */

export function switchTab(tabName) {
  $all('.tab').forEach((btn) => {
    const active = btn.dataset.tab === tabName;
    btn.setAttribute('aria-selected', active ? 'true' : 'false');
  });
  $all('.panel').forEach((panel) => {
    panel.hidden = panel.dataset.panel !== tabName;
  });
}

/* ---------------- Toast ---------------- */

let toastTimer = null;
export function showToast(message) {
  const el = $('#toast');
  el.textContent = message;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, 2200);
}

/* ---------------- Categories (chips) ---------------- */

export function renderCategories(bill, handlers) {
  const wrap = $('#categoryChips');
  wrap.innerHTML = '';
  bill.categories.forEach((cat) => {
    const chip = document.createElement('span');
    chip.className = 'chip';
    chip.innerHTML = `<span>${escapeHtml(cat.name)}</span>`;
    const delBtn = document.createElement('button');
    delBtn.type = 'button';
    delBtn.textContent = '×';
    delBtn.setAttribute('aria-label', `ลบหมวดหมู่ ${cat.name}`);
    delBtn.addEventListener('click', () => handlers.onRemoveCategory(cat.id));
    chip.appendChild(delBtn);
    wrap.appendChild(chip);
  });

  // อัปเดต dropdown หมวดหมู่ในตารางรายการทุกแถวด้วย
  refreshCategoryOptions(bill);
}

function refreshCategoryOptions(bill) {
  $all('#itemsBody select.item-category').forEach((select) => {
    const currentValue = select.value;
    select.innerHTML = bill.categories
      .map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`)
      .join('');
    if (bill.categories.some((c) => c.id === currentValue)) {
      select.value = currentValue;
    }
  });
}

/* ---------------- Items: card list ---------------- */

export function renderItems(bill, handlers) {
  const body = $('#itemsBody');
  body.innerHTML = '';
  $('#itemsEmptyHint').hidden = bill.items.length > 0;

  bill.items.forEach((item) => {
    const card = document.createElement('div');
    card.className = 'item-card';
    card.dataset.id = item.id;

    const lineTotal = item.qty * item.price;

    card.innerHTML = `
      <div class="item-card__row1">
        <input type="text" class="item-name" value="${escapeHtml(item.name)}" placeholder="ชื่อรายการ เช่น ต้มยำกุ้ง">
        <button type="button" class="row-del" aria-label="ลบรายการ ${escapeHtml(item.name)}">🗑</button>
      </div>
      <div class="item-card__row2">
        <div class="qty-stepper">
          <button type="button" class="qty-btn qty-btn--minus" aria-label="ลดจำนวน">−</button>
          <input type="number" class="item-qty" min="1" step="1" value="${item.qty}" aria-label="จำนวน">
          <button type="button" class="qty-btn qty-btn--plus" aria-label="เพิ่มจำนวน">+</button>
        </div>
        <label class="price-field"><span>฿</span><input type="number" class="item-price" min="0" step="0.01" value="${item.price}" aria-label="ราคาต่อหน่วย"></label>
        <select class="item-category" aria-label="หมวดหมู่">
          ${bill.categories.map((c) => `<option value="${c.id}">${escapeHtml(c.name)}</option>`).join('')}
        </select>
      </div>
      <div class="item-card__row3">รวม <span class="item-line-total">฿${formatMoney(lineTotal)}</span></div>
    `;

    $('.item-category', card).value = item.categoryId || bill.categories[0]?.id || '';

    $('.item-name', card).addEventListener('input', (e) => handlers.onUpdateItem(item.id, { name: e.target.value }));
    $('.item-qty', card).addEventListener('input', (e) => handlers.onUpdateItem(item.id, { qty: clampNumber(e.target.value, 1) }));
    $('.item-price', card).addEventListener('input', (e) => handlers.onUpdateItem(item.id, { price: clampNumber(e.target.value, 0) }));
    $('.item-category', card).addEventListener('change', (e) => handlers.onUpdateItem(item.id, { categoryId: e.target.value }));
    $('.row-del', card).addEventListener('click', () => handlers.onRemoveItem(item.id));
    $('.qty-btn--minus', card).addEventListener('click', () => handlers.onUpdateItem(item.id, { qty: Math.max(1, item.qty - 1) }));
    $('.qty-btn--plus', card).addEventListener('click', () => handlers.onUpdateItem(item.id, { qty: item.qty + 1 }));

    body.appendChild(card);
  });
}

export function renderTotals(bill) {
  const totals = calcBillTotals(bill.items, bill.settings);
  $('#sumSubtotal').textContent = formatMoney(totals.subtotal);
  $('#sumService').textContent = formatMoney(totals.serviceAmount);
  $('#sumVat').textContent = formatMoney(totals.vatAmount);
  $('#sumGrand').textContent = formatMoney(totals.grandTotal);

  const isInclusive = bill.settings.vatEnabled && bill.settings.vatMode === 'inclusive';
  $('#lblSubtotal').textContent = isInclusive ? 'รวมรายการ (รวม VAT แล้ว)' : 'รวมรายการ';
  $('#lblVat').textContent = !bill.settings.vatEnabled
    ? 'ภาษี VAT (ไม่มี)'
    : isInclusive ? 'VAT ที่รวมอยู่ในราคาแล้ว' : 'ภาษี VAT (บวกเพิ่ม)';
}

/* ---------------- Charge settings (VAT / service toggle) ---------------- */

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

  bill.people.forEach((person) => {
    const li = document.createElement('li');
    li.innerHTML = `
      <span class="avatar">${getInitial(person.name)}</span>
      <input type="text" class="person-name" value="${escapeHtml(person.name)}" placeholder="ชื่อคน">
      <button type="button" class="row-del" aria-label="ลบ ${escapeHtml(person.name)}">🗑</button>
    `;
    $('.person-name', li).addEventListener('input', (e) => {
      handlers.onUpdatePerson(person.id, e.target.value);
      $('.avatar', li).textContent = getInitial(e.target.value);
    });
    $('.row-del', li).addEventListener('click', () => handlers.onRemovePerson(person.id));
    list.appendChild(li);
  });
}

export function renderAssignList(bill, handlers) {
  const wrap = $('#assignList');
  wrap.innerHTML = '';

  if (bill.items.length === 0 || bill.people.length === 0) {
    wrap.innerHTML = `<div class="empty-hint"><span class="empty-hint__emoji">🍴</span><p>เพิ่มทั้งรายการอาหารและรายชื่อคนก่อน จึงจะระบุได้ว่าใครกินอะไร</p></div>`;
    return;
  }

  bill.items.forEach((item) => {
    const card = document.createElement('div');
    card.className = 'assign-item';
    const lineTotal = formatMoney(item.qty * item.price);
    card.innerHTML = `
      <div class="assign-item__title"><span>${escapeHtml(item.name || 'ไม่มีชื่อ')}</span><span>${lineTotal}</span></div>
      <div class="assign-people"></div>
    `;
    const tagWrap = $('.assign-people', card);
    bill.people.forEach((person) => {
      const btn = document.createElement('button');
      btn.type = 'button';
      btn.className = 'assign-tag' + (item.consumerIds?.includes(person.id) ? ' is-selected' : '');
      btn.innerHTML = `<span class="avatar">${getInitial(person.name)}</span><span>${escapeHtml(person.name || 'ไม่มีชื่อ')}</span>`;
      btn.addEventListener('click', () => handlers.onToggleConsumer(item.id, person.id));
      tagWrap.appendChild(btn);
    });
    wrap.appendChild(card);
  });
}

/* ---------------- Split results ---------------- */

export function renderSplit(bill, mode) {
  const wrap = $('#splitResult');
  wrap.innerHTML = '';
  $('#stampNote').hidden = true;

  if (bill.people.length === 0) {
    wrap.innerHTML = `<div class="empty-hint"><span class="empty-hint__emoji">🙋</span><p>เพิ่มรายชื่อคนกินก่อน จึงจะหารบิลได้</p></div>`;
    return;
  }
  if (bill.items.length === 0) {
    wrap.innerHTML = `<div class="empty-hint"><span class="empty-hint__emoji">🍽️</span><p>ยังไม่มีรายการอาหารให้หาร ลองเพิ่มรายการก่อน</p></div>`;
    return;
  }

  const result = mode === 'itemized'
    ? splitItemized(bill.items, bill.people, bill.settings)
    : splitEqual(bill.items, bill.people, bill.settings);

  result.perPerson.forEach((p) => {
    const card = document.createElement('div');
    card.className = 'split-card';
    const sub = mode === 'itemized'
      ? `<span class="split-card__sub">ค่าอาหาร ฿${formatMoney(p.subtotal)} + ส่วนแบ่งค่าบริการ/ภาษี</span>`
      : `<span class="split-card__sub">หารเท่ากันทุกคน</span>`;
    card.innerHTML = `
      <span class="avatar avatar--lg">${getInitial(p.name)}</span>
      <div class="split-card__info">
        <div class="split-card__name">${escapeHtml(p.name || 'ไม่มีชื่อ')}</div>
        ${sub}
      </div>
      <div class="split-card__amount">฿${formatMoney(p.amount)}</div>
    `;
    wrap.appendChild(card);
  });

  $('#stampNote').hidden = false;
}

/* ---------------- Helpers ---------------- */

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
