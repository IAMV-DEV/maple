# MapleStory M Auto Monitor (HTML + MySQL/TiDB)

โครงสร้าง
- `public/index.html`  หน้าเว็บ HTML ล้วน (ไม่ใช้ ASP.NET / jQuery)
- `server.js`          API เล็ก ๆ ต่อ MySQL (TiDB Cloud) ผ่าน TLS  — แทน GetGameInfo/GetAccountList/ResetAccount.ashx
- `.env`               ข้อมูลเชื่อมต่อฐานข้อมูล (อย่าแชร์/อย่าขึ้น git)

วิธีรัน
1. ติดตั้ง Node.js 18+
2. `npm install`
3. `npm run schema`   (ตรวจว่าเชื่อมต่อได้ และดูชื่อตาราง/คอลัมน์จริงใน `maple`)
4. `npm start`  แล้วเปิด http://localhost:3000

ทำไมต้องมี server.js: เบราว์เซอร์ต่อ MySQL ตรง ๆ ไม่ได้ และถ้าใส่รหัสผ่านในหน้า HTML ใครเปิดดู source ก็เห็น/สั่ง Reset ได้

ถ้าข้อมูลไม่ขึ้นหรือคอลัมน์ไม่ตรง ให้แก้ `ACCOUNTS_SQL` และ `ALIASES` ที่ต้นไฟล์ server.js
