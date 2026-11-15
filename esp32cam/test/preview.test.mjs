import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

test("the actual preview page preserves capture configuration", async () => {
  const source = readFileSync(new URL("../include/camera_module.h", import.meta.url), "utf8");
  const html = source.match(/R"HTML\(([\s\S]*?)\)HTML"/)[1];
  const script = html.match(/<script>([\s\S]*?)<\/script>/)[1];
  const image = { src: "", removeAttribute(name) { assert.equal(name, "src"); this.src = ""; } };
  const context = vm.createContext({
    document: { getElementById(id) { assert.equal(id, "frame"); return image; } },
    location: { hostname: "camera.example.invalid" },
    Date: { now: () => 123 },
    fetch() { throw new Error("Preview must not change /config"); },
  });
  vm.runInContext(script, context);
  await context.preview();
  assert.equal(image.src, "http://camera.example.invalid:81/stream");
  context.stop();
  assert.equal(image.src, "");
  context.capture();
  assert.equal(image.src, "/capture?t=123");
});
