import assert from "node:assert/strict";
import test from "node:test";
import { isCyberCampusAuthenticatedResponse } from "./cyber-campus-session-state";

test("isCyberCampusAuthenticatedResponse treats redirected main page as authenticated", () => {
  assert.equal(
    isCyberCampusAuthenticatedResponse(
      "<html><body><form action=\"/ilos/lo/logout.acl\"></form><a href=\"/ilos/message/received_list_pop_form.acl\"></a></body></html>",
      "https://e-cyber.catholic.ac.kr/ilos/main/main_form.acl",
    ),
    true,
  );
});

test("isCyberCampusAuthenticatedResponse rejects plain login form responses", () => {
  assert.equal(
    isCyberCampusAuthenticatedResponse(
      "<html><body><input id=\"usr_id\" /><input id=\"usr_pwd\" /></body></html>",
      "https://e-cyber.catholic.ac.kr/ilos/main/member/login_form.acl",
    ),
    false,
  );
});

test("isCyberCampusAuthenticatedResponse rejects login form served from main_form", () => {
  assert.equal(
    isCyberCampusAuthenticatedResponse(
      "<html><body><script>function popTodo(){}</script><form action=\"/ilos/main/member/login_form.acl\"><input id=\"usr_id\" /><input id=\"usr_pwd\" /><button id=\"login_btn\"></button></form></body></html>",
      "https://e-cyber.catholic.ac.kr/ilos/main/main_form.acl",
    ),
    false,
  );
});
