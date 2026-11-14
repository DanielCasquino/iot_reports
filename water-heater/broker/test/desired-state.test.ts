import test, { type TestContext } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DesiredState } from "../src/heater/desired-state.js";

function fixture(t: TestContext) {
  const directory = mkdtempSync(join(tmpdir(), "heater-desired-"));
  t.after(() => rmSync(directory, { recursive: true, force: true }));
  return { directory, file: join(directory, "desired-state.json") };
}

test("missing storage loads unknown without writing; valid requests create the configured directory", t => {
  const { directory } = fixture(t);
  const file = join(directory, ".runtime", "desired-state.json");
  const state = new DesiredState(file);
  assert.deepEqual(state.snapshot(), { power: null, temperature: null });
  assert.equal(existsSync(join(directory, ".runtime")), false);
  assert.equal(state.setPower(true), true);
  assert.deepEqual(JSON.parse(readFileSync(file, "utf8")), { power: true, temperature: null });
  assert.deepEqual(readdirSync(join(directory, ".runtime")), ["desired-state.json"]);
});

test("restart preserves the latest requested value independently for each field", t => {
  const { directory, file } = fixture(t);
  const state = new DesiredState(file);
  state.setPower(true);
  state.setTemperature(30);
  state.setPower(false);
  state.setTemperature(75);
  assert.deepEqual(state.snapshot(), { power: false, temperature: 75 });
  const restarted = new DesiredState(file);
  assert.deepEqual(restarted.snapshot(), { power: false, temperature: 75 });
  restarted.setTemperature(43);
  assert.deepEqual(new DesiredState(file).snapshot(), { power: false, temperature: 43 });
  assert.deepEqual(readdirSync(directory), ["desired-state.json"]);
});

test("snapshots are copies and null requests explicitly clear only their field", t => {
  const { file } = fixture(t);
  const state = new DesiredState(file);
  state.setPower(true);
  state.setTemperature(45);
  const copy = state.snapshot();
  copy.power = false;
  copy.temperature = 70;
  assert.deepEqual(state.snapshot(), { power: true, temperature: 45 });
  assert.equal(state.setPower(null), true);
  assert.deepEqual(new DesiredState(file).snapshot(), { power: null, temperature: 45 });
  assert.equal(state.setTemperature(null), true);
  assert.deepEqual(new DesiredState(file).snapshot(), { power: null, temperature: null });
});

test("invalid requests leave both the stored bytes and the current snapshot unchanged", t => {
  const { file } = fixture(t);
  const state = new DesiredState(file);
  state.setPower(false);
  state.setTemperature(43);
  const original = readFileSync(file, "utf8");
  for (const value of [29, 76, 30.5, NaN, Infinity, -Infinity, "43", true, undefined, {}, []]) {
    assert.equal(state.setTemperature(value), false);
  }
  for (const value of [0, 1, "true", "false", undefined, {}, []]) {
    assert.equal(state.setPower(value), false);
  }
  assert.equal(readFileSync(file, "utf8"), original);
  assert.deepEqual(state.snapshot(), { power: false, temperature: 43 });
});

test("malformed and invalid saved data remain untouched until a valid request", t => {
  const { file } = fixture(t);
  for (const original of ["{", "null", "[]", "{}", '{"power":true}',
    '{"power":"true","temperature":43}', '{"power":false,"temperature":76}',
    '{"power":true,"temperature":30.5}']) {
    writeFileSync(file, original);
    const state = new DesiredState(file);
    assert.deepEqual(state.snapshot(), { power: null, temperature: null });
    assert.equal(state.setTemperature(29), false);
    assert.equal(state.setPower("true"), false);
    assert.equal(readFileSync(file, "utf8"), original);
    assert.equal(state.setTemperature(45), true);
    assert.deepEqual(new DesiredState(file).snapshot(), { power: null, temperature: 45 });
  }
});

test("failed replacement throws without changing memory or leaving a temporary file", t => {
  const { directory, file } = fixture(t);
  mkdirSync(file);
  const state = new DesiredState(file);
  assert.throws(() => state.setPower(true));
  assert.deepEqual(state.snapshot(), { power: null, temperature: null });
  assert.deepEqual(readdirSync(directory), ["desired-state.json"]);
});
