"use client";

import { PageContainer, ProCard } from "@ant-design/pro-components";
import { Alert } from "antd";
import { useI18n } from "@/lib/i18n/i18n";

export function PagePlaceholder({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  const { t } = useI18n();
  return (
    <PageContainer
      header={{
        title: t(title),
        breadcrumb: {},
      }}
    >
      <Alert
        showIcon
        type="info"
        title="业务尚未接入"
        description="页面已按 Ant Design Pro 的 PageContainer 搭好，后续用 ProTable / ProForm / 抽屉 / 步骤条填业务。"
        style={{ marginBottom: 16 }}
      />
      <ProCard>{t(description)}</ProCard>
    </PageContainer>
  );
}
