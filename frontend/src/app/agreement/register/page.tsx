import type { Metadata } from "next";
import { AgreementDocument } from "../agreement-document";

export const metadata: Metadata = { title: "用户注册协议" };

/** 登录页注册勾选项的落地页：正文由后台「账号与登录 → 注册协议与隐私政策」维护。 */
export default function RegisterAgreementPage() {
  return (
    <AgreementDocument code="USER_REGISTRATION" fallbackTitle="用户注册协议" />
  );
}
