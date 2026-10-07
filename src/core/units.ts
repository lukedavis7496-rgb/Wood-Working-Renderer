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

export function formatDims(t: number, w: number, l: number, unit: Unit): string {
  return `${formatLength(t, unit)} × ${formatLength(w, unit)} × ${formatLength(l, unit)}`;
}
