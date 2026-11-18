export type CropMode = "primary" | "guard" | "full";
export type FrameEvidence = {
  crop: CropMode;
  light: "dark" | "lit" | "unknown";
  visible: boolean;
  readable: boolean;
  brightness: number | null;
  observedAt: number;
  rejectedValue: number | null;
};

// Blinking alternates every few frames. Require 5 s of the same category
// before logging a transition, and keep brightness out of the signature.
export class FrameDiagnostic {
  private candidate = "";
  private candidateSince = 0;
  private emitted = "";
  private last: FrameEvidence | null = null;

  observe(evidence: FrameEvidence, now = Date.now()): FrameEvidence | null {
    this.last = evidence;
    const signature = JSON.stringify([evidence.crop, evidence.light, evidence.visible, evidence.readable,
      evidence.rejectedValue !== null]);
    if (signature !== this.candidate || now < this.candidateSince) {
      this.candidate = signature;
      this.candidateSince = now;
      return null;
    }
    if (signature === this.emitted || now - this.candidateSince < 5000) return null;
    this.emitted = signature;
    return evidence;
  }

  snapshot() { return this.last; }
}
