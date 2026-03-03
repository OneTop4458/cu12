# CU12 Endpoint Catalog

## Auth / Session

1. `GET /el/member/login_form.acl`
2. `POST /el/lo/hak_login_proc.acl`

## My Course

1. `GET /el/member/mycourse_list_form.acl`
2. `GET /el/class/todo_list_form.acl?LECTURE_SEQ={lectureSeq}`

## Notice / Notification

1. `GET /el/class/notice_list_form.acl?LECTURE_SEQ={lectureSeq}`
2. `POST /el/co/notification_list.acl`

## Video Attendance (C01)

1. `POST /el/class/contents_vod_hisno.acl`
2. `POST /el/class/contents_vod_at.acl`
3. `POST /el/class/contents_vod_time.acl`
4. `POST /el/class/contents_vod_status.acl`
5. `GET /el/class/contents_vod_view_form.acl?...`
6. `GET /el/class/contents_vod_view.acl?...`

## Access Control / Validation

1. `POST /el/class/check_chapter_acss.acl`
2. `GET /el/class/st/online_view_check.acl?...`
3. `POST https://accessone.hellolms.com/accessone`

## Notes

- 대부분 엔드포인트는 HTML 응답이며 쿠키 세션에 의존한다.
- 파라미터 누락 시 알림창 또는 리다이렉트로 실패할 수 있다.
