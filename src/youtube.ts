import play from "play-dl";

export function configureYouTube(cookie?: string): void {
  if (!cookie) {
    return;
  }

  void play.setToken({
    youtube: {
      cookie,
    },
  });
}

export function isYouTubeBotCheck(error: unknown): boolean {
  return error instanceof Error && /sign in to confirm/i.test(error.message);
}
