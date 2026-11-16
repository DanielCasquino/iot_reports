type Evidence = { power: boolean | null; observedAt: number | null };

// No replay on restart/reconnect. A retry is an absolute request made only
// after new optical evidence proves the previous attempt did not change state.
export class PowerOperation {
  private target: boolean | null = null;
  private attempts = 0;
  private status: "idle" | "verifying" | "confirmed" | "failed" = "idle";
  private startedAt = 0;
  private sentAt = 0;
  private oppositeSince: number | null = null;
  private lastEvidence = -Infinity;

  request(target: boolean, now = Date.now()) {
    this.target = target;
    this.attempts = 1;
    this.status = "verifying";
    this.startedAt = this.sentAt = now;
    this.oppositeSince = null;
    this.lastEvidence = -Infinity;
  }
  disconnect() {
    if (this.status === "verifying") this.status = "failed";
  }
  snapshot() { return { target: this.target, attempts: this.attempts, status: this.status }; }

  poll(online: boolean, idle: boolean, observedPower: boolean | null, optical: Evidence, now = Date.now()): { power: boolean } | null {
    if (this.status !== "verifying" || this.target === null) return null;
    if (!online || now - this.startedAt >= 90000) { this.status = "failed"; return null; }
    const at = optical.observedAt;
    if (!idle || optical.power === null || optical.power !== observedPower || at === null ||
        at <= this.sentAt || at > now || now - at > 1200) {
      this.oppositeSince = null;
      return null;
    }
    if (optical.power === this.target) { this.status = "confirmed"; return null; }
    if (now - this.sentAt < 15000 || at <= this.lastEvidence) return null;
    if (at - this.lastEvidence > 3000) this.oppositeSince = null;
    this.lastEvidence = at;
    this.oppositeSince ??= now;
    if (now - this.oppositeSince < 3000) return null;
    if (this.attempts >= 3) { this.status = "failed"; return null; }
    this.attempts++;
    this.sentAt = now;
    this.oppositeSince = null;
    return { power: this.target };
  }
}
