import QRCode from 'qrcode';
import {
  epochDaysToDisplayDate,
  getAvailableDates,
  isoToEpochDays,
} from '../lib/storage';

export function escapeHtml(str: string): string {
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
}

export function formatReadableDate(iso: string): string {
  const epoch = isoToEpochDays(iso);
  if (epoch === null) return iso;
  const d = new Date(epoch * 86_400_000);
  const weekdays = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
  return `${weekdays[d.getUTCDay()]}, ${epochDaysToDisplayDate(epoch)}`;
}

export function findNearestDateWithPasses(targetISO: string): string | null {
  const dates = getAvailableDates();
  if (dates.length === 0) return null;
  const upcoming = dates.find((d) => d >= targetISO);
  return upcoming ?? dates[dates.length - 1];
}

const qrSvgCache = new Map<string, string>();

export async function renderQrSvg(text: string): Promise<string> {
  const cached = qrSvgCache.get(text);
  if (cached) return cached;

  const svg = await QRCode.toString(text, {
    type: 'svg',
    margin: 2,
    errorCorrectionLevel: 'M',
    color: {
      dark: '#000000',
      light: '#ffffff',
    },
  });
  if (qrSvgCache.size > 400) {
    qrSvgCache.clear();
  }
  qrSvgCache.set(text, svg);
  return svg;
}
