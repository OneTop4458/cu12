import assert from "node:assert/strict";
import test from "node:test";
import { isCyberCampusAuthenticatedResponse } from "./cyber-campus-session-state";

test("isCyberCampusAuthenticatedResponse treats redirected main page as authenticated", () => {
  assert.equal(
    isCyberCampusAuthenticatedResponse(
      "<html><body><form action=\"/ilos/lo/logout.acl\"></form></body></html>",
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
