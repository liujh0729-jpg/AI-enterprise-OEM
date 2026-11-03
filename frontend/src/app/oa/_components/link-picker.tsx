"use client";

import { PlusOutlined } from "@ant-design/icons";
import { Button, Input, Select, Space } from "antd";
import { useState } from "react";
import { oaApi } from "@/api/oa";
import type { OaLinkSearchItem, OaLinkTarget } from "@enterprise/contracts";
import { OA_LINK_TARGETS } from "@enterprise/contracts";
import { EmptyState, Notice } from "@/components/ui/panel";
import {
  LinkTargetLabel,
  Toolbar,
  oaDetailPath,
  oaError,
  type OaOrgQuery,
} from "./oa-common";

/** 契约里 targetType 是枚举；接口回传的是字符串，出网前按这个字面量联合收窄。 */
export type OaLinkTargetKey = (typeof OA_LINK_TARGETS)[number];
export type OaDraftLink = { targetType: OaLinkTargetKey; targetId: string };

export const OA_LINK_MAX = 20;

export const draftLinkOf = (item: OaLinkSearchItem): OaDraftLink => ({
  targetType: item.targetType as OaLinkTargetKey,
  targetId: item.id,
});

const keyOf = (item: { targetType: string; id: string }) =>
  `${item.targetType}:${item.id}`;

function ItemRow({
  item,
  action,
  disabled,
}: {
  item: OaLinkSearchItem;
  action: React.ReactNode;
  disabled?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        gap: 8,
        alignItems: "center",
        flexWrap: "wrap",
        opacity: disabled ? 0.6 : 1,
      }}
    >
      <span className="muted text-12">
        <LinkTargetLabel targetType={item.targetType} />
      </span>
      <span>{item.title || item.id}</span>
      {item.subtitle ? (
        <span className="muted text-12">{item.subtitle}</span>
      ) : null}
      {item.amount ? (
        <span className="muted text-12">￥{item.amount.toFixed(2)}</span>
      ) : null}
      <span style={{ marginLeft: "auto" }}>{action}</span>
    </div>
  );
}

/**
 * 单据关联业务对象：选类型 → 搜关键词 → 逐条添加，最多 20 个。
 * 提交时由后端冻结成可见快照，所以这里只传 targetType + targetId。
 */
export function LinkPicker({
  targets,
  org,
  value = [],
  onChange,
  restrictTo,
  disabled,
}: {
  targets: OaLinkTarget[];
  org: OaOrgQuery;
  value?: OaLinkSearchItem[];
  onChange: (next: OaLinkSearchItem[]) => void;
  /** 只允许关联某一类对象（模板字段 refTarget 用）；空＝全部可搜类型。 */
  restrictTo?: string;
  disabled?: boolean;
}) {
  const searchable = (
    restrictTo ? targets.filter((item) => item.key === restrictTo) : targets
  ).filter((item) => item.searchEnabled);
  const [targetType, setTargetType] = useState<OaLinkTargetKey | "">(
    (restrictTo as OaLinkTargetKey) || "",
  );
  const [keyword, setKeyword] = useState("");
  const [results, setResults] = useState<OaLinkSearchItem[] | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");

  const pickedKeys = new Set(value.map(keyOf));
  const isFull = value.length >= OA_LINK_MAX;

  const search = async () => {
    if (!targetType) {
      setError("先选择业务对象类型");
      return;
    }
    setLoading(true);
    setError("");
    try {
      const data = await oaApi.linkSearch({
        query: { ...org, targetType, keyword },
      });
      setResults((data || []) as OaLinkSearchItem[]);
    } catch (err) {
      setError(oaError(err));
      setResults(null);
    } finally {
      setLoading(false);
    }
  };

  const add = (item: OaLinkSearchItem) => {
    if (pickedKeys.has(keyOf(item)) || isFull) return;
    onChange([...value, item]);
  };

  return (
    <Space direction="vertical" size={8} style={{ width: "100%" }}>
      <Toolbar hint={`已关联 ${value.length} 个，最多 ${OA_LINK_MAX} 个`}>
        <Select
          placeholder="业务对象类型"
          style={{ minWidth: 180 }}
          disabled={disabled || !!restrictTo}
          value={targetType || undefined}
          onChange={(next) => setTargetType(next as OaLinkTargetKey)}
          options={searchable.map((item) => ({
            value: item.key as OaLinkTargetKey,
            label: item.label,
          }))}
        />
        <Input.Search
          allowClear
          placeholder="单号 / 标题关键词"
          style={{ width: 240 }}
          value={keyword}
          disabled={disabled}
          onChange={(event) => setKeyword(event.target.value)}
          onSearch={() => void search()}
          loading={loading}
        />
      </Toolbar>
      {error ? <Notice variant="error">{error}</Notice> : null}
      {results ? (
        results.length ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {results.map((item) => (
              <ItemRow
                key={keyOf(item)}
                item={item}
                disabled={pickedKeys.has(keyOf(item)) || (disabled ?? false)}
                action={
                  <Button
                    icon={<PlusOutlined aria-hidden />}
                    disabled={pickedKeys.has(keyOf(item)) || isFull || disabled}
                    onClick={() => add(item)}
                  >
                    {pickedKeys.has(keyOf(item)) ? "已关联" : "添加"}
                  </Button>
                }
              />
            ))}
          </div>
        ) : (
          <EmptyState text="没有匹配的业务对象，换个关键词试试" />
        )
      ) : null}
      {value.length ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          {value.map((item) => (
            <ItemRow
              key={keyOf(item)}
              item={item}
              action={
                <Space size={4}>
                  {oaDetailPath(targets, item.targetType, item.id) ? (
                    <Button
                      type="link"
                      onClick={() =>
                        window.open(
                          oaDetailPath(targets, item.targetType, item.id),
                          "_blank",
                          "noopener,noreferrer",
                        )
                      }
                    >
                      查看
                    </Button>
                  ) : null}
                  <Button
                    danger
                    disabled={disabled}
                    onClick={() =>
                      onChange(value.filter((row) => keyOf(row) !== keyOf(item)))
                    }
                  >
                    移除
                  </Button>
                </Space>
              }
            />
          ))}
        </div>
      ) : null}
    </Space>
  );
}

/** 模板字段 type=ref 的取值：一个业务对象（后端按 targetType + id 解析成关联）。 */
export function RefPicker({
  targets,
  org,
  value,
  onChange,
  refTarget,
  disabled,
}: {
  targets: OaLinkTarget[];
  org: OaOrgQuery;
  value?: OaLinkSearchItem | null;
  onChange: (next: OaLinkSearchItem | null) => void;
  refTarget?: string;
  disabled?: boolean;
}) {
  return (
    <LinkPicker
      targets={targets}
      org={org}
      restrictTo={refTarget}
      disabled={disabled}
      value={value ? [value] : []}
      onChange={(next) => onChange(next[next.length - 1] || null)}
    />
  );
}
