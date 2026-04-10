export function isCyberCampusAuthenticatedResponse(html: string, responseUrl: string): boolean {
  if (/\/ilos\/main\/main_form\.acl/i.test(responseUrl)) return true;
  return /\/ilos\/lo\/logout\.acl/i.test(html)
    || /popTodo\(/i.test(html)
    || /received_list_pop_form\.acl/i.test(html);
}
