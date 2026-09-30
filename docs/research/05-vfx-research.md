# 05. VFX 연출 리서치 — Lot & Roll (랏앤롤): 유사 게임 · 기술 옵션 · 에셋 파이프라인

> 작성일: 2026-09-30. 목적: 제품 오너 요청 "구매·건설·통행료·인수·명소 완성·축제·출발·무인도·카드·파산·승리 같은 순간을
> **2D 스프라이트 시트 + 파티클 애니메이션**으로 역동적이고 축하하는 느낌으로" 만들기 위한 근거 자료.
> 실행 가능한 설계 명세는 `docs/VFX.md`. **코드는 바꾸지 않았다**(`src/`는 다른 에이전트가 수정 중). 프로토타입·벤치는 스크래치 디렉터리에서만 돌렸다.
>
> **근거 표기** (`04-engine-options.md`와 동일 규칙 + 측정 태그)
> - **[V]** 실제로 fetch/소스 열람/명령 실행으로 직접 확인 (npm registry, `raw.githubusercontent.com`, 설치한 패키지 소스·번들, 이 저장소 파일).
> - **[S]** 웹 검색 결과 요약(스니펫)에만 근거. 원문 확인 실패.
> - **[K]** 작성자의 배경 지식/추정. 스파이크로 검증 필요.
> - **[M]** 이 세션에서 직접 만든 벤치·프로토타입으로 측정한 값(재현 방법 명시).
>
> **조사 한계(중요)**: 샌드박스 프록시가 `blakecrosley.com`, `wayline.io`, `infovore.org`, `mariowiki.com`, `pixijs.com`, `en.wikipedia.org`,
> `fandom.com`, `gamemeca.com`, `gamedeveloper.com`, `dragon-quest.org`, `developer.mozilla.org` 등을 차단했다(WebFetch `EGRESS_BLOCKED`).
> 열린 곳은 `raw.githubusercontent.com`과 npm registry 정도. 따라서 **게임별 연출 상세(프레임 단위 시간, 카메라)는 대부분 [S]/[K]**이며,
> 표의 "시간/수치"는 레퍼런스에서 관찰된 *구조(비트 순서)* 를 우리 30 fps 예산에 맞춰 환산한 **설계 값**이다. 실제 영상 비교(프레임 단위 캡처)는
> 접근 가능한 환경에서 후속 확인을 권한다(§7 후속 과제).

---

## 0. 결론 (TL;DR)

| 항목 | 결론 |
|---|---|
| **권장 기술** | **(b) 자체 경량 Canvas2D 스프라이트/파티클 엔진** — 프리베이크한 아틀라스 2장(색 고정 `fx-color` + 흰색 마스크 `fx-mask`)을 `drawImage`로 그리고, 기존 30 Hz 클럭(`onFrame`)에 얹는다. **오버레이 캔버스는 1장**, 이펙트가 살아 있을 때만 DOM에 노출·프레임 등록, 끝나면 숨김+백킹 스토어 해제(유휴 0). |
| **왜 Pixi가 아닌가** | 트리셰이킹 후에도 **≈109 KB gz**(현재 앱 JS 95 KB gz의 1.15배 추가) [V], 두 번째 GPU 컨텍스트·컨텍스트 로스트 경로·셰이더 컴파일 부담, 그리고 우리 게이트(≤300 파티클, 30 fps)에서는 Canvas2D로 충분 [M]. 대신 렌더러를 인터페이스 뒤에 두어 **Pixi 백엔드로 교체 가능**하게 설계(§2.7 에스컬레이션 조건). |
| **비용 결정 요인** | 이 환경(소프트웨어 GL)에서 **캔버스 면적 × 백킹 스케일**이 비용을 지배(2× 백킹은 fps를 절반으로) [M]. 파티클 수(100→300)는 거의 영향 없음. → *면적 예산(≤0.9 MP) + 리전 캔버스 + 유휴 시 해제* 가 핵심 규칙. |
| **에셋** | 원본 SVG 절차 생성(JS 함수) → Playwright/Chromium으로 래스터 → 알파 트림 → `maxrects-packer`로 패킹 → **Chromium 자체 WebP 인코더**(네이티브 의존성 0)로 저장. 프로토타입 125프레임: **마스크 1024×1024 + 컬러 256×512 = 182 KB(WebP q0.9), PNG로는 434 KB** [M]. 목표 ≤500 KB 충족. |
| **Juice 핵심 수치** | 히트스톱 50–100 ms(2–3프레임), 쉐이크 3–12 px·200–480 ms 감쇠, 스쿼시 1.15–1.35 / 0.75–0.85, 오버슈트 easeOutBack ≈10 %, 스태거 25–70 ms, 금액 팝업 스케일 0.6→1.25→1.0, 임팩트 레이어링: 사운드+햅틱 t=0 → 플래시 20 ms → 파티클 50 ms → 텍스트 100 ms [S]. |
| **접근성** | WCAG 2.3.1(초당 3회 초과 점멸 금지) [S] → 엔진에 `flashBudget`. `prefers-reduced-motion`은 기존 `instant()`가 이미 처리 → 캔버스 미생성, 정적 표식 + 사운드 + 햅틱만. |

---

## 1. 유사 게임 연구

### 1.1 조사 범위와 신뢰도

| 게임 | 확인한 것 | 태그 | 이 연구에서의 쓰임 |
|---|---|---|---|
| Monopoly GO! (Scopely) | 개발팀이 "주사위 굴리기가 재미없으면 게임이 없다"는 원칙으로 코어 루프(주사위+이동)부터 완성, 주사위 물리 애니메이션과 **햅틱이 굴러가는 소리와 동기** | [S] fastcompany 2024 "Inside the addictive design…" | 주사위/이동/햅틱 동기 원칙 |
| | 랜드마크(보드당 5개)를 지어 보드 완성, 랜드마크 "완성" 보상, Bank Heist(철도 칸→금고 문 3개 매칭)/Shutdown(상대 보드에서 건물 부수기) 미니게임, 성공 시 "세 마리 돼지" 후속 연출 | [S] pockettactics, gamerant, lootbar | 파괴/인수 연출의 "타격→후속 리액션" 구조 |
| | 프레임 단위 연출(건물 업그레이드 이펙트, 스티커 버스트) 상세 | **미확인** [K] | 설계 값으로 대체 |
| 모두의마블 (넷마블) | 컬러 독점 시 통행료 2배, 건물 3개 후 랜드마크, **랜드마크 도시는 상대의 모든 공격에서 방어**, 라인 독점 승리, 캐릭터별 능력치(무인도 탈출·건설 할인·주사위 컨트롤 등) | [S] namu.wiki 규칙, 넷마블 공식 가이드, 언론 기사 | 랜드마크/독점의 "가치 표현" 방식 |
| | 통행료 팝업·캐릭터 리액션·랜드마크 완성 컷 연출의 시간/카메라 | **미확인** [K] (검색 결과에 연출 서술 없음) | 설계 값 |
| Board Kings (Playtika) | 매 칸 도착 시 코인 획득 → 시설 업그레이드, 친구 보드 습격, 아이돌 수집, 시간당 무료 주사위 | [S] App Store/Common Sense | 코인 흡수·수집 피드백 |
| Fortune Street / Itadaki Street | 상점 구매·투자(턴당 최대 999), 지역 독점 시 가치·통행료 상승, 뱅크 통과 시 승진 보너스(고정 급여+상점 가치 10 %+승진 보너스), 주식, 벤처 카드 | [S] mariowiki/dragon-quest.org 검색 요약 | "지역 완성 → 가치 상승" 표현 아이디어 |
| | 구매 컷신·NPC 반응 연출 | **미확인** [K] | 설계 값 |
| Rento Fortune / Business Tour | 나라 단위 구매, 경매, 운명의 룰렛 / 온라인 멀티 보드 | [S] digitallydownloaded, steam | 룰렛·경매 리액션은 범위 밖 |
| Monopoly Tycoon/Plus, Marble Blast류 캐주얼 | — | [K] | 원칙 수준만 |
| Balatro | 카드 스프링 바운스+유기적 회전, **점수 칩→배수 순으로 슬롯머신식 롤업**, 점수 크기에 비례하는 **화면 쉐이크(강도가 정보 채널)**, 칩 파티클 버스트, **상승 피치 노트 + 배수 전용 사운드** | [S] blakecrosley 가이드 검색 요약 | 에스컬레이션·피치 래더·쉐이크=크기 정보 |
| Candy Crush | 스페셜 캔디 조합 시 증폭 효과, 레벨 종료 **Sugar Crush**: 남은 스페셜이 좌상단부터 정해진 순서(코코넛 휠→UFO→랩→스트라이프→컬러밤→기타)로 연쇄 발동, 남은 이동 수당 6000점, 캐스케이드로 새 스페셜이 생기면 순서가 바뀜 | [S] candycrush.fandom 검색 요약 | 콤보/연쇄 큐 규칙, 피날레의 "정해진 순서 폭발" |
| Clash Royale | 상자 개봉: 시각+청각 "폭발", 상자마다 고유 애니메이션·사운드, 개봉 전 **기대감(희귀도별 글로우: 파랑=레어, 보라=에픽)** | [S] gamedeveloper "Deconstructing Clash Royale", 검색 요약 | 기대(anticipation) 단계 설계 |
| Vlambeer "The Art of Screenshake" | 권총 1발: 사운드 + 탄피 배출 2–4 px/프레임 + 카메라 킥 **6 px** + 쉐이크 **+4** 누적(빠르게 감쇠) + 총기 반동 2 | [S] itch.io/infovore 검색 요약 | 킥/쉐이크 수치 |
| Jonasson & Purho "Juice it or lose it" | 색 추가, 트위닝/이징, **스퀴즈&스트레치**, 사운드, "파티클은 아무리 많아도 지나치지 않다"(연기·파편·궤적), 스크린셰이크, 눈과 표정 | [S] rpgplayground/quinnipiac 요약 | 원칙 목록 |

### 1.2 이벤트별 레퍼런스 비트 구조 → 우리 적용

> 레퍼런스에서 **공통으로 관찰되는 4단계**: ① 기대(anticipation, 시선 유도·작은 예비 동작) → ② 임팩트(히트스톱·플래시·쉐이크·사운드 동시) → ③ 보상(payoff: 파티클 버스트·숫자 롤업·재화 흡수) → ④ 안정화(settle: 파티클 소멸·UI 확정 상태로 복귀).
> 아래 시간은 **30 fps(1프레임 = 33.3 ms)** 예산에 맞춘 *설계 값*이며, 레퍼런스 원자료의 측정값이 아니다([K]/[S] 원칙에서 환산).

| 순간 | 레퍼런스에서 가져올 구조 | 비트 (기대 → 임팩트 → 보상 → 안정) | 총 길이 | 무엇이 "기분 좋게" 하는가 |
|---|---|---|---|---|
| 부동산 구매 | Board Kings·Fortune Street: 구매 즉시 "내 것" 표식 + 코인 지불 / Monopoly GO: 소유 표시 | 버튼 탭 스퀴시(2f) → 소유 색 띠 와이프 + 링 + 반짝(t≈100 ms) → 코인이 패널에서 칸으로(5–8개) → 깃발/소유 띠 안착 | 0.7–1.0 s | 지불(재화 이동)과 소유(색 변화)를 **같은 순간에 묶어** 인과를 보여줌 |
| 건설 | 모두의마블/Monopoly GO: 별장→빌딩→호텔→랜드마크 단계 상승 | 망치 들어올림(4f) → 타격 + 히트라인 + 먼지 + 벽돌 조각(t=133 ms, 히트스톱 1f) → 건물 팝인(오버슈트 10 %) → 잔 먼지 소멸. 레벨이 오를수록 타격 횟수 1→3, 먼지·조각 증가 | 0.7–1.2 s | **타격 횟수 = 레벨**로 진행 상태를 몸으로 이해; 마지막 타격에서만 팝인 |
| 랜드마크 완성 | 모두의마블(랜드마크=방어·최고 통행료), Monopoly GO(랜드마크 완성 보상) | 화면 살짝 어둡게+집중(300 ms) → 왕관/건물 낙하 → 히트스톱 100 ms + 링 2겹 + 쉐이크 8 px → 광선 + 불꽃놀이 3발 + 색종이 + 도장 "명소 완성" | 1.8–2.2 s | 게임 내 **가장 큰 단일 순간** 중 하나 — 이 이상은 승리뿐이어야 함(에스컬레이션 천장) |
| 통행료 지불/수령 | Board Kings(코인 흡수), Balatro(숫자 롤업) | 지불자 패널 펄스 → 코인이 튀어오름(150 ms) → 호를 그리며 수령자 패널로 스태거 40 ms → 도착마다 작은 반짝+패널 범프 → 수령 숫자 롤업 | 0.9–1.4 s | 돈이 **눈에 보이는 궤적**으로 이동; 금액 크기 = 코인 수·쉐이크·피치 |
| 인수 | Monopoly GO Shutdown(상대 건물 타격→후속 리액션) | 경광등 스윕 2회(500 ms) → 도장 임팩트 + 히트스톱 100 ms + 쉐이크 8 px → 소유 색 와이프 → 2× 가격 코인이 구매자→판매자 | 1.6–2.0 s | 기대(경고) 구간이 있어야 임팩트가 "당했다/했다"로 읽힘 |
| 출발 통과 | Fortune Street 뱅크 승진(급여+보너스) | 출발 칸 별 폭발 → 돈주머니 팝 → 코인 샤워 → 패널로 흡수 + 숫자 롤업 | 1.2–1.6 s | 월급의 "안정적 보상 리듬" — 짧고 반복해도 피로하지 않게 I2 상한 |
| 축제 | 모두의마블 이벤트/Monopoly GO 이벤트 | 깃발 3개 팝 → 이전 축제 칸→새 칸 혜성 궤적 → 금빛 별 폭발 + 색종이 | 1.2–1.5 s | 표식 이동을 궤적으로 |
| 무인도 | — [K] | (3연속 더블이면 경광등) → 토큰이 혜성처럼 날아감 → 착수: 파랑 링 3겹 + 물방울 | 1.0–1.3 s | 부정적 이벤트도 **귀엽게**(공격적 X) |
| 카드 뽑기 | Clash Royale 상자(희귀도 글로우 기대감) | 카드 뒷면 글로우(톤별 색) → 뒤집힘 정점에서 반짝 6개 → 결과 후속 이벤트(돈/이동) | 0.7–1.0 s | 뒤집기 전에 **결과 톤을 미리 암시**(좋음=금, 나쁨=붉은 연기) |
| 파산 | Monopoly GO "돼지" 후속처럼 감정 리액션 | 패널 탈색·붉은 경광 → 히트스톱 100 ms + 연기 + 벽돌 파편 + 동전 쏟아짐 + 쉐이크 6 px | 1.6–1.9 s | 승리와 정반대 톤(무채색·가라앉음), 폭죽 없음 |
| 승리 | Candy Crush Sugar Crush(정해진 순서 연쇄), Clash Royale(폭발) | 왕관 낙하 → 승리 종류별 시그니처(트리플=3색 불꽃 순차, 라인=칸을 훑는 빛, 허브=4곳에서 로켓 수렴) → 색종이 대포 → 결과 화면으로 | 3.0–4.0 s | 종류마다 **다른 안무**로 재승리 동기 |

### 1.3 Juice 원칙과 수치 범위 (30 fps 환산 포함)

| 원칙 | 권장 범위 | 30 fps 환산 | 우리 값 | 태그 |
|---|---|---|---|---|
| **히트스톱**(임팩트 정지) | 50–100 ms 최적, 너무 짧으면 지각 불가·너무 길면 렉으로 오인. 연구상 최적 0.1–0.2 s(대형 타격), 슬로모 0.2–0.4 s | 2–3 f (대형 3–4 f) | I2 33 ms, I3 66–100 ms, I4 100 ms | [S] eastondev, scitepress/IEICE 논문 요약 |
| **스크린 쉐이크** | 작게(큰 쉐이크는 멀미), 급감쇠. 킥 6 px + 쉐이크 +4 누적(Vlambeer). 크기 정보 채널(Balatro) | 6–14 f | I2 3–4 px/240 ms, I3 8 px/360 ms, I4 12 px/480 ms; 회전 ≤0.3° | [S] Vlambeer/Balatro, 현행 `shake.ts`는 7 px×강도, 480 ms [V] |
| **스쿼시&스트레치** | 부피 보존: 늘림 1.15–1.35 / 눌림 0.75–0.85 | 2–4 f | 토큰 홉·건물 팝·코인 착지 | [K] (Jonasson/Purho 원칙 [S]) |
| **오버슈트 이징** | easeOutBack(c1=1.70158 ≈ 10 % 오버슈트) 또는 `cubic-bezier(0.175,0.885,0.32,1.275)` | — | 팝인·숫자 팝업 | [S] 검색 요약 |
| **기대(anticipation)** | 큰 동작일수록 길게, 코믹 톤 UI는 150–250 ms | 4–8 f | 망치 들어올림 133 ms, 인수 경광등 500 ms | [S] |
| **스태거 버스트** | 개체 사이 25–70 ms | 1–2 f | 코인 샤워 25 ms(현행), 코인 호 40–55 ms(현행 55 ms [V]) | [V] 코드 / [K] |
| **숫자 팝업** | 스케일 0.6→1.25→1.0 (250 ms), 40–70 px 상승·700–900 ms 유지 후 마지막 200 ms 페이드, 카운트업 500–900 ms(≈10 Hz 갱신 — 현행) | 8 f / 24 f | 패널 `float()`(현행 유지) | [K]; 현행 카운트업 ≈10 Hz [V] |
| **임팩트 레이어링** | 사운드+진동 *동시* → 플래시 +20 ms → 파티클 +50 ms → 부유 텍스트 +100 ms | 0 / 1 f / 2 f / 3 f | 모든 I2 이상 이벤트의 기본 타임라인 | [S] eastondev "game feedback feel" |
| **파티클 수** | 플래시류 20–30개·수명 0.5–1 s; "100개든 30개든 플레이어는 구분 못 하지만 기기는 안다"; 동시 10개면 300→20으로 줄이기 | — | 이벤트당 ≤ 등급별 상한, **전역 라이브 ≤ 300** | [S] pocketgamer.biz 검색 요약 |
| **피치 래더** | 연속 보상에서 반음씩 상승(Balatro "상승 피치 노트") | +1 semitone/단계, 최대 +7 | `sfx.play(name,{pitch: 2^(k/12)})` (`pitch`는 배율 [V]) | [S] |
| **화면 플래시** | 1–2 프레임 짧게, 알파 ≤0.25, 초당 3회 초과 금지 | ≤ 2 f | 엔진 `flashBudget` | [S] WCAG 2.3.1 |
| **트레일** | 6–10 샘플 잔상(가산 블렌드) | — | 코인 호·혜성 | [K] |
| **색 규칙** | 소유/행위자 색으로 반짝·링을 틴트; 금색은 "돈/보상" 전용 | — | 플레이어 8색 팔레트 [V: `palette.ts`] | [V] |

### 1.4 테이블탑(4좌석) 특유의 함의

- 화면이 테이블이라 **글자가 있는 연출은 행위자 좌석으로 회전**해야 하고(Stage가 이미 그렇게 함 — DESIGN §2.2 [V]), 나머지 3명에게는 **방향 없는 아이콘·색·숫자(자기 패널에서 회전된)**만 필요하다. → 캔버스 FX는 글자를 그리지 않고(폰트/i18n/회전 문제 회피), 숫자는 기존 패널 `float()`·Stage 카드에 맡긴다.
- 모바일 레퍼런스(1인 시점)와 달리 "카메라 연출"이 없다(보드는 고정, 회전하는 것은 Stage뿐). 카메라 킥은 `.table`+`.fx-layer` 동시 미세 쉐이크로 대체.

---

## 2. 렌더링 기술 옵션 비교

### 2.1 우리 게이트(하드 제약) 재확인 [V: `docs/PERFORMANCE.md`, `DESIGN.md`]

- 30 fps 상한(전역 30 Hz 클럭 `src/ui/fx/time.ts`, `onFrame` = rAF 루프 1개, 등록 스텝 없으면 정지).
- **유휴 0**: 사람 차례 대기 10 s 동안 Layout/Paint/Raster/rAF/timer 0.
- 레이어 피크 ≤ 20(현재 **17**), 피크 레이어 메모리 ≤ 100 MB(현재 **89 MB**) → **FX가 쓸 수 있는 여유는 레이어 3개·메모리 ~11 MB**.
- 파티클 DOM+WAAPI는 파티클마다 GPU 레이어(구 76개)라 폐기, 현재는 이펙트당 임시 `<canvas>` 1장, **소프트웨어 캔버스(`willReadFrequently`) + 1× 해상도**. 가속 캔버스는 GPU 없는 WebView/헤드리스에서 커밋마다 업로드 대기 15–50 ms를 만들었다 [V: PERFORMANCE.md §4.3·§7·9단계].
- 서드파티 아트 금지, 모든 아트 원본(SVG/JS 생성), 번들 크기·오프라인.

### 2.2 크기 실측 [V]

| 후보 | 번들 (raw / gzip) | 측정 방법 |
|---|---|---|
| **PixiJS v8.21.0** — `WebGLRenderer, Container, Sprite, Texture, Ticker, ParticleContainer, Particle` 만 import, esbuild `--minify` | **387 KB / 109 KB** | 스크래치에서 `npm i pixi.js@8` 후 esbuild. `import * as PIXI`(전체)는 910 KB / 262 KB. 메인 인덱스가 부작용(확장 등록)을 가져와 트리셰이킹 한계 — `package.json`의 `sideEffects` 목록 [V] |
| (참고) 현재 앱 JS | 311 KB / **95 KB** | `dist/assets/index-*.js` |
| lottie-web `lottie_light_canvas.min.js` | 203 KB / **54 KB** | 설치 후 파일 크기 |
| lottie-web `lottie_canvas.min.js` | 266 KB / 68 KB | 〃 |
| @rive-app/canvas-lite 2.43.1 | JS 434 KB / 94 KB + **WASM 882 KB / 360 KB** | 〃 (공식 문서 요약은 707 KB/222 KB brotli [S]) |
| @lottiefiles/dotlottie-web 0.80.0 | WASM 1.24 MB / **496 KB** (+JS) | 〃 |
| Phaser 4 (참고) | npm unpacked 112 MB [V], 런타임 min ≈ 1 MB+ [K] | `npm view phaser dist.unpackedSize` |
| 자체 Canvas2D 엔진 | 추정 6–9 KB gz | [K] (`particles.ts` 234줄 + 아틀라스/프리셋) |

Pixi 소스 확인 [V, 설치본 `pixi.js@8.21.0/lib`]:
- `ParticleContainer`의 **파티클은 한 텍스처 소스를 공유**(`container.texture || children[0].texture`), 블렌드 모드는 컨테이너 단위 → **블렌드 모드(normal/add)별로 컨테이너 1개 = 아틀라스당 최대 2 draw call**. `dynamicProperties` 기본값 `position:true, rotation/uvs/color:false` — 프레임 애니메이션(UV 변경)과 회전을 쓰려면 켜야 한다.
- 컨텍스트 로스트: `GlContextSystem`이 `webglcontextlost`에서 `preventDefault()` 후 `webglcontextrestored`에서 `contextChange` 러너를 발행(텍스처 재업로드) — 복구는 되지만 **복구 중 프레임은 우리가 처리**해야 한다.
- `Ticker`: `maxFPS`(0=무제한), `stop()`이 대기 rAF를 취소, `autoStart` 기본 false [V: raw.githubusercontent.com/pixijs/pixijs/dev/src/ticker/Ticker.ts]. 우리는 **Pixi Ticker를 쓰지 않고** `renderer.render()`를 우리 `onFrame`에서 직접 호출하는 것이 30 Hz 격자 정렬(`time.ts`의 위상 고정)과 맞다.
- v8 ParticleContainer 성능 주장: "MacBook Pro M3에서 스프라이트 20만 vs 파티클 100만 @60fps" [S: pixijs.com 블로그 요약] — 우리 규모(≤300)에서는 무의미한 여유.

### 2.3 실측 벤치 [M]

**환경**: Playwright + Chromium 1194 헤드리스, **SwiftShader(소프트웨어 GL)**, 4 vCPU 샌드박스(다른 작업과 공유 → 편차 ±20 %), 30 Hz로 제한한 프레임 루프, 64×64 셀 8×8 프로시저럴 아틀라스에서 **가산 블렌드** 스프라이트 N개가 회전·이동·프레임 전환, 측정 6 s(2.5 s 워밍업 뒤). 지표: 표시 fps(루프 실행 횟수/s), 메인스레드 `TaskDuration` ms/s(CDP `Performance.getMetrics`). 재현: 스크래치 `bench.html`/`bench.mjs`(본 문서의 부록에 요지).

| # | 조건 | Canvas2D SW(`willReadFrequently`) | Canvas2D 가속 | Pixi WebGL(ParticleContainer) |
|---|---|---|---|---|
| 1 | 1000², DPR1, 300개, 스로틀 없음 | 21.8 fps / 36 ms/s | — | 28.3 fps / 28 ms/s |
| 2 | 1000², **백킹 2×**, 300개 | **12.2** fps / 25 | 16.0 / 26 | 14.8 / 14 |
| 3 | 800² CSS, 백킹 2×, 150개, **4× 스로틀** | 15–17 fps / 69–118 | 15.2 / 72 | 16.5–18.8 / 52–54 |
| 4 | 800² CSS, **백킹 1×**, 150개, 4× | **27–28** fps / 117–119 | — | **29.5–29.7** / 80–92 |
| 5 | 1300² CSS(≈전체 테이블), 백킹 1×, 150개, 4× | 23.2 / 118 | — | 27.7 / 84 |
| 6 | 800² CSS, 백킹 1.5×, 150개, 4× | 19.2 / 80 | — | 24.0 / 67 |
| 7 | 400² CSS, 백킹 1×, 150개, 4× | **29.7** / 118 | — | — |
| 8 | 100개 vs 300개 @1000² DPR1 (스로틀 없음) | 25.6 vs 36 ms/s | — | 22.5 vs 28 ms/s |
| 9 | 캔버스 없음(유휴) | 메인 0.1 ms/s, GPU 프로세스 10 ms/s | | |

**읽는 법(이 수치는 절대값이 아니라 상대 비교용)**
1. **면적×백킹이 지배**: 같은 개수에서 백킹 2×(#2,#3)는 1×(#4)보다 fps가 절반. 캔버스를 400²로 줄이면(#7) 30 fps 회복. → **면적 예산 ≤0.9 MP, 백킹 스케일은 면적에 맞춰 0.75–1.5**.
2. **파티클 수는 2차 요인**: 100→300개(#8)는 메인 스레드 +10 ms/s 수준 → 상한 300은 안전.
3. **Pixi는 메인 스레드 20–30 %·GPU 프로세스 ~15 % 이득**(#4–#6)이지만 둘 다 우리 게이트 안이며, 이 환경은 GPU가 아니라 CPU로 GL을 흉내 내므로 **실기기 결론으로 일반화 불가** [K]. 실기기 스파이크에서 반드시 재측정.
4. 2011–2014년 자료: "Nexus 5 Chrome에서 WebGL 약 17,500 오브젝트 vs Canvas2D 360 오브젝트 @30fps" [S: html5gamedevs/Ashley Gullen 요약] — 오래된 수치지만 **Canvas2D의 상한이 수백 스프라이트**라는 점은 우리 상한(300)이 경계에 가깝다는 뜻. 상한 초과 시 Pixi 에스컬레이션(§2.7).
5. 해상도 규칙과 소프트웨어 캔버스 선택은 기존 발견(PERFORMANCE.md 9단계)과 일치.

### 2.4 옵션별 평가

가중치: 성능(게이트) 25 · 에셋 제작 15 · 아틀라스/드로콜 5 · 번들 15 · WebView 신뢰성 15 · 헤드리스 테스트 10 · 공수 15 = 100. 점수 1–5(5 최고), 합계는 (Σ w×s)/5.

| 기준 | (a) Pixi v8 WebGL 오버레이 | **(b) 자체 Canvas2D** | (c) Lottie/dotLottie | (d) Rive | (e) CSS/WAAPI만 | (f) Phaser/Cocos |
|---|---|---|---|---|---|---|
| **성능(유휴0·30fps·레이어)** | 4 — `ticker.stop()`/렌더 온디맨드 가능, +1 GPU 컨텍스트·텍스처 메모리 | 4 — 유휴 시 DOM 숨김·`onFrame` 미등록, 면적 예산 필요 | 2 — 프레임마다 벡터 평가(메인 스레드), 레이어(도형)가 많으면 급증 | 3 — WASM 렌더, 캔버스/WebGL2 | **1** — 파티클마다 레이어(구 76개 → 폐기) | 3 — 자체 게임 루프(30fps 캡·유휴0 별도 작업) |
| **AI 에이전트의 원본 에셋 제작** | 4 — `Spritesheet` JSON 표준, 틴트 무료 | 4 — 자체 JSON, 틴트 캐시 필요 | 2 — Bodymovin JSON 절차 생성은 가능하나 파티클 표현력↓, 디버깅 난이도↑ | **1** — `.riv`는 Rive 에디터 산출물(절차 생성 불가) | 3 — 인라인 SVG/CSS, 프레임 시트는 `steps()` | 3 |
| **아틀라스/드로콜** | 5 — 아틀라스당 ≤2 콜 | 3 — 스프라이트당 `drawImage`(콜 수 무관, 소규모) | 1 — 해당 없음 | 1 | 2 | 5 |
| **번들** | 2 — **109 KB gz** [V] | **5** — ≈6–9 KB gz [K] | 3 — 54 KB gz(light canvas) [V] | **1** — WASM 360 KB + JS 94 KB gz [V] | 5 | **1** — MB 급 |
| **Android WebView 신뢰성** | 3 — 컨텍스트 로스트/저사양 GPU/셰이더 컴파일, WebGL 오버레이는 보드 SVG와 별개 합성 | **5** — WebGL 없음, `particles.ts`로 이미 검증 | 4 | 3 | 5 | 3 |
| **헤드리스 테스트성** | 4 — SwiftShader로 동작 확인 [M], 픽셀 미세 편차 | **5** — 결정적 시드+`page.clock`, GPU 무관 | 3 | 3 | 4 | 3 |
| **공수** | 3 — 통합+로스트 복구+틱 연동 | 3 — 엔진 600–900 LOC(기존 `particles.ts`·`time.ts` 재사용) | 2 | 2 | 4 | **1** — 게임 루프 재작성(04 문서 비권장) |
| **합계 /100** | **69** | **84** | 50 | 43 | 66 (게이트 실패 플래그) | 50 |

- (e)는 총점은 높아도 "파티클을 DOM으로"가 **하드 게이트(레이어) 위반**이라 전체 FX용으로는 탈락. 다만 **소수 요소의 저비용 연출**(칸 펄스, 도장, 배너)은 기존 WAAPI 유지가 맞다.
- (c) Lottie를 절차 생성하려면 Bodymovin JSON(shape layer: `el`/`sr`/`rc`/`fl`/`st`/`tr` + 키프레임)을 JS로 출력하면 되지만, 표현 가능한 것은 도형 애니메이션에 한정되고 다수 파티클은 레이어 폭증. **하이브리드**(Lottie로 만든 벡터 애니메이션을 헤드리스에서 프레임 렌더해 아틀라스로 굽기)는 §3 파이프라인과 겹치므로 별도 도구를 늘릴 이유가 없다 [K].
- (d) Rive는 에디터 의존 + WASM 실행 파일 크기(우리 gz 총 앱 JS의 4–5배)로 제약 위반.
- (f) `04-engine-options.md`가 이미 Phaser/Cocos 비권장 결론.

### 2.5 권장: (b) 자체 Canvas2D 엔진, Pixi를 후속 옵션으로 열어둠

이유 요약: ① 번들 +6–9 KB(추정) vs +109 KB gz, ② 유휴 0과 30 Hz 격자를 **이미 있는 `onFrame` 하나로** 보장, ③ WebGL 컨텍스트 로스트·저사양 GPU·셰이더 컴파일이라는 신규 위험 클래스가 없음, ④ 헤드리스 결정적 테스트(GPU 무관), ⑤ 기존 `particles.ts`의 검증된 패턴(임시 소프트웨어 캔버스·1× 해상도·`isSkipping()` ×5)을 확장. 대가: 틴트/가산 블렌드/회전을 CPU 경로로 처리(틴트 캐시 필요), ≤300 파티클 상한.

### 2.6 오버레이 통합 설계 요지 (상세는 `docs/VFX.md` §3)

- 현행 DOM: `.game > .table(board(stageHost·tokenLayer z3·board-overlay z4) + 패널) , .fx-layer(z40, pointer-events:none) , .menu-slot(z30) , .rotate-overlay(z100)` [V: `game.css`, `board.css`, `view.ts`]. **프롬프트(Stage)는 `.table` 안에 있어 `.fx-layer`보다 아래** → "보드 위·프롬프트 아래"는 z-order로 불가능. 대신 *글자·버튼 영역을 가리지 않는 연출 설계*(pointer-events:none, 프롬프트 카드 위에서는 파티클 알파 저감 옵션)로 해결.
- 캔버스 1장: 살아 있는 이미터들의 **합집합 바운딩 박스(패딩)**를 리전으로, 면적 ≤0.9 MP가 되도록 백킹 스케일 0.75–1.5(DPR로 상한). 리전은 커지기만 하고 비면 숨김+해제.
- 좌석 회전: 캔버스는 화면 좌표. 방향성 스프라이트(망치·깃발·왕관)는 `SEAT_ANGLE`(S 0, E −90, N 180, W 90 [V: `util.ts`])로 회전, 승리 색종이 중력 방향은 승자 좌석의 "아래".

### 2.7 Pixi로 에스컬레이션할 조건 (사전 합의)

다음 중 하나라도 **실기기 트레이스**로 확인되면 렌더러 백엔드만 Pixi(ParticleContainer×2: normal/add)로 교체한다(프리셋·시퀀서는 그대로):
1. FX 중 메인 스레드 프레임당 JS가 6 ms(1×) 초과가 상시(파티클 ≤300 조건에서),
2. FX 중 표시 fps가 26 미만으로 3회 이상 재현,
3. 파티클 상한을 600 이상으로 올려야 하는 연출 요구가 생김.
교체 시 추가 작업: `webglcontextlost/restored` 처리(복구 시 살아 있는 이펙트 폐기 + 아틀라스 재업로드), `onFrame`에서 직접 `render`, `backgroundAlpha:0`, `powerPreference:'low-power'`, `antialias:false`, `resolution=min(dpr,1.5)`.

---

## 3. 에셋 파이프라인 조사

### 3.1 접근

1. **프레임 생성**: `scripts/fx/sprites.mjs`에 스프라이트마다 `svg(frameIndex, frameCount) => string`를 JS 함수로 정의(수학적 파라미터: 반경·불투명도·회전·이징). 코드가 곧 원본 소스이므로 AI 에이전트가 수정·재생성하기 쉽고 라이선스 문제가 없다(C4).
2. **래스터**: Playwright Chromium(`/opt/pw-browsers/chromium`)에서 SVG data URL → `Image.decode()` → `OffscreenCanvas` 스케일 래스터(기본 1.5×, 부드러운 스프라이트는 0.75×/0.5× 추가 축소).
3. **트림**: 알파>6 바운딩 박스로 잘라 아틀라스 낭비 제거(원본 셀 대비 오프셋 `x0,y0,W,H` 저장 → 그릴 때 앵커 복원).
4. **패킹**: `maxrects-packer@2.7.3` [V: npm view] (`smart`, POT, 패딩 2 px, 회전 없음). 색 고정 스프라이트와 **흰색 마스크 스프라이트를 별도 아틀라스**로(마스크만 런타임 틴트 캐시 대상).
5. **인코딩**: 같은 페이지에서 `OffscreenCanvas.convertToBlob({type:'image/webp', quality})` — **네이티브 의존성(sharp) 없이** Chromium의 WebP 인코더 사용. PNG도 함께 출력(디버깅·비교용).
6. **출력**: `public/fx/fx-color.webp`, `public/fx/fx-mask.webp`, `public/fx/fx-atlas.json`(프레임명→`{ax,ay,tw,th,x0,y0,W,H,k}`), 커밋해서 빌드에 Playwright를 요구하지 않게 함(결정적 재생성, CI에서 diff 검사).

### 3.2 프로토타입 결과 [M]

스크래치 `atlas/`에서 스프라이트 29종/**125프레임**을 절차 생성해 위 파이프라인으로 구웠다(스크립트 부록 참조).

| 아틀라스 | 프레임 | 크기 | 사용 픽셀 | PNG | WebP q0.9 | WebP q0.8 | 디코드 메모리 |
|---|---|---|---|---|---|---|---|
| 색 고정(`fx-color`) | 29 | 256×512 | 90 k | 86 KB | **34 KB** | 27 KB | 0.5 MB |
| 마스크(`fx-mask`) | 96 | **1024×1024** | 748 k (71 %) | 349 KB | **148 KB** | 142 KB | 4 MB |
| **합계** | 125 | — | — | **435 KB** | **182 KB** | 169 KB | 4.5 MB |

- 베이크 스케일 1.0(전부 1×)로 구우면 WebP **108 KB**(마스크 256×2048). 1.5× 베이크로 선명도를 확보해도 182 KB로 ≤500 KB 예산의 36 %.
- 마스크 아틀라스를 정사각 1024²에 넣을 수 있음(2048 미만, 구형 GPU 한계 2048 준수 [S]). 프레임이 늘면 1024×2048까지 여유.
- 한계: 프로토타입 스프라이트는 **품질 검증용 초안**(기하 도형+그라디언트). 최종 미술 품질은 §VFX.md의 스프라이트 목록을 기준으로 다듬어야 한다. 그리고 프로토타입에는 코인의 "₩", 지폐의 "$", 태그의 "SOLD" 같은 **문자**가 들어 있는데, 실제 명세는 *스프라이트에 문자 금지*(회전/i18n/통화 오해)로 정했다.

### 3.3 틴트·가산 블렌드로 프레임 재사용

- Canvas2D는 스프라이트별 틴트가 없으므로 **`(프레임, 색)` 틴트 캐시**: 마스크 프레임을 작은 캔버스에 그린 뒤 `globalCompositeOperation='source-in'`으로 색 채움 → 캐시. 캐시 항목 = 프레임 영역만(예: 파이어워크 프레임 96²×4 B ≈ 37 KB) → 플레이어 4색+금+흰 = 6색×자주 쓰는 60프레임 ≈ **10 MB 이하**(LRU 상한 8 MB).
- 가산 발광은 `globalCompositeOperation='lighter'`로 그리면 흰 마스크 + 색 틴트가 곧바로 글로우가 된다(광선·링·반짝·혜성·불꽃).
- 결과: 마스크 96프레임 × 색 N개를 **베이크하지 않고** 재사용 → 아틀라스 크기가 색 수와 무관.

### 3.4 파이프라인 위험

| 위험 | 완화 |
|---|---|
| WebP 손실 압축의 알파 가장자리 밴딩(부드러운 그라디언트) | 마스크는 q≥0.9, 시각 검토용 컨택트 시트(`docs/assets/fx-contact-sheet.png`) 생성 |
| 프리멀티플라이드 알파로 인한 어두운 테두리 | 패딩 2 px + 트림 임계값 6, `drawImage`는 비프리멀 소스에서 브라우저가 처리 [K] |
| Chromium 버전에 따른 래스터 미세 차이 → 재생성 시 diff | 아틀라스 산출물 커밋, CI는 크기/무결성만 검사(바이트 동일성 요구 X) |
| Android WebView WebP(알파) 지원 | Chromium 기반이라 지원 [K]; 스파이크에서 실기기 로드 확인 |

---

## 4. 접근성·안전 [S/V]

- WCAG 2.3.1: "1초 안에 3회 초과 점멸 금지, 또는 일반/적색 점멸 임계 이하" — 일반 점멸은 상대 휘도 10 % 이상 반대 변화 쌍, 적색 점멸은 포화 적색 쌍 [S]. → 엔진 `flashBudget`(1초 창 ≤3 플래시 프레임), 플래시 알파 ≤0.25, 큰 적색 플래시 금지(경광등은 스윕이지 점멸 아님, 초당 2 사이클 이하).
- `prefers-reduced-motion`: 현행 `time.ts`의 `instant()`가 이미 참 → 이 경우 FX 엔진은 캔버스를 만들지 않고 **정적 표식 1프레임**(칸 테두리 하이라이트 800 ms) + 사운드 + 햅틱만. 앱 내 절전 모드/애니 속도 0(테스트)도 `instant()`로 동일 취급.

---

## 5. 출처

**[V] 직접 확인**
- npm registry: `pixi.js 8.21.0`(unpacked 75.3 MB), `maxrects-packer 2.7.3`, `lottie-web 5.13.0`, `@rive-app/canvas-lite 2.43.1`, `phaser 4.2.1`(unpacked 112 MB), `@lottiefiles/dotlottie-web 0.80.0`, `sharp 0.35.5` — `npm view <pkg> version dist.unpackedSize`.
- Pixi 소스(설치본 `lib/`): `scene/particle-container/shared/ParticleContainer.mjs`, `ParticleContainerPipe.mjs`, `rendering/renderers/gl/context/GlContextSystem.mjs`; `package.json` `sideEffects`.
- https://raw.githubusercontent.com/pixijs/pixijs/dev/src/ticker/Ticker.ts (maxFPS/minFPS/stop/autoStart)
- 이 저장소: `docs/PERFORMANCE.md`, `docs/DESIGN.md`, `docs/research/04-engine-options.md`, `src/ui/fx/{time,particles,animate,shake,floats}.ts`, `src/ui/audio/{sfx,haptics}.ts`, `src/ui/game/{view,util,devhook}.ts`, `src/engine/types.ts`, `src/styles/{game,board,stage}.css`, `scripts/perf.mjs`.

**[S] 검색 요약**
- Monopoly GO: https://fastcompany.com/91150220/addictive-design-mobile-game-monopoly-go-scopely · https://www.pockettactics.com/monopoly-go/wiki · https://gamerant.com/monopoly-go-complete-fairytale-guide-shutdown-heist/ · https://www.lootbar.com/blog/en/monopoly-go-fairytale-shutdowns-and-heists-guide.html
- 모두의마블: https://namu.wiki/w/모두의마블 온라인/규칙 · https://modoo.netmarble.net/guide/Contents.asp?depth1=324&depth2=1501&depth3=3079 · https://www.smarttoday.co.kr/ko-kr/articles/51960
- Board Kings: https://apps.apple.com/app/1116488672 · https://www.commonsensemedia.org/app-reviews/board-kings
- Fortune Street: https://www.mariowiki.com/Fortune_Street · https://dragon-quest.org/wiki/Fortune_Street
- Rento/Business Tour: https://www.digitallydownloaded.net/2018/01/review-rento-fortune-sony-playstation-4.html
- Balatro 피드백 분석: https://blakecrosley.com/guides/design/balatro
- Candy Crush: https://candycrush.fandom.com/wiki/Sugar_Crush
- Clash Royale: https://www.gamedeveloper.com/business/deconstructing-clash-royale
- Juice: https://rpgplayground.com/research-making-a-juicy-game/ · https://mywebspace.quinnipiac.edu/jbwarren/archive/2018-410/class-04.html · Vlambeer: https://infovore.org/?p=5275 · 히트스톱/피드백 타이밍: https://eastondev.com/blog/en/posts/dev/20260521-game-feedback-feel/ · https://www.scitepress.org/Papers/2024/124614/124614.pdf
- 파티클 예산: https://www.pocketgamer.biz/vfx-optimisation-in-midcore-games-commonly-overlooked-techniques-and-advanced-methods/
- Pixi ParticleContainer v8: https://pixijs.com/8.x/guides/components/scene-objects/particle-container · https://pixijs.com/blog/particlecontainer-v8
- Canvas2D vs WebGL 스프라이트: https://www.html5gamedevs.com/topic/15186-canvas-mode-performing-better-than-webgl/ · https://lists.w3.org/Archives/Public/public-whatwg-archive/2014Aug/0038.html
- WebView WebGL 컨텍스트 로스트: https://groups.google.com/a/chromium.org/g/android-webview-dev/c/y7bfM9ldBTE · https://discourse.threejs.org/t/how-to-fix-context-lost-android-iphone-ios/56829
- Rive 런타임 크기: https://rive.app/docs/runtimes/runtime-sizes.md
- WCAG 2.3.1: https://blog.equally.ai/developer-guide/2-3-1-three-flashes-or-below-threshold/ · https://digitalaccessibility.nyu.edu/testing/sc231.html

**[K]** 배경 지식으로 기재: 각 레퍼런스 게임의 프레임 단위 연출, 스쿼시/스트레치 배율, 트레일 샘플 수, Canvas2D 엔진 번들 추정치, 실기기(Adreno/Mali) 성능 추정, Android WebView WebP 알파 지원, Playwright `page.clock`.

**[M]** 스크래치(세션 임시 디렉터리)에서 실측: 벤치(`bench.html`/`bench.mjs`), 아틀라스 프로토타입(`sprites.js`/`bake.mjs`). 저장소에는 넣지 않았다(요청: 코드 변경 금지) — 핵심 로직은 `docs/VFX.md` §5에 스케치로 수록.

---

## 6. 위험과 미검증 사항

| 위험 | 등급 | 대응 |
|---|---|---|
| 레퍼런스 게임의 프레임 단위 연출을 직접 못 봄 | 중 | 설계 값은 원칙 기반. 후속: 접근 가능한 환경에서 영상 프레임 캡처 대조 |
| 실기기(Android 태블릿) Canvas2D 성능 미측정 — 이 문서의 벤치는 SwiftShader 헤드리스 | **높음** | 스파이크 1순위: 3종 기기(저/중/고)에서 `adb shell dumpsys gfxinfo` + Perfetto로 FX 프리셋 스트레스 |
| 소프트웨어 캔버스(`willReadFrequently`)가 실기기에서는 가속 캔버스보다 느릴 수 있음 | 중 | 런타임 스위치 `fx.sw`(기본 on, PERFORMANCE.md 결론 유지), 기기 A/B 후 확정 |
| 4× 스로틀 프레임 지연 미달 항목(PERFORMANCE §7)과 FX 겹침 | 중 | FX 시작을 DOM 변경 다음 프레임으로 미루는 기존 `nextFrame` 패턴, 캔버스 리사이즈는 이펙트 시작 시 1회 |
| 레이어 여유 3개(17→20) | 중 | FX 캔버스 1장 + 쉐이크는 기존 레이어의 transform → 순증가 ≤1~2 |
| 기존 sfx 24종만으로 표현 한계 | 낮음 | `sparkle`, `whoosh`, `thud`, `fanfare-big` 추가 제안(옵션) |

## 7. 후속 과제

1. 실기기 스파이크(§6 1순위) 및 Pixi 백엔드 A/B(§2.7 조건 확인).
2. 접근 가능한 환경에서 Monopoly GO/모두의마블 영상 프레임 분석으로 §1.2의 시간 값 보정.
3. 스프라이트 최종 미술 다듬기 → 컨택트 시트 리뷰 → 아틀라스 확정.
4. FX 프리셋 스트레스 시나리오를 `scripts/perf.mjs`의 `fx` 페이즈로(명세는 `docs/VFX.md` §9).

---

## 부록 A. 벤치 하네스 요지 (재현용)

```js
// bench.html: ?mode=c2d-sw|c2d-gpu|pixi&dpr=&cs=(canvas backing scale)&n=&sz=(CSS px)
// c2d: getContext('2d', mode==='c2d-sw' ? {willReadFrequently:true} : {}); 매 33 ms: clearRect →
//      globalCompositeOperation='lighter' → N × (save/translate/rotate/scale/drawImage(atlas, 64x64 cell)/restore)
// pixi: new WebGLRenderer().init({resolution:cs, backgroundAlpha:0, antialias:false, powerPreference:'low-power'});
//       ParticleContainer({texture, dynamicProperties:{position,rotation,vertex,uvs:true}, blendMode:'add'});
//       Ticker.maxFPS=30, renderer.render({container})
// bench.mjs: chromium.launch(args:['--use-gl=angle','--use-angle=swiftshader','--enable-unsafe-swiftshader'])
//            CDP Emulation.setCPUThrottlingRate, Performance.getMetrics(TaskDuration), browser CDP SystemInfo.getProcessInfo
```

## 부록 B. 아틀라스 굽기 프로토타입 요지

```js
// 페이지 안에서: SVG → Image → OffscreenCanvas(W=ceil(w*SCALE*k)) → getImageData 알파 트림 → 트림 캔버스 보관
// Node: new MaxRectsPacker(1024, 1024, 2, {smart:true, pot:true, allowRotation:false}).addArray(rects)
// 페이지 안에서: 아틀라스 OffscreenCanvas에 drawImage → convertToBlob({type:'image/webp', quality:0.9})
```

---

## 8. 농장/마을 게임 건축·업그레이드 연출 리서치

> 작성일: 2026-09-30. 요청: 상위 농장/마을 빌더 모바일 게임이 **새 건물·업그레이드를 어떻게 무대화하는지**(비트 순서·대략의 시간)를 조사해 **연출 패턴만** 차용(아트·이름·에셋은 쓰지 않음)하고, 이를 Lot & Roll 제약(30 fps, 이벤트당 1–2.2 s, 라이브 파티클 ≤300, 아틀라스 30종, 탭 스킵, 4좌석 가독성)에 맞춰 적용한다. 적용 결과의 정본은 `docs/VFX.md` §7.2b. **코드는 바꾸지 않았다.**

### 8.0 조사 방법과 신뢰도 (중요)

- WebSearch 약 14회 + WebFetch 시도. **`fandom.com`(Hay Day/CoC/Township/Simpsons 위키), `pocketgamer.com`, `bluestacks.com`, `supercell.com`, `mobilegamer.biz`, `deconstructoroffun.com`, `wayline.io`, `afkgaming.com` 등은 프록시가 차단**(`EGRESS_BLOCKED`). 열린 페이지에서도 애니메이션 프레임/시간을 서술한 글이 사실상 없어, 검색 요약이 준 **기능적 사실**만 [S], 나머지 비트 구조·시간은 **작성자의 배경 지식 [K]** 이다.
- 따라서 표의 "근사 시간"은 **측정값이 아니라 30 fps 설계용 추정 범위**다(육안 기억 기반, ±30 %). 실기 영상 프레임 캡처로 후속 보정을 권한다(§8.7). 표기: **[V]** 직접 확인 · **[S]** 검색 요약 · **[K]** 배경 지식 · **[D]** 우리 설계 값.
- 검색으로 **확인된 사실(전부 [S])**:
  1. Township: 재료가 부족한 건물은 **목재 비계(scaffolding)로 둘러싸이고 노란 안전모 아이콘이 떠 있다**; T-Cash(프리미엄 재화)로 **스피드업** 가능.
  2. Hay Day: 업그레이드/건설은 **재료 공급 → (공급 시) 건물 위에서 톱이 앞뒤로 움직이는 애니메이션 → 타이머 0에서 건물 위에 초록 위쪽 화살표 → 탭하면 완공 → 짧은 애니메이션 재생**(요약 출처가 불분명해 신뢰도 낮음).
  3. The Simpsons: Tapped Out: 건설은 수 분–수 시간, **도넛(프리미엄 재화)으로 건너뛰기**; 완공 후 건물이 만드는 **아이콘을 탭하면 돈+XP가 자동 입금**되고, 수거 전에는 생산이 멈춘다.
  4. Clash of Clans: 빌더는 **빌더 오두막**에 산다; 연구소는 업그레이드 중 **입구에서 보라/파랑/빨강/노랑 빛**이 난다; 이벤트(Hammer Jam)는 건설비 50 %.
  5. Monopoly GO!: 보드마다 **랜드마크 5개**, 건설/업그레이드 때마다 **집 1채** 추가, 한 칸에 5채가 차면 **호텔**로 승급; 가장 높은 단계에서 방어(실드) 연계.
  6. Juice 일반: 오버슈트 이징으로 "팝", 이징-아웃으로 "안착", 보상에는 파티클을 아끼지 않되 **기기별로 상한**, 코인이 카운터로 스케일 업하며 들어가는 피드백.

### 8.1 게임별 비트 표 (근사 시간은 [K]/[D], 사실은 [S] 표기)

읽는 법: "시간"은 각 비트가 화면에서 차지하는 대략의 길이. 우리 30 fps 프레임 환산은 §8.3 표.

#### Hay Day (Supercell)

| # | 단계 | 무엇이 보이나 | 시간 | 태그 |
|---|---|---|---|---|
| 1 | 배치/구매 | 상점 목록 → 건물이 필드 위 "고스트"로 뜨고 드래그로 이동, 체크/취소 버튼(격자 스냅) | 탭 후 0.2 s 스냅 | [K] |
| 2 | 공사 시작 | 필요 재료 목록 패널 → 재료 아이콘 납품 시 **톱 왕복 애니메이션**이 건물 위에서 반복, 남은 시간 표시 | 반복 루프 0.5–0.8 s/사이클 | [S] 톱, [K] 시간 |
| 3 | 완공 팝 | 완공 시 **초록 위쪽 화살표**(수거 대기) → 탭 → 짧은 팝 애니메이션(스쿼시 바운스, 먼지, 반짝) | 팝 0.3–0.5 s | [S] 화살표/탭, [K] 나머지 |
| 4 | 업그레이드 | 저장고/기계 업그레이드: 재료 납품 → 즉시/짧은 대기 → 새 모델로 교체 + 반짝 | 0.4–0.8 s | [K] |
| 5 | 보상 | +XP 별이 좌상단 레벨 바로 호를 그리며 비행, 코인 수치 팝업 | 0.6–0.9 s | [K] |
| 6 | 유휴 생명감 | 동물/굴뚝/물레방아 상시 루프 | 상시 | [K] |

#### Township (Playrix)

| # | 단계 | 무엇이 보이나 | 시간 | 태그 |
|---|---|---|---|---|
| 1 | 배치 | 상점 → 배치 고스트(초록/빨강 셀), 확정 체크 | 0.2 s | [K] |
| 2 | 공사 | **목재 비계 + 노란 안전모 아이콘**(재료 부족 시); 재료 충족 시 진행 바/타이머, **스피드업 버튼(T-Cash)** | 상태 표시(정적) + 바 | [S] 비계·안전모·스피드업, [K] 바 |
| 3 | 완공 팝 | 비계가 사라지며 건물이 튀어나오는 팝, 별/반짝, XP·코인 아이콘 비행 | 0.4–0.7 s | [K] |
| 4 | 업그레이드 | 건물 스프라이트 교체 + 단계 표시(별/티어 숫자) | 0.4–0.8 s | [K] |
| 5 | 보상 | 커뮤니티 건물 완공 시 큰 팝업+보상 행 스태거 | 1.0–1.5 s | [K] |
| 6 | 유휴 | 시민 이동·굴뚝 연기·공장 애니메이션 상시 | 상시 | [K] |

#### Family Island

| # | 단계 | 무엇이 보이나 | 시간 | 태그 |
|---|---|---|---|---|
| 1 | 구매/해금 | 건물은 **재료(자원) 요구 단계**를 채워 건설; 단계마다 모델이 조금씩 자라남 | — | [S] 자원 요구, [K] 단계 외형 |
| 2 | 공사 | 단계별 납품 → 공사 애니메이션 → 완료 팝 | 0.5–1.0 s/단계 | [K] |
| 3 | 완공 팝 | 스쿼시 바운스 + 먼지 + 반짝, 에너지/코인/XP 아이콘 비행 | 0.4–0.7 s | [K] |
| 4 | 보상 | 퀘스트 보상 카드 스태거 팝 | 0.8–1.2 s | [K] |

#### FarmVille 2 / 3

| # | 단계 | 무엇이 보이나 | 시간 | 태그 |
|---|---|---|---|---|
| 1 | 배치 | 상점→배치 고스트→확정 | 0.2 s | [K] |
| 2 | 공사 | 건설 재료(부품) 납품 후 건물이 단계적으로 조립되는 연출 | 0.5–1.0 s | [K] |
| 3 | 완공 | 팝 + "+숫자" 플로팅(코인/XP) + 수확형 아이콘 | 0.4–0.6 s | [K] |
| 4 | 레벨업 | 모달: 배너 슬라이드 → 레벨 숫자 팝 → 해금/보상 스태거 → 계속 버튼 | 1.5–2.5 s | [K] |

#### Farm Heroes류 (농장 테마 매치3 / 별점 공개)

| # | 단계 | 무엇이 보이나 | 시간 | 태그 |
|---|---|---|---|---|
| 1 | 클리어 별점 | 별 1→2→3 순차 팝, 각 별에 반짝+상승 피치 사운드 | 별당 0.25–0.4 s | [K] |
| 2 | 점수 정산 | 남은 자원/이동 수가 하나씩 점수로 변환(피치 래더) | 1–2 s | [K] |
| 차용 | **티어 핍(★)** 순차 팝 + 피치 래더 | | | [D] |

#### Clash of Clans / Boom Beach (Supercell)

| # | 단계 | 무엇이 보이나 | 시간 | 태그 |
|---|---|---|---|---|
| 1 | 배치 | 건물을 그리드에 드래그, 초록/빨강 격자 표시, 체크 | 0.2 s | [K] |
| 2 | 공사 | **건설 부지**(먼지 낀 바닥·비계 모형) + **빌더가 망치질하는 루프**(빌더 오두막에서 나옴 [S]) + 남은 시간 바 + **젬 "즉시 완료"** | 망치 루프 0.6–0.9 s/사이클 | [S] 빌더/오두막, [K] 나머지 |
| 3 | 완공 팝 | 건물이 밝게 플래시→ 짧은 먼지·반짝 → "완료" 알림/빌더 복귀 | 0.4–0.6 s | [K] |
| 4 | 업그레이드 | 모델 교체 시 밝기 플래시(≈2f) + 새 레벨의 시각적 차이(테두리·깃발·금 장식) | 0.3–0.5 s | [K] |
| 5 | 최대 레벨 | MAX 표시(금색 이름표/별), 금 장식 모델 | 정적 | [K] |
| 6 | 연구소 등 | 업그레이드 중 **입구 발광(보라/파랑/빨강/노랑)** 지속 [S] | 지속 | [S] |

#### The Simpsons: Tapped Out

| # | 단계 | 무엇이 보이나 | 시간 | 태그 |
|---|---|---|---|---|
| 1 | 배치 | 상점→고스트→확정 | 0.2 s | [K] |
| 2 | 공사 | 공사 표지/천막 상태 + 카운트다운, **도넛으로 스킵** [S] | 수 분–시간 [S] | [S] 시간·도넛 |
| 3 | 완공 | 팝 + 캐릭터 리액션, 이후 **건물 위 아이콘 탭 → 돈+XP 자동 입금** [S] | 0.4–0.6 s | [S] 수거, [K] 팝 |
| 4 | 수거 | 탭 한 번에 코인/XP 아이콘이 상단 카운터로 비행 | 0.5–0.8 s | [S]/[K] |
| 차용 | **결과를 입금 카운터로** 보내는 흐름(우리는 "소유자 패널"로) | | | [D] |

#### Golf Clash류 "레벨업" 화면 (모달)

| # | 단계 | 무엇이 보이나 | 시간 | 태그 |
|---|---|---|---|---|
| 1 | 진입 | 배경 딤 + 배너 슬라이드 인 | 0.25–0.35 s | [K] |
| 2 | 숫자 팝 | 큰 레벨 숫자 scale 0→1.2→1.0 + 회전 광선(`ray`) 배경 | 0.3–0.5 s | [K] |
| 3 | 보상 행 | 보상 아이템이 좌→우 스태거 팝 (스태거 150–250 ms) + 반짝 | 0.6–1.0 s | [K] |
| 4 | 종료 | 계속 버튼 펄스, 탭으로 닫기 | 대기 | [K] |
| 차용 | 회전 광선 + 숫자 팝 + 보상 스태거 (숫자는 우리는 DOM) | | | [D] |

#### Monopoly GO! (비교 기준)

| # | 단계 | 무엇이 보이나 | 시간 | 태그 |
|---|---|---|---|---|
| 1 | 건설 선택 | 랜드마크(보드당 5개)를 골라 건설/업그레이드 [S] | — | [S] |
| 2 | 건설 | **건물 확대 컷**(카메라가 건물로 줌), 집이 한 채씩 추가되는 팝, 건물 파츠가 순서대로 올라감 | 1.5–2.5 s | [K](줌·팝), [S](집 1채 추가) |
| 3 | 5단계 완성 | 호텔/랜드마크 완성 시 큰 축하(화면 전체 이펙트) + 보드 진행 | 2–3 s | [S] 승급, [K] 연출 |
| 4 | 파괴/방어 | 실드가 건물을 지킴, 습격 시 타격 연출 | — | [S] |
| 차용 | **확대 컷 → 우리 "클로즈업 카드"**, 집 1채 추가 = 티어 핍 | | | [D] |

### 8.2 교차 패턴 (여러 게임에서 수렴) → 차용 결정

| 패턴 | 관찰(게임) | 우리 적용 | 비고 |
|---|---|---|---|
| P1 **배치 고스트→안착(plop)** | Hay Day, Township, CoC 공통 | L0 부지: 소유 색 후광→`sale_tag` 낙하·스쿼시 | 고스트는 후광으로 대체 |
| P2 **재료 납품** | Hay Day, Family Island, FarmVille | 패널→칸 코인 10f(납품) | 결제=납품이므로 도착 무음 |
| P3 **공사 상태 표시**(비계/헬멧/천막) | Township [S], CoC | 이전 아이콘 딤 + 망치 타격(정적 비계 스프라이트 없음) | 시간 대기 없음 |
| P4 **망치 루프** | Hay Day 톱 [S], CoC 빌더 | 타격 횟수 = 레벨(1/2/3/3) | 루프 대신 유한 타격 |
| P5 **먼지 구름 속 모델 교체** | CoC, Boom Beach, Township | 먼지 커튼 → swap cue | 상태 변경을 cue로 지연 |
| P6 **스쿼시 팝(오버슈트)** | 전 게임 | 8/10/12/15 % 티어 단조 증가 | §8.3 |
| P7 **반짝 레이어 누적** | CoC 금 장식, Township 별 | 흰→금→소유 색→프리즘 | 티어 언어 |
| P8 **티어 핍(★)** | Township 티어, Farm Heroes 별점 | ★1–3 → 크라운 | 순차 팝+피치 래더 |
| P9 **MAX 특별 표식** | CoC 금 표시 | `.landmark` 정적 글로우 + 크라운 | 상시 비용 0 |
| P10 **완공 후 보상 비행** | Simpsons, Hay Day, FarmVille | 별→소유자 패널(장식 코인은 낙하만) | 획득 아님을 구분 |
| P11 **레벨업 모달**(광선+숫자+보상 스태거) | Golf Clash류, FarmVille | 랜드마크의 `ray_burst`+스탬프+보상 레이어 | 모달 없음(탭 스킵 가능) |
| P12 **확대 컷** | Monopoly GO | 행위자 쪽 클로즈업 카드(L4) | 카메라 없음 |
| P13 **스피드업/탭 투 컬렉트** | Township, CoC, Simpsons, Hay Day | 탭 = 스킵(×5) | 타이머 자체가 없음 |
| P14 **상시 생명감 루프** | 전 게임 | **채택하지 않음**(유휴 0) — 꼬리에 유한 연기/깃발 | 게이트 B |

### 8.3 수렴한 "juice" 수치 범위와 우리 값 [K] 범위 → [D] 선택

| 항목 | 농장 게임 관찰 범위 | 30 fps 환산 | 우리 값 |
|---|---|---|---|
| 팝 오버슈트 | 8–15 % (easeOutBack) | — | L1 8 · L2 10 · L3 12 · L4 15 % (`c1` 1.5/1.70158/1.9/2.17) |
| 팝 길이 | 250–400 ms | 8–12f | 8/9/10/10f |
| 스쿼시 착지 | 1.2–1.35 / 0.75–0.85, 1–2f 유지 | 1–2f | (1.25, 0.82) ~ (1.3, 0.75) |
| 예비 동작(망치 들어올림) | 100–200 ms | 3–6f | 3f |
| 타격 간격 | 130–250 ms | 4–8f | 4–5f |
| 히트스톱 | 33–100 ms | 1–3f | L1–L3 1f, L4 3f, 인수 3f, 독점 2f |
| 먼지 링 | 6–12f, 파티클 3–8개 | — | 스트라이크당 1 + 커튼 1/3/6 |
| 반짝 스태거 | 30–60 ms | 1–2f | 1f |
| 코인/별 비행 | 500–800 ms, 스태거 40–80 ms | 15–24f | 납품 10f, 별 18f, 톨 720 ms(기존) |
| 색종이 | 40–80개, 수명 0.8–1.2 s | — | 60(명소), 40(독점), 수명 24–30f |
| 광선 | 0.6–1.0 s 회전 페이드 | 18–30f | 24f + 페이드 |
| 쉐이크 | 3–12 px, 200–480 ms | 6–14f | L2 2 · L3 3 · L4 8 · I4 12 px |
| 핍 스태거/피치 | 250–400 ms(별점) | 8–12f | 2f(66 ms) — 이벤트 길이 예산 때문에 단축 |
| 피치 래더 | 반음 +1–2/단계 | — | 0/+4/+7반음, 코인 도착 k=0..4 |
| 전체 길이 | 신규 건물 0.7–1.5 s, 레벨업 모달 1.5–2.5 s, 확대 컷 2–3 s | 21–75f | L0 0.9 · L1 0.8 · L2 0.9 · L3 1.2 · L4 2.0 s(+정지) |

### 8.4 "확실한 차이"와 적응

| 농장 게임 | 우리 제약 | 결정 |
|---|---|---|
| 건설 타이머(분–시간)·스피드업 과금 | 없음(즉시 확정) | 연출만; "빨리 감기" = 탭 스킵 ×5 |
| 상시 애니메이션(연기/동물) | 유휴 0 게이트 | 꼬리에 유한 생명감 + 정적 CSS 글로우 |
| 카메라 줌/컷 | 카메라 없음, 4좌석 | 행위자 쪽 Stage 클로즈업 카드(글자 없음) + `zoomPunch` |
| 큰 텍스트 배너 | 캔버스에 글자 금지 | 기존 Stage 스탬프(↻)만 |
| 화면 전체 풀스크린 모달 | 다른 3명이 기다림 | 이벤트당 ≤2.2 s, I3 동시 1개, 스킵 |
| 재화 카운터로 비행 | 소유자 패널로 | 별은 소유자 패널, 코인 샤워는 장식(획득 오해 방지) |
| 스프라이트 대량 | 아틀라스 30종·125프레임 | 티어는 색·수량·반경 변화로 표현(새 스프라이트 0) |

### 8.5 결과 요약 (VFX.md §7.2b)

- 건설 4막: **납품 → 공사(타격 N) → 먼지 속 swap → 팝·보상**; 레벨이 오를수록 레이어 1장 추가(소유 링 → 흰 반짝 → 금 반짝 → 소유 색 외곽 + 별·십자 → 광선·불꽃·색종이·크라운).
- 프레임: L0 27f(I2 33f), L1 24f, L2 27f, L3 36f, L4 58f + 정지 3f, 무료 26–31f, 인수 51f + 3f, 독점 50f + 2f. 스폰 총량 14–171(상한 I1 40 / I2 100 / I3 200).
- 코드 영향(구현 에이전트용): `Built`/`PropertyBought`/`TakenOver`의 `render()`를 cue 프레임으로 지연, `FxHandle.cue`, `.fx-closeup` DOM.

### 8.6 출처

**[S] 검색 요약이 근거 (원문 미확인, 프록시 차단·요약만)**
- Township 비계/안전모/T-Cash: https://en.wikipedia.org/wiki/Township_(video_game) · https://medium.com/@aarthi.design/playrixs-township-6418f4ce319d · https://township.fandom.com/wiki/Community_Buildings · https://www.deconstructoroffun.com/blog/2020/10/13/how-playrix-township-became-a-billion-dollar-game · https://www.gamepressure.com/games/township/za4a05
- Hay Day 업그레이드/완공 탭: https://en.wikipedia.org/wiki/Hay_Day · https://hayday.fandom.com (Hay Day wiki, 검색 결과) · https://mobilegamer.biz/what-supercells-hay-day-team-learned-from-ten-years-of-updates/
- Simpsons Tapped Out 수거/도넛: https://www.pocketgamer.com/the-simpsons-tapped-out/how-to-rebuild-springfield-the-simpsons-tapped-out-hints-tips-and-tricks/ · https://en.wikipedia.org/wiki/The_Simpsons:_Tapped_Out · https://www.giantbomb.com/games/3030-37630/
- Clash of Clans 빌더/연구소 발광: https://clashofclans.fandom.com/wiki/Builder · https://clashofclans.fandom.com/wiki/Laboratory · https://supercell.com/en/games/clashofclans/blog/release-notes/full-patch-notes-bb2
- Monopoly GO 랜드마크/집→호텔: https://afkgaming.com/gaming/general/buildings-landmarks-in-monopoly-go-all-you-need-to-know · https://www.pockettactics.com/monopoly-go/wiki
- Family Island 자원·건설: https://www.bluestacks.com/blog/game-guides/family-island/fifg-beginner-guide-en.html · https://www.mumuglobal.com/blog/family-island-beginner-guide.html
- Juice 일반: https://www.wayline.io/learn/game-feel/1 · https://www.wayline.io/blog/shake-spark-sound-level-up-your-game-feel · https://gamedeveloper.com/design/3-game-juice-techniques-from-slime-road · https://slicker.me/python/game_feel_pygame.htm

**[V] 이 저장소**: `docs/VFX.md` §4·§6·§7·§12, `src/ui/audio/sfx.ts`(SfxName), `src/ui/audio/haptics.ts`(HapticKind), `src/ui/audio/synth.ts`(THROTTLE 40 ms 기본), `src/ui/fx/animate.ts`(`Built`/`PropertyBought` 현행 분기), `public/fx/atlas.json`(30종 프레임·fps: `dust_puff` 8f@20, `glint_sweep` 8f@24, `star_burst` 8f@24, `ring_shock` 6f@24, `firework` 12f@20, `smoke` 8f@15, `flag_wave` 6f@10, `hit_lines` 4f@24, `stamp_splat` 5f@24, `comet` 8f@20).

**[K]** 각 게임의 프레임 단위 연출 시간/구조 전부(표의 [K] 표기 항목).

### 8.7 한계·후속

| 한계 | 대응 |
|---|---|
| 게임별 프레임 시간이 [K] | 접근 가능한 환경에서 플레이 영상 캡처(60 fps) → 비트별 프레임 카운트로 §8.3 보정 |
| 검색 요약 [S]의 출처 신뢰도 편차(Hay Day 톱/화살표 요약은 출처 불분명) | 위키/공식 가이드 원문 대조 |
| 30종 스프라이트만 사용 — 비계/공사 표지 스프라이트 없음 | v2 후보 `scaffold`(1f), `crane_hook`(§4) 추가 시 공사 상태 표현 강화 |
| 클로즈업 카드는 레이어 +1 | 실기기 레이어 측정 후 L3/인수 확대 여부 결정 |
