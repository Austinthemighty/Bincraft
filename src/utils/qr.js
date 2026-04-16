import QRCode from 'qrcode';
import * as Settings from '../models/Settings.js';

export async function generateQRDataUrl(text) {
  return QRCode.toDataURL(text, { width: 300, margin: 2 });
}

export async function generateQRBuffer(text) {
  return QRCode.toBuffer(text, { width: 300, margin: 2 });
}

export async function getAppUrl() {
  return Settings.getAppUrl();
}

export function getCardScanUrl(baseUrl, cardUid) {
  return `${baseUrl}/scan/card/${cardUid}`;
}
