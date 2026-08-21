'use strict';
/**
 * «حركة الإيصالات» — payment-receipt log inside كشف العملاء.
 *
 * Saving a receipt does THREE things in ONE transaction:
 *   1. (new client only) create the Clients-Codes entry (code + both phones),
 *      with the same duplicate-phone guard. Existing clients are NOT modified.
 *   2. create/update the linked cs_sales_register operation (course + price +
 *      discount + paid=amount + Sales + payment_way=channel).
 *   3. create/update the cs_receipts row, linked to the operation via sale_id.
 *
 * Idempotent by client_request_id: re-saving a receipt UPDATES the same operation
 * + receipt, never duplicates. Owner + الإدارة المالية (Finance) only.
 */
const express = require('express');
const db = require('../config/database');
const { saveNow } = require('../config/database');
const { authenticate } = require('../middleware/auth');
const { requireOwnerOrManagement } = require('../middleware/roles');

const router = express.Router();
router.use(authenticate, requireOwnerOrManagement('Finance'));

function nowTs() { return new Date(Date.now() + 2 * 60 * 60 * 1000).toISOString().replace('T', ' ').slice(0, 19); }
function str(v) { if (v === undefined || v === null) return null; const s = String(v).trim(); return s === '' ? null : s; }
function num(v) { if (v === undefined || v === null || v === '') return null; const n = Number(String(v).replace(/,/g, '')); return Number.isFinite(n) ? n : null; }
// Discount: "10%" → % of price, else a plain amount. Returns the amount (magnitude).
function discountAmt(d, price) {
  const s = String(d ?? '').trim();
  if (!s) return 0;
  if (s.endsWith('%')) { const p = parseFloat(s.slice(0, -1)); return isFinite(p) ? (Number(price) || 0) * p / 100 : 0; }
  const a = parseFloat(s.replace(/,/g, '')); return isFinite(a) ? Math.abs(a) : 0;
}
const MONTH_ABBR = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
// Derive "YY-Mon" from a "M/D/YYYY" or "YYYY-MM-DD" date (best effort).
function monthsLabel(dateStr) {
  const s = String(dateStr || '');
  let y, m;
  let mm = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (mm) { m = +mm[1]; y = +mm[3]; }
  else { mm = s.match(/^(\d{4})-(\d{2})-(\d{2})$/); if (mm) { y = +mm[1]; m = +mm[2]; } }
  if (!y || !m) return null;
  return `${String(y).slice(2)}-${MONTH_ABBR[m - 1]}`;
}
// Duplicate phone across Clients-Codes (either stored number), leading-zero tolerant.
function phoneClash(numbers) {
  for (const raw of numbers) {
    const m = str(raw);
    if (!m) continue;
    const hit = db.prepare(
      `SELECT code, client_name FROM cs_client_codes
        WHERE (TRIM(IFNULL(mobile_no,''))  <> '' AND LTRIM(mobile_no,'0')  = LTRIM(?, '0'))
           OR (TRIM(IFNULL(mobile_no2,'')) <> '' AND LTRIM(mobile_no2,'0') = LTRIM(?, '0'))
        LIMIT 1`
    ).get(m, m);
    if (hit) return { ...hit, number: m };
  }
  return null;
}

const OP_INSERT = db => db.prepare(`
  INSERT INTO cs_sales_register
    (code, entry_date, client_name, mobile_no, courses, price, discount,
     total_paid_same_month, balance, department, payment_way, paid_status, months,
     lectures_count, op_type, source, created_at, updated_at)
  VALUES (@code, @entry_date, @client_name, @mobile_no, @courses, @price, @discount,
     @paid, @balance, 'Sales', @payment_way, @paid_status, @months,
     @lectures_count, '', 'system', @ts, @ts)
`);
const OP_UPDATE = db => db.prepare(`
  UPDATE cs_sales_register SET
    code=@code, entry_date=@entry_date, client_name=@client_name, mobile_no=@mobile_no,
    courses=@courses, price=@price, discount=@discount, total_paid_same_month=@paid,
    balance=@balance, payment_way=@payment_way, paid_status=@paid_status, months=@months,
    lectures_count=@lectures_count, updated_at=@ts
  WHERE id=@id
`);

// Map the receipt Status → the linked operation's paid_status (owner decision
// 2026-08): Rejected → Fake, Pending → Not Paid, Approved/blank → by balance.
function paidStatusFor(status, balance) {
  const s = String(status || '').trim();
  if (s === 'Rejected') return 'Fake';
  if (s === 'Pending') return 'Not Paid';
  return (Number(balance) || 0) <= 0.01 ? 'Paid' : 'Not Paid';
}

// Build the shared field bag for a receipt + its operation.
function fields(body) {
  const date = str(body.date);
  const price = num(body.price) || 0;
  const amount = num(body.amount) || 0;
  const disc = discountAmt(body.discount, price);
  const balance = Math.round(((price - disc) - amount) * 100) / 100;
  return {
    date, code: str(body.code), client_name: str(body.client_name),
    mobile_no: str(body.mobile_no), mobile_no2: str(body.mobile_no2),
    client_wallet: str(body.client_wallet), receiver_channel: str(body.receiver_channel),
    amount, timing: str(body.timing), courses: str(body.courses), price,
    discount: str(body.discount), status: str(body.status), photo: str(body.photo),
    tamkeen: str(body.tamkeen), operation_sys: str(body.operation_sys),
    system_status: str(body.system_status), financial_wallet: str(body.financial_wallet),
    lectures_count: num(body.lectures_count),
    balance, months: monthsLabel(date),
    paid_status: paidStatusFor(body.status, balance),
    payment_way: str(body.receiver_channel),
  };
}

// Receipt `date` (sheet text "M/D/YYYY") normalized to sortable ISO "YYYY-MM-DD"
// so the date-range filter compares correctly (SQLite date() only parses ISO).
const ISO_RECEIPT_DATE = `(CASE WHEN "date" LIKE '%/%/%' THEN `
  + `substr("date",-4) || '-' `
  + `|| printf('%02d', CAST(substr("date",1,instr("date",'/')-1) AS INTEGER)) || '-' `
  + `|| printf('%02d', CAST(substr(substr("date",instr("date",'/')+1),1,instr(substr("date",instr("date",'/')+1),'/')-1) AS INTEGER)) `
  + `ELSE "date" END)`;

// ─── LIST ────────────────────────────────────────────────────────────────────
router.get('/list', (req, res) => {
  try {
    const q = (req.query.q || '').trim();
    const status = (req.query.status || '').trim();
    const from = (req.query.from || '').trim();
    const to = (req.query.to || '').trim();
    const page = Math.max(1, parseInt(req.query.page, 10) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit, 10) || 50));
    const offset = (page - 1) * limit;
    const where = [], p = [];
    if (q) {
      const qz = q.replace(/^0+/, '') || q;
      where.push("(client_name LIKE ? OR code LIKE ? OR LTRIM(IFNULL(mobile_no,''),'0') LIKE ? OR LTRIM(IFNULL(client_wallet,''),'0') LIKE ?)");
      p.push(`%${q}%`, `${q}%`, `${qz}%`, `${qz}%`);
    }
    if (status) {
      if (status === '__blank__') where.push("TRIM(IFNULL(status,'')) = ''");
      else { where.push('status = ?'); p.push(status); }
    }
    if (from) { where.push(`${ISO_RECEIPT_DATE} >= ?`); p.push(from); }
    if (to)   { where.push(`${ISO_RECEIPT_DATE} <= ?`); p.push(to); }
    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';
    const rows = db.prepare(`
      SELECT *, COUNT(*) OVER() AS _total FROM cs_receipts
      ${whereSql} ORDER BY id DESC LIMIT ? OFFSET ?
    `).all(...p, limit, offset);
    const total = rows.length ? rows[0]._total : 0;
    rows.forEach(r => { delete r._total; });
    return res.json({ rows, total, page, pages: Math.max(1, Math.ceil(total / limit)) });
  } catch (err) {
    console.error('[cs-receipts/list]', err);
    return res.status(500).json({ error: err.message });
  }
});

// ─── CREATE / UPSERT (receipt + operation [+ new client code]) ───────────────
router.post('/', (req, res) => {
  try {
    const body = req.body || {};
    const f = fields(body);
    const ts = nowTs();
    const reqId = str(body.client_request_id);
    const force = body.force === true || body.force === 'true';
    // confirm=true → also create/update the operation in قائمة العمليات.
    // confirm=false («حفظ مؤقت») → log the receipt only (no operation yet).
    const confirm = body.confirm === true || body.confirm === 'true';
    // A code-less receipt can never create a client code either.
    const isNewClient = (body.is_new_client === true || body.is_new_client === 'true') && !!f.code;

    // Final save builds the operation → a client code is mandatory. Temp save may log
    // money that arrived before the client's data does (code added later on edit),
    // but still needs at least an amount or the wallet/channel so it isn't a blank row.
    if (confirm && !f.code) return res.status(400).json({ error: 'كود العميل مطلوب لحفظ العملية' });
    if (!f.code && !(num(body.amount) || f.client_wallet || f.receiver_channel)) {
      return res.status(400).json({ error: 'محتاج المبلغ أو رقم المحفظة على الأقل للحفظ المؤقت' });
    }

    // New client → create the Clients-Codes entry (with dup-phone guard), unless the
    // code already exists (idempotent). Existing clients are never modified here.
    if (isNewClient) {
      const exists = db.prepare('SELECT id FROM cs_client_codes WHERE code = ?').get(f.code);
      if (!exists) {
        if (!force) {
          const ph = phoneClash([f.mobile_no, f.mobile_no2]);
          if (ph) return res.status(409).json({
            code: 'DUP_PHONE', existingCode: ph.code, existingName: ph.client_name,
            error: `الموبايل ${ph.number} موجود بالفعل في كود ${ph.code}${ph.client_name ? ' (' + ph.client_name + ')' : ''}`,
          });
        }
      }
    }

    // Existing receipt with this request id → UPDATE its operation + itself.
    const prior = reqId ? db.prepare('SELECT id, sale_id FROM cs_receipts WHERE client_request_id = ?').get(reqId) : null;

    let saleId, receiptId;
    db.transaction(() => {
      if (isNewClient) {
        const exists = db.prepare('SELECT id FROM cs_client_codes WHERE code = ?').get(f.code);
        if (!exists) {
          db.prepare(`INSERT INTO cs_client_codes (code, client_name, mobile_no, mobile_no2, created_at, updated_at)
                      VALUES (?,?,?,?,?,?)`).run(f.code, f.client_name, f.mobile_no, f.mobile_no2, ts, ts);
        }
      }
      // Sync the registry card from the receipt (owner decision 2026-07-29):
      //   • PHONES (mobile_no / mobile_no2): FULL sync — a phone typed/edited on the
      //     receipt REPLACES the one on the card (as long as the receipt has a value;
      //     a blank receipt phone never wipes the card).
      //   • NAME: blanks-only — filled when the card is empty, never overwritten
      //     (a receipt typo must not rewrite an established client's name).
      // Reverses the older "a receipt never touches the registry" rule for phones only.
      if (f.code) {
        const cc = db.prepare('SELECT client_name, mobile_no, mobile_no2 FROM cs_client_codes WHERE code = ?').get(f.code);
        if (cc) {
          const blank = (v) => v == null || String(v).trim() === '';
          const sets = [], vals = { ts, code: f.code };
          if (blank(cc.client_name) && f.client_name) { sets.push('client_name=@client_name'); vals.client_name = f.client_name; }
          if (f.mobile_no  && f.mobile_no  !== cc.mobile_no)  { sets.push('mobile_no=@mobile_no');   vals.mobile_no  = f.mobile_no; }
          if (f.mobile_no2 && f.mobile_no2 !== cc.mobile_no2) { sets.push('mobile_no2=@mobile_no2'); vals.mobile_no2 = f.mobile_no2; }
          if (sets.length) db.prepare(`UPDATE cs_client_codes SET ${sets.join(', ')}, updated_at=@ts WHERE code=@code`).run(vals);
        }
      }
      if (confirm) {
        // Only the keys the operation statement binds (better-sqlite3 is strict on
        // named params — no extras, and `entry_date` must be present, not `date`).
        const opArgs = {
          code: f.code, entry_date: f.date, client_name: f.client_name, mobile_no: f.mobile_no,
          courses: f.courses, price: f.price, discount: f.discount, paid: f.amount,
          balance: f.balance, payment_way: f.payment_way, paid_status: f.paid_status,
          months: f.months, lectures_count: f.lectures_count, ts,
        };
        if (prior && prior.sale_id) {
          OP_UPDATE(db).run({ ...opArgs, id: prior.sale_id });
          saleId = prior.sale_id;
        } else {
          saleId = OP_INSERT(db).run(opArgs).lastInsertRowid;
        }
      } else {
        // «حفظ مؤقت» — keep any existing link, but don't create the operation yet.
        saleId = prior ? prior.sale_id : null;
      }
      const rParams = {
        date: f.date, code: f.code, client_name: f.client_name, mobile_no: f.mobile_no, mobile_no2: f.mobile_no2,
        client_wallet: f.client_wallet, receiver_channel: f.receiver_channel, amount: f.amount, timing: f.timing,
        courses: f.courses, price: f.price, discount: f.discount, status: f.status, photo: f.photo,
        tamkeen: f.tamkeen, operation_sys: f.operation_sys, system_status: f.system_status,
        financial_wallet: f.financial_wallet, lectures_count: f.lectures_count,
        sale_id: saleId, reqId, ts,
        by: req.user.id || null, byName: req.user.full_name || null,
      };
      if (prior) {
        db.prepare(`UPDATE cs_receipts SET
          date=@date, code=@code, client_name=@client_name, mobile_no=@mobile_no, mobile_no2=@mobile_no2,
          client_wallet=@client_wallet, receiver_channel=@receiver_channel, amount=@amount, timing=@timing,
          courses=@courses, price=@price, discount=@discount, status=@status, photo=@photo, tamkeen=@tamkeen,
          operation_sys=@operation_sys, system_status=@system_status, financial_wallet=@financial_wallet,
          lectures_count=@lectures_count, sale_id=@sale_id, updated_at=@ts WHERE id=@id`).run({ ...rParams, id: prior.id });
        receiptId = prior.id;
      } else {
        receiptId = db.prepare(`INSERT INTO cs_receipts
          (date, code, client_name, mobile_no, mobile_no2, client_wallet, receiver_channel, amount, timing,
           courses, price, discount, status, photo, tamkeen, operation_sys, system_status, financial_wallet,
           lectures_count, sale_id, client_request_id, source, created_by, created_by_name, created_at, updated_at)
          VALUES (@date,@code,@client_name,@mobile_no,@mobile_no2,@client_wallet,@receiver_channel,@amount,@timing,
           @courses,@price,@discount,@status,@photo,@tamkeen,@operation_sys,@system_status,@financial_wallet,
           @lectures_count,@sale_id,@reqId,'system',@by,@byName,@ts,@ts)`).run(rParams).lastInsertRowid;
      }
    })();
    saveNow();

    const receipt = db.prepare('SELECT * FROM cs_receipts WHERE id = ?').get(receiptId);
    return res.status(prior ? 200 : 201).json({ receipt, sale_id: saleId });
  } catch (err) {
    console.error('[cs-receipts/create]', err);
    return res.status(500).json({ error: err.message });
  }
});

// ─── PATCH a single tracking flag (inline edit from the list) ─────────────────
// Only tracking flags are editable this way; the field name is whitelisted so it
// can never be an arbitrary column, and the value must be one of the allowed opts.
// Amounts are never touched — the one exception is Status, which also updates the
// linked operation's paid_status flag (see below).
// Receiver channels — MUST mirror RECEIVER_CHANNELS in ReceiptsSection.jsx.
const RECEIVER_CHANNELS = ['1012164464', '1281429649', '1012164327', '1015048618', '1015082452', '1094172559', '1016738176', '1012164368', '1040247384', '1040254359', 'Paytaps', 'CiB', 'QNB-USD'];
const INLINE_FIELDS = {
  status: ['', 'Approved', 'Pending', 'Rejected'],
  photo: ['', 'Done'],
  tamkeen: ['', 'Done'],
  operation_sys: ['', 'Done'],
  system_status: ['', 'Done'],
  financial_wallet: ['', 'Transfer'],
  receiver_channel: ['', ...RECEIVER_CHANNELS],
};
// Free-text fields editable inline from the list (no fixed value list).
const INLINE_TEXT_FIELDS = new Set(['timing']);
router.patch('/:id/field', (req, res) => {
  try {
    const field = str(req.body && req.body.field);
    let value = req.body ? req.body.value : '';
    value = value == null ? '' : String(value);
    const isEnum = field && Object.prototype.hasOwnProperty.call(INLINE_FIELDS, field);
    const isText = field && INLINE_TEXT_FIELDS.has(field);
    if (!isEnum && !isText) {
      return res.status(400).json({ error: 'حقل غير مسموح' });
    }
    if (isEnum && !INLINE_FIELDS[field].includes(value)) {
      return res.status(400).json({ error: 'قيمة غير مسموحة' });
    }
    if (isText) value = value.trim().slice(0, 40); // free text — keep it short
    const row = db.prepare('SELECT id, sale_id FROM cs_receipts WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'غير موجود' });
    const ts = nowTs();
    db.prepare(`UPDATE cs_receipts SET ${field} = ?, updated_at = ? WHERE id = ?`)
      .run(str(value), ts, req.params.id);
    // Status drives the linked operation's paid_status (Rejected→Fake, Pending→Not
    // Paid, Approved/blank→by balance) so قائمة العمليات never shows Paid for a
    // rejected receipt. Amounts are untouched — only the paid_status flag changes.
    if (field === 'status' && row.sale_id) {
      const op = db.prepare('SELECT balance FROM cs_sales_register WHERE id = ?').get(row.sale_id);
      db.prepare('UPDATE cs_sales_register SET paid_status = ?, updated_at = ? WHERE id = ?')
        .run(paidStatusFor(value, op ? op.balance : 0), ts, row.sale_id);
    }
    saveNow();
    const receipt = db.prepare('SELECT * FROM cs_receipts WHERE id = ?').get(req.params.id);
    return res.json({ ok: true, receipt });
  } catch (err) {
    console.error('[cs-receipts/field]', err);
    return res.status(500).json({ error: err.message });
  }
});

// ─── DELETE (receipt only; the operation stays — delete it from قائمة العمليات) ─
router.delete('/:id', (req, res) => {
  try {
    const row = db.prepare('SELECT id FROM cs_receipts WHERE id = ?').get(req.params.id);
    if (!row) return res.status(404).json({ error: 'غير موجود' });
    db.prepare('DELETE FROM cs_receipts WHERE id = ?').run(req.params.id);
    saveNow();
    return res.json({ ok: true });
  } catch (err) {
    console.error('[cs-receipts/delete]', err);
    return res.status(500).json({ error: err.message });
  }
});

module.exports = router;
