import "dotenv/config";
import { z } from "zod";

const envSchema = z.object({
  DISCORD_TOKEN: z.string().trim().min(1, "DISCORD_TOKEN is required"),
  DISCORD_CLIENT_ID: z.string().trim().min(1, "DISCORD_CLIENT_ID is required"),
  DISCORD_GUILD_ID: z.string().trim().min(1).optional(),
  YOUTUBE_COOKIE: z.string().trim().min(1).optional(),
  MAX_PLAYLIST_SIZE: z.coerce.number().int().positive().max(100).default(25),
});

export type AppConfig = z.infer<typeof envSchema>;

export function loadConfig(): AppConfig {
  const parsed = envSchema.safeParse(process.env);

  if (!parsed.success) {
    const message = parsed.error.issues
      .map((issue) => `${issue.path.join(".")}: ${issue.message}`)
      .join("\n");

    throw new Error(`Invalid environment configuration:\n${message}`);
  }

  return parsed.data;
}
