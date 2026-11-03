import { PrismaService } from '../prisma/prisma.service';
import {
  ContactPair,
  EMPTY_CONTACT,
  StageContactData,
  contactSnapshot,
  contactStr,
} from './contacts';
/**
 * 联系方式自动解析（系统带出，见 shared/contacts.ts 口径）：
 * - 企业侧对应人：企业档案法定代表人/经营者（个人主体为姓名）+ 档案联系电话；
 * - 执行侧对应人：承办职员档案（实名 + 手机）；未指派或档案缺号时回退服务商备案联系人。
 */
export class ContactResolver {
  constructor(private readonly prisma: PrismaService) {}
  /** 企业/发起方对应人。userId 与 enterpriseId 择一（userId 优先）。 */
  async enterprise(userId = '', enterpriseId = 0): Promise<ContactPair> {
    const row = userId
      ? await this.prisma.enterpriseProfile.findFirst({
          where: { userId },
          orderBy: { id: 'desc' },
        })
      : enterpriseId
        ? await this.prisma.enterpriseProfile.findUnique({
            where: { id: enterpriseId },
          })
        : null;
    if (!row) return { ...EMPTY_CONTACT };
    return {
      name: contactStr(row.legalPerson) || contactStr(row.name),
      phone: contactStr(row.phone),
    };
  }
  /** 服务商/执行方对应人：承办职员档案优先，未指派时回退服务商备案联系人。 */
  async provider(staffUserId = '', providerUserId = ''): Promise<ContactPair> {
    if (staffUserId) {
      const profile = await this.prisma.staffProfile.findUnique({
        where: { userId: staffUserId },
      });
      const pair = {
        name: contactStr(profile?.realName),
        phone: contactStr(profile?.phone),
      };
      if (pair.name || pair.phone) return pair;
    }
    if (providerUserId) {
      const app =
        (await this.prisma.providerApplication.findFirst({
          where: { userId: providerUserId, status: 'APPROVED' },
          orderBy: { id: 'desc' },
        })) ||
        (await this.prisma.providerApplication.findFirst({
          where: { userId: providerUserId },
          orderBy: { id: 'desc' },
        }));
      if (app) {
        return {
          name: contactStr(app.contactName) || contactStr(app.orgName),
          phone: contactStr(app.contactPhone),
        };
      }
    }
    return { ...EMPTY_CONTACT };
  }
  /** 单据创建/推进时一步解析两组联系方式，并叠加入参覆盖（临时换人可改）。 */
  async stage(
    input: {
      enterpriseUserId?: string;
      enterpriseId?: number;
      staffUserId?: string;
      providerUserId?: string;
    },
    body?: Record<string, unknown>,
  ): Promise<StageContactData> {
    const [contact, providerContact] = await Promise.all([
      this.enterprise(input.enterpriseUserId || '', input.enterpriseId || 0),
      this.provider(input.staffUserId || '', input.providerUserId || ''),
    ]);
    return contactSnapshot({ contact, providerContact }, body);
  }
}
