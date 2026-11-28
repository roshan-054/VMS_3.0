/**
 * Settings > Download backup: every tab (or one date range) from Supabase as an Excel file with
 * the same tabs, columns and DD-MMM-YY dates as the Google Sheet.
 */
import { sbRpc } from './client';
import { decodeRow } from './cells';
import { loadCodeGsFactory } from './gasEngine';
import { fmtDate } from '../dateFormat';

/** Same order as the Sheet. */
export const BACKUP_TABS = ['Users', 'OrderLog', 'ReturnLog', 'DownloadLog', 'UploadLog', 'SecurityLog', 'Branding', 'TrashLog',
  'OrderManifest', 'PackVerificationLog', 'GTINCatalog', 'PackageDetails', 'ShopifyOrders', 'ReturnDetails'];
/** Lists that are copied whole even for a date range (they are not time logs). */
export const REFERENCE_TABS = ['Users', 'Branding', 'GTINCatalog'];

const DEFAULT_HEADERS: Record<string, string[]> = {
  Users: ['Timestamp', 'Full Name', 'Email', 'Password', 'Role', 'Status'],
  OrderLog: ['Timestamp', 'Order ID', 'Platform', 'Packer Email', 'Video Drive ID', 'Video Playback URL', 'Package Weight', 'Status', 'Recording Type', 'Queue Job ID', 'Video MIME Type', 'Playback Status'],
  ReturnLog: ['Timestamp', 'Order ID', 'Platform', 'Packer Email', 'Video Drive ID', 'Video Playback URL', 'Package Weight', 'Status', 'Recording Type', 'Queue Job ID', 'Video MIME Type', 'Playback Status'],
  DownloadLog: ['Timestamp', 'Order ID', 'Platform', 'User Email', 'File Name', 'File Size', 'Download Type', 'Recording Type'],
  UploadLog: ['Timestamp', 'Order ID', 'Platform', 'Packer Email', 'File Name', 'File Size', 'Upload ID', 'Stage', 'Progress', 'Drive File ID', 'Status', 'Error', 'Recording Type', 'Source', 'Queue Job ID'],
  SecurityLog: ['Timestamp', 'Email', 'Action', 'Result', 'Details'],
  Branding: ['Setting Key', 'Setting Value', 'Last Updated', 'Description'],
  TrashLog: ['Timestamp', 'Order ID', 'Platform', 'Recording Type', 'Action', 'Original Sheet', 'Drive File ID', 'Playback URL', 'Cleaned By', 'Details'],
  OrderManifest: ['Timestamp', 'Order ID', 'Platform', 'Assigned Packer Name', 'Assigned Packer Email', 'Processed By Name', 'Processed By Email', 'Total Items Count', 'Items List', 'Status', 'Notes', 'Packed At', 'Packed By Name', 'Video Drive Link'],
  PackVerificationLog: ['Timestamp', 'Order ID', 'Platform', 'Assigned Packer', 'Verified By Packer', 'Packer Email', 'Processed By', 'Status', 'Total Required Items', 'Total Scanned Items', 'Items Summary', 'Scanned GTINs Log', 'Duration Seconds', 'Drive Video URL'],
  GTINCatalog: ['Timestamp', 'GTIN', 'SKU', 'Product Name', 'Short Name', 'Category', 'Image URL', 'Default Quantity', 'Notes', 'Tag'],
  PackageDetails: ['Timestamp', 'Order ID', 'Platform', 'Recording Type', 'Box', 'Length (cm)', 'Breadth (cm)', 'Height (cm)',
    'Actual Weight (kg)', 'Volumetric Weight (kg)', 'Chargeable Weight (kg)', 'Volumetric Divisor', 'Packer Email'],
  ShopifyOrders: ['Synced At', 'Order ID', 'Order Date', 'Payment', 'Fulfillment', 'Order Status', 'Total Items Count', 'Items List',
    'Items JSON', 'Shopify Order ID', 'Shopify Updated At', 'Payment Mode', 'Payment Gateway', 'Tags', 'Customer Name', 'Customer Phone',
    'Customer Email', 'Shipping Pincode', 'Shipping City', 'Shipping State', 'Courier', 'Tracking Number'],
  ReturnDetails: ['Timestamp', 'Order ID', 'Platform', 'Return Type', 'Logistics Partner', 'Return Condition', 'Notes', 'Pincode',
    'Customer Name', 'Customer Phone', 'Customer Email', 'Not Received Claim', 'Recorded By'],
};

export interface BackupTabData {
  tab: string;
  headers: string[];
  rows: unknown[][]; // decoded cells
}

export interface BackupOptions {
  token: string;
  fromDate?: string; // yyyy-mm-dd, inclusive
  toDate?: string;   // yyyy-mm-dd, inclusive
  onProgress?: (text: string) => void;
}

async function exportTab(token: string, tab: string): Promise<{ headers: string[]; rows: unknown[][] }> {
  let after: number | null = null;
  let headers: string[] | null = null;
  const rows: unknown[][] = [];
  for (let page = 0; page < 500; page++) {
    const res: any = await sbRpc('vms_export', { p_token: token, p_tab: tab, p_after_seq: after, p_limit: 5000 }, { timeoutMs: 60000 });
    if (!headers && Array.isArray(res.headers)) headers = res.headers;
    for (const v of res.rows || []) rows.push(decodeRow(v));
    if (!res.more) break;
    after = res.next_seq;
  }
  return { headers: headers && headers.length ? headers : (DEFAULT_HEADERS[tab] || []), rows };
}

/** Read the backup data (also used by the tests). */
export async function collectBackup(opts: BackupOptions): Promise<BackupTabData[]> {
  const ranged = !!(opts.fromDate || opts.toDate);
  let inRange: (v: unknown) => boolean = () => true;
  if (ranged) {
    const factory = await loadCodeGsFactory();
    const G = factory({ console, __over: {} } as any);
    const rowDate = G('rowDate_') as (v: unknown) => Date;
    const from = opts.fromDate ? new Date(opts.fromDate + 'T00:00:00').getTime() : -Infinity;
    const to = opts.toDate ? new Date(opts.toDate + 'T23:59:59.999').getTime() : Infinity;
    inRange = (v) => {
      const d = rowDate(v);
      const t = d instanceof Date ? d.getTime() : NaN;
      return !isNaN(t) && t >= from && t <= to;
    };
  }
  const out: BackupTabData[] = [];
  for (const tab of BACKUP_TABS) {
    opts.onProgress?.('Reading ' + tab + '…');
    const { headers, rows } = await exportTab(opts.token, tab);
    const keep = ranged && !REFERENCE_TABS.includes(tab) ? rows.filter((r) => inRange(r[0])) : rows;
    out.push({ tab, headers, rows: keep });
  }
  return out;
}

export function backupFileName(fromDate?: string, toDate?: string): string {
  const f = (s?: string) => (s ? fmtDate(new Date(s + 'T12:00:00')) : '');
  if (fromDate || toDate) return `VMS-Backup-${f(fromDate) || 'start'}-to-${f(toDate) || f(new Date().toISOString().slice(0, 10))}.xlsx`;
  return `VMS-Backup-${fmtDate(new Date())}.xlsx`;
}

/** Build the Excel file. Dates are real dates shown as DD-MMM-YY hh:mm, like the Sheet. */
export async function buildBackupWorkbook(data: BackupTabData[]): Promise<ArrayBuffer> {
  const XLSX: any = await import('xlsx');
  const wb = XLSX.utils.book_new();
  for (const t of data) {
    const width = Math.max(t.headers.length, ...t.rows.map((r) => r.length), 1);
    const aoa = [t.headers.concat(Array(Math.max(0, width - t.headers.length)).fill('')),
      ...t.rows.map((r) => { const x = r.slice(); while (x.length < width) x.push(''); return x; })];
    const ws = XLSX.utils.aoa_to_sheet(aoa, { cellDates: true, dateNF: 'dd-mmm-yy hh:mm' });
    // Keep long numbers (GTINs, order numbers) exact.
    Object.keys(ws).forEach((addr) => {
      if (addr[0] === '!') return;
      const c = ws[addr];
      if (c && c.t === 'd') c.z = 'dd-mmm-yy hh:mm';
      if (c && c.t === 'n' && Math.abs(c.v) >= 1e11) { c.t = 's'; c.v = String(c.v); }
    });
    ws['!cols'] = t.headers.map((h) => ({ wch: Math.min(Math.max(String(h).length + 2, 12), 40) }));
    XLSX.utils.book_append_sheet(wb, ws, t.tab.slice(0, 31));
  }
  return XLSX.write(wb, { bookType: 'xlsx', type: 'array', cellDates: true });
}

export async function downloadBackup(opts: BackupOptions): Promise<{ fileName: string; rows: number; tabs: number }> {
  const data = await collectBackup(opts);
  opts.onProgress?.('Building the Excel file…');
  const buf = await buildBackupWorkbook(data);
  const fileName = backupFileName(opts.fromDate, opts.toDate);
  const blob = new Blob([buf], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
  return { fileName, rows: data.reduce((n, t) => n + t.rows.length, 0), tabs: data.length };
}
