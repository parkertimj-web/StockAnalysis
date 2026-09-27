import { format } from 'date-fns';

// Dollar amount with the sign before the "$" and thousands separators:
// -2.14 → "-$2.14" (not "$-2.14"), 1085.02 → "$1,085.02".
export function fmtMoney(n, d = 2) {
  if (n == null || isNaN(n)) return '—';
  const abs = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: d, maximumFractionDigits: d });
  return `${n < 0 ? '-' : ''}$${abs}`;
}

// Always-signed number: 0.48 → "+0.48", -0.07 → "-0.07".
export function fmtSigned(n, d = 2) {
  if (n == null || isNaN(n)) return '—';
  return `${n >= 0 ? '+' : ''}${n.toFixed(d)}`;
}

// Always-signed percent: 0.13 → "+0.13%".
export function fmtSignedPct(n, d = 2) {
  return n == null || isNaN(n) ? '—' : `${fmtSigned(n, d)}%`;
}

// Daily bars are timestamped at UTC midnight of the trading day (unix seconds).
// Formatting in local time shows US users the previous day, so pin to UTC.
export function fmtBarDate(unixSec, opts = { month: 'short', day: 'numeric', year: 'numeric' }) {
  if (!unixSec) return null;
  return new Date(unixSec * 1000).toLocaleDateString('en-US', { ...opts, timeZone: 'UTC' });
}

// Option expirations are stored as UTC midnight of the expiry date. Formatting
// them in local time shifts US users back a day (Friday → Thursday), so build
// the local date from the UTC calendar fields before formatting.
export function fmtExpiry(ms, pattern = 'MMM d') {
  const d = new Date(ms);
  return format(new Date(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()), pattern);
}
