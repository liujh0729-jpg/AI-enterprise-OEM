import { CurrentUser } from '../auth/current-user';
import { ok, text } from '../common/api';
import { parseId } from '../common/parse-id';
import { ExternalCredentialService } from './external-credential.service';
import { ExternalService } from './external.service';
export class ExternalController {
  constructor(
    private readonly external: ExternalService,
    private readonly credentials: ExternalCredentialService,
  ) {}
  /** 外报通道目录（含未开通通道与开通所需外部条件）。 */
  async channels() {
    return ok(await this.external.channels());
  }
  async submissions(
    user: CurrentUser,
    status?: string,
    bizType?: string,
    refType?: string,
  ) {
    return ok(
      await this.external.list(user, {
        status,
        bizType,
        refType,
      }),
    );
  }
  async byRef(user: CurrentUser, refType?: string, refId?: string) {
    return ok(
      await this.external.byRef(
        user,
        text(refType, 'TAX_DECLARATION'),
        Number(refId || 0),
      ),
    );
  }
  async detail(user: CurrentUser, id: string) {
    return ok(await this.external.detail(user, parseId(id)));
  }
  /** 报文预览（审核前即可查看将报送的报文与作业指引，不落库）。 */
  async preview(user: CurrentUser, declId: string) {
    return ok(
      await this.external.previewForDeclaration(
        user,
        parseId(declId, '申报单 ID'),
      ),
    );
  }
  /** 手工（重新）生成外报任务，幂等：同申报单同属期不重复建单。 */
  async create(user: CurrentUser, declId: string) {
    return ok(
      await this.external.createForDeclaration(
        user,
        parseId(declId, '申报单 ID'),
      ),
    );
  }
  async submit(
    user: CurrentUser,
    id: string,
    body: {
      acceptNo?: string;
    },
  ) {
    return ok(
      await this.external.markSubmitted(user, parseId(id), text(body.acceptNo)),
    );
  }
  async receipt(
    user: CurrentUser,
    id: string,
    body: {
      receiptNo?: string;
      rawBody?: string;
    },
  ) {
    return ok(
      await this.external.markReceipt(
        user,
        parseId(id),
        text(body.receiptNo),
        text(body.rawBody),
      ),
    );
  }
  async pay(
    user: CurrentUser,
    id: string,
    body: {
      note?: string;
    },
  ) {
    return ok(await this.external.markPaid(user, parseId(id), text(body.note)));
  }
  async reject(
    user: CurrentUser,
    id: string,
    body: {
      errorCode?: string;
      errorMsg?: string;
      rawBody?: string;
    },
  ) {
    return ok(
      await this.external.markRejected(
        user,
        parseId(id),
        text(body.errorCode),
        text(body.errorMsg),
        text(body.rawBody),
      ),
    );
  }
  async retry(user: CurrentUser, id: string) {
    return ok(await this.external.retry(user, parseId(id)));
  }
  async cancel(user: CurrentUser, id: string) {
    return ok(await this.external.cancel(user, parseId(id)));
  }
  /** 回执/回调原文留痕（只追加，不可篡改）。 */
  async callbacks(user: CurrentUser, id: string) {
    return ok(await this.external.callbacks(user, parseId(id)));
  }
  async recordCallback(
    user: CurrentUser,
    id: string,
    body: {
      rawBody?: string;
      source?: string;
      signatureValid?: boolean;
    },
  ) {
    return ok(
      await this.external.recordCallback(
        user,
        parseId(id),
        text(body.rawBody),
        text(body.source, 'MANUAL'),
        Boolean(body.signatureValid),
      ),
    );
  }
  /** 企业外报凭据（CA / 电子税务局子账号 / 电子口岸 IC 卡）：列表脱敏，仅本人与管理员可见。 */
  async listCredentials(user: CurrentUser, enterpriseId?: string) {
    const id = Number(enterpriseId || 0);
    await this.external.requireCredentialAccess(user, id);
    return ok(await this.credentials.list(id));
  }
  async saveCredential(
    user: CurrentUser,
    body: {
      enterpriseId?: number;
      channelCode?: string;
      credType?: string;
      label?: string;
      secret?: string;
      extra?: Record<string, unknown>;
      expiresAt?: string | null;
    },
  ) {
    const id = Number(body.enterpriseId || 0);
    await this.external.requireCredentialAccess(user, id);
    return ok(
      await this.credentials.upsert({
        enterpriseId: id,
        channelCode: text(body.channelCode, 'MANUAL'),
        credType: text(body.credType, 'CA'),
        label: text(body.label),
        secret: text(body.secret),
        extra: body.extra || {},
        expiresAt: body.expiresAt ?? null,
      }),
    );
  }
  async removeCredential(user: CurrentUser, id: string, enterpriseId?: string) {
    const eid = Number(enterpriseId || 0);
    await this.external.requireCredentialAccess(user, eid);
    return ok(await this.credentials.remove(eid, parseId(id)));
  }
}
