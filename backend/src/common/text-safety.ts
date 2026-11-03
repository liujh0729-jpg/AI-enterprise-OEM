/**
 * 不可见字符清理：零宽、双向覆盖（可把正常文字显示成另一句）与行内控制符。
 * 用户上传的文本会进模型上下文，这类字符能把指令藏得看不出痕迹，统一剥掉。
 */
const INVISIBLE =
  /[\u200B-\u200F\u202A-\u202E\u2060-\u2064\u2066-\u2069\uFEFF]/g;
// eslint-disable-next-line no-control-regex -- 要清掉的就是这些控制符本身
const CONTROL = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g;

export function stripInvisible(raw: string) {
  return String(raw ?? '')
    .replace(INVISIBLE, '')
    .replace(CONTROL, '');
}

/** 单行文本：会拼进系统提示的「一句话说明」用这个，换行一律折叠成空格。 */
export function toSingleLine(raw: string, max: number) {
  return stripInvisible(raw).replace(/\s+/g, ' ').trim().slice(0, max);
}
