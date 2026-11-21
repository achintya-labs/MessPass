import {
  createBackupFileContent,
  createTransferChunks,
  deleteCouponsForDate,
  deleteExpiredCoupons,
  getCouponsForDate,
  getStorageStats,
  getTodayLocalISO,
  mergeCoupons,
  parseBackupFileContent,
  wipeAllCoupons,
} from '../../lib/storage';
import {
  parseCouponsFromPDF,
  type PdfPageFailure,
} from '../../lib/pdf-parser';
import {
  escapeHtml,
  formatBytes,
  formatReadableDate,
  renderQrSvg,
} from '../utils';
import { openConfirm } from '../ui/confirm-modal';
import { showToast } from '../ui/toast';

export interface ManageViewCallbacks {
  getSelectedDateISO: () => string;
  onViewImportedDate: (dateISO: string) => void;
}

const statTotalEl = document.getElementById('stat-total') as HTMLSpanElement;
const statDatesEl = document.getElementById('stat-dates') as HTMLSpanElement;
const statExpiredEl = document.getElementById('stat-expired') as HTMLSpanElement;
const statBytesEl = document.getElementById('stat-bytes') as HTMLSpanElement;

const pdfDropzone = document.getElementById('pdf-dropzone') as HTMLLabelElement;
const pdfFileInput = document.getElementById('pdf-file-input') as HTMLInputElement;
const pdfProgressWrap = document.getElementById('pdf-progress-wrap') as HTMLDivElement;
const pdfProgressLabel = document.getElementById('pdf-progress-label') as HTMLSpanElement;
const pdfProgressPct = document.getElementById('pdf-progress-pct') as HTMLSpanElement;
const pdfProgressBar = document.getElementById('pdf-progress-bar') as HTMLDivElement;
const pdfResultEl = document.getElementById('pdf-result') as HTMLDivElement;

const btnShowTransferQr = document.getElementById('btn-show-transfer-qr') as HTMLButtonElement;
const btnExportTxt = document.getElementById('btn-export-txt') as HTMLButtonElement;
const txtRestoreInput = document.getElementById('txt-restore-input') as HTMLInputElement;

const btnDeleteSelectedDate = document.getElementById('btn-delete-selected-date') as HTMLButtonElement;
const btnDeleteExpired = document.getElementById('btn-delete-expired') as HTMLButtonElement;
const btnWipeAll = document.getElementById('btn-wipe-all') as HTMLButtonElement;

const transferModal = document.getElementById('transfer-modal') as HTMLDivElement;
const transferModalMeta = document.getElementById('transfer-modal-meta') as HTMLParagraphElement;
const transferQrSvgHost = document.getElementById('transfer-qr-svg') as HTMLDivElement;
const transferChunkLabel = document.getElementById('transfer-chunk-label') as HTMLSpanElement;
const btnTransferPrev = document.getElementById('btn-transfer-prev') as HTMLButtonElement;
const btnTransferNext = document.getElementById('btn-transfer-next') as HTMLButtonElement;
const btnCloseTransfer = document.getElementById('btn-close-transfer') as HTMLButtonElement;

let transferChunks: string[] = [];
let transferChunkIndex = 0;
let callbacks: ManageViewCallbacks | null = null;

export function isTransferModalOpen(): boolean {
  return !transferModal.hidden;
}

export function closeTransferModal(): void {
  transferModal.hidden = true;
}

export function stepTransferChunk(delta: number): void {
  const next = transferChunkIndex + delta;
  if (next < 0 || next >= transferChunks.length) return;
  transferChunkIndex = next;
  void renderCurrentTransferChunk();
}

export function refreshStats(): void {
  const selectedDateISO = callbacks?.getSelectedDateISO() ?? getTodayLocalISO();
  const stats = getStorageStats();
  statTotalEl.textContent = String(stats.count);
  statDatesEl.textContent = String(stats.datesCount);
  statExpiredEl.textContent = String(stats.expiredCount);
  statBytesEl.textContent = formatBytes(stats.bytes);

  const dayCoupons = getCouponsForDate(selectedDateISO);
  const dayLabel = formatReadableDate(selectedDateISO);
  btnDeleteSelectedDate.textContent = `Delete ${dayLabel} (${dayCoupons.length})`;
  btnDeleteSelectedDate.disabled = dayCoupons.length === 0;

  btnDeleteExpired.textContent = `Delete Expired (${stats.expiredCount})`;
  btnDeleteExpired.disabled = stats.expiredCount === 0;

  btnWipeAll.disabled = stats.count === 0;
  btnShowTransferQr.disabled = stats.count === 0;
  btnExportTxt.disabled = stats.count === 0;
}

async function renderCurrentTransferChunk(): Promise<void> {
  const chunk = transferChunks[transferChunkIndex];
  if (!chunk) return;

  transferChunkLabel.textContent = `${transferChunkIndex + 1} / ${transferChunks.length}`;
  btnTransferPrev.disabled = transferChunkIndex === 0;
  btnTransferNext.disabled = transferChunkIndex >= transferChunks.length - 1;

  transferQrSvgHost.innerHTML = await renderQrSvg(chunk);
}

async function importPdfFiles(fileList: File[]): Promise<void> {
  if (fileList.length === 0) return;

  pdfFileInput.value = '';
  pdfFileInput.disabled = true;

  pdfProgressWrap.hidden = false;
  pdfResultEl.hidden = true;
  pdfProgressBar.style.width = '0%';
  pdfProgressPct.textContent = '0%';
  pdfProgressLabel.textContent = `Preparing ${fileList.length} PDF file(s)...`;

  let totalPagesAll = 0;
  let totalAdded = 0;
  let totalUpdated = 0;
  let totalDuplicates = 0;
  let firstImportedDateISO: string | null = null;
  const allFailures: Array<{ file: string; failure: PdfPageFailure }> = [];

  try {
    for (let fIdx = 0; fIdx < fileList.length; fIdx++) {
      const file = fileList[fIdx];
      pdfProgressLabel.textContent = `Loading ${file.name}...`;

      const result = await parseCouponsFromPDF(file, (prog) => {
        const pct =
          prog.totalPages > 0
            ? Math.round((prog.currentPage / prog.totalPages) * 100)
            : 100;
        pdfProgressBar.style.width = `${pct}%`;
        pdfProgressPct.textContent = `${pct}%`;
        const prefix =
          fileList.length > 1 ? `[${fIdx + 1}/${fileList.length}] ` : '';
        pdfProgressLabel.textContent = `${prefix}Page ${prog.currentPage} / ${prog.totalPages} (${prog.decodedCount} decoded, ${prog.failedCount} failed)`;
      });

      totalPagesAll += result.totalPages;
      if (result.coupons.length > 0) {
        if (!firstImportedDateISO) {
          firstImportedDateISO = result.coupons[0].dateISO;
        }
        const merged = mergeCoupons(result.coupons);
        totalAdded += merged.added;
        totalUpdated += merged.updated;
        totalDuplicates += merged.duplicates;
      }

      for (const failure of result.failures) {
        allFailures.push({ file: file.name, failure });
      }
    }

    refreshStats();

    const failureHtml =
      allFailures.length > 0
        ? `
          <details class="failure-details">
            <summary>${allFailures.length} page(s) failed to decode or parse</summary>
            <ul class="failure-list">
              ${allFailures
                .map(
                  ({ file, failure }) =>
                    `<li><strong>${
                      fileList.length > 1 ? `${escapeHtml(file)} · ` : ''
                    }Page ${failure.page}:</strong> ${escapeHtml(
                      failure.reason
                    )}${
                      failure.rawQr
                        ? ` <code>${escapeHtml(failure.rawQr.slice(0, 60))}</code>`
                        : ''
                    }</li>`
                )
                .join('')}
            </ul>
          </details>
        `
        : '';

    const jumpHtml = firstImportedDateISO
      ? `<button type="button" class="btn btn-sm btn-primary" id="btn-view-imported" data-date="${firstImportedDateISO}">View Imported Passes</button>`
      : '';

    pdfResultEl.innerHTML = `
      <div class="result-summary">
        <div class="result-stats">
          <span><strong>${totalPagesAll}</strong> pages</span>
          <span class="text-success"><strong>+${totalAdded}</strong> added</span>
          <span><strong>${totalUpdated}</strong> updated</span>
          <span><strong>${totalDuplicates}</strong> duplicates</span>
          ${
            allFailures.length > 0
              ? `<span class="text-danger"><strong>${allFailures.length}</strong> failed</span>`
              : ''
          }
        </div>
        ${jumpHtml}
      </div>
      ${failureHtml}
    `;
    pdfResultEl.hidden = false;

    const jumpBtn = document.getElementById('btn-view-imported');
    jumpBtn?.addEventListener('click', () => {
      const targetDate = jumpBtn.getAttribute('data-date');
      if (targetDate) {
        callbacks?.onViewImportedDate(targetDate);
      }
    });

    showToast(
      `PDF imported: ${totalAdded} added, ${totalUpdated} updated`,
      allFailures.length > 0 && totalAdded === 0 ? 'error' : 'success'
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Failed to parse PDF';
    pdfResultEl.innerHTML = `<div class="text-danger">Error: ${escapeHtml(message)}</div>`;
    pdfResultEl.hidden = false;
    showToast('PDF import failed', 'error');
  } finally {
    pdfFileInput.disabled = false;
  }
}

export function initManageView(opts: ManageViewCallbacks): void {
  callbacks = opts;

  pdfFileInput.addEventListener('change', () => {
    const files = pdfFileInput.files;
    if (!files || files.length === 0) return;
    void importPdfFiles(Array.from(files));
  });

  pdfDropzone.addEventListener('dragover', (e) => {
    e.preventDefault();
    pdfDropzone.classList.add('is-dragover');
  });

  pdfDropzone.addEventListener('dragleave', () => {
    pdfDropzone.classList.remove('is-dragover');
  });

  pdfDropzone.addEventListener('drop', (e) => {
    e.preventDefault();
    pdfDropzone.classList.remove('is-dragover');
    if (pdfFileInput.disabled) return;
    const dropped = Array.from(e.dataTransfer?.files ?? []).filter(
      (f) => f.type === 'application/pdf' || f.name.toLowerCase().endsWith('.pdf')
    );
    if (dropped.length === 0) {
      showToast('Please drop a .pdf file', 'error');
      return;
    }
    void importPdfFiles(dropped);
  });

  btnShowTransferQr.addEventListener('click', async () => {
    const chunks = createTransferChunks(280);
    if (chunks.length === 0) {
      showToast('No coupons to transfer', 'info');
      return;
    }

    const stats = getStorageStats();
    transferChunks = chunks;
    transferChunkIndex = 0;
    transferModalMeta.textContent = `${stats.count} passes · ${chunks.length} QR ${chunks.length === 1 ? 'chunk' : 'chunks'}`;
    transferModal.hidden = false;
    await renderCurrentTransferChunk();
  });

  btnTransferPrev.addEventListener('click', () => stepTransferChunk(-1));
  btnTransferNext.addEventListener('click', () => stepTransferChunk(1));
  btnCloseTransfer.addEventListener('click', closeTransferModal);
  transferModal.addEventListener('click', (e) => {
    if (e.target === transferModal) {
      closeTransferModal();
    }
  });

  btnExportTxt.addEventListener('click', () => {
    const content = createBackupFileContent();
    if (!content) {
      showToast('No coupons to back up', 'info');
      return;
    }
    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `mess-pass-backup-${getTodayLocalISO()}.txt`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
    showToast('Backup file downloaded', 'success');
  });

  txtRestoreInput.addEventListener('change', async () => {
    const file = txtRestoreInput.files?.[0];
    if (!file) return;
    txtRestoreInput.value = '';

    try {
      const text = await file.text();
      const coupons = parseBackupFileContent(text);
      if (!coupons || coupons.length === 0) {
        showToast('Backup file was empty or invalid', 'error');
        return;
      }
      const stats = mergeCoupons(coupons);
      refreshStats();
      showToast(
        `Restored: ${stats.added} added, ${stats.updated} updated, ${stats.duplicates} duplicates`,
        'success'
      );
    } catch {
      showToast('Failed to read backup file', 'error');
    }
  });

  btnDeleteSelectedDate.addEventListener('click', () => {
    const selectedDateISO = callbacks?.getSelectedDateISO() ?? getTodayLocalISO();
    const count = getCouponsForDate(selectedDateISO).length;
    if (count === 0) return;
    const label = formatReadableDate(selectedDateISO);
    openConfirm(
      'Delete Date Passes?',
      `Delete all ${count} pass(es) for ${label}?`,
      'Delete',
      () => {
        const removed = deleteCouponsForDate(selectedDateISO);
        showToast(`Deleted ${removed} pass(es)`, 'info');
        refreshStats();
      }
    );
  });

  btnDeleteExpired.addEventListener('click', () => {
    const stats = getStorageStats();
    if (stats.expiredCount === 0) return;
    openConfirm(
      'Delete Expired Passes?',
      `Remove ${stats.expiredCount} pass(es) dated before today (${getTodayLocalISO()})?`,
      'Delete',
      () => {
        const removed = deleteExpiredCoupons();
        showToast(`Removed ${removed} expired pass(es)`, 'info');
        refreshStats();
      }
    );
  });

  btnWipeAll.addEventListener('click', () => {
    const stats = getStorageStats();
    if (stats.count === 0) return;
    openConfirm(
      'Wipe All Coupons?',
      `Permanently delete all ${stats.count} pass(es) stored on this device?`,
      'Wipe All',
      () => {
        const removed = wipeAllCoupons();
        showToast(`Wiped ${removed} pass(es)`, 'info');
        refreshStats();
      }
    );
  });
}
