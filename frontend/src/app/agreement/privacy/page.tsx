import type { Metadata } from "next";
import { AgreementDocument } from "../agreement-document";

export const metadata: Metadata = { title: "隐私政策" };

/** 登录页注册勾选项的落地页：正文由后台「账号与登录 → 注册协议与隐私政策」维护。 */
export default function PrivacyPolicyPage() {
  return <AgreementDocument code="USER_PRIVACY" fallbackTitle="隐私政策" />;
}
