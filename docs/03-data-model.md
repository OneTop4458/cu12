# Data Model

## Core Tables

1. `User`
   - 인증 대상 사용자
2. `InviteToken`
   - 초대코드 해시/만료/사용 여부
3. `Cu12Account`
   - CU12 ID, 암호화 비밀번호, 캠퍼스, 상태
4. `JobQueue`
   - 비동기 작업 큐(SYNC/AUTOLEARN 등)
5. `WorkerHeartbeat`
   - 워커 생존 체크

## Snapshot Tables

1. `CourseSnapshot`
   - 강좌별 진도/기간/남은일
2. `CourseNotice`
   - 강좌 공지 제목/본문/읽음상태
3. `NotificationEvent`
   - 알림 항목(공지/온라인강의/글)
4. `LearningTask`
   - C01 학습 태스크(주차/차시/필요시간/학습시간)
5. `LearningRun`
   - 자동수강 실행 결과

## Mail Tables

1. `MailSubscription`
2. `MailDelivery`

## Key Constraints

- `CourseSnapshot`: `(userId, lectureSeq)` unique
- `CourseNotice`: `(userId, lectureSeq, noticeKey)` unique
- `NotificationEvent`: `(userId, notifierSeq)` unique
- `LearningTask`: `(userId, lectureSeq, courseContentsSeq)` unique

## Notes

- 토큰/패스워드는 평문 저장 금지
- 큐 payload/result는 JSON으로 저장
