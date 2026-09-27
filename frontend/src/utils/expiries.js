// Option-expiry selection shared by the Options and Calls Matrix pages.
// Expirations are UTC-midnight epoch ms.

const SHORT_DATED_MS = 60 * 86400 * 1000;

// Unexpired standard expirations, through the furthest-dated LEAPS listed.
// Near-term, only Fridays are kept — that hides the Mon/Wed weeklies and
// dailies. Beyond ~2 months every listing is a monthly, quarterly or LEAPS
// expiry, so a non-Friday date there is a holiday shift (e.g. Thursday when
// the Friday is an exchange holiday) and is kept.
export function standardExpiries(dates, now = Date.now()) {
  return dates
    .filter(d => d > now && (new Date(d).getUTCDay() === 5 || d - now > SHORT_DATED_MS))
    .sort((a, b) => a - b);
}

// [[year, [ms, …]], …] in ascending year order.
export function groupByYear(dates) {
  const groups = {};
  for (const d of dates) {
    const yr = new Date(d).getUTCFullYear();
    (groups[yr] ||= []).push(d);
  }
  return Object.entries(groups).sort(([a], [b]) => Number(a) - Number(b));
}
