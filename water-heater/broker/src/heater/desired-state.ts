import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

export interface DesiredStateSnapshot {
  power: boolean | null;
  temperature: number | null;
}

function validPower(value: unknown): value is boolean | null {
  return value === null || typeof value === "boolean";
}

function validTemperature(value: unknown): value is number | null {
  return value === null || (typeof value === "number" && Number.isInteger(value) && value >= 30 && value <= 75);
}

export class DesiredState {
  private state: DesiredStateSnapshot = { power: null, temperature: null };

  constructor(private readonly filePath: string) {
    try {
      const saved: unknown = JSON.parse(readFileSync(filePath, "utf8"));
      if (saved && typeof saved === "object" && !Array.isArray(saved) &&
          "power" in saved && "temperature" in saved &&
          validPower(saved.power) && validTemperature(saved.temperature)) {
        this.state = { power: saved.power, temperature: saved.temperature };
      }
    } catch {}
  }

  snapshot(): DesiredStateSnapshot {
    return { ...this.state };
  }

  setPower(value: unknown): boolean {
    if (!validPower(value)) return false;
    this.save({ ...this.state, power: value });
    return true;
  }

  setTemperature(value: unknown): boolean {
    if (!validTemperature(value)) return false;
    this.save({ ...this.state, temperature: value });
    return true;
  }

  private save(next: DesiredStateSnapshot) {
    mkdirSync(dirname(this.filePath), { recursive: true, mode: 0o700 });
    const temporary = `${this.filePath}.${randomUUID()}.tmp`;
    try {
      writeFileSync(temporary, JSON.stringify(next) + "\n", { encoding: "utf8", flag: "wx", mode: 0o600 });
      renameSync(temporary, this.filePath);
      this.state = next;
    } finally {
      rmSync(temporary, { force: true });
    }
  }
}
