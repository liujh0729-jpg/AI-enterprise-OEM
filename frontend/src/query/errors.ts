import { ApiError } from "@enterprise/contracts";

const presentedErrors = new WeakSet<object>();

/** 同一次错误可能经过 Mutation 和确认弹窗，只展示一次操作提示。 */
export function presentMutationError(
  error: unknown,
  display: (text: string) => unknown,
) {
  if (error instanceof ApiError && error.kind === "cancelled") return;
  if (typeof error === "object" && error !== null) {
    if (presentedErrors.has(error)) return;
    presentedErrors.add(error);
  }
  display(error instanceof Error ? error.message : "操作失败");
}
