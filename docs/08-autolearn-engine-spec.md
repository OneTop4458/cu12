# Auto-learning Engine Spec

## Scope

- v1 대상: `C01` 온라인강의
- v1 제외: 퀴즈/시험/과제/토론/설문 제출

## Execution Steps

1. CU12 로그인
2. 대상 강좌 목록 확정(요청 lectureSeq 또는 전체 활성 강좌)
3. `todo_list_form.acl`에서 미완료 C01 추출
4. `contents_vod_view_form.acl` 진입
5. 남은 학습시간만큼 페이지 유지
6. `pageExit(false)` 호출로 시간 저장
7. 완료 후 스냅샷 재수집

## Timing

- 기본 재생 계수: `AUTOLEARN_TIME_FACTOR=1`
- 기본 최대 처리 건수: `AUTOLEARN_MAX_TASKS=3`
- 요구 시 계수는 1보다 작게 조정 가능하지만 출석 인정 리스크가 있음

## Conflict Handling

- '다른 기기에서 시청 중' confirm 발생 시 수락
- 중복 작업 방지를 위해 사용자 단위 큐 직렬화 유지

## Output

- `watchedTaskCount`
- `watchedSeconds`
- 처리한 `lectureSeqs`
