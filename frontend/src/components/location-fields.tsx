"use client";

import { Button, Form, Input, Select } from "antd";
import { useMemo } from "react";
import { EMPTY_REGIONS, useLocationDictionary, type Region } from "@/query/locations";
export type { Region } from "@/query/locations";

export type LocationValue = { province: string; city: string };

function LocationDictionaryError() {
  const query = useLocationDictionary();
  return query.isError ? <span role="alert">地区加载失败：{query.error.message} <Button type="link" onClick={() => void query.refetch()}>重试</Button></span> : null;
}

export function citiesOf(
  regions: Region[],
  province: string | undefined,
): { label: string; value: string }[] {
  if (!province) return [];
  const children =
    regions.find((region) => region.value === province)?.children || [];
  // 直辖市：平台字典的二级是「区」，而本系统记录的是「市」——补一个「全市」值，
  // 保证入库值与筛选值都能由下拉产出（AIworkin 侧演示资源同样用 province=city=上海市）。
  if (province.endsWith("市") && !children.some((item) => item.value === province)) {
    return [{ label: `${province}（全市）`, value: province }, ...children];
  }
  return children;
}

/** 「浙江省杭州市」展示文案；未填写时返回空串（调用方决定占位）。 */
export function locationText(
  province: string | undefined,
  city: string | undefined,
): string {
  const p = (province || "").trim();
  const c = (city || "").trim();
  // 直辖市省市同名（入库就是 上海市/上海市），展示只保留一次
  if (!c || c === p) return p;
  if (!p) return c;
  return `${p}${c}`;
}

/**
 * 表单里的「所在省份 / 所在城市」（用户认证、服务商备案、职员资料三处共用，提交必填）。
 * 放在 <Form> 内即可，字段名固定为 province / city。
 */
export function LocationFields({ extra }: { extra?: string }) {
  const form = Form.useFormInstance();
  const regions = useLocationDictionary().data ?? EMPTY_REGIONS;
  const province = Form.useWatch("province", form);
  const cities = useMemo(() => citiesOf(regions, province), [regions, province]);
  return (
    <div className="form-2col">
      <Form.Item
        name="province"
        label="所在省份"
        rules={[{ required: true, message: "请选择所在省份" }]}
        extra={<>{extra}<LocationDictionaryError /></>}
      >
        <Select
          showSearch
          placeholder="请选择省份"
          options={regions.map((region) => ({
            value: region.value,
            label: region.label,
          }))}
          onChange={() => form.setFieldValue("city", undefined)}
        />
      </Form.Item>
      <Form.Item
        name="city"
        label="所在城市"
        rules={[{ required: true, message: "请选择所在城市" }]}
      >
        <Select
          showSearch
          placeholder={province ? "请选择城市" : "请先选择省份"}
          disabled={!province}
          options={cities}
        />
      </Form.Item>
    </div>
  );
}

/** 名录列表页的省市筛选条（选了省份才能选城市，清空即恢复全部）。 */
export function LocationFilterBar({
  value,
  onChange,
}: {
  value: LocationValue;
  onChange: (next: LocationValue) => void;
}) {
  const regions = useLocationDictionary().data ?? EMPTY_REGIONS;
  const cities = useMemo(
    () => citiesOf(regions, value.province),
    [regions, value.province],
  );
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      <LocationDictionaryError />
      <Select
        style={{ width: 132 }}
        allowClear
        showSearch
        placeholder="全部省份"
        value={value.province || undefined}
        options={regions.map((region) => ({
          value: region.value,
          label: region.label,
        }))}
        onChange={(next?: string) =>
          onChange({ province: next || "", city: "" })
        }
      />
      <Select
        style={{ width: 132 }}
        allowClear
        showSearch
        placeholder="全部城市"
        disabled={!value.province}
        value={value.city || undefined}
        options={cities}
        onChange={(next?: string) =>
          onChange({ ...value, city: next || "" })
        }
      />
    </div>
  );
}

/**
 * 需求 / 服务的「地域范围」三态（口径对齐 AIworkin）：不限制 / 指定地区（省、市）/ 经纬度坐标。
 * 指定地区和经纬度都算「有省、市」——经纬度由后端解析成省、市，因此列表筛选对两种模式同样生效。
 * 位置跟着需求本身走，不取发布主体（企业 / 服务商）档案上的省、市。
 */
export const REGION_MODE_OPTIONS = [
  { value: "NONE", label: "不限制" },
  { value: "REGION", label: "指定地区" },
  { value: "RADIUS", label: "经纬度坐标" },
];

/** 表单里的「地域范围」（字段名 region_mode / province / city / longitude / latitude / radius_km）。 */
export function RegionScopeFields({
  label = "地域范围",
  extra,
  modeField = "region_mode",
  modeOptions = REGION_MODE_OPTIONS,
  required = false,
}: {
  label?: string;
  extra?: string;
  /** 服务侧的三态键名是 service_area_mode，且「不限制」取值为 NATIONWIDE。 */
  modeField?: string;
  modeOptions?: { value: string; label: string }[];
  required?: boolean;
}) {
  const form = Form.useFormInstance();
  const regions = useLocationDictionary().data ?? EMPTY_REGIONS;
  const fallbackMode = modeOptions[0].value;
  const mode = Form.useWatch(modeField, form) || fallbackMode;
  const province = Form.useWatch("province", form);
  const cities = useMemo(() => citiesOf(regions, province), [regions, province]);
  return (
    <>
      <Form.Item
        name={modeField}
        label={label}
        initialValue={fallbackMode}
        extra={<>{extra}<LocationDictionaryError /></>}
        rules={
          required
            ? [{ required: true, message: `请选择${label}` }]
            : undefined
        }
      >
        <Select
          options={modeOptions}
          onChange={() => {
            form.setFieldsValue({
              province: undefined,
              city: undefined,
              longitude: undefined,
              latitude: undefined,
              radius_km: undefined,
            });
          }}
        />
      </Form.Item>
      {mode === "REGION" ? (
        <div className="form-2col">
          <Form.Item
            name="province"
            label="省份"
            rules={[{ required: true, message: "请选择省份" }]}
          >
            <Select
              showSearch
              placeholder="请选择省份"
              options={regions.map((region) => ({
                value: region.value,
                label: region.label,
              }))}
              onChange={() => form.setFieldValue("city", undefined)}
            />
          </Form.Item>
          <Form.Item
            name="city"
            label="城市"
            rules={[{ required: true, message: "请选择城市" }]}
          >
            <Select
              showSearch
              placeholder={province ? "请选择城市" : "请先选择省份"}
              disabled={!province}
              options={cities}
            />
          </Form.Item>
        </div>
      ) : null}
      {mode === "RADIUS" ? (
        <div className="form-2col">
          <Form.Item
            name="longitude"
            label="经度"
            rules={[{ required: true, message: "请填写经度" }]}
            extra="省、市按坐标自动解析（最近的城市中心点）"
          >
            <Input type="number" placeholder="-180 ~ 180" />
          </Form.Item>
          <Form.Item
            name="latitude"
            label="纬度"
            rules={[{ required: true, message: "请填写纬度" }]}
          >
            <Input type="number" placeholder="-90 ~ 90" />
          </Form.Item>
          <Form.Item
            name="radius_km"
            label="半径（公里）"
            rules={[{ required: true, message: "请填写半径公里数" }]}
          >
            <Input type="number" placeholder="如 50" />
          </Form.Item>
        </div>
      ) : null}
    </>
  );
}

/**
 * 需求行 → 「地域范围」表单值（编辑态回填用）。
 * 存量行的自由文本 / 未知取值一律按「不限制」显示，不改数据、不静默回填。
 */
export function regionFormValues(row: {
  regionMode?: string;
  province?: string;
  city?: string;
  longitude?: number | null;
  latitude?: number | null;
  radiusKm?: number | null;
}): Record<string, unknown> {
  const mode =
    row.regionMode === "REGION" || row.regionMode === "RADIUS"
      ? row.regionMode
      : "NONE";
  return {
    region_mode: mode,
    province: mode === "REGION" ? row.province || undefined : undefined,
    city: mode === "REGION" ? row.city || undefined : undefined,
    longitude: mode === "RADIUS" ? row.longitude ?? undefined : undefined,
    latitude: mode === "RADIUS" ? row.latitude ?? undefined : undefined,
    radius_km: mode === "RADIUS" ? row.radiusKm ?? undefined : undefined,
  };
}

/**
 * 需求列表的省市筛选条：省、市下拉首项都是「不限制」（＝该维度不参与筛选）。
 * 未选省时城市无意义，因此城市下拉在省为空时不可选。
 */
export function RegionScopeFilter({
  value,
  onChange,
}: {
  value: LocationValue;
  onChange: (next: LocationValue) => void;
}) {
  const regions = useLocationDictionary().data ?? EMPTY_REGIONS;
  const cities = useMemo(
    () => citiesOf(regions, value.province),
    [regions, value.province],
  );
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
      <LocationDictionaryError />
      <Select
        style={{ width: 132 }}
        showSearch
        value={value.province || ""}
        options={[
          { value: "", label: "省份：不限制" },
          ...regions.map((region) => ({
            value: region.value,
            label: region.label,
          })),
        ]}
        onChange={(next: string) => onChange({ province: next, city: "" })}
      />
      <Select
        style={{ width: 132 }}
        showSearch
        disabled={!value.province}
        value={value.province ? value.city || "" : undefined}
        placeholder={!value.province ? "请先选择省份" : undefined}
        options={[
          { value: "", label: "城市：不限制" },
          ...cities.map((city) => ({ value: city.value, label: city.label })),
        ]}
        onChange={(next: string) => onChange({ ...value, city: next })}
      />
    </div>
  );
}
