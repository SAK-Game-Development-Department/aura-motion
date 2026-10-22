// Hand presence / placement (desk-distance play in front of a webcam).
export const HAND = {
  /** Palm size = wrist → middle MCP, in view-height units. Placement guide range. */
  minSize: 0.07,
  maxSize: 0.34,
  /** Lose a hand slot after this long without a match (ms). */
  slotGraceMs: 300,
  /** Start: a hand in view & in range for this long (ms). */
  startHoldMs: 1500,
  /** Booth considered empty after no hand for this long (ms). */
  absentReturnMs: 10_000,
  /** Hold-to-select buttons: pointer = index fingertip. */
  buttonHoldMs: 1000,
  buttonRadius: 0.09,
} as const;
