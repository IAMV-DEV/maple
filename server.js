'use strict';
/**
 * MapleStory M Auto Monitor  -  API server (แทน GetGameInfo.ashx / GetAccountList.ashx / ResetAccount.ashx)
 * - เสิร์ฟหน้า /public/index.html (HTML ล้วน)
 * - ต่อ MySQL (TiDB Cloud) ผ่าน TLS โดยเก็บรหัสผ่านไว้ฝั่ง server ใน .env เท่านั้น
 */
require('dotenv').config();
const path = require('path');
const express = require('express');
const mysql = require('mysql2/promise');

const pool = mysql.createPool({
  host: process.env.DB_HOST,
  port: Number(process.env.DB_PORT || 4000),
  user: process.env.DB_USER,
  password: process.env.DB_PASSWORD,
  database: process.env.DB_NAME,
  ssl: { minVersion: 'TLSv1.2', rejectUnauthorized: true }, // TiDB Cloud บังคับ TLS
  waitForConnections: true,
  connectionLimit: 5,
  dateStrings: false,
  decimalNumbers: true,
});

// ---------------------------------------------------------------------------
// SQL ที่ใช้แทน Stored Procedure เดิม (TiDB/MySQL บน TiDB Cloud ไม่รองรับ stored procedure)
// ถ้าข้อมูลจริงอยู่คนละตาราง/ต้อง JOIN ให้แก้ที่ ACCOUNTS_SQL บรรทัดเดียว
// ---------------------------------------------------------------------------
const ACCOUNTS_SQL = 'SELECT * FROM accounts WHERE active = 1 ORDER BY act_date DESC'; // อัพเดทล่าสุดอยู่บนสุด (NULL อยู่ล่างสุด)

// ชื่อคอลัมน์ที่เป็นไปได้ (เลือกอันแรกที่มีอยู่จริงในตาราง) -> ชื่อมาตรฐานที่หน้าเว็บใช้
const ALIASES = {
  player:         ['player'],
  team:           ['team'],
  name:           ['name', 'char_name', 'nickname'],
  jobs:           ['jobs', 'job'],
  online_status:  ['online_status', 'game_online', 'online'],
  party_status:   ['party_status'],
  party_statusx:  ['party_statusx'],
  red_money:      ['red_money', 'redmeso', 'red_meso'],
  gold_money:     ['gold_money', 'meso', 'gold_meso'],
  trade:          ['trade'],
  dun_di:         ['dun_di'],
  dun_mu:         ['dun_mu'],
  open_box:       ['open_box'],
  bag_status:     ['bag_status'],
  auto_battle:    ['auto_battle'],
  power:          ['power', 'cp'],
  sf_map:         ['sf_map', 'sf'],
  act_date:       ['act_date', 'update_date', 'updated_at', 'last_update'],
  battery:        ['battery'],
};

function pick(row, keys) {
  for (const k of keys) if (row[k] !== undefined) return row[k];
  return undefined;
}

function pad(n) { return String(n).padStart(2, '0'); }
function hms(d) { return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`; }
const num = (v) => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
const flag = (v) => (v === 1 || v === true || v === '1' ? 1 : 0);

function normalize(row) {
  const o = {};
  for (const [std, keys] of Object.entries(ALIASES)) {
    const v = pick(row, keys);
    if (v === undefined || v === null) { o[std] = ''; continue; }
    o[std] = v instanceof Date ? hms(v) : (typeof v === 'bigint' ? Number(v) : v);
  }
  o.online_status = flag(o.online_status);
  return o;
}

// ---------------------------------------------------------------------------
const app = express();
app.use(express.json());
app.use(express.urlencoded({ extended: false }));
app.use(express.static(path.join(__dirname, 'public')));
app.use((req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });

// รายการตัวละคร + ตัวเลขสรุป (แทน GetAccountList.ashx)
app.get('/api/accounts', async (req, res) => {
  try {
    const [rows] = await pool.query(ACCOUNTS_SQL);
    const data = rows.map(normalize);

    let team = 0, battery = 0, red = 0, gold = 0, online = 0, party = 0;
    const teams = new Set();
    for (const r of data) {
      if (r.team !== '') teams.add(String(r.team));
      if (r.online_status === 1) online++;
      if (flag(r.party_status)) party++;
      if (r.battery !== '') battery = num(r.battery);
      red += num(r.red_money);
      gold += num(r.gold_money);
    }
    team = teams.size;
    const fmt = (v) => Math.round(v / 1e6).toLocaleString('en-US');

    res.json({
      success: true,
      currentTime: hms(new Date()),
      summary: { total: team, online, party, bag: battery, red_meso: fmt(red), gold_meso: fmt(gold), characters: data.length },
      data,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// Reset (แทน ResetAccount.ashx)
const RESET_SET =
  'auto_battle=NULL, bag_status=NULL, game_online=NULL, party_status=NULL, ' +
  'step_status=NULL, step_remark=NULL, dun_di=NULL, dun_mu=NULL, open_box=NULL, trade=NULL';

app.post('/api/reset', async (req, res) => {
  try {
    const key = process.env.ADMIN_KEY;
    if (key && req.get('x-admin-key') !== key) {
      return res.status(401).json({ success: false, message: 'รหัสผู้ดูแลไม่ถูกต้อง' });
    }
    const { action, player, team } = req.body || {};
    if (action === 'reset_all') {
      await pool.query(`UPDATE accounts SET ${RESET_SET} WHERE active = 1`);
    } else if (player && team) {
      await pool.query(`UPDATE accounts SET ${RESET_SET} WHERE player = ? AND team = ?`, [player, team]);
    } else {
      throw new Error('ข้อมูล Parameter ไม่ถูกต้อง');
    }
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ success: false, message: err.message });
  }
});

// ---------------------------------------------------------------------------
// ตรวจโครงสร้างฐานข้อมูลจริง:  npm run schema   (ใช้ตรวจว่าชื่อคอลัมน์ตรงกับที่โค้ดคาดไว้หรือไม่)
async function printSchema() {
  const [tables] = await pool.query('SHOW TABLES');
  console.log('Tables:', tables.map((t) => Object.values(t)[0]).join(', ') || '(ไม่มีตาราง)');
  for (const t of tables.map((x) => Object.values(x)[0])) {
    const [cols] = await pool.query(`SHOW COLUMNS FROM \`${t}\``);
    console.log(`\n[${t}]`);
    cols.forEach((c) => console.log(`  ${c.Field}  ${c.Type}`));
  }
  await pool.end();
}

if (process.argv.includes('--schema')) {
  printSchema().catch((e) => { console.error('เชื่อมต่อไม่สำเร็จ:', e.message); process.exit(1); });
} else {
  const port = Number(process.env.PORT || 3000);
  app.listen(port, () => console.log(`MapleStory Monitor running -> http://localhost:${port}`));
}
