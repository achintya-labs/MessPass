import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  STORAGE_KEY,
  buildCoupon,
  compressForTransfer,
  createBackupFileContent,
  createTransferChunks,
  datePartsToEpochDays,
  decompressTransferData,
  deleteCoupon,
  deleteCouponsForDate,
  deleteExpiredCoupons,
  deserializeCoupons,
  epochDaysToDisplayDate,
  epochDaysToISO,
  formatCouponPayload,
  getAvailableDates,
  getCouponsForDate,
  getRawStorage,
  getRelevantMealForTime,
  getStorageStats,
  isoToEpochDays,
  loadCoupons,
  mergeCoupons,
  parseBackupFileContent,
  parseCouponPayload,
  parseTransferChunk,
  serializeCoupons,
  shiftISODate,
  wipeAllCoupons,
  type MealType,
} from '../src/lib/storage.ts';

function installMockLocalStorage(): Map<string, string> {
  const store = new Map<string, string>();
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: {
      getItem: (key: string) => (store.has(key) ? store.get(key)! : null),
      setItem: (key: string, value: string) => {
        store.set(key, String(value));
      },
      removeItem: (key: string) => {
        store.delete(key);
      },
      clear: () => {
        store.clear();
      },
      get length() {
        return store.size;
      },
      key: (i: number) => Array.from(store.keys())[i] ?? null,
    },
  });
  return store;
}

describe('Date & Epoch Utilities', () => {
  it('converts UTC dates accurately without timezone drift', () => {
    assert.equal(datePartsToEpochDays(1970, 0, 1), 0);
    assert.equal(epochDaysToISO(0), '1970-01-01');
    assert.equal(epochDaysToDisplayDate(0), 'Jan 1, 1970');

    const epoch = isoToEpochDays('2026-11-22');
    assert.ok(epoch !== null);
    assert.equal(epochDaysToISO(epoch), '2026-11-22');
    assert.equal(epochDaysToDisplayDate(epoch), 'Nov 22, 2026');
  });

  it('validates leap years and rejects impossible calendar dates', () => {
    assert.notEqual(datePartsToEpochDays(2024, 1, 29), null);
    assert.notEqual(datePartsToEpochDays(2028, 1, 29), null);
    assert.equal(datePartsToEpochDays(2025, 1, 29), null);
    assert.equal(datePartsToEpochDays(2026, 1, 30), null);
    assert.equal(datePartsToEpochDays(2026, 3, 31), null);
    assert.equal(isoToEpochDays('2026-02-30'), null);
    assert.equal(isoToEpochDays('invalid'), null);
  });

  it('shifts ISO dates forward and backward across month/year boundaries', () => {
    assert.equal(shiftISODate('2026-11-30', 1), '2026-12-01');
    assert.equal(shiftISODate('2026-01-01', -1), '2025-12-31');
    assert.equal(shiftISODate('2024-02-28', 1), '2024-02-29');
    assert.equal(shiftISODate('2024-02-29', 1), '2024-03-01');
  });
});

describe('QR Payload Parsing ("id`Nov 22, 2026")', () => {
  it('parses standard, single-digit, zero-padded, full-month, and mixed-case dates', () => {
    const standard = parseCouponPayload('CPN-1001`Nov 22, 2026');
    assert.deepEqual(standard, {
      id: 'CPN-1001',
      epochDays: isoToEpochDays('2026-11-22')!,
      dateISO: '2026-11-22',
      displayDate: 'Nov 22, 2026',
      rawPayload: 'CPN-1001`Nov 22, 2026',
    });

    const singleDigit = parseCouponPayload('  ID42`Nov 5, 2026  ');
    assert.ok(singleDigit);
    assert.equal(singleDigit.id, 'ID42');
    assert.equal(singleDigit.dateISO, '2026-11-05');
    assert.equal(singleDigit.displayDate, 'Nov 5, 2026');

    const zeroPadded = parseCouponPayload('ID42`Nov 05, 2026');
    assert.ok(zeroPadded);
    assert.equal(zeroPadded.dateISO, '2026-11-05');
    assert.equal(zeroPadded.rawPayload, 'ID42`Nov 5, 2026');

    const fullMonth = parseCouponPayload('ID99`SEPTEMBER 1, 2026');
    assert.ok(fullMonth);
    assert.equal(fullMonth.dateISO, '2026-09-01');
    assert.equal(fullMonth.displayDate, 'Sep 1, 2026');

    assert.equal(
      formatCouponPayload('CPN-1001', isoToEpochDays('2026-11-22')!),
      'CPN-1001`Nov 22, 2026'
    );
  });

  it('rejects malformed payloads, invalid dates, and storage-breaking characters', () => {
    assert.equal(parseCouponPayload(''), null);
    assert.equal(parseCouponPayload('no-backtick-here'), null);
    assert.equal(parseCouponPayload('`Nov 22, 2026'), null);
    assert.equal(parseCouponPayload('ID1`'), null);
    assert.equal(parseCouponPayload('ID1`Foo 22, 2026'), null);
    assert.equal(parseCouponPayload('ID1`Feb 29, 2026'), null);
    assert.equal(parseCouponPayload('BAD|PIPE`Nov 22, 2026'), null);
    assert.equal(parseCouponPayload('BAD\nLINE`Nov 22, 2026'), null);
  });
});

describe('Compact mc_v1 Storage, Deduplication & Ordering', () => {
  let backingStore: Map<string, string>;

  beforeEach(() => {
    backingStore = installMockLocalStorage();
  });

  it('stores compact <epoch_days_base36>|<meal_char>|<id> lines under single key mc_v1', () => {
    const epoch = isoToEpochDays('2026-11-22')!;
    mergeCoupons([
      { epochDays: epoch, meal: 'D', id: 'C3' },
      { epochDays: epoch, meal: 'B', id: 'C1' },
      { epochDays: epoch, meal: 'L', id: 'C2' },
    ]);

    assert.deepEqual(Array.from(backingStore.keys()), [STORAGE_KEY]);
    const b36 = epoch.toString(36);
    assert.equal(
      getRawStorage(),
      `${b36}|B|C1\n${b36}|L|C2\n${b36}|D|C3`
    );
  });

  it('deduplicates by full QR payload (id + date), preferring known meal types over U', () => {
    const day1 = isoToEpochDays('2026-11-22')!;
    const day2 = isoToEpochDays('2026-11-23')!;

    const first = mergeCoupons([
      { epochDays: day1, meal: 'U', id: 'SAME_ID' },
      { epochDays: day1, meal: 'L', id: 'KNOWN_ID' },
      { epochDays: day2, meal: 'B', id: 'SAME_ID' }, // different date => distinct payload
    ]);
    assert.equal(first.added, 3);
    assert.equal(first.updated, 0);
    assert.equal(first.duplicates, 0);

    // Upgrade U -> D, ignore incoming U over existing L, ignore incoming D over existing L by default
    const second = mergeCoupons([
      { epochDays: day1, meal: 'D', id: 'SAME_ID' },
      { epochDays: day1, meal: 'U', id: 'KNOWN_ID' },
      { epochDays: day1, meal: 'D', id: 'KNOWN_ID' },
    ]);
    assert.equal(second.added, 0);
    assert.equal(second.updated, 1);
    assert.equal(second.duplicates, 2);

    const day1Coupons = getCouponsForDate('2026-11-22');
    assert.deepEqual(
      day1Coupons.map((c) => `${c.meal}:${c.id}`),
      ['L:KNOWN_ID', 'D:SAME_ID']
    );

    // Explicit overwriteKnownMeal (manual camera tag re-tagging)
    const third = mergeCoupons(
      [{ epochDays: day1, meal: 'B', id: 'KNOWN_ID' }],
      { overwriteKnownMeal: true }
    );
    assert.equal(third.updated, 1);
    assert.equal(getCouponsForDate('2026-11-22')[0].meal, 'B');
  });

  it('orders daily coupons strictly Breakfast -> Lunch -> Snacks -> Dinner -> Unknown', () => {
    const day = isoToEpochDays('2026-11-22')!;
    mergeCoupons([
      { epochDays: day, meal: 'U', id: 'A1' },
      { epochDays: day, meal: 'D', id: 'A2' },
      { epochDays: day, meal: 'S', id: 'A5' },
      { epochDays: day, meal: 'L', id: 'A3' },
      { epochDays: day, meal: 'B', id: 'A4' },
      { epochDays: day, meal: 'B', id: 'A0' },
    ]);

    const sorted = getCouponsForDate('2026-11-22');
    assert.deepEqual(
      sorted.map((c) => `${c.meal}:${c.id}`),
      ['B:A0', 'B:A4', 'L:A3', 'S:A5', 'D:A2', 'U:A1']
    );
  });

  it('ignores malformed lines gracefully during deserialization', () => {
    const epoch = isoToEpochDays('2026-11-22')!;
    const b36 = epoch.toString(36);
    const parsed = deserializeCoupons(
      [
        '',
        'garbage line',
        `${b36}|X|INVALID_MEAL`,
        `notbase36!|B|BAD_EPOCH`,
        `${b36}|U|ID1`,
        `${b36}|B|ID1`, // dedups & upgrades U -> B
        `${b36}|L|ID2`,
      ].join('\n')
    );

    assert.equal(parsed.length, 2);
    assert.equal(parsed[0].meal, 'B');
    assert.equal(parsed[0].id, 'ID1');
    assert.equal(parsed[1].meal, 'L');
    assert.equal(parsed[1].id, 'ID2');
  });

  it('serializes deterministically and reports available dates', () => {
    const d1 = isoToEpochDays('2026-11-24')!;
    const d2 = isoToEpochDays('2026-11-21')!;
    const serialized = serializeCoupons([
      buildCoupon(d1, 'D', 'X'),
      buildCoupon(d2, 'B', 'Y'),
      buildCoupon(d2, 'U', 'Y'),
    ]);
    assert.equal(serialized, `${d2.toString(36)}|B|Y\n${d1.toString(36)}|D|X`);

    mergeCoupons([
      { epochDays: d1, meal: 'D', id: 'X' },
      { epochDays: d2, meal: 'B', id: 'Y' },
    ]);
    assert.deepEqual(getAvailableDates(), ['2026-11-21', '2026-11-24']);
  });
});

describe('1,000-Coupon Footprint, LZ-String Transfer Chunking & .txt Backup', () => {
  beforeEach(() => {
    installMockLocalStorage();
  });

  it('stores 1,000 coupons in minimal footprint and round-trips through MC1 QR chunks & .txt backup', () => {
    const startEpoch = isoToEpochDays('2026-01-01')!;
    const meals: MealType[] = ['B', 'L', 'S', 'D'];
    const bulk = Array.from({ length: 1000 }, (_, i) => ({
      epochDays: startEpoch + Math.floor(i / 4),
      meal: meals[i % 4],
      id: `MP${String(100000 + i)}`,
    }));

    const mergeResult = mergeCoupons(bulk);
    assert.equal(mergeResult.added, 1000);
    assert.equal(mergeResult.total, 1000);

    const stats = getStorageStats();
    assert.equal(stats.count, 1000);
    assert.ok(
      stats.bytes < 20_000,
      `Expected < 20KB for 1,000 coupons, got ${stats.bytes} bytes`
    );

    const compressed = compressForTransfer();
    assert.ok(compressed.length > 0 && compressed.length < stats.bytes);

    // Split into sequential chunks (280 chars each)
    const chunks = createTransferChunks(280);
    assert.ok(chunks.length > 1);

    // Simulate scanning chunks in reverse/shuffled order
    const rxMap = new Map<number, string>();
    for (const rawChunk of [...chunks].reverse()) {
      const parsed = parseTransferChunk(rawChunk);
      assert.ok(parsed);
      assert.equal(parsed.total, chunks.length);
      rxMap.set(parsed.part, parsed.data);
    }
    assert.equal(rxMap.size, chunks.length);

    let reassembled = '';
    for (let p = 1; p <= chunks.length; p++) {
      reassembled += rxMap.get(p)!;
    }

    const decoded = decompressTransferData(reassembled);
    assert.ok(decoded);
    assert.equal(decoded.length, 1000);
    assert.deepEqual(decoded, loadCoupons());

    // Backup .txt export & restore round-trip
    const backupTxt = createBackupFileContent();
    assert.ok(backupTxt.startsWith('MC1:'));
    const restoredFromCompressed = parseBackupFileContent(backupTxt);
    assert.ok(restoredFromCompressed);
    assert.equal(restoredFromCompressed.length, 1000);

    // Single-chunk format and raw mc_v1 fallback also restore cleanly
    const restoredFromSingleChunk = parseBackupFileContent(
      `MC1:1/1:${compressed}`
    );
    assert.equal(restoredFromSingleChunk?.length, 1000);

    const restoredFromRaw = parseBackupFileContent(getRawStorage());
    assert.equal(restoredFromRaw?.length, 1000);
  });

  it('rejects malformed transfer chunks and invalid backup contents', () => {
    assert.equal(parseTransferChunk('NOTMC:1/2:abc'), null);
    assert.equal(parseTransferChunk('MC1:0/2:abc'), null);
    assert.equal(parseTransferChunk('MC1:3/2:abc'), null);
    assert.equal(parseTransferChunk('MC1:1/2:'), null);
    assert.equal(decompressTransferData(''), null);
    assert.equal(parseBackupFileContent(''), null);
    assert.equal(parseBackupFileContent('MC1:not_valid_compressed_data!!!'), null);
  });
});

describe('Single & Bulk Deletion Operations', () => {
  beforeEach(() => {
    installMockLocalStorage();
  });

  it('supports single coupon, selected-date, expired-only, and wipe-all deletions', () => {
    const dPast1 = isoToEpochDays('2026-11-18')!;
    const dPast2 = isoToEpochDays('2026-11-20')!;
    const dToday = isoToEpochDays('2026-11-21')!;
    const dFuture = isoToEpochDays('2026-11-22')!;

    mergeCoupons([
      { epochDays: dPast1, meal: 'B', id: 'P1' },
      { epochDays: dPast2, meal: 'L', id: 'P2' },
      { epochDays: dToday, meal: 'B', id: 'T1' },
      { epochDays: dToday, meal: 'L', id: 'T2' },
      { epochDays: dFuture, meal: 'B', id: 'F1' },
      { epochDays: dFuture, meal: 'D', id: 'F2' },
    ]);

    // 1. Delete single coupon
    assert.equal(deleteCoupon(dToday, 'T1'), true);
    assert.equal(deleteCoupon(dToday, 'NON_EXISTENT'), false);
    assert.equal(getCouponsForDate('2026-11-21').length, 1);

    // 2. Delete expired coupons (strictly before 2026-11-21)
    assert.equal(deleteExpiredCoupons('2026-11-21'), 2);
    assert.equal(getCouponsForDate('2026-11-18').length, 0);
    assert.equal(getCouponsForDate('2026-11-20').length, 0);
    assert.equal(getCouponsForDate('2026-11-21').length, 1); // today preserved

    // 3. Delete selected date
    assert.equal(deleteCouponsForDate('2026-11-22'), 2);
    assert.equal(getCouponsForDate('2026-11-22').length, 0);
    assert.equal(loadCoupons().length, 1);

    // 4. Wipe all
    assert.equal(wipeAllCoupons(), 1);
    assert.equal(loadCoupons().length, 0);
    assert.equal(getRawStorage(), '');
  });
});

describe('Time-of-Day Relevant Meal Selection', () => {
  const atTime = (hour: number, minute: number) =>
    new Date(2026, 10, 21, hour, minute, 0);

  it('identifies active meal windows accurately (Breakfast, Lunch, Snacks, Dinner)', () => {
    // Breakfast: 7:00 - 10:00
    assert.deepEqual(getRelevantMealForTime(atTime(7, 0)), {
      meal: 'B',
      status: 'active',
      windowLabel: '7:00 - 10:00 AM',
    });
    assert.equal(getRelevantMealForTime(atTime(10, 0)).meal, 'B');
    assert.equal(getRelevantMealForTime(atTime(10, 0)).status, 'active');

    // Lunch: 12:00 - 14:30
    assert.deepEqual(getRelevantMealForTime(atTime(12, 0)), {
      meal: 'L',
      status: 'active',
      windowLabel: '12:00 - 2:30 PM',
    });
    assert.equal(getRelevantMealForTime(atTime(14, 30)).meal, 'L');
    assert.equal(getRelevantMealForTime(atTime(14, 30)).status, 'active');

    // Snacks: 16:30 - 17:30
    assert.deepEqual(getRelevantMealForTime(atTime(16, 30)), {
      meal: 'S',
      status: 'active',
      windowLabel: '4:30 - 5:30 PM',
    });
    assert.equal(getRelevantMealForTime(atTime(17, 30)).meal, 'S');
    assert.equal(getRelevantMealForTime(atTime(17, 30)).status, 'active');

    // Dinner: 19:00 - 21:30
    assert.deepEqual(getRelevantMealForTime(atTime(19, 0)), {
      meal: 'D',
      status: 'active',
      windowLabel: '7:00 - 9:30 PM',
    });
    assert.equal(getRelevantMealForTime(atTime(21, 30)).meal, 'D');
    assert.equal(getRelevantMealForTime(atTime(21, 30)).status, 'active');
  });

  it('selects next upcoming meal between windows and none after Dinner ends', () => {
    assert.equal(getRelevantMealForTime(atTime(6, 30)).meal, 'B');
    assert.equal(getRelevantMealForTime(atTime(6, 30)).status, 'upcoming');

    assert.equal(getRelevantMealForTime(atTime(11, 15)).meal, 'L');
    assert.equal(getRelevantMealForTime(atTime(11, 15)).status, 'upcoming');

    assert.equal(getRelevantMealForTime(atTime(15, 0)).meal, 'S');
    assert.equal(getRelevantMealForTime(atTime(15, 0)).status, 'upcoming');

    assert.equal(getRelevantMealForTime(atTime(18, 15)).meal, 'D');
    assert.equal(getRelevantMealForTime(atTime(18, 15)).status, 'upcoming');

    assert.deepEqual(getRelevantMealForTime(atTime(21, 31)), {
      meal: null,
      status: 'none',
      windowLabel: '',
    });
  });
});
