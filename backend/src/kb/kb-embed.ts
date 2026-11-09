import { aiEmbed } from '../ai/ai-gateway';
import {
  hashEmbed,
  isRemoteEmbedId,
  LOCAL_EMBED_ID,
  REMOTE_EMBED_PREFIX,
  remoteEmbedId,
} from '../ai/retrieval-kernel';
import type { PrismaService } from '../prisma/prisma.service';

/**
 * 知识库向量层（AI 底座方案 §4.2 可插拔 embedding）：
 * - 默认本地袋装向量（local-hash-256）：确定性、零外部依赖，verify 脚本可复现；
 * - 账号在「模型设置 → 向量嵌入」配了槽位，写入时改用真实向量，模型标识
 *   记进 kb_chunks.model（`embed:<模型名>`），与本地向量按块隔离；
 * - 查询侧按分块记录的模型分组取查询向量：本地零成本，远端每种模型一次调用；
 *   槽位换了模型或调用失败时，旧块自动退化为词面检索，绝不因向量失配而整库不可搜。
 * 全量重算（换模型后的存量回填）是 P1-A 摄取管道的职责，这里只保证新旧向量共存可查。
 */

export type EmbedOutcome = { model: string; vectors: number[][] };

/** 写路径：真实向量优先，配不出槽位或上游失败回落本地袋装。 */
export async function embedForWrite(
  prisma: PrismaService,
  userId: string,
  texts: string[],
): Promise<EmbedOutcome> {
  if (texts.length) {
    const remote = await aiEmbed(prisma, {
      userId,
      texts,
      module: 'kb',
      operation: 'embed_chunk',
    });
    if (remote?.vectors?.length === texts.length) {
      return {
        model: remoteEmbedId(remote.model),
        vectors: remote.vectors,
      };
    }
  }
  return {
    model: LOCAL_EMBED_ID,
    vectors: texts.map((text) => hashEmbed(text)),
  };
}

/** 读路径：按块上记录的模型 id 取查询向量（本地同步算，远端逐模型一次调用）。 */
export async function queryVectors(
  prisma: PrismaService,
  userId: string,
  models: string[],
  query: string,
): Promise<Record<string, number[]>> {
  const out: Record<string, number[]> = {};
  const remote: string[] = [];
  for (const id of new Set(models)) {
    if (!id || id === LOCAL_EMBED_ID) {
      out[LOCAL_EMBED_ID] = hashEmbed(query);
    } else if (isRemoteEmbedId(id)) {
      remote.push(id.slice(REMOTE_EMBED_PREFIX.length));
    } else {
      // 未知标识（历史数据）：按长度兜底走本地向量，匹配不上自然退化词面
      out[id] = hashEmbed(query);
    }
  }
  for (const model of remote) {
    const result = await aiEmbed(prisma, {
      userId,
      model,
      texts: [query],
      module: 'kb',
      operation: 'embed_query',
    });
    const vector = result?.vectors?.[0];
    if (vector?.length) out[remoteEmbedId(model)] = vector;
  }
  return out;
}
