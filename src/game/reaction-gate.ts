/** Counts qualifying pokes and decides when Droppie giggles.
 *
 * Pokes arrive as DOM pointer events, which can fire several times between two
 * fixed physics steps. Counting them here — at event time — instead of in the
 * deferred physics release path means rapid taps are never dropped.
 *
 * A poke only reaches {@link poke} when the caller has already verified it:
 * an actual hit on Droppie, a short tap, no meaningful drag or stretch, no UI
 * control, and no miss. This class only handles timing, counting, and the
 * anti-spam cooldown.
 */
export class ReactionGate {
  private count=0;
  private firstTime=-Infinity;
  private lastGiggle=-Infinity;
  readonly required:number;
  readonly windowMs:number;
  readonly cooldownMs:number;

  constructor(required=3,windowMs=1800,cooldownMs=2000) {
    this.required=required;this.windowMs=windowMs;this.cooldownMs=cooldownMs;
  }

  /** Record one qualifying poke. Returns true exactly when a giggle should play. */
  poke(now:number):boolean {
    if(!Number.isFinite(now))return false;
    if(now-this.lastGiggle<this.cooldownMs)return false;
    if(this.count===0||now-this.firstTime>this.windowMs) {
      this.count=1;this.firstTime=now;
      return false;
    }
    this.count++;
    if(this.count>=this.required) {
      this.count=0;this.firstTime=-Infinity;this.lastGiggle=now;
      return true;
    }
    return false;
  }

  /** Clear a pending partial sequence (e.g. on reset). Cooldown is preserved. */
  reset() {
    this.count=0;this.firstTime=-Infinity;
  }

  get pending():number {
    return this.count;
  }
}
