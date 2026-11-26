// Settings > Download backup: the Excel file has the Sheet's tabs/columns and DD-MMM-YY dates.
process.env.TZ = 'Asia/Kolkata';
import test from 'node:test';
import assert from 'node:assert/strict';
import XLSX from 'xlsx';
import { buildBackupWorkbook, backupFileName } from '../src/lib/supabase/backup';

test('backup workbook keeps tabs, headers, real dates and long numbers', async () => {
  const when = new Date('2026-11-26T09:15:00Z');
  const buf = await buildBackupWorkbook([
    { tab: 'OrderLog', headers: ['Timestamp', 'Order ID', 'Package Weight'], rows: [[when, '405-1-2', '1.2 MB'], [when, 8901234567890123, 3]] },
    { tab: 'Users', headers: ['Timestamp', 'Full Name', 'Email', 'Password', 'Role', 'Status'], rows: [[when, 'A', 'a@x', '', 'Admin', 'Approved']] },
  ]);
  const wb = XLSX.read(Buffer.from(buf), { cellDates: true, cellNF: true });
  assert.deepEqual(wb.SheetNames, ['OrderLog', 'Users']);
  const s = wb.Sheets.OrderLog;
  assert.equal(s.A1.v, 'Timestamp');
  assert.equal(s.B1.v, 'Order ID');
  assert.ok(s.A2.v instanceof Date, 'date cell');
  assert.equal(s.A2.z, 'dd-mmm-yy hh:mm');
  assert.equal(String(s.B3.v), '8901234567890123', 'long numbers stay exact');
  assert.equal(s.C3.v, 3);
  assert.ok(!wb.Sheets.Users.D2 || wb.Sheets.Users.D2.v === '', 'no password');
});

test('backup file names use DD-MMM-YY', () => {
  assert.equal(backupFileName('2026-11-01', '2026-11-26'), 'VMS-Backup-01-Nov-26-to-26-Nov-26.xlsx');
  assert.match(backupFileName(), /^VMS-Backup-\d\d-[A-Z][a-z]{2}-\d\d\.xlsx$/);
});
