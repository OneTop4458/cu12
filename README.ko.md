# CU12 자동화

이 저장소는 가톨릭 공유대(CU12) 수강 현황 모니터링과 자동 수강을 클라우드 환경에서 운영하기 위한 프로젝트입니다.

## 빠른 개요

- 웹 콘솔에서 강좌/공지/작업 상태를 확인합니다.
- 워커가 CU12에 로그인해 동기화 및 자동 수강을 수행합니다.
- 작업 큐와 스냅샷은 PostgreSQL에 저장됩니다.
- 워커 실행은 GitHub Actions로 디스패치됩니다.

## 빠른 시작

```bash
npm install
npm run check:text
npm run check:openapi
npm run prisma:generate
npm run typecheck
npm run build:web
```

## 초기 운영 순서

1. GitHub Secrets 설정
2. Vercel 환경변수 설정
3. `DB Bootstrap` 실행
4. 신규 환경이면 `Auth Reset Bootstrap` 실행 후 관리자 초대코드 발급
5. 웹 배포 후 `/api/health` 확인
6. 관리자 로그인 후 사용자 초대코드 발급

## 자세한 문서

- 기본 문서는 영어(`README.md`, `docs/*`)를 기준으로 유지합니다.
- 한국어 요약은 이 파일(`README.ko.md`)에서 제공합니다.
