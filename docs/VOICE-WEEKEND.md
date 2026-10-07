# 딜러 음성 주말 작업 (2026-10-07 준비)

ElevenLabs 키가 있는 PC에서 한 번에 끝내는 순서다. 키는 그 PC의 환경변수에만 있고 저장소에는 절대 넣지 않는다.

## 무엇을 녹음하나

딜러 대사 **25줄, 한국어 691자**. 나머지 232줄은 이미 녹음돼 있고 다시 녹음하지 않는다.

- **새 대사 23줄**: 재미 룰(뉴스 속보, 맞교환, 습격, 모 아니면 도, 되찾기, 잭팟, 더블 보너스, 역전 찬스)과
  상표 정리로 바뀐 말(랜드마크 → 명소, 올림픽 → 대축제).
- **고친 대사 1줄** `explain.sets.1`: 플레이어 카드가 단순해지면서 문장이 바뀌었는데 옛 녹음이 그대로 나가고
  있었다. 옛 녹음은 지웠고, 지금은 글자로만 나온다.
- **새 환영 대사 1줄** `game.start.3`: "머니폴리에 오신 걸 환영해요!" 게임 이름이 바뀐 뒤 이름을 말하는 대사가
  없었다.

정확한 목록은 언제든 키 없이 볼 수 있다.

```sh
node scripts/dealer/gen-voice.mjs --dry
```

## 준비물 (한 번만)

- Node.js 22.12 이상, 저장소 최신(`git pull origin main`), `npm ci`
- ffmpeg와 ffprobe가 PATH에 있을 것. Windows: `winget install Gyan.FFmpeg` 후 새 터미널.
- ElevenLabs 키(상업 이용 가능한 요금제). 비용은 글자 수 기준이라 이번 작업은 약 700자 분량이다. 마음에 안 드는
  줄을 다시 뽑을 여유를 두면 1,000자 안팎.

## 순서

1. 목록 확인: `node scripts/dealer/gen-voice.mjs --dry` → "25 to record"가 나와야 한다.
2. 키를 넣고 녹음한다.
   - PowerShell: `$env:ELEVENLABS_API_KEY="키"; node scripts/dealer/gen-voice.mjs`
   - bash: `ELEVENLABS_API_KEY=키 node scripts/dealer/gen-voice.mjs`
   - 스크립트가 알아서 하는 것: 25줄만 받아서 다듬고(앞뒤 무음 제거, 음량 맞춤) `public/voice/`에 넣고,
     `manifest.json`의 길이와 `scripts/dealer/voice-texts.json`(녹음한 문장)을 갱신하고, `lines.ts`의
     `VOICE_PENDING` 목록을 비운다.
3. 들어 보기: `public/voice/<id>.ogg`를 몇 개 재생하거나, `npm run dev`로 한 판 해 본다.
   - 어떤 줄이 마음에 안 들면: `scripts/dealer/.cache/voice/<id>.mp3`를 지우고, 그 id를 `lines.ts`의
     `VOICE_PENDING`에 다시 넣은 뒤 2번을 다시 돌린다. 그 줄만 새로 받는다.
   - 문장 자체를 고치고 싶으면 `lines.ts`에서 문장을 고치고 그 id를 `VOICE_PENDING`에 넣는다.
4. 확인: `npm run typecheck` 와 `npx vitest run src/ui/dealer` 가 통과해야 한다.
5. 커밋하고 푸시한다. `[skip ci]` 없이 푸시하면 APK가 만들어진다.

```sh
git add public/voice scripts/dealer/voice-texts.json src/ui/dealer/lines.ts
git commit -m "voice: record the 25 pending dealer lines"
git push origin main
```

## 안전장치

- 대사 문장을 고치면서 `VOICE_PENDING`에 넣는 걸 잊으면 단위 테스트가 실패한다. 녹음된 문장
  (`voice-texts.json`)과 지금 문장이 다르기 때문이다. 이번에 찾은 `explain.sets.1` 같은 일이 다시 생기지 않는다.
- 녹음 안 된 줄은 글자로만 나오고, 옛 녹음 파일이 남아 있으면 테스트가 실패한다.
- 원본 MP3 캐시(`scripts/dealer/.cache/`)가 없는 PC에서도 25줄만 받는다. 이미 녹음된 232줄은 건드리지 않는다.
  모든 줄을 다시 받는 것은 `--all`일 때뿐이다(크레딧을 전부 쓴다).

## 같이 하면 좋은 것 (선택)

- **우는 판매 컷인의 흐느낌 소리**: 지금은 합성음(`sob`)이다. 녹음 효과음으로 바꾸려면 `scripts/sound/gen-sound.mjs`에
  프롬프트를 넣고 `src/ui/audio/sfx.ts`의 `SYNTH_ONLY_SFX`에서 빼는 작은 코드 수정이 필요하다. 원하면 미리 해 둔다.
- **ElevenLabs 상업 이용 증빙**: `docs/RELEASE.md` 체크리스트 항목. 요금제 화면을 캡처해 보관한다.

## 25줄

| id | 대사 |
|---|---|
| game.start.3 | 머니폴리에 오신 걸 환영해요! 누가 제일 큰 부자가 될까요? |
| explain.sets.1 | 여기는 내가 산 땅이에요! 같은 색을 모두 모으면 통행료가 두 배, 금색 테두리는 다 모은 색이에요. |
| explain.takeover.1 | 통행료를 낸 뒤엔 그 땅을 웃돈 주고 인수할 수 있어요. 명소는 안 돼요! |
| landmark.done.1 | 와아! 명소 완성! 이제 아무도 이 땅을 빼앗을 수 없어요! |
| landmark.done.2 | 드디어 명소! 이 도시의 자랑이 탄생했어요! |
| festival.grand.2 | 대축제예요! 통행료가 더 크게 뛰었어요! |
| news.tollFever.1 | 뉴스 속보! 이번 라운드는 통행료가 두 배예요! 조심조심! |
| news.quake.1 | 뉴스 속보! 지진이에요! 건물들이 흔들려요! |
| news.buildBoom.1 | 뉴스 속보! 건설 붐! 이번 라운드는 건설비가 반값이에요! |
| news.takeoverSale.1 | 뉴스 속보! 인수 세일! 이번 라운드는 인수가 싸요! |
| news.shareDay.1 | 뉴스 속보! 나눔의 날이에요! 1등이 꼴찌에게 돈을 나눠요! |
| news.vaultBoom.1 | 뉴스 속보! 기부함이 두 배로! 출발 칸에 딱 멈추면 대박이에요! |
| bonus.card.1 | 더블 보너스! 카드 한 장 더 뽑아요! |
| comeback.offer.1 | 역전 찬스! 꼴찌에게만 오는 특별한 카드예요! |
| card.swap.1 | 땅 맞교환 카드! 상대의 도시를 노려 봐요! |
| card.raid.1 | 선두 습격! 1등의 지갑을 털어요! |
| swap.pick.1 | 어느 도시를 가져올까요? 비싼 도시가 좋겠죠? |
| swap.done.1 | 맞교환 성공! 땅 주인이 바뀌었어요! |
| gamble.advice.roll.1 | 모 아니면 도! 지금은 주사위에 걸어 볼 만해요! |
| gamble.advice.pay.1 | 지금은 안전하게 세금을 내는 게 좋겠어요. |
| gamble.win.1 | 면제! 세금이 한 푼도 안 나갔어요! |
| gamble.lose.1 | 아이고, 세금이 두 배! 기부함만 신났네요! |
| winback.advice.1 | 빼앗긴 땅을 되찾을 기회예요! 지금은 반값이에요! |
| winback.done.1 | 되찾았어요! 역시 내 땅은 내 땅! |
| jackpot.win.1 | 기부함 잭팟! 쌓인 돈을 몽땅 가져가요! |
