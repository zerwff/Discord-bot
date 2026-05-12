# Discord Music Bot

TypeScript 기반 Discord slash-command 노래봇입니다. YouTube 링크, YouTube playlist 링크, 또는 검색어로 음악을 재생하고 서버별 대기열을 관리합니다.

## 기능

- `/play query:<검색어 또는 URL>`: YouTube 영상/플레이리스트를 대기열에 추가하고 재생
- `/skip`: 현재 곡 건너뛰기
- `/stop`: 재생 중지 및 대기열 비우기
- `/pause`, `/resume`: 일시정지/재개
- `/queue`: 현재 곡과 대기열 확인
- `/nowplaying`: 현재 재생 중인 곡 확인
- `/leave`: 음성 채널에서 나가기

## 준비

1. Discord Developer Portal에서 bot application을 만들고 token/client ID를 확인합니다.
2. Bot 권한에 `Connect`, `Speak`, `Use Slash Commands`를 포함해 서버에 초대합니다.
3. 환경변수를 설정합니다.

```bash
cp .env.example .env
```

`.env` 파일에 값을 채웁니다.

```dotenv
DISCORD_TOKEN=your-bot-token
DISCORD_CLIENT_ID=your-application-client-id
DISCORD_GUILD_ID=your-test-guild-id
MAX_PLAYLIST_SIZE=25
```

`DISCORD_GUILD_ID`를 설정하면 slash command가 해당 서버에만 빠르게 등록됩니다. 비워두면 전역 command로 등록됩니다.

## 실행

```bash
npm install
npm run deploy:commands
npm run build
npm start
```

개발 중에는 아래 명령을 사용할 수 있습니다.

```bash
npm run dev
```

## 검증

```bash
npm run check
```
