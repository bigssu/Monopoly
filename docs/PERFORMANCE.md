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
