import { Client, Events, GatewayIntentBits, MessageFlags, type ButtonInteraction, type ChatInputCommandInteraction } from "discord.js";
import { loadConfig } from "./config.js";
import { MusicPlayer } from "./music/MusicPlayer.js";
import { configureYouTube } from "./youtube.js";

const config = loadConfig();
configureYouTube(config.YOUTUBE_COOKIE);

const client = new Client({
  intents: [GatewayIntentBits.Guilds, GatewayIntentBits.GuildVoiceStates],
});
const musicPlayer = new MusicPlayer(client, config.MAX_PLAYLIST_SIZE);

client.once(Events.ClientReady, (readyClient) => {
  console.log(`Logged in as ${readyClient.user.tag}`);
});

client.on(Events.InteractionCreate, async (interaction) => {
  if (!interaction.isChatInputCommand() && !interaction.isButton()) {
    return;
  }

  if (!interaction.inCachedGuild()) {
    await interaction.reply({
      content: "서버 안에서만 사용할 수 있는 명령어입니다.",
      flags: MessageFlags.Ephemeral,
    });
    return;
  }

  try {
    if (interaction.isButton()) {
      if (musicPlayer.isMusicButton(interaction.customId)) {
        await musicPlayer.handleButton(interaction);
      }

      return;
    }

    switch (interaction.commandName) {
      case "play":
        await musicPlayer.play(interaction);
        break;
      case "skip":
        await musicPlayer.skip(interaction);
        break;
      case "stop":
        await musicPlayer.stop(interaction);
        break;
      case "pause":
        await musicPlayer.pause(interaction);
        break;
      case "resume":
        await musicPlayer.resume(interaction);
        break;
      case "queue":
        await musicPlayer.queue(interaction);
        break;
      case "nowplaying":
        await musicPlayer.nowPlaying(interaction);
        break;
      case "leave":
        await musicPlayer.leave(interaction);
        break;
      default:
        await interaction.reply({
          content: "알 수 없는 명령어입니다.",
          flags: MessageFlags.Ephemeral,
        });
    }
  } catch (error) {
    await handleInteractionError(interaction, error);
  }
});

await client.login(config.DISCORD_TOKEN);

async function handleInteractionError(
  interaction: ChatInputCommandInteraction<"cached"> | ButtonInteraction<"cached">,
  error: unknown,
): Promise<void> {
  const message = musicPlayer.isUserFacingError(error)
    ? error.message
    : "명령어 처리 중 오류가 발생했습니다.";

  if (!musicPlayer.isUserFacingError(error)) {
    console.error("Unhandled interaction error:", error);
  }

  if (interaction.deferred || interaction.replied) {
    await interaction.editReply({ content: message, embeds: [], components: [] });
  } else {
    await interaction.reply({
      content: message,
      flags: MessageFlags.Ephemeral,
    });
  }
}
