# CONTEXT.md — ศัพท์โดเมนของ Receipt Splitter (หารบิล)

ชื่อเรียกที่ใช้ร่วมกันในโค้ด เทสต์ และการคุยกับ AI agent ถ้าจะเพิ่มแนวคิดใหม่ ให้เพิ่มคำที่นี่ก่อนตั้งชื่อในโค้ด

## ศัพท์ธุรกิจ

**Bill (บิล)** — บิลหนึ่งใบที่กำลังหาร ประกอบด้วย Item ทั้งหมด, Person ทั้งหมด และ Charges มีได้ใบเดียวในแอปในเวลาเดียวกัน (เก็บใน localStorage)

**Item (รายการอาหาร)** — หนึ่งบรรทัดของบิล มี `name`, `qty`, `price` (ราคาต่อหน่วย ยังไม่รวมค่าบริการ/VAT) และ `consumerIds` ราคารวมของรายการ = `qty × price` เรียกว่า *line total*

**Person (คน / คนกิน)** — คนที่ร่วมหารบิล มี `id` และ `name` เก็บไว้ข้ามบิลได้ — เริ่มบิลใหม่แล้วรายชื่อยังอยู่

**Consumer (ผู้กิน)** — Person ที่กินรายการนั้น ๆ (อยู่ใน `consumerIds` ของ Item)
- **ไม่ระบุผู้กิน** (`consumerIds` ว่าง) หมายถึง **ทุกคนกินร่วมกัน** ไม่ใช่ "ไม่มีใครกิน" — กฎนี้อยู่ที่เดียวคือ `consumersOf()` ใน `splitter.js`
- ลบ Person แล้ว Person นั้นต้องหายจากผู้กินของทุก Item ด้วย (บังคับโดย Bill session)

**Charges (ค่าใช้จ่ายเพิ่มเติม)** — ค่าบริการ (service) และภาษีมูลค่าเพิ่ม (VAT) เปิด/ปิดและตั้ง % ได้แยกกัน คิดตามลำดับ: ค่าบริการจากยอดรายการก่อน แล้ว VAT จากยอดที่รวมค่าบริการแล้ว

**Totals (ยอดรวม)** — `subtotal` (รวมรายการ), `serviceAmount`, `vatAmount`, `grandTotal`

**Split mode (วิธีหาร)** — `equal` หารเท่ากัน: `grandTotal ÷ จำนวนคน` / `itemized` หารตามรายการที่กิน: แต่ละคนจ่ายส่วนแบ่งของ Item ที่กิน บวกค่าบริการ/VAT ตามสัดส่วนยอดอาหารของตัวเอง

**Split (ผลหารบิล)** — ผลของการหาร Bill ตาม Split mode หนึ่งโหมด: Totals + ยอดต่อคน (`perPerson`) + รายการที่แต่ละคนหาร + สถานะ *reconciled* ผลลัพธ์ทุกหน้าจอ (สรุป, sheet รายคน, ข้อความแชร์, รูปภาพ) ต้องมาจาก `computeSplit()` เท่านั้น

**Reconciled (กระทบยอดตรง)** — ยอดของทุกคนรวมกันได้เท่ากับ `grandTotal` พอดีเมื่อเทียบเป็นสตางค์ ระบบเกลี่ยเศษสตางค์ด้วย largest-remainder เพื่อให้เป็นจริงเสมอเมื่อมีคนอย่างน้อยหนึ่งคน

**Scan / OCR** — อ่านรูปใบเสร็จเป็นข้อความ แล้ว *parse* เป็น Item พร้อมเช็ก *reconciliation* กับยอดที่พิมพ์ในใบเสร็จ (คนละความหมายกับ "Reconciled" ด้านบน — อันนี้ตรวจผล parse ไม่ใช่ผลหาร)

## ศัพท์การนำทาง (UI)

**Step (ขั้นตอน)** — 4 ขั้น: 1 รายการ+ค่าใช้จ่าย, 2 คน, 3 วิธีหาร, 4 สรุป

**Panel (หน้าจอ)** — หน้าจอหนึ่งหน้า (`items`, `charges`, `people`, `method`, `split` + `landing`, `scan`) Step หนึ่งมีได้หลาย Panel แสดงเป็นแท็บย่อย (substep)

## ศัพท์สถาปัตยกรรม

ใช้คำตาม codebase-design: **module**, **interface**, **seam**, **adapter**, **depth**

| Module | หน้าที่ | Interface หลัก |
|---|---|---|
| **Bill session** (`js/bill.js`) | เจ้าของสถานะบิล + กติกาการแก้ไข + บันทึกให้เอง | `createBillSession(storage, newId)` → `session.bill`, `addItem`, `updateItem`, `removePerson`, `toggleConsumer`, `startNew` ฯลฯ |
| **Storage adapter** (`js/storage.js`) | อ่าน/เขียน localStorage + migrate ข้อมูลเก่า เป็น adapter ที่ seam ของ Bill session (อีกตัวคือ in-memory ในเทสต์) | `loadBill()`, `saveBill(bill)` |
| **Split** (`js/splitter.js`) | คำนวณทุกอย่างของการหารแบบ pure | `computeSplit(bill, mode)` (ฟังก์ชันอื่นเป็นตัวช่วย/implementation) |
| **UI renderers** (`js/ui.js`) | อ่านผลแล้ววาด DOM เท่านั้น ไม่แก้ state | `render*()` |
| **OCR** (`js/ocr.js`) | อ่านรูป + parse ข้อความเป็น Item | `recognizeReceiptText()`, `parseReceiptLines()` |

## ที่ยังไม่ได้ทำ (จาก architecture review 2026-10-08)

- แยก **Flow** (การนำทาง Step/Panel) ออกจาก `ui.js` — ตอนนี้ `currentTab`/`currentMode` อยู่ใน `ui.js` และ `goTo` ใน `app.js` ต้องเรียกซ้ำหลายครั้ง
- แยก **Share** (ข้อความแชร์ + วาดรูป canvas + ช่องทางแชร์) ออกจาก `app.js`
- รวม **Item form** (modal state + validate + submit) เป็น module เดียว
