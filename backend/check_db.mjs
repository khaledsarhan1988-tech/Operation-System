import { readFileSync } from 'fs';
import { createRequire } from 'module';
const require = createRequire(import.meta.url);
const initSqlJs = require('./node_modules/sql.js/dist/sql-wasm.js');

const SQL = await initSqlJs();
const data = readFileSync('./data/academy.db');
const db = new SQL.Database(data);

const r1 = db.exec("SELECT COUNT(*) as cnt FROM remarks WHERE category='توزيع عملاء'");
console.log('Total remarks (توزيع عملاء):', r1[0]?.values[0][0]);

const r2 = db.exec("SELECT client_date, status FROM remarks WHERE category='توزيع عملاء' LIMIT 5");
console.log('Sample dates/status:', r2[0]?.values);

const r3 = db.exec("SELECT status, COUNT(*) as cnt FROM remarks WHERE category='توزيع عملاء' GROUP BY status ORDER BY cnt DESC");
console.log('Status breakdown:', r3[0]?.values);

const r4 = db.exec("SELECT id, status, total_clients FROM distribution_sessions ORDER BY id");
console.log('Sessions:', r4[0]?.values);
