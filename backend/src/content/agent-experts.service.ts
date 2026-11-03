import { text } from '../common/api';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { CurrentUser } from '../auth/current-user';
import { PrismaService } from '../prisma/prisma.service';
import { ContentMediaService } from './content-media.service';

const NAME_MAX = 40;
const DESCRIPTION_MAX = 200;
const INSTRUCTION_MAX = 4000;

/** 专家生成用的一次性提示：只允许模型回 JSON，人设字段在这里定死口径。 */
const EXPERT_SYSTEM_PROMPT = [
  '你是「专家人设编写助手」。用户会用一段中文指令描述想要的专家，',
  '典型格式是：帮我创建一个 XXX 专家、擅长 XXX。我的经验是：[行业背景、相关经验]。',
  '请据此写出一个可复用的专家人设，只输出一个 JSON 对象（不要代码块、不要解释），字段：',
  'name：专家名，不超过 20 个汉字，形如「税务筹划专家」；',
  'description：一句话介绍，不超过 60 字；',
  'prompt：第二人称的角色设定，150~400 字，写清专业身份、擅长领域、工作方法、回答风格和边界；',
  '用户填写的经验就是这位专家的经验，不要虚构用户没提供的资质、履历或头衔。',
].join('\n');

type ExpertRow = {
  id: number;
  name: string;
  description: string;
  instruction: string;
  prompt: string;
  createdBy: string;
  creatorName: string;
  useCount: number;
  createdAt: Date;
  updatedAt: Date;
};

function parseExpertJson(raw: string) {
  const start = raw.indexOf('{');
  const end = raw.lastIndexOf('}');
  if (start < 0 || end <= start) return null;
  try {
    const node = JSON.parse(raw.slice(start, end + 1)) as Record<
      string,
      unknown
    >;
    const name = text(node.name).trim();
    const description = text(node.description).trim();
    const prompt = text(node.prompt).trim();
    if (!name || !prompt) return null;
    return { name, description, prompt };
  } catch {
    return null;
  }
}

/**
 * Agent 专家：用户用一段指令生成一个公共角色，全站任何账号都能直接拿来对话；
 * 只有创建人能删除；列表按被启用的会话数（useCount）从高到低排。
 */
export class ContentAgentExpertService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly media: ContentMediaService,
  ) {}

  shape(row: ExpertRow, userId: string) {
    return {
      id: row.id,
      name: row.name,
      description: row.description,
      instruction: row.instruction,
      prompt: row.prompt,
      creatorId: row.createdBy,
      creatorName: row.creatorName,
      useCount: row.useCount,
      mine: row.createdBy === userId,
      createdAt: row.createdAt.toISOString(),
      updatedAt: row.updatedAt.toISOString(),
    };
  }

  async list(user: CurrentUser) {
    const rows = await this.prisma.contentAgentExpert.findMany({
      orderBy: [{ useCount: 'desc' }, { id: 'asc' }],
      take: 200,
    });
    return rows.map((row) => this.shape(row, user.userId));
  }

  async create(
    user: CurrentUser,
    token: string | undefined,
    body: Record<string, unknown>,
  ) {
    const instruction = text(body.instruction).trim();
    if (!instruction) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '请先描述你想要的专家（例如：帮我创建一个税务筹划专家、擅长…）',
      );
    }
    if (instruction.length > INSTRUCTION_MAX) {
      throw new BusinessException(
        ErrorCode.BAD_REQUEST,
        '这段描述太长了，请精简到 4000 字以内',
      );
    }
    const answer = await this.media.chat(user, token, [
      { role: 'system', content: EXPERT_SYSTEM_PROMPT },
      { role: 'user', content: instruction },
    ]);
    const parsed = parseExpertJson(answer);
    if (!parsed) {
      throw new BusinessException(
        ErrorCode.SERVICE_UNAVAILABLE,
        '生成专家失败：模型没有按要求返回人设，请稍后重试或换个描述',
      );
    }
    const row = await this.prisma.contentAgentExpert.create({
      data: {
        name: parsed.name.slice(0, NAME_MAX),
        description: parsed.description.slice(0, DESCRIPTION_MAX),
        instruction,
        prompt: parsed.prompt,
        createdBy: user.userId,
        creatorName: user.username,
      },
    });
    return this.shape(row, user.userId);
  }

  async remove(user: CurrentUser, id: string) {
    const expertId = Number(id);
    if (!Number.isInteger(expertId) || expertId <= 0) {
      throw new BusinessException(ErrorCode.BAD_REQUEST, '专家编号无效');
    }
    const row = await this.prisma.contentAgentExpert.findUnique({
      where: { id: expertId },
    });
    if (!row) throw new BusinessException(ErrorCode.NOT_FOUND, '专家不存在');
    if (row.createdBy !== user.userId) {
      throw new BusinessException(
        ErrorCode.FORBIDDEN,
        '只有创建这个专家的账号可以删除',
      );
    }
    await this.prisma.contentAgentExpert.delete({ where: { id: expertId } });
    return { removed: true };
  }

  /** 会话绑定专家时校验存在性，并带回名字冗余到会话行。 */
  async bindable(expertId: number) {
    if (!Number.isInteger(expertId) || expertId <= 0) return null;
    return this.prisma.contentAgentExpert.findUnique({
      where: { id: expertId },
      select: { id: true, name: true },
    });
  }

  /** 会话里注入的角色提示；专家已被删就返回空，不影响继续对话。 */
  async promptOf(expertId: number) {
    if (!Number.isInteger(expertId) || expertId <= 0) return null;
    const row = await this.prisma.contentAgentExpert.findUnique({
      where: { id: expertId },
      select: { name: true, prompt: true },
    });
    return row ?? null;
  }

  /** 会话第一次发消息时记一次使用，热度按会话数算（不按消息条数刷量）。 */
  async bumpUsage(expertId: number) {
    if (!Number.isInteger(expertId) || expertId <= 0) return;
    await this.prisma.contentAgentExpert.updateMany({
      where: { id: expertId },
      data: { useCount: { increment: 1 } },
    });
  }
}
