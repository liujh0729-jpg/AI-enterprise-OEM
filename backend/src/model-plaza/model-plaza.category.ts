/** 模型广场的能力分类：文本 / 图片 / 视频 / 音频 / 向量 / 其他。 */

export type PlazaCategory =
  'text' | 'image' | 'video' | 'audio' | 'embedding' | 'other';

export const PLAZA_CATEGORIES: PlazaCategory[] = [
  'text',
  'image',
  'video',
  'audio',
  'embedding',
  'other',
];

export function isPlazaCategory(value: unknown): value is PlazaCategory {
  return (
    typeof value === 'string' &&
    PLAZA_CATEGORIES.includes(value as PlazaCategory)
  );
}

/** 按端点推导分类；管理员显式填写的合法分类优先。 */
export function categoryOf(
  endpoints: string[],
  explicit?: unknown,
): PlazaCategory {
  if (isPlazaCategory(explicit)) return explicit;
  const paths = endpoints.map((item) => item.toLowerCase());
  if (paths.some((item) => item.startsWith('/images'))) return 'image';
  if (paths.some((item) => item.startsWith('/videos'))) return 'video';
  if (paths.some((item) => item.startsWith('/audio'))) return 'audio';
  if (paths.some((item) => item.startsWith('/embeddings'))) return 'embedding';
  if (paths.some((item) => item.startsWith('/chat'))) return 'text';
  return 'other';
}
