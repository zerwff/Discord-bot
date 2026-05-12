import assert from "node:assert/strict";
import test from "node:test";
import { formatDuration, truncate } from "../src/utils/format.js";

test("formatDuration formats live or unknown durations", () => {
  assert.equal(formatDuration(0), "live");
  assert.equal(formatDuration(undefined), "live");
});

test("formatDuration formats minutes and seconds", () => {
  assert.equal(formatDuration(65), "1:05");
});

test("formatDuration formats hours", () => {
  assert.equal(formatDuration(3661), "1:01:01");
});

test("truncate shortens long strings", () => {
  assert.equal(truncate("abcdef", 5), "ab...");
  assert.equal(truncate("abc", 5), "abc");
});
