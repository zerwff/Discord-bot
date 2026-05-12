import {
  AudioPlayerStatus,
  NoSubscriberBehavior,
  StreamType,
  VoiceConnectionStatus,
  createAudioPlayer,
  createAudioResource,
  entersState,
  joinVoiceChannel,
  type AudioPlayer,
  type DiscordGatewayAdapterCreator,
  type VoiceConnection,
} from "@discordjs/voice";
import {
  escapeMarkdown,
  MessageFlags,
  PermissionFlagsBits,
  type ChatInputCommandInteraction,
  type Client,
  type Snowflake,
  type VoiceBasedChannel,
} from "discord.js";
import play, { type YouTubeVideo } from "play-dl";
import { formatDuration, truncate } from "../utils/format.js";

type CachedCommandInteraction = ChatInputCommandInteraction<"cached">;

interface Track {
  title: string;
  url: string;
  duration: string;
  durationInSec: number;
  requestedBy: Snowflake;
}

interface GuildMusicQueue {
  guildId: Snowflake;
  voiceChannelId: Snowflake;
  textChannelId: Snowflake;
  connection: VoiceConnection;
  player: AudioPlayer;
  tracks: Track[];
  current?: Track;
}

class BotError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BotError";
  }
}

export class MusicPlayer {
  private readonly queues = new Map<Snowflake, GuildMusicQueue>();

  constructor(
    private readonly client: Client,
    private readonly maxPlaylistSize: number,
  ) {}

  async play(interaction: CachedCommandInteraction): Promise<void> {
    const query = interaction.options.getString("query", true);
    const voiceChannel = this.getMemberVoiceChannel(interaction);

    await interaction.deferReply();

    const tracks = await this.resolveTracks(query, interaction.user.id);
    const queue = await this.getOrCreateQueue(interaction, voiceChannel);
    queue.tracks.push(...tracks);

    if (queue.player.state.status === AudioPlayerStatus.Idle && !queue.current) {
      void this.playNext(queue);
    }

    const suffix =
      tracks.length === 1
        ? `대기열에 추가했습니다: ${this.describeTrack(tracks[0])}`
        : `${tracks.length}곡을 대기열에 추가했습니다.`;

    await interaction.editReply(suffix);
  }

  async skip(interaction: CachedCommandInteraction): Promise<void> {
    const queue = this.requireQueue(interaction.guildId);
    this.ensureSameVoiceChannel(interaction, queue);

    if (!queue.current) {
      await this.respond(interaction, "현재 재생 중인 곡이 없습니다.", true);
      return;
    }

    const skipped = queue.current;
    queue.player.stop(true);
    await this.respond(interaction, `건너뜁니다: ${this.describeTrack(skipped)}`);
  }

  async stop(interaction: CachedCommandInteraction): Promise<void> {
    const queue = this.requireQueue(interaction.guildId);
    this.ensureSameVoiceChannel(interaction, queue);
    this.destroyQueue(interaction.guildId);

    await this.respond(interaction, "재생을 멈추고 대기열을 비웠습니다.");
  }

  async pause(interaction: CachedCommandInteraction): Promise<void> {
    const queue = this.requireQueue(interaction.guildId);
    this.ensureSameVoiceChannel(interaction, queue);

    if (queue.player.state.status !== AudioPlayerStatus.Playing || !queue.player.pause()) {
      await this.respond(interaction, "일시정지할 곡이 없습니다.", true);
      return;
    }

    await this.respond(interaction, "일시정지했습니다.");
  }

  async resume(interaction: CachedCommandInteraction): Promise<void> {
    const queue = this.requireQueue(interaction.guildId);
    this.ensureSameVoiceChannel(interaction, queue);

    if (queue.player.state.status !== AudioPlayerStatus.Paused || !queue.player.unpause()) {
      await this.respond(interaction, "다시 재생할 일시정지 곡이 없습니다.", true);
      return;
    }

    await this.respond(interaction, "다시 재생합니다.");
  }

  async queue(interaction: CachedCommandInteraction): Promise<void> {
    const queue = this.requireQueue(interaction.guildId);
    const current = queue.current ? `현재 재생: ${this.describeTrack(queue.current)}` : "현재 재생 중인 곡이 없습니다.";

    if (queue.tracks.length === 0) {
      await this.respond(interaction, `${current}\n대기열이 비어 있습니다.`);
      return;
    }

    const preview = queue.tracks
      .slice(0, 10)
      .map((track, index) => `${index + 1}. ${this.describeTrack(track)}`)
      .join("\n");
    const remaining = queue.tracks.length > 10 ? `\n...외 ${queue.tracks.length - 10}곡` : "";

    await this.respond(interaction, `${current}\n\n대기열:\n${preview}${remaining}`);
  }

  async nowPlaying(interaction: CachedCommandInteraction): Promise<void> {
    const queue = this.requireQueue(interaction.guildId);

    if (!queue.current) {
      await this.respond(interaction, "현재 재생 중인 곡이 없습니다.", true);
      return;
    }

    await this.respond(interaction, `현재 재생: ${this.describeTrack(queue.current)}`);
  }

  async leave(interaction: CachedCommandInteraction): Promise<void> {
    const queue = this.requireQueue(interaction.guildId);
    this.ensureSameVoiceChannel(interaction, queue);
    this.destroyQueue(interaction.guildId);

    await this.respond(interaction, "음성 채널에서 나갔습니다.");
  }

  isUserFacingError(error: unknown): error is BotError {
    return error instanceof BotError;
  }

  private async resolveTracks(query: string, requestedBy: Snowflake): Promise<Track[]> {
    const validation = await play.validate(query);

    if (validation === "yt_video") {
      const info = await play.video_basic_info(query);
      return [this.toTrack(info.video_details, requestedBy)];
    }

    if (validation === "yt_playlist") {
      const playlist = await play.playlist_info(query, { incomplete: true });
      const videos = await playlist.next(this.maxPlaylistSize);

      if (videos.length === 0) {
        throw new BotError("재생할 수 있는 플레이리스트 영상을 찾지 못했습니다.");
      }

      return videos.map((video) => this.toTrack(video, requestedBy));
    }

    if (this.isProbablyUrl(query)) {
      throw new BotError("현재는 YouTube 영상/플레이리스트 링크 또는 검색어를 지원합니다.");
    }

    const results = await play.search(query, {
      limit: 1,
      source: { youtube: "video" },
    });

    if (results.length === 0) {
      throw new BotError("검색 결과를 찾지 못했습니다.");
    }

    return [this.toTrack(results[0], requestedBy)];
  }

  private async getOrCreateQueue(
    interaction: CachedCommandInteraction,
    voiceChannel: VoiceBasedChannel,
  ): Promise<GuildMusicQueue> {
    const existingQueue = this.queues.get(interaction.guildId);

    if (existingQueue) {
      if (existingQueue.voiceChannelId !== voiceChannel.id) {
        throw new BotError("이미 다른 음성 채널에서 음악을 재생 중입니다.");
      }

      return existingQueue;
    }

    const connection = joinVoiceChannel({
      channelId: voiceChannel.id,
      guildId: interaction.guildId,
      adapterCreator: interaction.guild.voiceAdapterCreator as DiscordGatewayAdapterCreator,
      selfDeaf: true,
    });
    const player = createAudioPlayer({
      behaviors: {
        noSubscriber: NoSubscriberBehavior.Pause,
      },
    });
    const queue: GuildMusicQueue = {
      guildId: interaction.guildId,
      voiceChannelId: voiceChannel.id,
      textChannelId: interaction.channelId,
      connection,
      player,
      tracks: [],
    };

    this.wireQueueEvents(queue);
    connection.subscribe(player);
    this.queues.set(interaction.guildId, queue);

    try {
      await entersState(connection, VoiceConnectionStatus.Ready, 30_000);
      return queue;
    } catch (error) {
      this.destroyQueue(interaction.guildId);
      throw new BotError("음성 채널에 연결하지 못했습니다. 봇 권한을 확인해 주세요.");
    }
  }

  private wireQueueEvents(queue: GuildMusicQueue): void {
    queue.player.on(AudioPlayerStatus.Idle, () => {
      if (this.queues.get(queue.guildId) !== queue) {
        return;
      }

      queue.current = undefined;
      void this.playNext(queue);
    });

    queue.player.on("error", (error) => {
      const failedTrack = queue.current;
      console.error("Audio player error:", error);

      if (failedTrack) {
        void this.notify(queue, `재생 중 오류가 발생했습니다: ${this.describeTrack(failedTrack)}`);
      }

      queue.current = undefined;
      void this.playNext(queue);
    });

    queue.connection.on(VoiceConnectionStatus.Disconnected, async () => {
      try {
        await Promise.race([
          entersState(queue.connection, VoiceConnectionStatus.Signalling, 5_000),
          entersState(queue.connection, VoiceConnectionStatus.Connecting, 5_000),
        ]);
      } catch {
        this.destroyQueue(queue.guildId);
      }
    });
  }

  private async playNext(queue: GuildMusicQueue): Promise<void> {
    if (this.queues.get(queue.guildId) !== queue) {
      return;
    }

    const nextTrack = queue.tracks.shift();

    if (!nextTrack) {
      await this.notify(queue, "대기열이 끝났습니다. 음성 채널에서 나갑니다.");
      this.destroyQueue(queue.guildId);
      return;
    }

    queue.current = nextTrack;

    try {
      const stream = await play.stream(nextTrack.url);
      const resource = createAudioResource(stream.stream, {
        inputType: stream.type as unknown as StreamType,
        metadata: nextTrack,
      });

      queue.player.play(resource);
      await entersState(queue.player, AudioPlayerStatus.Playing, 15_000);
      await this.notify(queue, `재생 시작: ${this.describeTrack(nextTrack)}`);
    } catch (error) {
      console.error("Failed to play track:", error);
      await this.notify(queue, `곡을 재생하지 못했습니다: ${this.describeTrack(nextTrack)}`);
      queue.current = undefined;
      await this.playNext(queue);
    }
  }

  private requireQueue(guildId: Snowflake): GuildMusicQueue {
    const queue = this.queues.get(guildId);

    if (!queue) {
      throw new BotError("현재 재생 중인 음악이 없습니다.");
    }

    return queue;
  }

  private getMemberVoiceChannel(interaction: CachedCommandInteraction): VoiceBasedChannel {
    const voiceChannel = interaction.member.voice.channel;

    if (!voiceChannel) {
      throw new BotError("먼저 음성 채널에 들어가 주세요.");
    }

    const botPermissions = voiceChannel.permissionsFor(interaction.client.user);

    if (!botPermissions?.has(PermissionFlagsBits.Connect) || !botPermissions.has(PermissionFlagsBits.Speak)) {
      throw new BotError("봇에게 음성 채널 접속 및 말하기 권한이 필요합니다.");
    }

    return voiceChannel;
  }

  private ensureSameVoiceChannel(interaction: CachedCommandInteraction, queue: GuildMusicQueue): void {
    const voiceChannel = interaction.member.voice.channel;

    if (!voiceChannel || voiceChannel.id !== queue.voiceChannelId) {
      throw new BotError("음악을 제어하려면 봇과 같은 음성 채널에 있어야 합니다.");
    }
  }

  private destroyQueue(guildId: Snowflake): void {
    const queue = this.queues.get(guildId);

    if (!queue) {
      return;
    }

    this.queues.delete(guildId);
    queue.tracks = [];
    queue.current = undefined;
    queue.player.stop(true);

    if (queue.connection.state.status !== VoiceConnectionStatus.Destroyed) {
      queue.connection.destroy();
    }
  }

  private async notify(queue: GuildMusicQueue, content: string): Promise<void> {
    const channel = await this.client.channels.fetch(queue.textChannelId).catch(() => null);

    if (!channel?.isSendable()) {
      return;
    }

    await channel.send({ content, allowedMentions: { parse: [] } }).catch(() => undefined);
  }

  private async respond(interaction: CachedCommandInteraction, content: string, ephemeral = false): Promise<void> {
    if (interaction.deferred || interaction.replied) {
      await interaction.editReply({ content });
      return;
    }

    await interaction.reply({
      content,
      flags: ephemeral ? MessageFlags.Ephemeral : undefined,
      allowedMentions: { parse: [] },
    });
  }

  private toTrack(video: YouTubeVideo, requestedBy: Snowflake): Track {
    return {
      title: video.title ?? "Untitled",
      url: video.url,
      duration: formatDuration(video.durationInSec),
      durationInSec: video.durationInSec,
      requestedBy,
    };
  }

  private describeTrack(track: Track): string {
    const title = escapeMarkdown(truncate(track.title, 80));
    return `[${title}](${track.url}) (${track.duration}) - <@${track.requestedBy}>`;
  }

  private isProbablyUrl(value: string): boolean {
    try {
      new URL(value);
      return true;
    } catch {
      return false;
    }
  }
}
