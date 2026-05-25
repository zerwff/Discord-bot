import assert from "node:assert/strict";
import test from "node:test";
import { isYouTubePlaylistUrl, isYouTubeRadioUrl, normalizeYouTubeWatchUrl, parseCookieHeader } from "../src/youtube.js";

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

test("YouTube radio links are not treated as playlists", () => {
  const radioUrl = "https://www.youtube.com/watch?v=74XP3iXM9qk&list=RD74XP3iXM9qk&start_radio=1";

  assert.equal(isYouTubeRadioUrl(radioUrl), true);
  assert.equal(isYouTubePlaylistUrl(radioUrl), false);
});

test("regular YouTube playlists are treated as playlists", () => {
  const playlistUrl = "https://www.youtube.com/playlist?list=PLMC9KNkIncKtPzgY-5rmhvj7fax8fdxoj";

  assert.equal(isYouTubeRadioUrl(playlistUrl), false);
  assert.equal(isYouTubePlaylistUrl(playlistUrl), true);
});
