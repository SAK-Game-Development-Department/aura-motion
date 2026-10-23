// Hand presence / placement (desk-distance play in front of a webcam).
export const HAND = {
  /** Palm size = wrist → middle MCP, in view-height units. Placement guide range. */
  minSize: 0.07,
  maxSize: 0.34,
  /** Lose a hand slot after this long without a match (ms). */
  slotGraceMs: 300,
  /** Start: a hand in view & in range for this long (ms). */
  startHoldMs: 1500,
  /** Stage selection: hold the hand over a card this long (ms); ignore the first moment after the screen opens. */
  selectHoldMs: 1200,
  selectGraceMs: 900,
  /** Card centres (view x) and half width. */
  selectCardsX: [0.2, 0.5, 0.8] as readonly number[],
  selectCardHalfW: 0.135,
  /** Name entry: hold the fingertip over a key this long to type it; the same key again after this pause. */
  keyDwellMs: 650,
  keyRepeatMs: 450,
  /** Name entry is skipped after this long without any input (ms). */
  nameIdleMs: 45_000,
  /** Countdown shown for the last part of the idle time (ms). */
  nameCountdownMs: 10_000,
  /** Fingertip area (view 0..1) stretched over the whole on-screen keyboard. */
  keyReach: { x0: 0.2, x1: 0.8, y0: 0.25, y1: 0.7 },
  /** Booth considered empty after no hand for this long (ms). */
  absentReturnMs: 10_000,
  /** Hold-to-select buttons: pointer = index fingertip. */
  buttonHoldMs: 1000,
  buttonRadius: 0.09,
} as const;
