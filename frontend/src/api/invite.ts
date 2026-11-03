import { apiEnvelope, z } from "@enterprise/contracts";
import { http } from "./http";

/**
 * 我的邀请接口（/enterprise/account/invite）：
 * 开源版新增本地接口，未纳入统一 contracts 生成表，直接用底层 http() + 宽松信封校验。
 */
export interface InviteInfo {
  /** 自己的邀请码（大写字母数字；存量账户首次访问时懒生成）。 */
  inviteCode: string;
  /** 被谁邀请注册；null＝非邀请注册。 */
  invitedBy: { userId: string; username: string } | null;
  /** 已成功邀请注册的人数。 */
  invitedCount: number;
}

const inviteSchema = apiEnvelope(z.unknown());

export const inviteApi = {
  me: async (): Promise<InviteInfo> => {
    const result = await http("/api/backend/enterprise/account/invite", inviteSchema);
    return result.data.data as InviteInfo;
  },
};
