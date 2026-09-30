# 성능 (Performance) — 작업 로그

> 이 문서는 작업 중 컨테이너 재시작에 대비해 단계마다 갱신되는 **실행 로그**로 시작한다.
> 최종 정리(방법론, 전/후 표, 변경 사항, 재실행 방법, 남은 비용)는 작업 완료 시 아래에 채운다.

## 기준선 (baseline, 이전 에이전트 측정 — 4× CPU 스로틀, DPR 2, 1600×1000)

| 항목 | 값 |
|---|---|
| Long task | 44건 (100 ms 초과 29건, 최대 630 ms) |
| 100 ms 초과 프레임 | 28 |
| Paint / Raster | 61/s / 143/s |
| 레이어 수 (중앙값) | 36 |
| Title 레이어 메모리 | 173 MB |
| DOM 노드 (16턴) | 1360 → 1872 |
| 부팅 (Title까지) | ≈ 6 s |

상세 레이어 보고서: `docs/assets/perf-render-baseline.json` (`scripts/perf-render.mjs`).

## 이미 커밋된 작업 (이전 에이전트)

- `eabce4e` 30 Hz 애니메이션 클럭(`src/ui/fx/time.ts`), 패널/레이어 페인트 수정, 글꼴 서브셋
  (`public/fonts/app`, `scripts/subset-fonts.py`), Android `preferredRefreshRate`, 절전 모드 토글.
- `b29a2d4` 30 Hz 계단식(step) Web Animations 래퍼(`src/ui/fx/quantize.ts`) + 테스트.

## 단계별 로그

- **1단계** — 이 로그 파일 생성, `npm run perf` 스크립트 등록. typecheck / test(151) / build 통과 확인.
- **2단계** — 측정 재확인(현 상태): idle B는 메인 스레드 기준 이미 통과(0 Layout/Paint/Raster)지만
  Title/게임/Result 모두 합성기(compositor)가 무한 장식 애니메이션 때문에 ~30 DrawFrame/s를 계속 그림.
  cap: 절전 on 34.5 fps(목표 26–34 초과), off 59.2 fps. play(60 s): p99 16.8 ms, 33 ms 초과 프레임 26개, 최대 133 ms.
  → `src/ui/fx/ambient.ts` 추가: 스타일시트의 `infinite` 장식 애니메이션을 시작 시점에 반복 횟수로 제한해
  마지막 입력 후 ~10 s에 끝나게 함(짧은 루프는 반복 경계=정지 자세, 4 s 초과 느린 드리프트는 `fill: forwards`로 자세 유지).
  타이머 없음. pointerdown/keydown 시 다시 10 s 연장(끝난 것은 멈춘 자리에서 재개). `lr-shake`(주사위 흔들기)는 제외.
- **3단계** — 주사위를 CSS 3D(preserve-3d, 면마다 GPU 레이어 → 주사위 2개에 레이어 16개)에서
  **정사영 2D 큐브**로 교체(`src/ui/stage/Dice.ts` `cubeFaces`): 각 면을 2D `matrix()`로 투영하고 뒷면은 숨김,
  옆면은 법선에 따라 살짝 어둡게. 굴림 중 회전은 공용 30 Hz 클럭(`onFrame`)으로 갱신, 튀어오름은 기존 WAAPI.
  대기 화면 레이어 31 → 12(장식 애니메이션 정지 후 6), 레이어 메모리 103 → 99 MB(정지 후 49 MB).
