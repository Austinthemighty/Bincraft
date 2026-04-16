// QR Code Scanner using html5-qrcode
// Loaded from CDN in scan/index.ejs

let scanner = null;

function initScanner() {
  const scannerEl = document.getElementById('scanner-region');
  const resultEl = document.getElementById('scan-result');
  if (!scannerEl) return;

  scanner = new Html5Qrcode('scanner-region');

  const config = {
    fps: 10,
    qrbox: { width: 250, height: 250 },
    aspectRatio: 1.0,
  };

  scanner.start(
    { facingMode: 'environment' },
    config,
    onScanSuccess,
    onScanFailure
  ).catch((err) => {
    console.error('Scanner start error:', err);
    scannerEl.innerHTML = `
      <p class="text-danger">Camera access denied or unavailable.</p>
      <p>You can manually enter the card UID below.</p>
    `;
  });
}

async function onScanSuccess(decodedText) {
  // Pause scanner while processing
  if (scanner) {
    await scanner.pause(true);
  }

  // Extract card_uid from URL or use raw text
  let cardUid = decodedText;
  const match = decodedText.match(/\/scan\/card\/([a-f0-9-]+)/i);
  if (match) {
    cardUid = match[1];
  }

  await processScan(cardUid);
}

function onScanFailure(error) {
  // Ignore - this fires constantly when no QR is in view
}

async function processScan(cardUid) {
  const resultEl = document.getElementById('scan-result');
  // Reset classes so the entrance animation replays on each scan
  resultEl.classList.remove('scan-success-flourish');
  resultEl.style.display = 'block';
  resultEl.innerHTML = '<p aria-busy="true">Processing scan...</p>';

  try {
    const res = await fetch('/api/scan', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ card_uid: cardUid }),
    });
    const data = await res.json();

    if (res.ok) {
      // Trigger the success flourish on the panel (CSS handles reduced-motion fallback)
      // Use requestAnimationFrame to ensure the class toggle re-triggers the animation
      requestAnimationFrame(() => resultEl.classList.add('scan-success-flourish'));
      const item = data.item;
      const uom = item.unit_of_measure || 'units';
      const stockText = item.current_stock != null
        ? `Current stock: <strong>${item.current_stock}</strong> ${uom}`
        : '';

      resultEl.innerHTML = `
        <div class="scan-success">
          <h3>${data.action_label}</h3>
          <p><strong>${item.part_number}</strong> &middot; ${item.name}</p>
          <p>Status: <span class="badge badge-${data.card.status}">${data.card.status.replace(/_/g, ' ')}</span></p>
          ${data.message ? `<p>${data.message}</p>` : ''}
          ${item.current_stock != null ? `
            <div class="consume-panel" style="margin-top:1rem;padding-top:1rem;border-top:1px solid var(--border-subtle);text-align:left;">
              <p style="margin-bottom:0.5rem;">${stockText}</p>
              <div id="consume-form-${item.id}" style="display:flex;gap:0.5rem;align-items:flex-end;">
                <div class="form-group" style="flex:1;margin:0;">
                  <label for="consume-qty-${item.id}" style="font-size:var(--text-xs);">Remove from stock</label>
                  <input type="number" id="consume-qty-${item.id}" min="1" value="1" step="1" style="width:100%;">
                </div>
                <button type="button" class="btn btn-secondary" onclick="consumeStock(${item.id})">Remove</button>
              </div>
              <div id="consume-result-${item.id}" style="margin-top:0.5rem;font-size:var(--text-sm);"></div>
            </div>
          ` : ''}
          <div style="margin-top:1rem;">
            <button type="button" class="btn btn-primary" onclick="resumeScanner()">Scan Next</button>
          </div>
        </div>
      `;
    } else {
      resultEl.innerHTML = `
        <div class="scan-error">
          <h3>Scan Failed</h3>
          <p>${data.error || 'Unknown error'}</p>
          <button onclick="resumeScanner()" class="mt-1">Try Again</button>
        </div>
      `;
    }
  } catch (err) {
    resultEl.innerHTML = `
      <div class="scan-error">
        <h3>Network Error</h3>
        <p>Could not process scan. Check your connection.</p>
        <button onclick="resumeScanner()" class="mt-1">Try Again</button>
      </div>
    `;
  }
}

function resumeScanner() {
  const resultEl = document.getElementById('scan-result');
  resultEl.style.display = 'none';
  if (scanner) {
    scanner.resume();
  }
}

// Consume stock from the scan result
async function consumeStock(itemId) {
  const qtyInput = document.getElementById('consume-qty-' + itemId);
  const resultEl = document.getElementById('consume-result-' + itemId);
  if (!qtyInput || !resultEl) return;

  const qty = parseInt(qtyInput.value, 10);
  if (!qty || qty <= 0) {
    resultEl.innerHTML = '<span style="color:var(--color-danger);">Enter a positive quantity.</span>';
    return;
  }

  resultEl.textContent = 'Updating...';

  try {
    const res = await fetch('/api/consume', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ item_id: itemId, quantity: qty }),
    });
    const data = await res.json();

    if (res.ok) {
      const alert = data.item.below_reorder
        ? ' <span style="color:var(--color-warning);font-weight:600;">&#9888; Below reorder point</span>'
        : '';
      resultEl.innerHTML = `Removed ${data.quantity_removed}. New stock: <strong>${data.item.current_stock}</strong>${alert}`;
      qtyInput.value = '1';
    } else {
      resultEl.innerHTML = `<span style="color:var(--color-danger);">${data.error || 'Failed to update stock.'}</span>`;
    }
  } catch (err) {
    resultEl.innerHTML = '<span style="color:var(--color-danger);">Network error.</span>';
  }
}

// Manual UID entry — accepts either a raw UID, an item ID, or a full scan URL
function submitManualUid() {
  const input = document.getElementById('manual-uid');
  if (!input) return;
  let value = input.value.trim();
  if (!value) return;

  // Extract UID from a full URL if pasted
  const urlMatch = value.match(/\/scan\/card\/([a-f0-9-]+)/i);
  if (urlMatch) value = urlMatch[1];

  processScan(value);
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', () => {
  initScanner();

  // Support Enter key in the manual entry field
  const input = document.getElementById('manual-uid');
  if (input) {
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        submitManualUid();
      }
    });
  }
});
