"use client";

import { GlobalOutlined } from "@ant-design/icons";
import { Select, Table, Tag } from "antd";
import { useMemo, useState } from "react";
import { EmptyState, Notice } from "@/components/ui/panel";
import {
  PRESS_LANGUAGES,
  PRESS_PLATFORMS,
  PRESS_PRICING,
  type PressLanguageKey,
  type PressPlatform,
  type PressPricing,
} from "./press-platforms";

const LANGUAGE_LABEL = new Map(
  PRESS_LANGUAGES.map((item) => [item.value, item.label]),
);

const ALL = "all";

/**
 * 发稿平台推荐：按语言与付费方式筛主流发布渠道（平台名 / 类型 / 支持语言 / 简介 / 官网）。
 * 只做清单与跳转，不代下单；价格与服务条款以各平台官网为准。
 */
export function GeoPressView() {
  const [language, setLanguage] = useState<string>(ALL);
  const [pricing, setPricing] = useState<string>(ALL);

  const rows = useMemo(
    () =>
      PRESS_PLATFORMS.filter(
        (item) =>
          (language === ALL ||
            item.languages.includes(language as PressLanguageKey)) &&
          (pricing === ALL || item.pricing === (pricing as PressPricing)),
      ),
    [language, pricing],
  );

  return (
    <div>
      <Notice variant="info">
        发稿平台分付费与免费两类：付费渠道（通讯社、软文分发平台）按篇或套餐收费，适合正式通稿与媒体直达；免费渠道（知乎、微信公众号、今日头条、小红书、Reddit、Medium 等）用自有账号发布，适合长期内容与口碑积累。清单为公开资料整理，报价与服务条款以各平台官网为准。
      </Notice>

      <div className="geo-bar" style={{ margin: "12px 0 0" }}>
        <Select
          value={pricing}
          style={{ width: 160 }}
          onChange={(value) => setPricing(value)}
          options={[
            { value: ALL, label: "全部类型" },
            ...PRESS_PRICING.map((item) => ({
              value: item.value,
              label: item.label,
            })),
          ]}
        />
        <Select
          value={language}
          style={{ width: 200 }}
          onChange={(value) => setLanguage(value)}
          options={[
            { value: ALL, label: "全部语言" },
            ...PRESS_LANGUAGES.map((item) => ({
              value: item.value,
              label: item.label,
            })),
          ]}
        />
        <span className="text-12 muted">共 {rows.length} 个平台</span>
      </div>

      <div className="table-wrap">
        <Table<PressPlatform>
          rowKey="name"
          size="middle"
          dataSource={rows}
          pagination={false}
          scroll={{ x: "max-content" }}
          locale={{
            emptyText: (
              <EmptyState
                icon={<GlobalOutlined aria-hidden />}
                text="当前筛选下暂无已收录的发稿平台"
              />
            ),
          }}
          columns={[
            {
              title: "平台名称",
              dataIndex: "name",
              width: 220,
              render: (value: string) => (
                <span style={{ fontWeight: 600 }}>{value}</span>
              ),
            },
            {
              title: "类型",
              dataIndex: "pricing",
              width: 100,
              render: (value: PressPricing) =>
                value === "paid" ? (
                  <Tag color="gold">付费</Tag>
                ) : (
                  <Tag color="green">免费</Tag>
                ),
            },
            {
              title: "支持语言",
              dataIndex: "languages",
              width: 220,
              render: (value: PressLanguageKey[]) =>
                value.map((key) => LANGUAGE_LABEL.get(key) ?? key).join(" / "),
            },
            {
              title: "平台简介",
              dataIndex: "intro",
              width: 520,
            },
            {
              title: "官网",
              dataIndex: "url",
              width: 300,
              render: (value: string) => (
                <a href={value} target="_blank" rel="noreferrer">
                  {value}
                </a>
              ),
            },
          ]}
        />
      </div>
    </div>
  );
}
