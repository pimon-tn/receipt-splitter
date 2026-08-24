// app.js — จุดเริ่มต้นของแอป
// เก็บ state ของบิลไว้ในหน่วยความจำ + sync ลง localStorage ทุกครั้งที่เปลี่ยน
// ผูก event ของ DOM แล้วเรียก ui.js ให้วาดผลลัพธ์ใหม่

import { loadBill, saveBill, createEmptyBill, cryptoId } from './storage.js';
import { recognizeReceiptText, parseReceiptLines } from './ocr.js';
import { splitEqual, splitItemized, formatMoney } from './splitter.js';
import * as ui from './ui.js';

let bill = loadBill();
let splitMode = 'equal';

const $ = (sel) => document.querySelector(sel);

/* ============ persist + re-render helpers ============ */

function persist() {
  saveBill(bill);
}

function renderAll() {
  ui.renderItems(bill, itemHandlers);
  ui.renderChargeSettings(bill);
  ui.renderTotals(bill);
  ui.renderPeople(bill, peopleHandlers);
  ui.renderAssignList(bill, assignHandlers);
  ui.renderSplitMode(splitMode);
  ui.renderSplit(bill, splitMode, splitHandlers);
  ui.renderStepNav(bill, splitMode);
}

/** ไปหน้าจอที่ระบุ แล้ววาดผลหารบิลใหม่ถ้าเป็นหน้าสรุป (ยอดอาจเปลี่ยนหลังผู้ใช้แก้ข้อมูล) */
function goTo(tab) {
  ui.switchTab(tab);
  ui.renderStepNav(bill, splitMode);
  if (ui.getCurrentTab() === 'split') ui.renderSplit(bill, splitMode, splitHandlers);
}

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
  if (totalEl) totalEl.textContent = '฿' + formatMoney(item.qty * item.price);
  // ปุ่ม +/- อ่านค่า item.qty ที่อัปเดตแล้วโดยอัตโนมัติ (อ้างอิง object เดียวกัน) แต่ input ตัวเลขต้อง sync กรณีกดปุ่ม +/-
  const qtyInput = card.querySelector('.item-qty');
  if (qtyInput && document.activeElement !== qtyInput) qtyInput.value = item.qty;
}

/* ============ Landing / navigation ============ */

$('#startBtn').addEventListener('click', () => goTo('scan'));

$('#resumeBtn').addEventListener('click', () => goTo('items'));

$('#backBtn').addEventListener('click', () => goTo(ui.previousTab()));

$('#restartBtn').addEventListener('click', () => startNewBill());

// ปุ่มขั้นตอนบนแถบบน — พาไปหน้าแรกของขั้นตอนนั้น
document.querySelectorAll('.tab').forEach((btn) => {
  btn.addEventListener('click', () => goTo(btn.dataset.tab));
});

// ปุ่มย้อนกลับ/ถัดไปในหน้า — ปลายทางคำนวณตอนคลิกจาก flow ของโหมดปัจจุบัน
// (ไม่ hard-code ชื่อหน้าไว้ใน HTML เพราะปลายทางของขั้นตอน "แบ่งบิล" เปลี่ยนตามโหมดที่เลือก)
document.querySelectorAll('.js-nav').forEach((btn) => {
  btn.addEventListener('click', () => {
    const target = btn.dataset.go === 'next' ? ui.nextTab() : ui.previousTab();
    if (target) goTo(target);
  });
});

// แท็บย่อยถูกสร้างใหม่ทุกครั้งที่ render จึงต้องดักที่ตัวแม่ (event delegation)
$('#substeps').addEventListener('click', (e) => {
  const btn = e.target.closest('[data-substep]');
  if (btn) goTo(btn.dataset.substep);
});

/* ============ เริ่มบิลด้วยตัวเอง (ไม่ต้องสแกน) ============ */

$('#manualStartBtn').addEventListener('click', () => {
  goTo('items');
  ui.openItemModal();
});

/* ============ Popup เพิ่มรายการอาหาร ============ */

$('#addItemBtn').addEventListener('click', () => ui.openItemModal());
$('#emptyAddItemBtn').addEventListener('click', () => ui.openItemModal());

$('#modalCancelBtn').addEventListener('click', () => ui.closeItemModal());
$('#modalCloseBtn').addEventListener('click', () => ui.closeItemModal());

$('#itemModalOverlay').addEventListener('click', (e) => {
  if (e.target === $('#itemModalOverlay')) ui.closeItemModal();
});

function submitItemModal() {
  const nameInput = $('#modalItemName');
  const priceInput = $('#modalItemPrice');
  const name = nameInput.value.trim();
  const priceRaw = priceInput.value.trim();

  if (!name) {
    nameInput.setAttribute('aria-invalid', 'true');
    nameInput.focus();
    ui.showToast('กรุณากรอกชื่อรายการ');
    return;
  }

  const price = Number(priceRaw);
  if (!priceRaw || !Number.isFinite(price) || price < 0) {
    priceInput.setAttribute('aria-invalid', 'true');
    priceInput.focus();
    ui.showToast('กรุณากรอกราคาให้ถูกต้อง');
    return;
  }

  const qty = Math.max(1, parseInt($('#modalItemQty').value, 10) || 1);

  bill.items.push({ id: cryptoId(), name, qty, price, consumerIds: [] });
  ui.closeItemModal();
  persist();
  renderAll();
  ui.showToast(`เพิ่ม "${name}" แล้ว`);
}

$('#modalSubmitBtn').addEventListener('click', submitItemModal);

['modalItemName', 'modalItemQty', 'modalItemPrice'].forEach((id) => {
  const input = $(`#${id}`);
  input.addEventListener('input', () => input.removeAttribute('aria-invalid'));
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      submitItemModal();
    }
  });
});

/* ============ ค่าใช้จ่ายเพิ่มเติม (VAT / ค่าบริการ) ============ */

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
    // อัปเดตชื่อในหน้าระบุคนกินโดยไม่ต้อง re-render ทั้งหมด (กัน cursor กระโดด)
    ui.renderAssignList(bill, assignHandlers);
  },
  onRemovePerson(id) {
    bill.people = bill.people.filter((p) => p.id !== id);
    bill.items.forEach((it) => { it.consumerIds = (it.consumerIds || []).filter((cid) => cid !== id); });
    persist();
    renderAll();
  },
};

function addPerson() {
  bill.people.push({ id: cryptoId(), name: `คนที่ ${bill.people.length + 1}` });
  persist();
  renderAll();
}

$('#addPersonBtn').addEventListener('click', addPerson);
$('#emptyAddPersonBtn').addEventListener('click', addPerson);

$('#clearPeopleBtn').addEventListener('click', () => {
  if (!bill.people.length) return;
  if (!confirm('ล้างรายชื่อคนกินทั้งหมดใช่หรือไม่?')) return;
  bill.people = [];
  bill.items.forEach((item) => { item.consumerIds = []; });
  persist();
  renderAll();
  ui.showToast('ล้างรายชื่อทั้งหมดแล้ว');
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
  onSelectAllConsumers(itemId) {
    const item = bill.items.find((it) => it.id === itemId);
    if (!item) return;
    const consumerIds = item.consumerIds || [];
    const allSelected = bill.people.length > 0 && bill.people.every((p) => consumerIds.includes(p.id));
    // กดซ้ำตอนเลือกทุกคนอยู่แล้ว -> เคลียร์กลับเป็น [] (สถานะ implicit "ทุกคนกินร่วมกัน" ตามค่าเริ่มต้นของระบบ
    // ไม่ใช่ "ไม่มีใครกินเลย" — ถ้าต้องการแบบนั้นต้องแตะถอดทีละคนต่อจากนี้)
    item.consumerIds = allSelected ? [] : bill.people.map((p) => p.id);
    persist();
    ui.renderAssignList(bill, assignHandlers);
  },
};

/* ============ Split mode ============ */

document.querySelectorAll('.split-mode__btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    splitMode = btn.dataset.mode;
    ui.renderSplitMode(splitMode);
    ui.renderSplit(bill, splitMode, splitHandlers);
    // โหมดกำหนดว่า flow มีหน้า "ใครกินอะไร" หรือไม่ — อัปเดตแท็บย่อย/ป้ายปุ่มถัดไปในที่
    // โดยไม่พาผู้ใช้ออกจากหน้านี้ (เขายังกำลังเลือกอยู่ อาจเปลี่ยนใจได้)
    ui.renderStepNav(bill, splitMode);
  });
});

/* ============ หน้าสรุป: แตะที่คน เพื่อดูรายการอาหารที่หาร ============ */

const splitHandlers = {
  onSelectPerson(personId) {
    ui.openPersonSheet(bill, splitMode, personId);
  },
};

$('#personSheetCloseBtn').addEventListener('click', () => ui.closeSheet('#personSheetOverlay'));
$('#personSheetOverlay').addEventListener('click', (e) => {
  if (e.target === $('#personSheetOverlay')) ui.closeSheet('#personSheetOverlay');
});

/* ============ Share sheet ============ */

$('#openShareBtn').addEventListener('click', () => {
  if (bill.people.length === 0 || bill.items.length === 0) {
    ui.showToast('ต้องมีรายการอาหารและรายชื่อคนก่อน จึงจะแชร์ผลได้');
    return;
  }
  ui.openShareSheet();
});

$('#shareSheetCloseBtn').addEventListener('click', () => ui.closeSheet('#shareSheetOverlay'));
$('#shareSheetOverlay').addEventListener('click', (e) => {
  if (e.target === $('#shareSheetOverlay')) ui.closeSheet('#shareSheetOverlay');
});

document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape') return;
  if (ui.isItemModalOpen()) ui.closeItemModal();
  else ui.closeAllOverlays();
});

$('#shareResultBtn').addEventListener('click', async () => {
  const text = createShareText();
  try {
    if (navigator.share) await navigator.share({ title: 'Receipt Splitter', text });
    else if (navigator.clipboard) await navigator.clipboard.writeText(text);
    ui.showToast(navigator.share ? 'เปิดหน้าต่างแชร์แล้ว' : 'คัดลอกสรุปผลแล้ว');
  } catch (err) {
    if (err?.name !== 'AbortError') ui.showToast('ยังแชร์ไม่ได้ในเบราว์เซอร์นี้');
  }
});

$('#shareLineBtn').addEventListener('click', () => {
  const url = 'https://line.me/R/msg/text/?' + encodeURIComponent(createShareText());
  window.open(url, '_blank', 'noopener');
});

$('#copyResultBtn').addEventListener('click', async () => {
  try {
    await navigator.clipboard?.writeText(createShareText());
    ui.showToast('คัดลอกสรุปผลแล้ว');
  } catch {
    ui.showToast('ยังคัดลอกไม่ได้ในเบราว์เซอร์นี้');
  }
});

$('#downloadImageBtn').addEventListener('click', () => {
  try {
    downloadResultImage();
    ui.showToast('บันทึกรูปสรุปผลแล้ว');
  } catch (err) {
    console.error(err);
    ui.showToast('สร้างรูปภาพไม่สำเร็จในเบราว์เซอร์นี้');
  }
});

/** ยอดของแต่ละคนตามโหมดที่เลือกอยู่ (ใช้ทั้งข้อความแชร์และรูปภาพ) */
function currentSplit() {
  return splitMode === 'itemized'
    ? splitItemized(bill.items, bill.people, bill.settings)
    : splitEqual(bill.items, bill.people, bill.settings);
}

function createShareText() {
  const { totals, perPerson } = currentSplit();
  const lines = [
    'สรุปหารบิล — Receipt Splitter',
    `ยอดรวมทั้งหมด ฿${formatMoney(totals.grandTotal)}`,
    `วิธีหาร: ${splitMode === 'itemized' ? 'หารตามรายการที่กิน' : 'หารเท่ากัน'}`,
    '',
    ...perPerson.map((p) => `• ${p.name || 'ไม่มีชื่อ'} ฿${formatMoney(p.amount)}`),
  ];
  return lines.join('\n');
}

/**
 * วาดสรุปผลลงบน canvas แล้วให้เบราว์เซอร์ดาวน์โหลดเป็นไฟล์ PNG
 * (วาดเองด้วย canvas API ไม่ต้องพึ่ง library ภายนอก — แอปนี้ทำงานแบบออฟไลน์ได้)
 */
function downloadResultImage() {
  const { totals, perPerson } = currentSplit();

  const scale = 2;
  const width = 640;
  const rowHeight = 62;
  const headHeight = 210;
  const footHeight = 74;
  const height = headHeight + perPerson.length * rowHeight + footHeight;

  const canvas = document.createElement('canvas');
  canvas.width = width * scale;
  canvas.height = height * scale;
  const ctx = canvas.getContext('2d');
  ctx.scale(scale, scale);

  const body = "600 15px 'IBM Plex Sans Thai', sans-serif";

  ctx.fillStyle = '#f2f4f2';
  ctx.fillRect(0, 0, width, height);
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(20, 20, width - 40, height - 40);

  ctx.fillStyle = '#237f78';
  ctx.font = "700 15px 'IBM Plex Sans Thai', sans-serif";
  ctx.fillText('RECEIPT SPLITTER', 46, 62);

  ctx.fillStyle = '#17314c';
  ctx.font = "700 24px 'IBM Plex Sans Thai', sans-serif";
  ctx.fillText('สรุปผลการหารบิล', 46, 98);

  ctx.fillStyle = '#718096';
  ctx.font = body;
  ctx.fillText(splitMode === 'itemized' ? 'หารตามรายการที่กิน' : 'หารเท่ากันทุกคน', 46, 124);

  ctx.fillStyle = '#edf5f3';
  ctx.fillRect(46, 142, width - 92, 52);
  ctx.fillStyle = '#4a5f78';
  ctx.font = body;
  ctx.fillText('ยอดรวมทั้งหมด', 62, 172);
  ctx.fillStyle = '#12756e';
  ctx.font = "700 22px 'Space Mono', monospace";
  ctx.textAlign = 'right';
  ctx.fillText('฿' + formatMoney(totals.grandTotal), width - 62, 174);
  ctx.textAlign = 'left';

  perPerson.forEach((person, i) => {
    const y = headHeight + i * rowHeight;
    ctx.strokeStyle = '#e3ebe8';
    ctx.beginPath();
    ctx.moveTo(46, y + rowHeight - 12);
    ctx.lineTo(width - 46, y + rowHeight - 12);
    ctx.stroke();

    ctx.fillStyle = '#17314c';
    ctx.font = "600 17px 'IBM Plex Sans Thai', sans-serif";
    ctx.fillText(person.name || 'ไม่มีชื่อ', 46, y + 26);

    ctx.fillStyle = '#12756e';
    ctx.font = "700 17px 'Space Mono', monospace";
    ctx.textAlign = 'right';
    ctx.fillText('฿' + formatMoney(person.amount), width - 46, y + 26);
    ctx.textAlign = 'left';
  });

  ctx.fillStyle = '#718096';
  ctx.font = "500 13px 'IBM Plex Sans Thai', sans-serif";
  ctx.textAlign = 'center';
  ctx.fillText('แบ่งกันง่าย ๆ อร่อยไปด้วยกันนะ', width / 2, height - 46);
  ctx.textAlign = 'left';

  const link = document.createElement('a');
  link.download = 'receipt-split.png';
  link.href = canvas.toDataURL('image/png');
  link.click();
}

/* ============ New bill ============ */

function startNewBill() {
  if (!confirm('ล้างข้อมูลบิลปัจจุบันทั้งหมด (ยกเว้นรายชื่อคน) และเริ่มใหม่?')) return;
  const keptPeople = bill.people;
  bill = createEmptyBill();
  bill.people = keptPeople;
  splitMode = 'equal';
  persist();
  ui.closeAllOverlays();
  resetScanPanel();
  renderAll();
  goTo('scan');
  ui.showToast('เริ่มบิลใหม่แล้ว (เก็บรายชื่อคนไว้เหมือนเดิม)');
}

$('#newBillBtn').addEventListener('click', startNewBill);

function resetScanPanel() {
  $('#scanPreviewWrap').hidden = true;
  $('#ocrRawWrap').hidden = true;
  $('#ocrRawText').value = '';
  ui.setScanStatus('');
}

/* ============ Scan / OCR flow ============ */

function handleImageSelected(file) {
  if (!file) return;

  const previewWrap = $('#scanPreviewWrap');
  $('#scanPreview').src = URL.createObjectURL(file);
  previewWrap.hidden = false;
  $('#ocrRawWrap').hidden = true;

  ui.setScanStatus('กำลังอ่านใบเสร็จ...', 'loading');

  recognizeReceiptText(file, (status, progress) => {
    ui.setScanStatus(`${translateStatus(status)} ${(progress * 100).toFixed(0)}%`, 'loading');
  })
    .then((text) => {
      ui.setScanStatus('อ่านเสร็จแล้ว ตรวจสอบข้อความก่อนแปลงเป็นรายการด้านล่าง', 'ok');
      $('#ocrRawText').value = text.trim();
      $('#ocrRawWrap').hidden = false;
    })
    .catch((err) => {
      console.error(err);
      ui.setScanStatus('ไม่สามารถอ่านใบเสร็จได้ ลองถ่ายภาพใหม่ให้ชัดขึ้น หรือเลือก "เพิ่มรายการเอง"', 'error');
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
  const result = parseReceiptLines($('#ocrRawText').value);
  const parsedItems = result.items;

  if (parsedItems.length === 0) {
    ui.showToast('อ่านรายการไม่ได้ ลองแก้ไขข้อความ หรือเลือก "เพิ่มรายการเอง"');
    return;
  }

  parsedItems.forEach((p) => {
    bill.items.push({
      id: cryptoId(),
      name: p.name,
      qty: p.qty,
      price: p.price,
      consumerIds: [],
    });
  });

  persist();
  renderAll();
  goTo('items');

  const r = result.reconciliation;
  if (r.checked && !r.matches) {
    // ยอดที่พาร์สรายการได้ไม่ตรงกับยอด subtotal/total ที่พิมพ์ไว้ในใบเสร็จ — เตือนให้ตรวจสอบ
    ui.showToast(
      `เพิ่ม ${parsedItems.length} รายการแล้ว แต่ยอดรวมที่อ่านได้ (฿${formatMoney(r.itemsSum)}) ไม่ตรงกับยอดในใบเสร็จ (฿${formatMoney(r.expected)}) กรุณาตรวจสอบรายการอีกครั้ง`
    );
  } else {
    ui.showToast(`เพิ่ม ${parsedItems.length} รายการจากใบเสร็จแล้ว กรุณาตรวจสอบความถูกต้อง`);
  }
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
// มีบิลค้างอยู่จากครั้งก่อน (เก็บใน localStorage) → เสนอให้ทำต่อได้เลย ไม่ต้องเริ่มใหม่
$('#resumeBtn').hidden = bill.items.length === 0;
ui.switchTab('landing');
