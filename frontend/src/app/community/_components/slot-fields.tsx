"use client";

import { Button, Input, InputNumber, Select, Space, Upload } from "antd";
import { DeleteOutlined, PictureOutlined, ReloadOutlined, UploadOutlined } from "@ant-design/icons";
import { useState } from "react";
import { uploadCommunityInput } from "@/api/community";
import type { CommunitySlot } from "@enterprise/contracts";

export type SlotValues = Record<string, string | number | null>;

/** 单张输入图封顶 20MB：Comfy Cloud 在 50MiB 才拒，但这是浏览器到本站的一次上传，早点提醒更省事。 */
const INPUT_IMAGE_MAX_BYTES = 20 * 1024 * 1024;

function seedValue() {
  return Math.floor(Math.random() * 2_147_483_647);
}

/** 打开表单时先按槽位默认值铺一遍：种子除外（每次进来都给个新的，否则同参数会重复出同一张图）。 */
export function initialSlotValues(slots: CommunitySlot[]): SlotValues {
  const values: SlotValues = {};
  for (const slot of slots) {
    values[slot.key] =
      slot.type === "seed"
        ? seedValue()
        : slot.defaultValue === null || slot.defaultValue === undefined
          ? null
          : slot.defaultValue;
  }
  return values;
}

/** 必填项检查：返回缺哪几个槽位的标签，界面直接拿去提示（不依赖 antd Form 是因为控件由 slots 动态生成）。 */
export function missingRequiredSlots(
  slots: CommunitySlot[],
  values: SlotValues,
): string[] {
  return slots
    .filter((slot) => slot.required)
    .filter((slot) => {
      const value = values[slot.key];
      return value === null || value === undefined || value === "";
    })
    .map((slot) => slot.label || slot.key);
}

/**
 * 参数表单：控件完全由发布时固化的槽位白名单生成。
 * 用户能改的只有这些槽位——工作流里没声明的输入一律按原值提交（后端 `buildRunGraph` 兜底），
 * 所以这里不需要、也不允许把 JSON 摊开给人编辑。
 */
export function SlotFields({
  slots,
  values,
  onChange,
}: {
  slots: CommunitySlot[];
  values: SlotValues;
  onChange: (values: SlotValues) => void;
}) {
  const [uploading, setUploading] = useState("");
  const [error, setError] = useState("");

  const set = (key: string, value: string | number | null) =>
    onChange({ ...values, [key]: value });

  const uploadImage = async (slot: CommunitySlot, file: File) => {
    setError("");
    if (file.size > INPUT_IMAGE_MAX_BYTES) {
      setError(`${slot.label}：图片超过 20MB，请换小一点的`);
      return false;
    }
    setUploading(slot.key);
    try {
      const result = await uploadCommunityInput(file);
      // 存完整地址而不是对象键：预览能直接用，后端也认本站桶的 https 地址
      set(slot.key, result.url);
    } catch (caught) {
      setError((caught as Error).message || "图片上传失败");
    } finally {
      setUploading("");
    }
    return false;
  };

  if (!slots.length) {
    return (
      <div className="text-12 muted">
        这份工作流没有开放可修改的参数，会按作者保存的原值直接运行。
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: 12 }}>
      {slots.map((slot) => {
        const value = values[slot.key];
        const rangeHint =
          slot.min !== null || slot.max !== null
            ? `（${slot.min ?? "-∞"} ~ ${slot.max ?? "+∞"}）`
            : "";
        return (
          <div key={slot.key}>
            <div className="text-12" style={{ marginBottom: 4 }}>
              <strong>{slot.label || slot.key}</strong>
              {slot.required ? <span style={{ color: "#d4380d" }}> *</span> : null}
              <span className="muted">{rangeHint}</span>
            </div>
            {slot.type === "longtext" ? (
              <Input.TextArea
                rows={4}
                value={typeof value === "string" ? value : ""}
                maxLength={8000}
                placeholder={slot.defaultValue == null ? "" : String(slot.defaultValue)}
                onChange={(event) => set(slot.key, event.target.value)}
              />
            ) : slot.type === "enum" ? (
              <Select
                style={{ width: "100%" }}
                value={typeof value === "string" && value ? value : undefined}
                placeholder="请选择"
                allowClear
                options={slot.options.map((item) => ({ label: item, value: item }))}
                onChange={(next) => set(slot.key, next ?? null)}
              />
            ) : slot.type === "int" || slot.type === "float" || slot.type === "seed" ? (
              <Space.Compact style={{ width: "100%" }}>
                <InputNumber
                  style={{ width: "100%" }}
                  value={typeof value === "number" ? value : undefined}
                  precision={slot.type === "float" ? undefined : 0}
                  min={slot.min ?? undefined}
                  max={slot.max ?? undefined}
                  onChange={(next) => set(slot.key, next)}
                />
                {slot.type === "seed" ? (
                  <Button
                    icon={<ReloadOutlined />}
                    onClick={() => set(slot.key, seedValue())}
                  >
                    随机
                  </Button>
                ) : null}
              </Space.Compact>
            ) : slot.type === "image" ? (
              typeof value === "string" && value ? (
                <div>
                  {/* eslint-disable-next-line @next/next/no-img-element -- 本站 OSS 直链，尺寸不固定，用原生 img 免配置域名白名单 */}
                  <img
                    src={value}
                    alt={slot.label}
                    style={{
                      maxWidth: "100%",
                      maxHeight: 180,
                      borderRadius: 8,
                      border: "1px solid var(--line, #f0f0f0)",
                      display: "block",
                    }}
                  />
                  <Button
                    size="small"
                    style={{ marginTop: 6 }}
                    icon={<DeleteOutlined />}
                    onClick={() => set(slot.key, null)}
                  >
                    移除图片
                  </Button>
                </div>
              ) : (
                <Upload
                  accept="image/*"
                  showUploadList={false}
                  beforeUpload={(file) => uploadImage(slot, file as unknown as File)}
                >
                  <Button
                    icon={<PictureOutlined />}
                    loading={uploading === slot.key}
                  >
                    上传图片
                  </Button>
                </Upload>
              )
            ) : (
              <Input
                value={typeof value === "string" ? value : value === null ? "" : String(value)}
                maxLength={4000}
                placeholder={slot.defaultValue == null ? "" : String(slot.defaultValue)}
                onChange={(event) => set(slot.key, event.target.value)}
              />
            )}
          </div>
        );
      })}
      {error ? (
        <div className="text-12" style={{ color: "#d4380d" }}>
          {error}
        </div>
      ) : null}
      <div className="text-12 muted">
        <UploadOutlined /> 只列出作者开放出来的参数；没列出的输入按工作流原值运行。
      </div>
    </div>
  );
}
