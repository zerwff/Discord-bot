import {
  AudioPlayerStatus,
  NoSubscriberBehavior,
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
  ActionRowBuilder,
  ButtonBuilder,
  ButtonStyle,
  EmbedBuilder,
  escapeMarkdown,
  MessageFlags,
  PermissionFlagsBits,
  type APIEmbedField,
  type ButtonInteraction,
  type ChatInputCommandInteraction,
  type Client,
  type InteractionEditReplyOptions,
  type InteractionReplyOptions,
  type MessageCreateOptions,
  type Snowflake,
  type VoiceBasedChannel,
} from "discord.js";
import play, { type YouTubeVideo } from "play-dl";
import { formatDuration, truncate } from "../utils/format.js";
import { createYouTubeAudioStream, isYouTubeBotCheck, normalizeYouTubeWatchUrl } from "../youtube.js";

type CachedCommandInteraction = ChatInputCommandInteraction<"cached">;
type CachedButtonInteraction = ButtonInteraction<"cached">;
type CachedMusicInteraction = CachedCommandInteraction | CachedButtonInteraction;

const MUSIC_COLOR = 0x8b5cf6;
const MUSIC_PREFIX = "music:";
const MUSIC_CONTROLS = {
  pause: `${MUSIC_PREFIX}pause`,
  resume: `${MUSIC_PREFIX}resume`,
  skip: `${MUSIC_PREFIX}skip`,
  stop: `${MUSIC_PREFIX}stop`,
  queue: `${MUSIC_PREFIX}queue`,
  nowPlaying: `${MUSIC_PREFIX}nowplaying`,
  leave: `${MUSIC_PREFIX}leave`,
} as const;

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

interface MusicEmbedOptions {
  title: string;
  description: string;
  status?: string;
  highlightedTrack?: Track;
  currentTrack?: Track;
  queueLength?: number;
  queuePreview?: Track[];
  voiceChannelId?: Snowflake;
  includeQueuePreview?: boolean;
  includeControls?: boolean;
  ephemeral?: boolean;
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

  isMusicButton(customId: string): boolean {
    return customId.startsWith(MUSIC_PREFIX);
  }

  async handleButton(interaction: CachedButtonInteraction): Promise<void> {
    switch (interaction.customId) {
      case MUSIC_CONTROLS.pause:
        await this.pause(interaction);
        break;
      case MUSIC_CONTROLS.resume:
        await this.resume(interaction);
        break;
      case MUSIC_CONTROLS.skip:
        await this.skip(interaction);
        break;
      case MUSIC_CONTROLS.stop:
        await this.stop(interaction);
        break;
      case MUSIC_CONTROLS.queue:
        await this.queue(interaction);
        break;
      case MUSIC_CONTROLS.nowPlaying:
        await this.nowPlaying(interaction);
        break;
      case MUSIC_CONTROLS.leave:
        await this.leave(interaction);
        break;
      default:
        await this.respond(interaction, "알 수 없는 음악 버튼입니다.", true);
    }
  }

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

    const description =
      tracks.length === 1
        ? "곡을 대기열에 추가했습니다."
        : `${tracks.length}곡을 대기열에 추가했습니다.`;

    await this.respondWithQueue(interaction, queue, {
      title: "Music Added",
      description,
      highlightedTrack: tracks[0],
    });
  }

  async skip(interaction: CachedMusicInteraction): Promise<void> {
    const queue = this.requireQueue(interaction.guildId);
    this.ensureSameVoiceChannel(interaction, queue);

    if (!queue.current) {
      await this.respond(interaction, "현재 재생 중인 곡이 없습니다.", true);
      return;
    }

    const skipped = queue.current;
    queue.player.stop(true);
    await this.respondWithQueue(interaction, queue, {
      title: "Skipped",
      description: "현재 곡을 건너뜁니다.",
      highlightedTrack: skipped,
    });
  }

  async stop(interaction: CachedMusicInteraction): Promise<void> {
    const queue = this.requireQueue(interaction.guildId);
    this.ensureSameVoiceChannel(interaction, queue);
    this.destroyQueue(interaction.guildId);

    await this.respondEmbed(interaction, {
      title: "Player Stopped",
      description: "재생을 멈추고 대기열을 비웠습니다.",
      status: "정지",
      includeControls: false,
    });
  }

  async pause(interaction: CachedMusicInteraction): Promise<void> {
    const queue = this.requireQueue(interaction.guildId);
    this.ensureSameVoiceChannel(interaction, queue);

    if (queue.player.state.status !== AudioPlayerStatus.Playing || !queue.player.pause()) {
      await this.respond(interaction, "일시정지할 곡이 없습니다.", true);
      return;
    }

    await this.respondWithQueue(interaction, queue, {
      title: "Paused",
      description: "현재 곡을 일시정지했습니다.",
      status: "일시정지",
    });
  }

  async resume(interaction: CachedMusicInteraction): Promise<void> {
    const queue = this.requireQueue(interaction.guildId);
    this.ensureSameVoiceChannel(interaction, queue);

    if (queue.player.state.status !== AudioPlayerStatus.Paused || !queue.player.unpause()) {
      await this.respond(interaction, "다시 재생할 일시정지 곡이 없습니다.", true);
      return;
    }

    await this.respondWithQueue(interaction, queue, {
      title: "Resumed",
      description: "다시 재생합니다.",
      status: "재생 중",
    });
  }

  async queue(interaction: CachedMusicInteraction): Promise<void> {
    const queue = this.requireQueue(interaction.guildId);

    await this.respondWithQueue(interaction, queue, {
      title: "Music Queue",
      description: queue.tracks.length === 0 ? "대기열이 비어 있습니다." : "다음 곡 목록입니다.",
      includeQueuePreview: true,
    });
  }

  async nowPlaying(interaction: CachedMusicInteraction): Promise<void> {
    const queue = this.requireQueue(interaction.guildId);

    if (!queue.current) {
      await this.respond(interaction, "현재 재생 중인 곡이 없습니다.", true);
      return;
    }

    await this.respondWithQueue(interaction, queue, {
      title: "Now Playing",
      description: "현재 재생 중인 곡입니다.",
      highlightedTrack: queue.current,
    });
  }

  async leave(interaction: CachedMusicInteraction): Promise<void> {
    const queue = this.requireQueue(interaction.guildId);
    this.ensureSameVoiceChannel(interaction, queue);
    this.destroyQueue(interaction.guildId);

    await this.respondEmbed(interaction, {
      title: "Disconnected",
      description: "음성 채널에서 나갔습니다.",
      status: "연결 종료",
      includeControls: false,
    });
  }

  isUserFacingError(error: unknown): error is BotError {
    return error instanceof BotError;
  }

  private async resolveTracks(query: string, requestedBy: Snowflake): Promise<Track[]> {
    try {
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
    } catch (error) {
      if (error instanceof BotError) {
        throw error;
      }

      throw this.toPlaybackError(error);
    }
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
        void this.notifyEmbed(queue, {
          title: "Playback Error",
          description: "재생 중 오류가 발생했습니다.",
          highlightedTrack: failedTrack,
          status: "오류",
          includeControls: false,
        });
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
      await this.notifyEmbed(queue, {
        title: "Queue Finished",
        description: "대기열이 끝났습니다. 음성 채널에서 나갑니다.",
        status: "완료",
        includeControls: false,
      });
      this.destroyQueue(queue.guildId);
      return;
    }

    queue.current = nextTrack;

    try {
      const stream = await createYouTubeAudioStream(nextTrack.url);
      const resource = createAudioResource(stream, {
        metadata: nextTrack,
      });

      queue.player.play(resource);
      await entersState(queue.player, AudioPlayerStatus.Playing, 15_000);
      await this.notifyWithQueue(queue, {
        title: "Now Playing",
        description: "재생을 시작합니다.",
        highlightedTrack: nextTrack,
        status: "재생 중",
      });
    } catch (error) {
      console.error("Failed to play track:", error);
      await this.notifyEmbed(queue, {
        title: "Playback Failed",
        description: this.toPlaybackError(error).message,
        highlightedTrack: nextTrack,
        status: "실패",
        includeControls: false,
      });
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

  private async notify(queue: GuildMusicQueue, options: MessageCreateOptions): Promise<void> {
    const channel = await this.client.channels.fetch(queue.textChannelId).catch(() => null);

    if (!channel?.isSendable()) {
      return;
    }

    await channel.send({ ...options, allowedMentions: { parse: [] } }).catch(() => undefined);
  }

  private async respond(interaction: CachedMusicInteraction, content: string, ephemeral = false): Promise<void> {
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

  private async respondWithQueue(
    interaction: CachedMusicInteraction,
    queue: GuildMusicQueue,
    options: MusicEmbedOptions,
  ): Promise<void> {
    await this.respondEmbed(interaction, this.queueEmbedOptions(queue, options));
  }

  private async notifyWithQueue(queue: GuildMusicQueue, options: MusicEmbedOptions): Promise<void> {
    await this.notifyEmbed(queue, this.queueEmbedOptions(queue, options));
  }

  private async respondEmbed(interaction: CachedMusicInteraction, options: MusicEmbedOptions): Promise<void> {
    const payload = this.toInteractionPayload(options);

    if (interaction.deferred || interaction.replied) {
      await interaction.editReply(payload);
      return;
    }

    await interaction.reply({
      ...payload,
      flags: options.ephemeral ? MessageFlags.Ephemeral : undefined,
    });
  }

  private async notifyEmbed(queue: GuildMusicQueue, options: MusicEmbedOptions): Promise<void> {
    await this.notify(queue, this.toMessagePayload(options));
  }

  private queueEmbedOptions(queue: GuildMusicQueue, options: MusicEmbedOptions): MusicEmbedOptions {
    return {
      ...options,
      currentTrack: queue.current,
      queueLength: queue.tracks.length,
      queuePreview: options.includeQueuePreview ? queue.tracks : undefined,
      voiceChannelId: queue.voiceChannelId,
      status: options.status ?? this.getQueueStatus(queue),
    };
  }

  private toInteractionPayload(options: MusicEmbedOptions): InteractionReplyOptions & InteractionEditReplyOptions {
    const payload = this.toMessagePayload(options);
    return {
      embeds: payload.embeds,
      components: payload.components,
      content: "",
      allowedMentions: { parse: [] },
    };
  }

  private toMessagePayload(options: MusicEmbedOptions): MessageCreateOptions {
    return {
      embeds: [this.createMusicEmbed(options)],
      components: options.includeControls === false ? [] : this.createControlRows(),
      allowedMentions: { parse: [] },
    };
  }

  private createMusicEmbed(options: MusicEmbedOptions): EmbedBuilder {
    const fields: APIEmbedField[] = [];
    const featuredTrack = options.highlightedTrack ?? options.currentTrack;

    if (featuredTrack) {
      fields.push({
        name: "Track",
        value: this.describeTrack(featuredTrack),
      });
      fields.push(
        {
          name: "Duration",
          value: featuredTrack.duration,
          inline: true,
        },
        {
          name: "Requested by",
          value: `<@${featuredTrack.requestedBy}>`,
          inline: true,
        },
      );
    }

    if (options.currentTrack && options.highlightedTrack && options.currentTrack.url !== options.highlightedTrack.url) {
      fields.push({
        name: "Now Playing",
        value: this.describeTrack(options.currentTrack),
      });
    }

    if (typeof options.queueLength === "number") {
      fields.push({
        name: "Queue",
        value: `${options.queueLength}곡 대기 중`,
        inline: true,
      });
    }

    if (options.voiceChannelId) {
      fields.push({
        name: "Voice",
        value: `<#${options.voiceChannelId}>`,
        inline: true,
      });
    }

    if (options.queuePreview) {
      fields.push({
        name: "Up Next",
        value: this.formatQueuePreview(options.queuePreview),
      });
    }

    return new EmbedBuilder()
      .setColor(MUSIC_COLOR)
      .setAuthor({ name: "Discord Music Player" })
      .setTitle(options.title)
      .setDescription(options.description)
      .addFields(fields)
      .setFooter({ text: `Status: ${options.status ?? "대기 중"}` })
      .setTimestamp();
  }

  private createControlRows(): ActionRowBuilder<ButtonBuilder>[] {
    return [
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(MUSIC_CONTROLS.pause)
          .setLabel("Pause")
          .setEmoji("⏸️")
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(MUSIC_CONTROLS.resume)
          .setLabel("Resume")
          .setEmoji("▶️")
          .setStyle(ButtonStyle.Success),
        new ButtonBuilder()
          .setCustomId(MUSIC_CONTROLS.skip)
          .setLabel("Skip")
          .setEmoji("⏭️")
          .setStyle(ButtonStyle.Primary),
        new ButtonBuilder()
          .setCustomId(MUSIC_CONTROLS.stop)
          .setLabel("Stop")
          .setEmoji("⏹️")
          .setStyle(ButtonStyle.Danger),
      ),
      new ActionRowBuilder<ButtonBuilder>().addComponents(
        new ButtonBuilder()
          .setCustomId(MUSIC_CONTROLS.queue)
          .setLabel("Queue")
          .setEmoji("📜")
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(MUSIC_CONTROLS.nowPlaying)
          .setLabel("Now Playing")
          .setEmoji("🎧")
          .setStyle(ButtonStyle.Secondary),
        new ButtonBuilder()
          .setCustomId(MUSIC_CONTROLS.leave)
          .setLabel("Leave")
          .setEmoji("👋")
          .setStyle(ButtonStyle.Secondary),
      ),
    ];
  }

  private formatQueuePreview(tracks: Track[]): string {
    if (tracks.length === 0) {
      return "대기열이 비어 있습니다.";
    }

    const preview = tracks
      .slice(0, 10)
      .map((track, index) => `**${index + 1}.** ${this.describeTrack(track)}`)
      .join("\n");
    const remaining = tracks.length > 10 ? `\n...외 ${tracks.length - 10}곡` : "";

    return `${preview}${remaining}`;
  }

  private getQueueStatus(queue: GuildMusicQueue): string {
    switch (queue.player.state.status) {
      case AudioPlayerStatus.Playing:
        return "재생 중";
      case AudioPlayerStatus.Paused:
        return "일시정지";
      case AudioPlayerStatus.Buffering:
        return "버퍼링";
      case AudioPlayerStatus.AutoPaused:
        return "자동 일시정지";
      default:
        return "대기 중";
    }
  }

  private toTrack(video: YouTubeVideo, requestedBy: Snowflake): Track {
    return {
      title: video.title ?? "Untitled",
      url: normalizeYouTubeWatchUrl(video.url),
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

  private toPlaybackError(error: unknown): BotError {
    if (isYouTubeBotCheck(error)) {
      return new BotError("YouTube가 봇 검증을 요구해서 재생할 수 없습니다. YOUTUBE_COOKIE 설정이 필요합니다");
    }

    return new BotError("YouTube 정보를 가져오거나 재생 스트림을 여는 데 실패했습니다");
  }
}
