# AGENTS Playbook

## 목적

- CU12 자동화 프로젝트에서 작업 방식과 운영 기준을 일관되게 유지한다.
- 코드 변경 시 문서/API/워크플로를 같이 갱신한다.

## 아키텍처 요약

1. `apps/web`: Next.js API + UI (Vercel 배포)
2. `apps/worker`: Playwright 워커 (GitHub Actions 실행)
3. `packages/core`: 공용 타입/파서
4. `prisma`: PostgreSQL(Neon) 스키마
5. `.github/workflows`: CI/CD, 스케줄 동기화, 워커 실행, Dependabot 자동화

## 인증 모델

1. 로그인은 CU12 계정으로 매번 실검증한다.
2. 신규 사용자는 최초 1회 초대코드 검증이 필요하다.
3. 초대코드는 `cu12Id`에 바인딩되며 1회 사용 후 만료된다.
4. 회원가입 페이지(`invite/accept`)는 사용하지 않는다.

## 필수 명령어

```bash
npm install
npm run prisma:generate
npm run typecheck
npm run build:web
```

## 배포/운영 기본 순서

1. DB 반영: `DB Bootstrap` 또는 `npm run prisma:push`
2. 신규 환경 초기화: `Auth Reset Bootstrap` 실행 후 관리자 초대코드 확보
3. 웹 배포: Vercel 프로덕션 배포 (`apps/web`)
4. 워커 실행: `worker-consume.yml` 수동/스케줄 실행
5. 상태 확인:
   - `/api/health` 200
   - 최근 `Worker Consume` 성공

## 변경 시 체크리스트

1. 코드 변경과 문서 변경 동시 반영 (`docs`, `README`)
2. API/스키마 변경 시 `docs/04-api/openapi.yaml` 갱신
3. `npm run typecheck` 통과
4. 필요 시 `npm run build:web` 통과
5. 워크플로/시크릿 영향 범위 명시

## 금지 사항

- 운영 DB에 임의 SQL 직접 수정(공식 절차 없이)
- 실패 원인 분석 없이 동일 워크플로 무한 재실행
- 민감정보(비밀번호/토큰) 로그 출력

## 장애 대응 가이드

- 워커 실패:
  1. `gh run view <run_id> --log-failed`로 실패 스텝 확인
  2. `APP_MASTER_KEY`, `DATABASE_URL`, `WEB_INTERNAL_BASE_URL` 확인
  3. 수정 후 `worker-consume.yml` 재실행
- Vercel 404:
  1. Root Directory=`apps/web` 확인
  2. 환경변수 확인 후 재배포
  3. `/api/health` 확인
