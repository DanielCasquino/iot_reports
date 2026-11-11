export function parseTemperature(text: string, confidence: number, minimumConfidence = 80): number | null {
  // A crop must contain ONE reading. Do not join numbers or guess OCR substitutions.
  const match = text.trim().match(/^(\d{1,3}(?:[.,]\d)?)\s*(?:°\s*)?[Cc]?$/);
  if (!match || !Number.isFinite(confidence) || confidence < minimumConfidence) return null;
  const value = Number(match[1]!.replace(",", "."));
  return Number.isFinite(value) && value >= 0 && value <= 100 ? value : null;
}
