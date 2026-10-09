/**
 * All internal math is done in inches (board feet, nominal lumber and most
 * woodworking conventions are imperial). Specs may be given in mm; they are
 * converted on the way in and formatted back on the way out.
 */
export type Unit = 'in' | 'mm';

export const MM_PER_INCH = 25.4;

export function toInches(value: number, unit: Unit): number {
  return unit === 'mm' ? value / MM_PER_INCH : value;
}

export function fromInches(inches: number, unit: Unit): number {
  return unit === 'mm' ? inches * MM_PER_INCH : inches;
}

/** Round down to the nearest 1/16″ (used when a dimension must not exceed a limit). */
export function floorToSixteenth(inches: number): number {
  return Math.floor(inches * 16 + 1e-9) / 16;
}

export function roundToSixteenth(inches: number): number {
  return Math.round(inches * 16) / 16;
}

function gcd(a: number, b: number): number {
  return b === 0 ? a : gcd(b, a % b);
}

/** 29.25 → "29-1/4″", 0.375 → "3/8″", 12 → "12″" (nearest 1/16″). */
export function formatInches(inches: number): string {
  const sixteenths = Math.round(Math.abs(inches) * 16);
  const sign = inches < 0 && sixteenths > 0 ? '-' : '';
  const whole = Math.floor(sixteenths / 16);
  const rem = sixteenths % 16;
  if (rem === 0) return `${sign}${whole}″`;
  const g = gcd(rem, 16);
  const frac = `${rem / g}/${16 / g}`;
  return whole === 0 ? `${sign}${frac}″` : `${sign}${whole}-${frac}″`;
}

export function formatLength(inches: number, unit: Unit): string {
  if (unit === 'mm') return `${Math.round(inches * MM_PER_INCH)} mm`;
  return formatInches(inches);
}

/** Lumber lengths read best in feet: 96 → "8′", 78 → "6′6″". */
export function formatBoardLength(inches: number, unit: Unit): string {
  if (unit === 'mm') return `${(inches * MM_PER_INCH / 1000).toFixed(2)} m`;
  const feet = Math.floor(inches / 12);
  const rest = inches - feet * 12;
  return rest < 1e-6 ? `${feet}′` : `${feet}′${formatInches(rest)}`;
}

/** Small measurements (sag, gaps) where 1/16″ is too coarse: 0.052″ or 1.3 mm. */
export function formatSmall(inches: number, unit: Unit): string {
  return unit === 'mm' ? `${(inches * MM_PER_INCH).toFixed(1)} mm` : `${inches.toFixed(3).replace(/^0/, '')}″`;
}

export function formatDims(t: number, w: number, l: number, unit: Unit): string {
  return `${formatLength(t, unit)} × ${formatLength(w, unit)} × ${formatLength(l, unit)}`;
}

/**
 * Parse a length as woodworkers write it: "1.75", "1-3/4", "1 3/4", "3/4",
 * optionally followed by ″, " or in. Returns null if it isn't a length.
 * The number is in whatever unit the caller is working in.
 */
export function parseLength(text: string | number): number | null {
  if (typeof text === 'number') return Number.isFinite(text) ? text : null;
  const t = text.trim().replace(/(″|"|in|mm)$/i, '').trim();
  if (!t) return null;
  // "1-3/4" / "1 3/4" (whole + fraction), "3/4" (fraction), "1.75" (decimal)
  const mixed = t.match(/^(\d+)(?:\s+|-)(\d+)\/(\d+)$/);
  const frac = t.match(/^(\d+)\/(\d+)$/);
  const dec = t.match(/^\d+(?:\.\d*)?$|^\.\d+$/);
  if (mixed) return Number(mixed[3]) ? Number(mixed[1]) + Number(mixed[2]) / Number(mixed[3]) : null;
  if (frac) return Number(frac[2]) ? Number(frac[1]) / Number(frac[2]) : null;
  return dec ? Number(t) : null;
}

/** Parse a list of lengths separated by commas or semicolons. Null if any entry isn't a length. */
export function parseLengthList(text: string | number[]): number[] | null {
  if (Array.isArray(text)) return text.every((n) => Number.isFinite(n)) ? text : null;
  const parts = text.split(/[,;]/).map((s) => s.trim()).filter(Boolean);
  const out = parts.map(parseLength);
  return out.some((n) => n === null) ? null : (out as number[]);
}
