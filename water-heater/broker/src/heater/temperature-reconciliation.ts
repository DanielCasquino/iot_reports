import type { TemperatureControl } from "./temperature-control.js";

export class TemperatureReconciliation {
  private target: number | null = null;
  private attempts = 0;
  private pending: number | null = null;
  private startedAt = 0;
  private completed = false;
  private failed = false;
  private requestedAt = 0;
  private online = false;

  request(target: number, commandId?: number, now = Date.now()) {
    this.target = target;
    this.attempts = commandId === undefined ? 0 : 1;
    this.pending = commandId ?? null;
    this.startedAt = now;
    this.completed = false;
    this.failed = false;
    this.requestedAt = now;
  }

  snapshot() {
    return { target: this.target, attempts: this.attempts,
      status: this.failed ? "failed" : this.completed ? "confirmed" : this.attempts >= 3 && this.pending === null ? "failed" :
        this.pending === null ? "waiting" : "verifying" };
  }

  poll(control: TemperatureControl | null, online: boolean, readable: boolean, now = Date.now()) {
    if (!this.completed && this.target !== null && now - this.requestedAt >= 90000) {
      this.pending = null;
      this.failed = true;
    }
    if (this.failed) return null;
    if (!online) { this.online = false; this.pending = null; return null; }
    if (!this.online) { this.online = true; if (this.completed) { this.completed = false; this.attempts = 0; this.requestedAt = now; } }
    if (!control || this.target === null || this.completed) return null;
    if (this.pending !== null) {
      if (control.commandId === this.pending && control.status === "idle" && control.base === this.target) {
        this.pending = null;
        this.completed = true;
        return null;
      }
      if ((control.commandId === this.pending && control.status === "error") || now - this.startedAt >= 60000)
        this.pending = null;
      else return null;
    }
    if (this.attempts >= 3 || !readable || control.locked || control.status !== "idle") return null;
    this.attempts++;
    this.pending = ((now % 0xffffff00) + this.attempts) >>> 0;
    this.startedAt = now;
    return { id: this.pending, base: control.base, target: this.target };
  }
}
