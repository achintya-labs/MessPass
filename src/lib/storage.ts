import LZString from 'lz-string';

export type MealType = 'B' | 'L' | 'S' | 'D' | 'U';

export type ScheduledMealType = 'B' | 'L' | 'S' | 'D';

export interface MealWindow {
  meal: ScheduledMealType;
  startMinutes: number;
  endMinutes: number;
  label: string;
}

export interface RelevantMealInfo {
  meal: ScheduledMealType | null;
  status: 'active' | 'upcoming' | 'none';
  windowLabel: string;
}

export interface Coupon {
  epochDays: number;
  dateISO: string;
  displayDate: string;
  meal: MealType;
  id: string;
  rawPayload: string;
}

export interface CouponInput {
  epochDays: number;
  meal: MealType;
  id: string;
}

export interface ParsedQR {
  id: string;
  epochDays: number;
  dateISO: string;
  displayDate: string;
  rawPayload: string;
}

export interface MergeStats {
  added: number;
  updated: number;
  duplicates: number;
  total: number;
}

export interface StorageStats {
  count: number;
  bytes: number;
  datesCount: number;
  expiredCount: number;
}

export interface TransferChunk {
  part: number;
  total: number;
  data: string;
}

export const STORAGE_KEY = 'mc_v1';
export const TRANSFER_PREFIX = 'MC1:';

const MS_PER_DAY = 86_400_000;

export const MEAL_ORDER: Record<MealType, number> = {
  B: 0,
  L: 1,
  S: 2,
  D: 3,
  U: 4,
};

export const MEAL_LABELS: Record<MealType, string> = {
  B: 'Breakfast',
  L: 'Lunch',
  S: 'Snacks',
  D: 'Dinner',
  U: 'Unknown',
};

export const MEAL_WINDOWS: readonly MealWindow[] = [
  { meal: 'B', startMinutes: 7 * 60, endMinutes: 10 * 60, label: '7:00 – 10:00 AM' },
  { meal: 'L', startMinutes: 12 * 60, endMinutes: 14 * 60 + 30, label: '12:00 – 2:30 PM' },
  { meal: 'S', startMinutes: 16 * 60 + 30, endMinutes: 17 * 60 + 30, label: '4:30 – 5:30 PM' },
  { meal: 'D', startMinutes: 19 * 60, endMinutes: 21 * 60 + 30, label: '7:00 – 9:30 PM' },
] as const;

export const MEAL_TIMING_LABELS: Partial<Record<MealType, string>> = {
  B: '7:00 – 10:00 AM',
  L: '12:00 – 2:30 PM',
  S: '4:30 – 5:30 PM',
  D: '7:00 – 9:30 PM',
};

/**
 * Determines which meal pass is currently active (or next upcoming) for the
 * given local time of day:
 * - Breakfast: 7:00 – 10:00
 * - Lunch:     12:00 – 14:30
 * - Snacks:    16:30 – 17:30
 * - Dinner:    19:00 – 21:30
 */
export function getRelevantMealForTime(now: Date = new Date()): RelevantMealInfo {
  const minutes = now.getHours() * 60 + now.getMinutes();

  for (const win of MEAL_WINDOWS) {
    if (minutes >= win.startMinutes && minutes <= win.endMinutes) {
      return {
        meal: win.meal,
        status: 'active',
        windowLabel: win.label,
      };
    }
  }

  for (const win of MEAL_WINDOWS) {
    if (minutes < win.startMinutes) {
      return {
        meal: win.meal,
        status: 'upcoming',
        windowLabel: win.label,
      };
    }
  }

  return {
    meal: null,
    status: 'none',
    windowLabel: '',
  };
}

const SHORT_MONTHS = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
] as const;

const MONTH_MAP: Record<string, number> = {
  jan: 0,
  january: 0,
  feb: 1,
  february: 1,
  mar: 2,
  march: 2,
  apr: 3,
  april: 3,
  may: 4,
  jun: 5,
  june: 5,
  jul: 6,
  july: 6,
  aug: 7,
  august: 7,
  sep: 8,
  sept: 8,
  september: 8,
  oct: 9,
  october: 9,
  nov: 10,
  november: 10,
  dec: 11,
  december: 11,
};

export function isMealType(value: string): value is MealType {
  return (
    value === 'B' ||
    value === 'L' ||
    value === 'S' ||
    value === 'D' ||
    value === 'U'
  );
}

export function datePartsToEpochDays(
  year: number,
  monthIndex0: number,
  day: number
): number | null {
  if (
    !Number.isInteger(year) ||
    !Number.isInteger(monthIndex0) ||
    !Number.isInteger(day) ||
    year < 1970 ||
    year > 9999 ||
    monthIndex0 < 0 ||
    monthIndex0 > 11 ||
    day < 1 ||
    day > 31
  ) {
    return null;
  }

  const utcMs = Date.UTC(year, monthIndex0, day);
  const check = new Date(utcMs);
  if (
    check.getUTCFullYear() !== year ||
    check.getUTCMonth() !== monthIndex0 ||
    check.getUTCDate() !== day
  ) {
    return null;
  }

  return Math.floor(utcMs / MS_PER_DAY);
}

export function epochDaysToISO(epochDays: number): string {
  const d = new Date(epochDays * MS_PER_DAY);
  const y = d.getUTCFullYear();
  const m = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function epochDaysToDisplayDate(epochDays: number): string {
  const d = new Date(epochDays * MS_PER_DAY);
  const month = SHORT_MONTHS[d.getUTCMonth()];
  const day = d.getUTCDate();
  const year = d.getUTCFullYear();
  return `${month} ${day}, ${year}`;
}

export function isoToEpochDays(iso: string): number | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso.trim());
  if (!match) return null;
  const year = Number(match[1]);
  const monthIndex0 = Number(match[2]) - 1;
  const day = Number(match[3]);
  return datePartsToEpochDays(year, monthIndex0, day);
}

export function getTodayLocalISO(): string {
  const now = new Date();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function getTodayLocalEpochDays(): number {
  const now = new Date();
  return (
    datePartsToEpochDays(now.getFullYear(), now.getMonth(), now.getDate()) ??
    Math.floor(Date.now() / MS_PER_DAY)
  );
}

export function shiftISODate(iso: string, deltaDays: number): string {
  const epochDays = isoToEpochDays(iso);
  if (epochDays === null) return getTodayLocalISO();
  return epochDaysToISO(Math.max(0, epochDays + deltaDays));
}

export function formatCouponPayload(id: string, epochDays: number): string {
  return `${id}\`${epochDaysToDisplayDate(epochDays)}`;
}

export function buildCoupon(
  epochDays: number,
  meal: MealType,
  id: string
): Coupon {
  const displayDate = epochDaysToDisplayDate(epochDays);
  return {
    epochDays,
    dateISO: epochDaysToISO(epochDays),
    displayDate,
    meal,
    id,
    rawPayload: `${id}\`${displayDate}`,
  };
}

/**
 * Parses a mess coupon QR payload of the format: `"id`Nov 22, 2026"`.
 */
export function parseCouponPayload(raw: string): ParsedQR | null {
  const trimmed = raw.trim();
  const sepIdx = trimmed.lastIndexOf('`');
  if (sepIdx <= 0 || sepIdx === trimmed.length - 1) return null;

  const id = trimmed.slice(0, sepIdx).trim();
  const datePart = trimmed.slice(sepIdx + 1).trim();

  if (!id || /[\r\n|]/.test(id)) return null;

  const dateMatch = /^([A-Za-z]+)\s+(\d{1,2})\s*,\s*(\d{4})$/.exec(datePart);
  if (!dateMatch) return null;

  const monthIndex0 = MONTH_MAP[dateMatch[1].toLowerCase()];
  if (monthIndex0 === undefined) return null;

  const day = Number(dateMatch[2]);
  const year = Number(dateMatch[3]);
  const epochDays = datePartsToEpochDays(year, monthIndex0, day);
  if (epochDays === null) return null;

  const displayDate = epochDaysToDisplayDate(epochDays);
  const dateISO = epochDaysToISO(epochDays);

  return {
    id,
    epochDays,
    dateISO,
    displayDate,
    rawPayload: `${id}\`${displayDate}`,
  };
}

function couponKey(epochDays: number, id: string): string {
  return `${epochDays}\u0000${id}`;
}

export function compareCoupons(a: Coupon, b: Coupon): number {
  if (a.epochDays !== b.epochDays) return a.epochDays - b.epochDays;
  const mealDiff = MEAL_ORDER[a.meal] - MEAL_ORDER[b.meal];
  if (mealDiff !== 0) return mealDiff;
  return a.id.localeCompare(b.id);
}

/**
 * Serializes coupons into compact line-delimited format:
 * `<epoch_days_base36>|<meal_char>|<id>`
 */
export function serializeCoupons(coupons: Coupon[]): string {
  const deduped = new Map<string, Coupon>();
  for (const c of coupons) {
    const key = couponKey(c.epochDays, c.id);
    const existing = deduped.get(key);
    if (!existing) {
      deduped.set(key, c);
    } else if (existing.meal === 'U' && c.meal !== 'U') {
      deduped.set(key, c);
    }
  }

  return Array.from(deduped.values())
    .sort(compareCoupons)
    .map((c) => `${c.epochDays.toString(36)}|${c.meal}|${c.id}`)
    .join('\n');
}

/**
 * Parses compact line-delimited `<epoch_days_base36>|<meal_char>|<id>` storage text,
 * deduplicating by full QR payload (`id` + date) and preferring known meal types over `U`.
 */
export function deserializeCoupons(raw: string): Coupon[] {
  if (!raw || !raw.trim()) return [];

  const map = new Map<string, Coupon>();
  const lines = raw.split(/\r?\n/);

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;

    const firstPipe = trimmed.indexOf('|');
    if (firstPipe <= 0) continue;
    const secondPipe = trimmed.indexOf('|', firstPipe + 1);
    if (secondPipe <= firstPipe + 1) continue;

    const epochBase36 = trimmed.slice(0, firstPipe);
    const mealChar = trimmed.slice(firstPipe + 1, secondPipe);
    const id = trimmed.slice(secondPipe + 1);

    if (!/^[0-9a-z]+$/i.test(epochBase36)) continue;
    const epochDays = parseInt(epochBase36, 36);
    if (!Number.isSafeInteger(epochDays) || epochDays < 0) continue;
    if (!isMealType(mealChar)) continue;
    if (!id || /[\r\n|]/.test(id)) continue;

    const key = couponKey(epochDays, id);
    const existing = map.get(key);
    if (!existing) {
      map.set(key, buildCoupon(epochDays, mealChar, id));
    } else if (existing.meal === 'U' && mealChar !== 'U') {
      map.set(key, buildCoupon(epochDays, mealChar, id));
    }
  }

  return Array.from(map.values()).sort(compareCoupons);
}

export function getRawStorage(): string {
  try {
    return localStorage.getItem(STORAGE_KEY) ?? '';
  } catch {
    return '';
  }
}

export function loadCoupons(): Coupon[] {
  return deserializeCoupons(getRawStorage());
}

export function saveCoupons(coupons: Coupon[]): void {
  const serialized = serializeCoupons(coupons);
  if (serialized.length === 0) {
    localStorage.removeItem(STORAGE_KEY);
  } else {
    localStorage.setItem(STORAGE_KEY, serialized);
  }
}

export function mergeCoupons(
  incoming: CouponInput[],
  options: { overwriteKnownMeal?: boolean } = {}
): MergeStats {
  const current = loadCoupons();
  const map = new Map<string, Coupon>();

  for (const c of current) {
    map.set(couponKey(c.epochDays, c.id), c);
  }

  let added = 0;
  let updated = 0;
  let duplicates = 0;

  for (const item of incoming) {
    if (!item.id || /[\r\n|]/.test(item.id)) continue;
    const key = couponKey(item.epochDays, item.id);
    const existing = map.get(key);

    if (!existing) {
      map.set(key, buildCoupon(item.epochDays, item.meal, item.id));
      added++;
    } else if (existing.meal === 'U' && item.meal !== 'U') {
      map.set(key, buildCoupon(item.epochDays, item.meal, item.id));
      updated++;
    } else if (
      options.overwriteKnownMeal &&
      item.meal !== 'U' &&
      existing.meal !== item.meal
    ) {
      map.set(key, buildCoupon(item.epochDays, item.meal, item.id));
      updated++;
    } else {
      duplicates++;
    }
  }

  const merged = Array.from(map.values()).sort(compareCoupons);
  saveCoupons(merged);

  return {
    added,
    updated,
    duplicates,
    total: merged.length,
  };
}

export function getCouponsForDate(dateISO: string): Coupon[] {
  const targetEpoch = isoToEpochDays(dateISO);
  if (targetEpoch === null) return [];
  return loadCoupons()
    .filter((c) => c.epochDays === targetEpoch)
    .sort(compareCoupons);
}

export function getAvailableDates(): string[] {
  const seen = new Set<string>();
  const dates: string[] = [];
  for (const c of loadCoupons()) {
    if (!seen.has(c.dateISO)) {
      seen.add(c.dateISO);
      dates.push(c.dateISO);
    }
  }
  return dates;
}

export function getStorageStats(): StorageStats {
  const raw = getRawStorage();
  const coupons = deserializeCoupons(raw);
  const todayEpoch = getTodayLocalEpochDays();
  const dates = new Set<number>();
  let expiredCount = 0;

  for (const c of coupons) {
    dates.add(c.epochDays);
    if (c.epochDays < todayEpoch) {
      expiredCount++;
    }
  }

  return {
    count: coupons.length,
    bytes: new TextEncoder().encode(raw).length,
    datesCount: dates.size,
    expiredCount,
  };
}

export function deleteCoupon(epochDays: number, id: string): boolean {
  const current = loadCoupons();
  const next = current.filter(
    (c) => !(c.epochDays === epochDays && c.id === id)
  );
  if (next.length === current.length) return false;
  saveCoupons(next);
  return true;
}

export function deleteCouponsForDate(dateISO: string): number {
  const targetEpoch = isoToEpochDays(dateISO);
  if (targetEpoch === null) return 0;
  const current = loadCoupons();
  const next = current.filter((c) => c.epochDays !== targetEpoch);
  const removed = current.length - next.length;
  if (removed > 0) saveCoupons(next);
  return removed;
}

export function deleteExpiredCoupons(todayISO?: string): number {
  const cutoff =
    todayISO !== undefined
      ? isoToEpochDays(todayISO) ?? getTodayLocalEpochDays()
      : getTodayLocalEpochDays();

  const current = loadCoupons();
  const next = current.filter((c) => c.epochDays >= cutoff);
  const removed = current.length - next.length;
  if (removed > 0) saveCoupons(next);
  return removed;
}

export function wipeAllCoupons(): number {
  const count = loadCoupons().length;
  localStorage.removeItem(STORAGE_KEY);
  return count;
}

export function compressForTransfer(): string {
  const canonical = serializeCoupons(loadCoupons());
  if (!canonical) return '';
  return LZString.compressToBase64(canonical);
}

export function decompressTransferData(compressed: string): Coupon[] | null {
  const trimmed = compressed.trim();
  if (!trimmed) return null;
  try {
    const decompressed = LZString.decompressFromBase64(trimmed);
    if (!decompressed) return null;
    const coupons = deserializeCoupons(decompressed);
    if (coupons.length === 0) return null;
    return coupons;
  } catch {
    return null;
  }
}

/**
 * Splits compressed storage data into sequential QR chunks:
 * `MC1:<part>/<total>:<data>`
 */
export function createTransferChunks(chunkSize = 280): string[] {
  const compressed = compressForTransfer();
  if (!compressed) return [];

  const safeSize = Math.max(80, Math.floor(chunkSize));
  const total = Math.ceil(compressed.length / safeSize);
  const chunks: string[] = [];

  for (let i = 0; i < total; i++) {
    const slice = compressed.slice(i * safeSize, (i + 1) * safeSize);
    chunks.push(`${TRANSFER_PREFIX}${i + 1}/${total}:${slice}`);
  }

  return chunks;
}

export function parseTransferChunk(raw: string): TransferChunk | null {
  const trimmed = raw.trim();
  if (!trimmed.startsWith(TRANSFER_PREFIX)) return null;

  const match = /^MC1:(\d+)\/(\d+):([\s\S]+)$/.exec(trimmed);
  if (!match) return null;

  const part = Number(match[1]);
  const total = Number(match[2]);
  const data = match[3];

  if (
    !Number.isInteger(part) ||
    !Number.isInteger(total) ||
    total < 1 ||
    part < 1 ||
    part > total ||
    !data
  ) {
    return null;
  }

  return { part, total, data };
}

export function createBackupFileContent(): string {
  const compressed = compressForTransfer();
  if (!compressed) return '';
  return `${TRANSFER_PREFIX}${compressed}`;
}

/**
 * Parses a `.txt` backup file. Supports:
 * - Compressed `MC1:<base64>`
 * - Single-chunk `MC1:1/1:<base64>`
 * - Raw `mc_v1` line-delimited text
 */
export function parseBackupFileContent(text: string): Coupon[] | null {
  const trimmed = text.trim();
  if (!trimmed) return null;

  const singleChunk = parseTransferChunk(trimmed);
  if (singleChunk && singleChunk.total === 1 && singleChunk.part === 1) {
    return decompressTransferData(singleChunk.data);
  }

  if (trimmed.startsWith(TRANSFER_PREFIX)) {
    return decompressTransferData(trimmed.slice(TRANSFER_PREFIX.length));
  }

  const rawCoupons = deserializeCoupons(trimmed);
  return rawCoupons.length > 0 ? rawCoupons : null;
}
