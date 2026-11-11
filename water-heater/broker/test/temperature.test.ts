import test from "node:test";
import assert from "node:assert/strict";
import { parseTemperature } from "../src/camera/temperature.js";

test("accept a single confident temperature, including zero and decimals", () => {
  assert.equal(parseTemperature("48\n", 95), 48);
  assert.equal(parseTemperature("0°C", 90), 0);
  assert.equal(parseTemperature("48,5 C", 90), 48.5);
});
test("reject dark/ambiguous display, multiple numbers, errors and implausible values", () => {
  for (const text of ["", "--", "ERR", "4 8", "48 50", "48\n50", "101", "-1", "4B", "NaN", "Infinity"])
    assert.equal(parseTemperature(text, 95), null, text);
  assert.equal(parseTemperature("48", 79), null);
  assert.equal(parseTemperature("48", NaN), null);
});
