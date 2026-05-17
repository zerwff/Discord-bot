import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { Readable } from "node:stream";
import type { ReadableStream as WebReadableStream } from "node:stream/web";
import { youtubeDl } from "youtube-dl-exec";
import play from "play-dl";

let youtubeCookieFile: string | undefined;

export function configureYouTube(cookie?: string): void {
  if (!cookie) {
    return;
  }

  void play.setToken({
    youtube: {
      cookie,
    },
  });

  const dataDirectory = join(process.cwd(), ".data");
  mkdirSync(dataDirectory, { recursive: true });
  youtubeCookieFile = join(dataDirectory, "youtube-cookies.txt");
  writeFileSync(youtubeCookieFile, toNetscapeCookieFile(cookie), { mode: 0o600 });
}

export function isYouTubeBotCheck(error: unknown): boolean {
  return error instanceof Error && /sign in to confirm/i.test(error.message);
}

export interface YouTubeAudioStream {
  stream: Readable;
  mimeType?: string;
}

export async function createYouTubeAudioStream(url: string): Promise<YouTubeAudioStream> {
  const audioUrl = await getYouTubeAudioUrl(url);
  const response = await fetch(audioUrl, {
    headers: {
      "User-Agent":
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/125 Safari/537.36",
    },
  });

  if (!response.ok || !response.body) {
    throw new Error(`Audio URL request failed with status ${response.status}`);
  }

  return {
    stream: Readable.fromWeb(response.body as unknown as WebReadableStream<Uint8Array>, {
      highWaterMark: 1 << 25,
    }),
    mimeType: getAudioMimeType(audioUrl, response.headers.get("content-type")),
  };
}

export async function getYouTubeAudioUrl(url: string): Promise<string> {
  const output = await youtubeDl(normalizeYouTubeWatchUrl(url), {
    getUrl: true,
    format: "bestaudio[ext=webm]/bestaudio[acodec=opus]/bestaudio/best",
    noPlaylist: true,
    noWarnings: true,
    jsRuntimes: "node",
    ...(youtubeCookieFile ? { cookies: youtubeCookieFile } : {}),
  });

  if (typeof output !== "string") {
    throw new Error("yt-dlp did not return an audio URL");
  }

  const audioUrl = output
    .split("\n")
    .map((line) => line.trim())
    .find(Boolean);

  if (!audioUrl) {
    throw new Error("yt-dlp returned an empty audio URL");
  }

  return audioUrl;
}

function getAudioMimeType(audioUrl: string, headerMimeType: string | null): string | undefined {
  const urlMimeType = new URL(audioUrl).searchParams.get("mime");
  return urlMimeType ? decodeURIComponent(urlMimeType) : (headerMimeType ?? undefined);
}

export function normalizeYouTubeWatchUrl(value: string): string {
  const url = new URL(value);
  const videoId = url.searchParams.get("v");

  if (!videoId) {
    return value;
  }

  return `https://www.youtube.com/watch?v=${videoId}`;
}

export function parseCookieHeader(cookieHeader: string): Cookie[] {
  return cookieHeader
    .split(";")
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const separatorIndex = entry.indexOf("=");
      const name = separatorIndex === -1 ? entry : entry.slice(0, separatorIndex);
      const value = separatorIndex === -1 ? "" : entry.slice(separatorIndex + 1);

      return {
        name,
        value,
        domain: ".youtube.com",
        path: "/",
        secure: true,
      };
    });
}

interface Cookie {
  name: string;
  value: string;
  domain: string;
  path: string;
  secure: boolean;
}

function toNetscapeCookieFile(cookieHeader: string): string {
  const lines = [
    "# Netscape HTTP Cookie File",
    "# Generated from YOUTUBE_COOKIE.",
    ...parseCookieHeader(cookieHeader).map((cookie) =>
      [
        cookie.domain,
        "TRUE",
        cookie.path,
        cookie.secure ? "TRUE" : "FALSE",
        "2147483647",
        cookie.name,
        cookie.value,
      ].join("\t"),
    ),
  ];

  return `${lines.join("\n")}\n`;
}
