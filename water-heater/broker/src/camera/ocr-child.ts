import { createWorker, PSM } from "tesseract.js";

const deadline = setTimeout(() => process.exit(1), 15000);
process.once("disconnect", () => process.exit(0)); // Parent exit cannot orphan its WASM/threads.
process.once("message", async (image: unknown) => {
  if (!Buffer.isBuffer(image) || !image.length || image.length > 1024 * 1024) process.exit(1);
  try {
    const worker = await createWorker("eng", 1, process.env.OCR_LANG_PATH ? { langPath: process.env.OCR_LANG_PATH } : {});
    try {
      await worker.setParameters({ tessedit_pageseg_mode: PSM.SINGLE_LINE,
        tessedit_char_whitelist: "0123456789.,Cc°" });
      const { data } = await worker.recognize(image);
      const response = { data: { text: data.text.slice(0, 129), confidence: data.confidence } };
      await new Promise<void>((resolve, reject) => process.send!(response, error => error ? reject(error) : resolve()));
    } finally { await worker.terminate(); }
    clearTimeout(deadline);
    process.disconnect?.();
  } catch { process.exit(1); }
});
