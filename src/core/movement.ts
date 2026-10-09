import { getSpecies } from './species';

/**
 * Seasonal wood movement. Solid wood swells and shrinks across its width
 * (barely along its length) as indoor humidity changes. A heated and
 * air-conditioned home typically swings about 4% in moisture content between
 * summer and winter (e.g. 6% → 10%).
 */
export const SEASONAL_MC_SWING = 4;

/** Expected change in width (inches) of flatsawn stock this wide over a season. */
export function seasonalMovement(speciesId: string, width: number, mcSwing = SEASONAL_MC_SWING): number {
  return width * getSpecies(speciesId).movement.tangential * mcSwing;
}

/**
 * Slot length for a screw that sits `offset` from the fixed centre of a part
 * that must slide. The wood under it travels offset × coefficient × swing over
 * a year; doubling that lets the screw go in centred in the slot whatever the
 * season you build in. Plus the screw's own diameter.
 */
export function slotLength(speciesId: string, offset: number, screwDiameter: number, mcSwing = SEASONAL_MC_SWING): number {
  return 2 * seasonalMovement(speciesId, offset, mcSwing) + screwDiameter;
}
