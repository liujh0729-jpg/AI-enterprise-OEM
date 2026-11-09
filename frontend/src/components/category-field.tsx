"use client";

import { Button, Form, Input, Select, type SelectProps } from "antd";
import { useAllModuleCategories, useModuleCategory } from '@/query/categories';

/**
 * 平台类目选择（AIworkin 类目树）：
 * 一级类目固定为平台父类目名只读展示，二级类目取平台子类目（提交 sub_category_id）。
 * `domain="HUB"`（供需市场）跨板块：二级类目按一级类目分组列出全部板块的叶子，
 * 一级类目随所选叶子反推，只读展示。
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
  const hub = domain.toUpperCase() === "HUB";
  const single = useModuleCategory(domain, !hub);
  const all = useAllModuleCategories(hub);
  const query = hub ? all : single;
  const selected = Form.useWatch(name) as string | undefined;

  const modules = hub ? all.data || [] : [];
  const flat = hub ? modules.flatMap((item) => item.options) : single.data?.options || [];
  const hit = flat.find((item) => item.id === selected);
  const category1 = hub
    ? modules.find((item) => item.options.some((item) => item.id === selected))
        ?.category1 || ""
    : single.data?.category1 || "";
  const options: SelectProps["options"] = hub
    ? modules.map((item) => ({
        label: item.category1 || item.label,
        options: item.options.map((option) => ({
          value: option.id,
          label: option.label,
        })),
      }))
    : flat.map((item) => ({ value: item.id, label: item.label }));

  const error = query.error?.message;
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
          value={category1}
          placeholder={hub ? "选择二级类目后自动带出" : "加载中…"}
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
          showSearch
          optionFilterProp="label"
          placeholder={
            hub
              ? all.data
                ? "请选择二级类目（可跨板块）"
                : "加载中…"
              : single.data
                ? "请选择二级类目"
                : "加载中…"
          }
          options={options}
        />
      </Form.Item>
    </>
  );
}

/**
 * 供需市场（跨板块）的类目筛选：按二级类目查挂单，选项按一级类目分组 —— 与发布表单
 * (`CategoryField` 的 HUB 分支) 同一棵类目树，只是这里可清空、不校验。选中的值就是
 * 挂单的 `subCategoryId`，由列表接口按它收窄（见后端 `MarketBoard_demands/_services`）。
 * 只在供需市场渲染：单一板块的看板/市集已由板块本身收窄，不需要再选类目。
 */
export function HubCategoryFilter({
  value,
  onChange,
}: {
  value: string;
  onChange: (value: string) => void;
}) {
  const query = useAllModuleCategories();
  const modules = query.data || [];
  return (
    <Select
      style={{ width: 240 }}
      allowClear
      showSearch
      optionFilterProp="label"
      loading={query.isPending}
      placeholder="全部类目"
      value={value || undefined}
      onChange={(next?: string) => onChange(next || "")}
      options={modules.map((item) => ({
        label: item.category1 || item.label,
        options: item.options.map((option) => ({
          value: option.id,
          label: option.label,
        })),
      }))}
    />
  );
}
