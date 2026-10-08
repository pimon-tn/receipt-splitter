// app.js — จุดเริ่มต้นของแอป
// ผูก event ของ DOM → สั่งแก้บิลผ่าน session (bill.js ดูแลกติกา + บันทึกให้เอง) → เรียก ui.js ให้วาดผลลัพธ์ใหม่

import { loadBill, saveBill, cryptoId } from './storage.js';
import { createBillSession } from './bill.js';
import { recognizeReceiptText, parseReceiptLines } from './ocr.js';
import { computeSplit, formatMoney } from './splitter.js';
import * as ui from './ui.js';

const session = createBillSession({ load: loadBill, save: saveBill }, cryptoId);
let splitMode = 'equal';

const $ = (sel) => document.querySelector(sel);

/* ============ re-render helpers ============ */

function renderAll() {
  ui.renderItems(session.bill, itemHandlers);
  ui.renderChargeSettings(session.bill);
  ui.renderTotals(session.bill);
  ui.renderPeople(session.bill, peopleHandlers);
  ui.renderAssignList(session.bill, assignHandlers);
  ui.renderSplitMode(splitMode);
  ui.renderSplit(session.bill, splitMode, splitHandlers);
  ui.renderStepNav(splitMode);
}

/** ไปหน้าจอที่ระบุ แล้ววาดผลหารบิลใหม่ถ้าเป็นหน้าสรุป (ยอดอาจเปลี่ยนหลังผู้ใช้แก้ข้อมูล) */
function goTo(tab) {
  ui.switchTab(tab);
  ui.renderStepNav(splitMode);
  if (ui.getCurrentTab() === 'split') ui.renderSplit(session.bill, splitMode, splitHandlers);
}

/* ============ Item handlers ============ */

const itemHandlers = {
  onUpdateItem(id, patch) {
    if (!session.updateItem(id, patch)) return;
    ui.renderTotals(session.bill);
    // อัปเดตแค่แถวนี้โดยไม่ re-render ทั้งตาราง เพื่อไม่ให้เสียตำแหน่ง scroll
    updateRowQty(id);
  },
  onRemoveItem(id) {
    session.removeItem(id);
    renderAll();
  },
  onEditItem(id) {
    const item = session.bill.items.find((it) => it.id === id);
    if (!item) return;
    ui.openItemModal(item);
  },
};

function updateRowQty(id) {
  const item = session.bill.items.find((it) => it.id === id);
  if (!item) return;
  const card = document.querySelector(`#itemsBody .item-card[data-id="${id}"]`);
  if (!card) return;
  const qtyEl = card.querySelector('.item-qty');
  if (qtyEl) qtyEl.textContent = item.qty;
  const priceEl = card.querySelector('.item-price');
  if (priceEl) priceEl.textContent = '฿' + formatMoney(item.qty * item.price);
}

/* ============ Landing / navigation ============ */

$('#startBtn').addEventListener('click', () => goTo('scan'));

$('#resumeBtn').addEventListener('click', () => goTo('items'));

$('#restartBtn').addEventListener('click', () => startNewBill());

// ปุ่มขั้นตอนบนแถบบน — พาไปหน้าแรกของขั้นตอนนั้น
document.querySelectorAll('.tab').forEach((btn) => {
  btn.addEventListener('click', () => goTo(btn.dataset.tab));
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

  const editingId = ui.getEditingItemId();
  if (editingId) {
    if (session.updateItem(editingId, { name, qty, price })) ui.showToast(`แก้ไข "${name}" แล้ว`);
  } else {
    session.addItem({ name, qty, price });
    ui.showToast(`เพิ่ม "${name}" แล้ว`);
  }

  ui.closeItemModal();
  renderAll();
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
  session.setCharge('vatEnabled', e.target.checked);
  ui.renderChargeSettings(session.bill);
  ui.renderTotals(session.bill);
});

$('#vatPercentInput').addEventListener('input', (e) => {
  session.setCharge('vatPercent', parseFloat(e.target.value) || 0);
  ui.renderTotals(session.bill);
});

$('#serviceEnabledInput').addEventListener('change', (e) => {
  session.setCharge('serviceEnabled', e.target.checked);
  ui.renderChargeSettings(session.bill);
  ui.renderTotals(session.bill);
});

$('#servicePercentInput').addEventListener('input', (e) => {
  session.setCharge('servicePercent', parseFloat(e.target.value) || 0);
  ui.renderTotals(session.bill);
});

/* ============ People handlers ============ */

const peopleHandlers = {
  onUpdatePerson(id, name) {
    session.renamePerson(id, name);
    // อัปเดตชื่อในหน้าระบุคนกินโดยไม่ต้อง re-render ทั้งหมด (กัน cursor กระโดด)
    ui.renderAssignList(session.bill, assignHandlers);
  },
  onRemovePerson(id) {
    session.removePerson(id);
    renderAll();
  },
};

function addPerson() {
  session.addPerson();
  renderAll();
}

$('#addPersonBtn').addEventListener('click', addPerson);
$('#emptyAddPersonBtn').addEventListener('click', addPerson);

$('#clearPeopleBtn').addEventListener('click', () => {
  if (!session.bill.people.length) return;
  if (!confirm('ล้างรายชื่อคนกินทั้งหมดใช่หรือไม่?')) return;
  session.clearPeople();
  renderAll();
  ui.showToast('ล้างรายชื่อทั้งหมดแล้ว');
});

/* ============ Assign (itemized) handlers ============ */

const assignHandlers = {
  onToggleConsumer(itemId, personId) {
    session.toggleConsumer(itemId, personId);
    ui.renderAssignList(session.bill, assignHandlers);
  },
  onSelectAllConsumers(itemId) {
    session.toggleAllConsumers(itemId);
    ui.renderAssignList(session.bill, assignHandlers);
  },
};

/* ============ Split mode ============ */

document.querySelectorAll('.split-mode__btn').forEach((btn) => {
  btn.addEventListener('click', () => {
    splitMode = btn.dataset.mode;
    ui.renderSplitMode(splitMode);
    ui.renderSplit(session.bill, splitMode, splitHandlers);
    // โหมดกำหนดว่า flow มีหน้า "ใครกินอะไร" หรือไม่ — อัปเดตแท็บย่อย/ป้ายปุ่มถัดไปในที่
    // โดยไม่พาผู้ใช้ออกจากหน้านี้ (เขายังกำลังเลือกอยู่ อาจเปลี่ยนใจได้)
    ui.renderStepNav(splitMode);
  });
});

/* ============ หน้าสรุป: แตะที่คน เพื่อดูรายการอาหารที่หาร ============ */

const splitHandlers = {
  onSelectPerson(personId) {
    ui.openPersonSheet(session.bill, splitMode, personId);
  },
};

$('#personSheetCloseBtn').addEventListener('click', () => ui.closeSheet('#personSheetOverlay'));
$('#personSheetOverlay').addEventListener('click', (e) => {
  if (e.target === $('#personSheetOverlay')) ui.closeSheet('#personSheetOverlay');
});

/* ============ Share sheet ============ */

$('#openShareBtn').addEventListener('click', () => {
  if (session.bill.people.length === 0 || session.bill.items.length === 0) {
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

function createShareText() {
  const { totals, perPerson } = computeSplit(session.bill, splitMode);
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
  const { totals, perPerson } = computeSplit(session.bill, splitMode);

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
  session.startNew();
  splitMode = 'equal';
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

  session.addItems(parsedItems);
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
$('#resumeBtn').hidden = session.bill.items.length === 0;
ui.switchTab('landing');
