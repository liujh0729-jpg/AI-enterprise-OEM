"use client";

import { Button, Form, Input, Select } from "antd";
import { useModuleCategory } from '@/query/categories';

/**
 * 平台类目选择（AIworkin 类目树）：
 * 一级类目固定为平台父类目名只读展示，二级类目取平台子类目（提交 sub_category_id）。
 */
export function CategoryField({
  domain,
  label = "二级类目",
  name = "sub_category_id",
  showCredentialHint = false,
}: {
  domain: string;
  label?: string;
  name?: string;
  /** 服务发布场景：提示所选类目的资质要求 */
  showCredentialHint?: boolean;
}) {
  const query = useModuleCategory(domain);
  const category = query.data;
  const error = query.error?.message;
  const selected = Form.useWatch(name) as string | undefined;

  const hit = category?.options.find((item) => item.id === selected);
  const hint = error
    ? error
    : showCredentialHint && hit?.credentialTypes.length
      ? `该类目需先在平台核验资质（${hit.credentialTypes.join(" / ")}）后才参与匹配展示`
      : showCredentialHint && hit?.manualOnly
        ? "该类目平台仅支持人工沟通对接"
        : undefined;

  return (
    <>
      <Form.Item label="一级类目">
        <Input
          value={category?.category1 || ""}
          placeholder="加载中…"
          readOnly
          disabled
        />
      </Form.Item>
      <Form.Item
        name={name}
        label={label}
        rules={[{ required: true, message: "请选择二级类目" }]}
        extra={<>{hint}{error ? <Button onClick={() => void query.refetch()}>重试</Button> : null}</>}
      >
        <Select
          loading={query.isPending}
          disabled={Boolean(error)}
          placeholder={category ? "请选择二级类目" : "加载中…"}
          options={(category?.options || []).map((item) => ({
            value: item.id,
            label: item.label,
          }))}
        />
      </Form.Item>
    </>
  );
}
