// Explicit optional test: first run downloads the English OCR model.
// This is synthetic printed text, NOT validation of the heater display.
import assert from "node:assert/strict";
import sharp from "sharp";
import { createWorker, PSM } from "tesseract.js";
import { parseTemperature } from "../src/camera/temperature.js";

const image = await sharp(Buffer.from('<svg width="300" height="140"><rect width="300" height="140" fill="white"/><text x="30" y="110" font-family="DejaVu Sans" font-weight="bold" font-size="110" fill="black">48</text></svg>')).png().toBuffer();
const worker = await createWorker("eng");
try {
  await worker.setParameters({ tessedit_char_whitelist: "0123456789", tessedit_pageseg_mode: PSM.SINGLE_LINE });
  const { data } = await worker.recognize(image);
  assert.equal(parseTemperature(data.text, data.confidence), 48);
  console.log(`Synthetic OCR passed: ${data.text.trim()}, confidence=${data.confidence}`);
} finally { await worker.terminate(); }
