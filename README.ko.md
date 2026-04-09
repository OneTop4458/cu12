# CU12 자동화

CU12 자동화는 CU12 자격 증명을 검증하고, 강의/공지 상태를 추적하며, 큐 기반 자동 학습 작업을 클라우드 환경에서 실행하는 서비스입니다.

## 빠른 시작

```bash
corepack enable pnpm
pnpm install --frozen-lockfile
pnpm run prisma:generate
pnpm run check:text
pnpm run check:openapi
pnpm run typecheck
pnpm run test:web
pnpm run test:ops
pnpm run build:web
```

- `pnpm-lock.yaml` 또는 Node 버전이 바뀌지 않았다면 worktree마다 매번 재설치하지 말고 기존 설치를 재사용합니다.
- `prisma/schema.prisma` 또는 Prisma 모델 사용 코드가 바뀌면 `pnpm run prisma:generate`를 다시 실행합니다.

## Codex 작업 흐름

- Codex가 linked worktree에서 실행 중이면 `pnpm run ai:start -- --task "<task-slug>"` 는 현재 worktree에서 `ai/session-<thread-id>` 브랜치를 만들거나 재사용합니다.
- 이 기본 흐름에서는 저장소 내부에 또 다른 `.worktrees/session-*` 를 만들지 않습니다.
- 수동 병렬 작업이 정말 필요할 때만 `pnpm run ai:worktree -- --task "<task-slug>"` 를 사용합니다.
- 작업이 끝나면 `pnpm run ai:clean` 으로 병합된 repo-local worktree, stale lock, 불필요한 `ai/*` 브랜치를 정리합니다.

## 운영 시작 순서

1. GitHub Secrets 와 Vercel 환경 변수를 설정합니다.
2. `DB Bootstrap` 워크플로우를 실행합니다.
3. 새 환경이면 `Auth Reset Bootstrap` 을 실행해 관리자 초대 코드를 준비합니다.
4. 웹을 배포하고 `/api/health` 를 확인합니다.
5. `worker-consume.yml` 을 한 번 실행해 큐 처리와 작업 흐름을 검증합니다.

## 문서

- 기본 문서는 영어(`README.md`, `docs/*`)를 기준으로 유지합니다.
- 한국어 요약은 이 파일(`README.ko.md`)에만 둡니다.
