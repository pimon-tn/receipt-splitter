// app.js — จุดเริ่มต้นของแอป
// เก็บ state ของบิลไว้ในหน่วยความจำ + sync ลง localStorage ทุกครั้งที่เปลี่ยน
// ผูก event ของ DOM แล้วเรียก ui.js ให้วาดผลลัพธ์ใหม่

import { loadBill, saveBill, clearBill, createEmptyBill, cryptoId } from './storage.js';
import { recognizeReceiptText, parseReceiptLines } from './ocr.js';
import * as ui from './ui.js';

let bill = loadBill();
let splitMode = 'equal';

const $ = (sel) => document.querySelector(sel);

/* ============ persist + re-render helpers ============ */

function persist() {
  saveBill(bill);
}

function renderAll() {
  ui.renderCategories(bill, categoryHandlers);
  ui.renderItems(bill, itemHandlers);
  ui.renderChargeSettings(bill);
  ui.renderTotals(bill);
  ui.renderPeople(bill, peopleHandlers);
  ui.renderAssignList(bill, assignHandlers);
  ui.renderSplit(bill, splitMode);
}

/* ============ Category handlers ============ */

const categoryHandlers = {
  onRemoveCategory(id) {
    bill.categories = bill.categories.filter((c) => c.id !== id);
    // รายการที่ใช้หมวดหมู่นี้อยู่ ให้ล้างเป็นไม่มีหมวดหมู่
    bill.items.forEach((it) => { if (it.categoryId === id) it.categoryId = bill.categories[0]?.id || null; });
    persist();
    renderAll();
  },
};

$('#addCategoryBtn').addEventListener('click', () => {
  const name = prompt('ชื่อหมวดหมู่ใหม่:');
  if (!name || !name.trim()) return;
  bill.categories.push({ id: cryptoId(), name: name.trim() });
  persist();
  renderAll();
});

/* ============ Item handlers ============ */

const itemHandlers = {
  onUpdateItem(id, patch) {
    const item = bill.items.find((it) => it.id === id);
    if (!item) return;
    Object.assign(item, patch);
    persist();
    ui.renderTotals(bill);
    // อัปเดตแค่ยอดรวมแถวโดยไม่ re-render ทั้งตาราง เพื่อไม่ให้ cursor กระโดดตอนพิมพ์
    updateRowSum(id);
  },
  onRemoveItem(id) {
    bill.items = bill.items.filter((it) => it.id !== id);
    persist();
    renderAll();
  },
};

function updateRowSum(id) {
  const item = bill.items.find((it) => it.id === id);
  if (!item) return;
  const card = document.querySelector(`#itemsBody .item-card[data-id="${id}"]`);
  if (!card) return;
  const totalEl = card.querySelector('.item-line-total');
  if (totalEl) {
    totalEl.textContent = '฿' + (item.qty * item.price).toLocaleString('th-TH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  }
  // ปุ่ม +/- อ่านค่า item.qty ที่อัปเดตแล้วโดยอัตโนมัติ (อ้างอิง object เดียวกัน) แต่ input ตัวเลขต้อง sync กรณีกดปุ่ม +/-
  const qtyInput = card.querySelector('.item-qty');
  if (qtyInput && document.activeElement !== qtyInput) qtyInput.value = item.qty;
}

$('#addItemBtn').addEventListener('click', () => {
  bill.items.push({
    id: cryptoId(),
    name: '',
    qty: 1,
    price: 0,
    categoryId: bill.categories[0]?.id || null,
    consumerIds: [],
  });
  persist();
  renderAll();
});

/* ============ เริ่มบิลด้วยตัวเอง (ไม่ต้องสแกน) ============ */

$('#manualStartBtn').addEventListener('click', () => {
  if (bill.items.length === 0) {
    bill.items.push({
      id: cryptoId(),
      name: '',
      qty: 1,
      price: 0,
      categoryId: bill.categories[0]?.id || null,
      consumerIds: [],
    });
    persist();
    renderAll();
  }
  ui.switchTab('items');
});

$('#vatEnabledInput').addEventListener('change', (e) => {
  bill.settings.vatEnabled = e.target.checked;
  persist();
  ui.renderChargeSettings(bill);
  ui.renderTotals(bill);
});

document.querySelectorAll('#vatModeSegmented .segmented__btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    bill.settings.vatMode = btn.dataset.vatmode;
    persist();
    ui.renderChargeSettings(bill);
    ui.renderTotals(bill);
  });
});

$('#vatPercentInput').addEventListener('input', (e) => {
  bill.settings.vatPercent = parseFloat(e.target.value) || 0;
  persist();
  ui.renderTotals(bill);
});

$('#serviceEnabledInput').addEventListener('change', (e) => {
  bill.settings.serviceEnabled = e.target.checked;
  persist();
  ui.renderChargeSettings(bill);
  ui.renderTotals(bill);
});

$('#servicePercentInput').addEventListener('input', (e) => {
  bill.settings.servicePercent = parseFloat(e.target.value) || 0;
  persist();
  ui.renderTotals(bill);
});

/* ============ People handlers ============ */

const peopleHandlers = {
  onUpdatePerson(id, name) {
    const person = bill.people.find((p) => p.id === id);
    if (!person) return;
    person.name = name;
    persist();
    // อัปเดตชื่อในหน้าระบุคนกิน/สรุปโดยไม่ต้อง re-render ทั้งหมด (กัน cursor กระโดด)
    ui.renderAssignList(bill, assignHandlers);
  },
  onRemovePerson(id) {
    bill.people = bill.people.filter((p) => p.id !== id);
    bill.items.forEach((it) => { it.consumerIds = (it.consumerIds || []).filter((cid) => cid !== id); });
    persist();
    renderAll();
  },
};

$('#addPersonBtn').addEventListener('click', () => {
  bill.people.push({ id: cryptoId(), name: `คนที่ ${bill.people.length + 1}` });
  persist();
  renderAll();
});

/* ============ Assign (itemized) handlers ============ */

const assignHandlers = {
  onToggleConsumer(itemId, personId) {
    const item = bill.items.find((it) => it.id === itemId);
    if (!item) return;
    item.consumerIds = item.consumerIds || [];
    const idx = item.consumerIds.indexOf(personId);
    if (idx >= 0) item.consumerIds.splice(idx, 1);
    else item.consumerIds.push(personId);
    persist();
    ui.renderAssignList(bill, assignHandlers);
  },
};

/* ============ Split mode ============ */

document.querySelectorAll('.split-mode__btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    splitMode = btn.dataset.mode;
    document.querySelectorAll('.split-mode__btn').forEach((b) => b.classList.toggle('is-active', b === btn));
    ui.renderSplit(bill, splitMode);
  });
});

/* ============ Tabs ============ */

document.querySelectorAll('.tab').forEach((btn) => {
  btn.addEventListener('click', () => {
    ui.switchTab(btn.dataset.tab);
    if (btn.dataset.tab === 'split') ui.renderSplit(bill, splitMode);
  });
});

/* ============ New bill ============ */

$('#newBillBtn').addEventListener('click', () => {
  if (!confirm('ล้างข้อมูลบิลปัจจุบันทั้งหมดและเริ่มใหม่?')) return;
  clearBill();
  bill = createEmptyBill();
  persist();
  renderAll();
  ui.showToast('เริ่มบิลใหม่แล้ว');
});

/* ============ Scan / OCR flow ============ */

function handleImageSelected(file) {
  if (!file) return;

  const previewWrap = $('#scanPreviewWrap');
  const preview = $('#scanPreview');
  preview.src = URL.createObjectURL(file);
  previewWrap.hidden = false;

  const statusEl = $('#scanStatus');
  statusEl.hidden = false;
  statusEl.textContent = 'กำลังอ่านข้อความจากใบเสร็จ...';

  const ocrRawWrap = $('#ocrRawWrap');
  ocrRawWrap.hidden = true;

  recognizeReceiptText(file, (status, progress) => {
    statusEl.textContent = `${translateStatus(status)} ${(progress * 100).toFixed(0)}%`;
  })
    .then((text) => {
      statusEl.textContent = 'อ่านเสร็จแล้ว ตรวจสอบข้อความก่อนแปลงเป็นรายการด้านล่าง';
      $('#ocrRawText').value = text.trim();
      ocrRawWrap.hidden = false;
    })
    .catch((err) => {
      console.error(err);
      statusEl.textContent = 'อ่านใบเสร็จไม่สำเร็จ ลองถ่ายรูปให้ชัดขึ้น หรือกรอกรายการด้วยตนเองในแท็บ "รายการ"';
    });
}

function translateStatus(status) {
  const map = {
    'loading tesseract core': 'กำลังโหลดโมดูล',
    'initializing tesseract': 'กำลังเริ่มต้นระบบ',
    'loading language traineddata': 'กำลังโหลดชุดภาษา',
    'initializing api': 'กำลังเตรียมพร้อม',
    'recognizing text': 'กำลังอ่านตัวอักษร',
  };
  return map[status] || 'กำลังประมวลผล';
}

$('#cameraInput').addEventListener('change', (e) => handleImageSelected(e.target.files[0]));
$('#fileInput').addEventListener('change', (e) => handleImageSelected(e.target.files[0]));

$('#parseBtn').addEventListener('click', () => {
  const rawText = $('#ocrRawText').value;
  const parsedItems = parseReceiptLines(rawText);

  if (parsedItems.length === 0) {
    ui.showToast('อ่านรายการไม่ได้ ลองแก้ไขข้อความ หรือเพิ่มรายการเองในแท็บ "รายการ"');
    return;
  }

  const defaultCategoryId = bill.categories[0]?.id || null;
  parsedItems.forEach((p) => {
    bill.items.push({
      id: cryptoId(),
      name: p.name,
      qty: p.qty,
      price: p.price,
      categoryId: defaultCategoryId,
      consumerIds: [],
    });
  });

  persist();
  renderAll();
  ui.switchTab('items');
  ui.showToast(`เพิ่ม ${parsedItems.length} รายการจากใบเสร็จแล้ว กรุณาตรวจสอบความถูกต้อง`);
});

/* ============ Service worker (PWA) ============ */

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('service-worker.js').catch((err) => {
      console.warn('ลงทะเบียน service worker ไม่สำเร็จ', err);
    });
  });
}

/* ============ Boot ============ */

renderAll();
