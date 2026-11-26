import type { PlatformType } from '../types';

/**
 * The platform an order ID clearly belongs to, or null when it cannot be told from the ID alone
 * (the packer then picks it). Only clear prefixes / full formats count, never loose substrings.
 * - Amazon: 3-7-7 digits (405-9801142-6317130), AMZ- / AMAZON- prefixes, 40… / 17… long numbers
 * - JioMart: JIO- / JM- / JIOMART- prefixes
 * - D2C: #OD- / OD- (any number of '#', spaces ignored), D2C- / W- / FK- prefixes, 12-16 digit AWBs
 */
export function detectPlatformFromOrderId(raw: string | null | undefined): PlatformType | null {
  const clean = String(raw || '').replace(/\s+/g, '').replace(/^[^A-Za-z0-9#]+/, '').replace(/[^A-Za-z0-9]+$/, '');
  if (!clean) return null;
  const lower = clean.toLowerCase();
  if (
    lower.startsWith('amz-') ||
    lower.startsWith('amazon-') ||
    /^\d{3}-\d{7}-\d{7}$/.test(clean) ||
    /^40\d{8,12}$/.test(clean) ||
    /^17\d{8,12}$/.test(clean)
  ) return 'Amazon';
  if (lower.startsWith('jio-') || lower.startsWith('jm-') || lower.startsWith('jiomart-')) return 'JioMart';
  if (
    /^#*od-/.test(lower) ||
    lower.startsWith('d2c-') ||
    lower.startsWith('w-') ||
    lower.startsWith('fk-') ||
    /^\d{12,16}$/.test(clean) // Delhivery / Shiprocket tracking AWB
  ) return 'D2C';
  return null;
}
