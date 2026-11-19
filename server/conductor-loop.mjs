export const LOOP_INTERVALS = Object.freeze({ collect: 5000, changed: 30000, maxBackoff: 900000 });

// Scheduling and collection contain no provider/model calls. Only decide() does.
export class ConductorLoop {
  constructor(state, { collect, decide, busy = () => false, save = () => {}, now = Date.now,
    setTimer = setTimeout, clearTimer = clearTimeout, intervals = {} }) {
    this.state = state; this.collect = collect; this.decide = decide; this.busy = busy;
    this.save = save; this.now = now; this.setTimer = setTimer; this.clearTimer = clearTimer;
    this.intervals = { ...LOOP_INTERVALS, ...intervals };
    this.timer = null; this.enabled = false; this.ticking = false; this.generation = 0;
  }
  start() { this.enabled = true; this.schedule(0); }
  wake() { this.clearTimer(this.timer); this.timer = null; this.schedule(0); }
  stop() { this.enabled = false; this.generation++; this.clearTimer(this.timer); this.timer = null; }
  control(value) {
    if (!['running', 'paused', 'stopped'].includes(value)) throw new Error('Choose running, paused, or stopped.');
    this.generation++; this.state.state = value; this.state.nextRoundAt = null;
    this.clearTimer(this.timer); this.timer = null; this.save();
    if (this.enabled && value === 'running') this.schedule(0);
    return this.state;
  }
  schedule(delay) {
    if (!this.enabled || this.state.state !== 'running' || this.timer !== null) return;
    this.timer = this.setTimer(() => { this.timer = null; void this.tick(); }, delay);
    this.timer?.unref?.();
  }
  async tick() {
    if (this.ticking || !this.enabled || this.state.state !== 'running') return;
    this.ticking = true;
    const generation = this.generation;
    try {
      const data = await this.collect();
      if (generation !== this.generation || !this.enabled || this.state.state !== 'running') return;
      this.state.lastCollectedAt = new Date(this.now()).toISOString();
      this.state.coverage = data.coverage || null;
      this.state.observedProgress = data.observations?.length || 0;
      this.state.pendingProgress = data.pendingObservationIds?.length || 0;
      this.state.pendingProjects = data.projectRounds?.length || 0;
      // Seed a completed/empty baseline without a paid historical-completion pulse.
      if (!data.eligible || (!data.hasWork && !this.state.lastSignature && !data.pendingReview)) {
        this.state.lastSignature = data.signature;
        this.state.nextRoundAt = null; this.save(); return;
      }
      const changed = data.signature !== this.state.lastSignature;
      const last = Date.parse(this.state.lastRoundAt || '') || 0;
      const retry = Date.parse(this.state.retryAt || '') || 0;
      // Completed scopes keep listening, but unchanged idle scopes never call a model.
      if (!changed && !data.pendingReview) { this.state.nextRoundAt = null; this.save(); return; }
      const cadence = this.intervals.changed;
      const due = Math.max(last ? last + cadence : 0, retry);
      this.state.nextRoundAt = new Date(Math.max(this.now(), due)).toISOString();
      if (this.busy() || this.now() < due) { this.save(); return; }
      this.state.lastRoundAt = new Date(this.now()).toISOString();
      this.state.rounds = (this.state.rounds || 0) + 1; this.save();
      const result = await this.decide(data);
      if (generation !== this.generation || !this.enabled || this.state.state !== 'running') return;
      if (result?.status === 'error') throw new Error(result.answer || 'Conductor round failed.');
      this.state.lastSignature = result?.observedSignature || data.signature;
      this.state.failures = 0; this.state.lastError = null; this.state.retryAt = null;
      this.state.nextRoundAt = null; // Listen for a new observation; unchanged work needs no paid pulse.
      this.save();
    } catch (error) {
      if (generation !== this.generation || !this.enabled || this.state.state !== 'running') return;
      this.state.failures = (this.state.failures || 0) + 1;
      this.state.lastError = String(error.message || error).slice(0, 1000);
      const backoff = Math.min(this.intervals.maxBackoff, this.intervals.changed * 2 ** Math.min(this.state.failures - 1, 10));
      this.state.retryAt = new Date(this.now() + backoff).toISOString();
      this.state.nextRoundAt = this.state.retryAt; this.save();
    } finally {
      this.ticking = false;
      this.schedule(this.intervals.collect);
    }
  }
}
