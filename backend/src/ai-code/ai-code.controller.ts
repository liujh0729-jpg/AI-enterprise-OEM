import type { CurrentUser } from '../auth/current-user';
import type { AiCodeService, AiCodeUploadFile } from './ai-code.service';

/**
 * AI 编程控制器：AdminAiCode_* 由 moduleHandlers 自动映射（参数顺序＝用户、路径参数、查询、请求体）。
 * SSE 对话与 multipart 上传走单独注册的非契约路由。
 */
export class AiCodeController {
  constructor(private readonly service: AiCodeService) {}

  overview(user: CurrentUser) {
    return this.service.overview(user);
  }

  unlock(user: CurrentUser, body: { password: string }) {
    return this.service.unlock(user, body);
  }

  models(user: CurrentUser) {
    return this.service.models(user);
  }

  sessions(user: CurrentUser) {
    return this.service.sessions(user);
  }

  createSession(user: CurrentUser, body: { title: string; model: string }) {
    return this.service.createSession(user, body);
  }

  session(user: CurrentUser, id: string) {
    return this.service.session(user, id);
  }

  edits(user: CurrentUser, id: string) {
    return this.service.edits(user, id);
  }

  approve(
    user: CurrentUser,
    id: string,
    body: { path: string; status: 'approved' | 'rejected' },
  ) {
    return this.service.approve(user, id, body);
  }

  revert(user: CurrentUser, id: string, body: { path: string }) {
    return this.service.revert(user, id, body);
  }

  /** 契约里的 export 动作（导出补丁包）。 */
  export(user: CurrentUser, id: string) {
    return this.service.export(user, id);
  }

  apply(
    user: CurrentUser,
    body: {
      sessionId: number;
      backupDatabase: boolean;
      backupCode: boolean;
      autoRollback: boolean;
      conflictStrategy: 'overwrite' | 'abort';
      confirmation: string;
    },
  ) {
    return this.service.apply(user, body);
  }

  chat(
    user: CurrentUser,
    token: string | undefined,
    id: string,
    body: Record<string, unknown>,
    emit: (event: string, data: Record<string, unknown>) => Promise<void>,
  ) {
    return this.service.chat(user, token, id, body, emit);
  }

  upload(user: CurrentUser, id: string, file: AiCodeUploadFile) {
    return this.service.upload(user, id, file);
  }

  readUpload(user: CurrentUser, id: string, name: string) {
    return this.service.readUpload(user, id, name);
  }

  readExport(user: CurrentUser, name: string) {
    return this.service.readExport(user, name);
  }
}
