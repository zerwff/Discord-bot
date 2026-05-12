import { SlashCommandBuilder, type RESTPostAPIChatInputApplicationCommandsJSONBody } from "discord.js";

export const commandData: RESTPostAPIChatInputApplicationCommandsJSONBody[] = [
  new SlashCommandBuilder()
    .setName("play")
    .setDescription("YouTube 링크나 검색어로 음악을 재생합니다.")
    .addStringOption((option) =>
      option
        .setName("query")
        .setDescription("YouTube URL, playlist URL, 또는 검색어")
        .setRequired(true),
    ),
  new SlashCommandBuilder().setName("skip").setDescription("현재 곡을 건너뜁니다."),
  new SlashCommandBuilder().setName("stop").setDescription("재생을 멈추고 대기열을 비웁니다."),
  new SlashCommandBuilder().setName("pause").setDescription("현재 곡을 일시정지합니다."),
  new SlashCommandBuilder().setName("resume").setDescription("일시정지된 곡을 다시 재생합니다."),
  new SlashCommandBuilder().setName("queue").setDescription("현재 대기열을 확인합니다."),
  new SlashCommandBuilder().setName("nowplaying").setDescription("현재 재생 중인 곡을 확인합니다."),
  new SlashCommandBuilder().setName("leave").setDescription("음성 채널에서 봇을 내보냅니다."),
].map((command) => command.toJSON());
