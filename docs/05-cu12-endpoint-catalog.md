# CU12 Endpoint Catalog

This catalog lists known CU12 pages/endpoints used by the worker and validators.

## Authentication

1. `GET /el/member/login_form.acl`
- CU12 login form page.
- Worker fetches this before login submit to establish initial session cookies.

2. `POST /el/lo/hak_login_proc.acl`
- Login processing endpoint used by credential validation.

3. `returnURL=/el/main/main_form.acl` (login payload parameter)
- Used as the post-login redirect target in login form submission.
- Not treated as a standalone worker fetch path.

## Learning and Course Pages

1. `GET /el/member/mycourse_list_form.acl`
- Current enrolled courses list.
- Primary source for active lecture IDs.

2. `GET /el/class/notice_list_form.acl?LECTURE_SEQ=<id>`
- Notice list page for each lecture.
- Used by sync/notice scan, plus notice detail follow-up requests.

3. `POST/GET /el/class/notice_list.acl`
- Alternate notice-detail/list endpoint variants used as resilient fallback candidates.

4. `POST/GET /el/class/notice_view_form.acl`
- Notice detail rendering endpoint variants used for body recovery fallback.

5. `POST /el/co/notice_detail.acl`
- Additional notice detail endpoint candidate used during body recovery fallback.

6. `GET /el/class/todo_list_form.acl?LECTURE_SEQ=<id>`
- Pending learning tasks and todo items.

7. `GET /el/class/contents_vod_view_form.acl`
- VOD player page used by auto-learning.

8. `GET /el/class/contents_material_view_form.acl`
- Material page for text/file-based learning tasks.
- Live behavior confirmed on 2026-04-07 KST: opening this page is sufficient for CU12 to mark the material activity complete.

9. `GET /el/class/contents_quiz_view_form.acl`
- Quiz landing page with summary, due time, and start button.

10. `GET /el/class/contents_quiz_question_view_form.acl`
- Quiz runner shell page after the user starts the quiz.

11. `POST /el/class/contents_quiz_question_view.acl`
- Returns one quiz question HTML fragment at a time.

12. `POST /el/class/contents_quiz_answer_insert*.acl`
- Quiz answer submission endpoints used by the page JS.
- Observed families:
  - `contents_quiz_answer_insert.acl`
  - `contents_quiz_answer_insert4.acl`
  - `contents_quiz_answer_insert5.acl`
  - `contents_quiz_answer_insert6.acl`

13. `POST /el/class/contents_quiz_answer_update*.acl`
- Quiz answer update endpoints used when the page allows answer replacement before final completion.

14. `GET /el/class/contents_quiz_question_result_view_form.acl`
- Quiz result page after the final answer submission.

15. `POST /el/co/notification_list.acl`
- Notification feed endpoint used by sync snapshot collection.

16. `GET /el/co/file_list_user4.acl?CONTENTS_SEQ=<id>&LECTURE_SEQ=<id>`
- Attachment list endpoint used when expanding notice bodies.

## Operational Notes

- Most endpoints are HTML/session-cookie based.
- Field names and hidden inputs may change without notice.
- Worker parser must stay resilient to partial markup changes.
- Worker runs browserless HTTP sync for `SYNC`/`NOTICE_SCAN` and uses Playwright only for `AUTOLEARN`.
