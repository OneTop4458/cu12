# Data Model

## Core Tables

1. `User`
   - 서비스 사용자
   - `role`: `ADMIN` | `USER`
2. `InviteToken`
   - `cu12Id` 바인딩 초대코드
   - 해시(`tokenHash`), 만료(`expiresAt`), 사용 시각(`usedAt`)
3. `Cu12Account`
   - CU12 ID, 암호화 비밀번호, 캠퍼스, 상태
4. `JobQueue`
   - 비동기 작업 큐(`SYNC`, `AUTOLEARN` 등)
5. `WorkerHeartbeat`
   - 워커 생존 체크

## Snapshot Tables

1. `CourseSnapshot`
2. `CourseNotice`
3. `NotificationEvent`
4. `LearningTask`
5. `LearningRun`

## Mail Tables

1. `MailSubscription`
2. `MailDelivery`

## Key Constraints

- `InviteToken.tokenHash` unique
- `InviteToken` index: `(cu12Id)`
- `Cu12Account.userId` unique
- `Cu12Account.cu12Id` unique
- `CourseSnapshot`: `(userId, lectureSeq)` unique
- `CourseNotice`: `(userId, lectureSeq, noticeKey)` unique
- `NotificationEvent`: `(userId, notifierSeq)` unique
- `LearningTask`: `(userId, lectureSeq, courseContentsSeq)` unique

## Notes

- 토큰/비밀번호 평문 저장 금지
- 큐 payload/result는 JSON 저장
