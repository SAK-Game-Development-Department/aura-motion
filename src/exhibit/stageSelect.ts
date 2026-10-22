// Hands-free stage selection: hold the hand (palm) over one of the cards.
// Deterministic (time is injected); the UI only draws what this reports.
import { HAND } from '../config';

export interface SelectState {
  /** Card under the hand (index) or null. */
  hover: number | null;
  /** 0..1 hold progress of the hovered card. */
  progress: number;
  /** Set once, when a card has been held long enough. */
  chosen: number | null;
}

export class StageSelector {
  private hover: number | null = null;
  private since = 0;
  private chosen: number | null = null;

  constructor(
    private openedAt: number,
    private holdMs: number = HAND.selectHoldMs,
    private graceMs: number = HAND.selectGraceMs,
    private cardsX: readonly number[] = HAND.selectCardsX,
    private halfW: number = HAND.selectCardHalfW,
  ) {}

  /** Card index for a palm x (view coords), or null between cards. */
  cardAt(x: number): number | null {
    for (let i = 0; i < this.cardsX.length; i++) if (Math.abs(x - this.cardsX[i]!) <= this.halfW) return i;
    return null;
  }

  /** Choose directly (keys 1–3, mouse click). */
  choose(i: number): void {
    if (this.chosen === null && i >= 0 && i < this.cardsX.length) this.chosen = i;
  }

  update(now: number, palmX: number | null): SelectState {
    if (this.chosen !== null) return { hover: this.chosen, progress: 1, chosen: this.chosen };
    const card = palmX === null ? null : this.cardAt(palmX);
    // Grace: the hand that just started the game is somewhere — let the player move first.
    const start = Math.max(now, this.openedAt + this.graceMs);
    if (card !== this.hover) {
      this.hover = card;
      this.since = start;
    } else if (now < this.openedAt + this.graceMs) this.since = start;
    const progress = card === null ? 0 : Math.max(0, Math.min(1, (now - this.since) / this.holdMs));
    if (card !== null && progress >= 1) this.chosen = card;
    return { hover: card, progress, chosen: this.chosen };
  }
}
