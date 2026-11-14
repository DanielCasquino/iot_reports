import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
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
  private saved: string;

  constructor(private readonly storagePath?: string) {
    if (storagePath) {
      try {
        const state = JSON.parse(readFileSync(storagePath, "utf8"));
        if (state && !Array.isArray(state) &&
            (state.target === null || (Number.isInteger(state.target) && state.target >= 30 && state.target <= 75)) &&
            Number.isInteger(state.attempts) && state.attempts >= 0 && state.attempts <= 3 &&
            Number.isSafeInteger(state.requestedAt) && state.requestedAt >= 0 &&
            typeof state.completed === "boolean" && typeof state.failed === "boolean" &&
            !(state.completed && state.failed) &&
            (state.target !== null || (state.attempts === 0 && !state.completed && !state.failed))) {
          this.target = state.target;
          this.attempts = state.attempts;
          this.requestedAt = state.requestedAt;
          this.completed = state.completed;
          this.failed = state.failed;
        }
      } catch {}
    }
    this.saved = this.serialize();
  }

  private serialize() {
    return JSON.stringify({ target: this.target, attempts: this.attempts, requestedAt: this.requestedAt,
      completed: this.completed, failed: this.failed || (!this.completed && this.attempts >= 3 && this.pending === null) });
  }

  private save() {
    if (!this.storagePath) return;
    const serialized = this.serialize();
    if (serialized === this.saved) return;
    mkdirSync(dirname(this.storagePath), { recursive: true, mode: 0o700 });
    const temporary = `${this.storagePath}.${process.pid}.tmp`;
    try {
      writeFileSync(temporary, serialized + "\n", { encoding: "utf8", mode: 0o600 });
      renameSync(temporary, this.storagePath);
      this.saved = serialized;
    } finally {
      rmSync(temporary, { force: true });
    }
  }

  request(target: number, commandId?: number, now = Date.now()) {
    this.target = target;
    this.attempts = commandId === undefined ? 0 : 1;
    this.pending = commandId ?? null;
    this.startedAt = now;
    this.completed = false;
    this.failed = false;
    this.requestedAt = now;
    this.save();
  }

  snapshot() {
    return { target: this.target, attempts: this.attempts,
      status: this.failed ? "failed" : this.completed ? "confirmed" : this.attempts >= 3 && this.pending === null ? "failed" :
        this.pending === null ? "waiting" : "verifying" };
  }

  poll(control: TemperatureControl | null, online: boolean, readable: boolean, now = Date.now()) {
    try {
      return this.reconcile(control, online, readable, now);
    } finally {
      this.save();
    }
  }

  private reconcile(control: TemperatureControl | null, online: boolean, readable: boolean, now: number) {
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
