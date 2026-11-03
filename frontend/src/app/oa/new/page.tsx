"use client";

import { OaShell } from "../_components/oa-shell";

/** 业务侧「发起 OA 审批」深链落点：与 /oa 同一份页壳，只是默认停在「我发起的」。 */
export default function OaNewPage() {
  return <OaShell defaultTab="mine" />;
}
