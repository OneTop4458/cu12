function isCyberCampusLoginFormResponse(html: string): boolean {
  return /member\/login_form\.acl/i.test(html)
    || /id=["']usr_id["']/i.test(html)
    || /id=["']usr_pwd["']/i.test(html)
    || /id=["']login_btn["']/i.test(html);
}

export function isCyberCampusAuthenticatedResponse(html: string, _responseUrl: string): boolean {
  if (isCyberCampusLoginFormResponse(html)) {
    return false;
  }

  return /\/ilos\/lo\/logout\.acl/i.test(html)
    || /received_list_pop_form\.acl/i.test(html);
}
