import assert from "node:assert/strict";
import test from "node:test";
import { normalizeYouTubeWatchUrl, parseCookieHeader } from "../src/youtube.js";

test("normalizeYouTubeWatchUrl converts music links to watch links", () => {
  assert.equal(
    normalizeYouTubeWatchUrl("https://music.youtube.com/watch?v=jR92OVBgQOU&si=test"),
    "https://www.youtube.com/watch?v=jR92OVBgQOU",
  );
});

test("parseCookieHeader keeps cookie values that contain equals signs", () => {
  const cookies = parseCookieHeader("SID=abc; LOGIN_INFO=a=b=c");

  assert.deepEqual(
    cookies.map(({ name, value }) => ({ name, value })),
    [
      { name: "SID", value: "abc" },
      { name: "LOGIN_INFO", value: "a=b=c" },
    ],
  );
});
