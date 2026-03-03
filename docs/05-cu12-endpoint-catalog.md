# CU12 Endpoint Catalog

This catalog lists known CU12 pages/endpoints used by the worker and validators.

## Authentication

1. `GET /el/main/main_form.acl`
- CU12 landing page.
- Used to verify base availability and entry points.

2. `POST /el/lo/hak_login_proc.acl`
- Login processing endpoint used by credential validation.

## Learning and Course Pages

1. `GET /el/member/mycourse_list_form.acl`
- Current enrolled courses list.
- Primary source for active lecture IDs.

2. `GET /el/std/todo_list_form.acl`
- Pending learning tasks and todo items.

3. `GET /el/std/contents_vod_view_form.acl`
- VOD player page used by auto-learning.

## Operational Notes

- Most endpoints are HTML/session-cookie based.
- Field names and hidden inputs may change without notice.
- Worker parser must stay resilient to partial markup changes.