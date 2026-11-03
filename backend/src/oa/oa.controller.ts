import { CurrentUser } from '../auth/current-user';
import { OaService } from './oa.service';

/** OA 控制器：与契约 Oa_* 一一对应，只做参数透传。 */
export class OaController {
  constructor(private readonly service: OaService) {}

  workspace(user: CurrentUser, query: Record<string, unknown>) {
    return this.service.workspace(user, query);
  }

  overview(user: CurrentUser, query: Record<string, unknown>) {
    return this.service.overview(user, query);
  }

  templates(user: CurrentUser, query: Record<string, unknown>) {
    return this.service.templateList(user, query);
  }

  templateDetail(
    user: CurrentUser,
    id: string,
    query: Record<string, unknown>,
  ) {
    return this.service.templateDetail(user, id, query);
  }

  saveTemplate(user: CurrentUser, body: Record<string, unknown>) {
    return this.service.templateSave(user, body);
  }

  deleteTemplate(user: CurrentUser, id: string) {
    return this.service.templateDelete(user, id);
  }

  toggleTemplate(user: CurrentUser, id: string, body: Record<string, unknown>) {
    return this.service.templateToggle(user, id, body);
  }

  copyTemplate(user: CurrentUser, id: string, body: Record<string, unknown>) {
    return this.service.templateCopy(user, id, body);
  }

  applications(user: CurrentUser, query: Record<string, unknown>) {
    return this.service.applications(user, query);
  }

  applicationDetail(
    user: CurrentUser,
    id: string,
    query: Record<string, unknown>,
  ) {
    return this.service.applicationDetail(user, id, query);
  }

  saveDraft(user: CurrentUser, body: Record<string, unknown>) {
    return this.service.saveDraft(user, body);
  }

  submit(user: CurrentUser, id: string) {
    return this.service.submit(user, id);
  }

  withdraw(user: CurrentUser, id: string, body: Record<string, unknown>) {
    return this.service.withdraw(user, id, body);
  }

  deleteDraft(user: CurrentUser, id: string) {
    return this.service.deleteDraft(user, id);
  }

  preReview(user: CurrentUser, id: string, token: string) {
    return this.service.preReview(user, id, token);
  }

  export(user: CurrentUser, query: Record<string, unknown>) {
    return this.service.export(user, query);
  }

  tasks(user: CurrentUser, query: Record<string, unknown>) {
    return this.service.tasks(user, query);
  }

  done(user: CurrentUser, query: Record<string, unknown>) {
    return this.service.done(user, query);
  }

  approve(user: CurrentUser, id: string, body: Record<string, unknown>) {
    return this.service.approve(user, id, body);
  }

  reject(user: CurrentUser, id: string, body: Record<string, unknown>) {
    return this.service.reject(user, id, body);
  }

  /** 契约操作是 Oa_return；类方法名允许保留字，调用方用方括号取值。 */
  return(user: CurrentUser, id: string, body: Record<string, unknown>) {
    return this.service.returnTask(user, id, body);
  }

  transfer(user: CurrentUser, id: string, body: Record<string, unknown>) {
    return this.service.transfer(user, id, body);
  }

  addSign(user: CurrentUser, id: string, body: Record<string, unknown>) {
    return this.service.addSign(user, id, body);
  }

  cc(user: CurrentUser, query: Record<string, unknown>) {
    return this.service.cc(user, query);
  }

  readCc(user: CurrentUser, id: string) {
    return this.service.readCc(user, id);
  }

  records(user: CurrentUser, id: string, query: Record<string, unknown>) {
    return this.service.records(user, id, query);
  }

  comment(user: CurrentUser, id: string, body: Record<string, unknown>) {
    return this.service.comment(user, id, body);
  }

  linkTargets() {
    return this.service.linkTargets();
  }

  linkSearch(user: CurrentUser, query: Record<string, unknown>) {
    return this.service.linkSearch(user, query);
  }

  retryLink(user: CurrentUser, id: string, linkId: string) {
    return this.service.retryLink(user, id, linkId);
  }

  approvalInbox(user: CurrentUser, query: Record<string, unknown>) {
    return this.service.approvalInbox(user, query);
  }

  settings(user: CurrentUser, query: Record<string, unknown>) {
    return this.service.settings(user, query);
  }

  saveSettings(user: CurrentUser, body: Record<string, unknown>) {
    return this.service.saveSettings(user, body);
  }
}
