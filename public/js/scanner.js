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
      resultEl.innerHTML = `
        <div class="scan-success">
          <h3>${data.action_label}</h3>
          <p><strong>${data.item.part_number}</strong> - ${data.item.name}</p>
          <p>Status: <span class="badge badge-${data.card.status}">${data.card.status.replace(/_/g, ' ')}</span></p>
          ${data.message ? `<p>${data.message}</p>` : ''}
          <button onclick="resumeScanner()" class="mt-1">Scan Next</button>
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

// Manual UID entry
function submitManualUid() {
  const input = document.getElementById('manual-uid');
  if (input && input.value.trim()) {
    processScan(input.value.trim());
  }
}

// Initialize on page load
document.addEventListener('DOMContentLoaded', initScanner);
