import { text } from '../common/api';
import { BusinessException } from '../common/business.exception';
import { ErrorCode } from '../common/error-code';
import { GEO_CENTERS } from './geo-regions';
import type {
  DemandGeoConfig,
  ServiceAreaInput,
} from '../aiworkin/aiworkin.types';
/**
 * 地域范围三态（2026-09-25 用户指令，口径对齐 AIworkin）：
 * - `NONE`＝不限制、`REGION`＝指定地区（省、市）、`RADIUS`＝经纬度坐标（含半径公里）；
 * - **指定地区和经纬度都算「有省、市」**：`RADIUS` 由经纬度按最近城市中心点解析出省、市
 *   （`GEO_CENTERS`，见 geo-regions.ts），因此需求列表的省市筛选对两种模式同样生效；
 * - **位置跟着需求本身走，不跟着发布主体走**：不取企业 / 服务商档案上的省、市，未选就是空；
 * - 三态与 AIworkin 契约一一对应：需求侧 `a2aConfig.geoMatchMode`、服务侧 `serviceArea.mode`
 *   （`NONE` 在服务侧映射为平台的不限制值 `NATIONWIDE`）；
 * - 旧的自由文本 `region_scope` 列不再作为输入，改为**派生展示文案**（`label`），
 *   外部接口只传自由文本时按「不限制 + 原文案」存，存量行不静默回填。
 */
export const REGION_MODES = ['NONE', 'REGION', 'RADIUS'] as const;
export type RegionMode = (typeof REGION_MODES)[number];
/** 服务侧「不限制」在 AIworkin 的取值（平台 serviceArea.mode 无 NONE）。 */
export const SERVICE_AREA_UNRESTRICTED = 'NATIONWIDE';
export type RegionScope = {
  mode: RegionMode;
  province: string;
  city: string;
  longitude: number | null;
  latitude: number | null;
  radiusKm: number | null;
  /** 一句话文案，用于「地域范围」展示与派生写入旧的 region_scope 列。 */
  label: string;
};
export const UNRESTRICTED_REGION_LABEL = '不限制';
function clip(value: string, max: number) {
  return value.slice(0, max);
}
/** 表单可能同时给 snake_case 与 camelCase（板块内两套键名并存）。 */
function pick(body: Record<string, unknown>, ...keys: string[]) {
  for (const key of keys) {
    const value = text(body[key]).trim();
    if (value !== '') return value;
  }
  return '';
}
function bad(message: string): never {
  throw new BusinessException(ErrorCode.BAD_REQUEST, message);
}
function toCoordinate(value: string, label: string, min: number, max: number) {
  const num = Number(value);
  if (!Number.isFinite(num)) bad(`请填写${label}`);
  if (num < min || num > max) {
    bad(`${label}需在 ${min} ~ ${max} 之间（当前 ${value}）`);
  }
  return Number(num.toFixed(6));
}
/** 「浙江省杭州市」；省市同名（直辖市）只保留一次。 */
function locationLabel(province: string, city: string) {
  if (!city || city === province) return province;
  if (!province) return city;
  return `${province}${city}`;
}
/**
 * 经纬度 → 省、市：按球面距离取最近的城市中心点。
 * 解析结果一定落在省市字典的可选项内（中心点表与字典同源）。
 */
export function locateByCoordinates(longitude: number, latitude: number) {
  let best = GEO_CENTERS[0];
  let bestDistance = Number.POSITIVE_INFINITY;
  for (const row of GEO_CENTERS) {
    const distance = approxDistanceKm(longitude, latitude, row[2], row[3]);
    if (distance < bestDistance) {
      bestDistance = distance;
      best = row;
    }
  }
  return {
    province: best[0],
    city: best[1],
    /** 距最近城市中心点的公里数，仅用于日志与提示，不落库 */
    distanceKm: Math.round(bestDistance),
  };
}
function approxDistanceKm(
  lng1: number,
  lat1: number,
  lng2: number,
  lat2: number,
) {
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const earthRadiusKm = 6371;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * earthRadiusKm * Math.asin(Math.sqrt(a));
}
function label(
  mode: RegionMode,
  province: string,
  city: string,
  radiusKm: number | null,
) {
  if (mode === 'NONE') return UNRESTRICTED_REGION_LABEL;
  const place = locationLabel(province, city);
  if (mode === 'REGION') return place;
  return `${place}（半径 ${radiusKm} 公里）`;
}
function normalizeMode(value: string): RegionMode | null {
  const raw = value.toUpperCase();
  if (!REGION_MODES.includes(raw as RegionMode)) return null;
  return raw as RegionMode;
}
/**
 * 解析表单 / 接口入参的地域范围。
 * 返回 `null` 表示入参既没有三态、也没有旧自由文本（修改时应保持原值不动）。
 */
export function regionFromBody(
  body: Record<string, unknown>,
): RegionScope | null {
  const rawMode = pick(body, 'region_mode', 'regionMode', 'geoMatchMode');
  const legacy = clip(
    pick(body, 'region_scope', 'regionScope', '地域范围'),
    200,
  );
  if (!rawMode) {
    if (!legacy) return null;
    // 外部接口只传自由文本：按「不限制」存原文案，界面仍可读
    return {
      mode: 'NONE',
      province: '',
      city: '',
      longitude: null,
      latitude: null,
      radiusKm: null,
      label: legacy,
    };
  }
  const mode = normalizeMode(rawMode);
  if (!mode) {
    bad(`地域范围只支持 NONE 不限制 / REGION 指定地区 / RADIUS 经纬度坐标`);
  }
  if (mode === 'NONE') {
    return {
      mode,
      province: '',
      city: '',
      longitude: null,
      latitude: null,
      radiusKm: null,
      label: UNRESTRICTED_REGION_LABEL,
    };
  }
  if (mode === 'REGION') {
    const province = clip(pick(body, 'province', '省份'), 48);
    const city = clip(pick(body, 'city', '城市'), 48);
    if (!province || !city) {
      bad('指定地区需要同时选择省份与城市（或把地域范围改为不限制）');
    }
    return {
      mode,
      province,
      city,
      longitude: null,
      latitude: null,
      radiusKm: null,
      label: label(mode, province, city, null),
    };
  }
  const longitude = toCoordinate(
    pick(body, 'longitude', '经度'),
    '经度',
    -180,
    180,
  );
  const latitude = toCoordinate(
    pick(body, 'latitude', '纬度'),
    '纬度',
    -90,
    90,
  );
  const radiusRaw = pick(body, 'radius_km', 'radiusKm', '半径');
  const radiusKm = Number(radiusRaw);
  if (!Number.isFinite(radiusKm) || radiusKm <= 0) {
    bad('经纬度范围需要填写大于 0 的半径（公里）');
  }
  const resolved = locateByCoordinates(longitude, latitude);
  return {
    mode,
    province: resolved.province,
    city: resolved.city,
    longitude,
    latitude,
    radiusKm: Number(radiusKm.toFixed(2)),
    label: label(mode, resolved.province, resolved.city, radiusKm),
  };
}
/** 新增：未带地域范围入参时按「不限制」落库（与表单默认值一致）。 */
export function regionForCreate(body: Record<string, unknown>): RegionScope {
  return (
    regionFromBody(body) || {
      mode: 'NONE',
      province: '',
      city: '',
      longitude: null,
      latitude: null,
      radiusKm: null,
      label: UNRESTRICTED_REGION_LABEL,
    }
  );
}
/**
 * 服务侧（AIworkin `serviceArea.mode`）入参 → 三态：
 * `NATIONWIDE`（全国）与存量 `REMOTE`（远程交付）都算「不限制」，`REGION` / `RADIUS` 同名透传。
 */
export function regionFromServiceBody(
  body: Record<string, unknown>,
): RegionScope {
  const raw = text(
    body.service_area_mode ?? body.serviceAreaMode,
  ).toUpperCase();
  return regionForCreate({
    ...body,
    region_mode: raw === 'REMOTE' || raw === 'NATIONWIDE' ? 'NONE' : raw,
  });
}
/** 列表筛选条件：省 / 市任一为空即不参与过滤（界面下拉首项「不限制」＝不筛选）。 */
export type RegionFilter = {
  province?: string;
  city?: string;
};
/** 落库列片段（七张需求表同名）；自由文本列（region_scope / origin / fields）由调用方写 label。 */
export function regionColumns(scope: RegionScope) {
  return {
    regionMode: scope.mode,
    province: scope.province,
    city: scope.city,
    longitude: scope.longitude,
    latitude: scope.latitude,
    radiusKm: scope.radiusKm,
  };
}
/** 列表筛选条件：省 / 市任一为空即不参与过滤（界面下拉首项「不限制」＝不筛选）。 */
export function regionFilterWhere(filter: RegionFilter): {
  province?: string;
  city?: string;
} {
  const province = clip(text(filter.province).trim(), 48);
  const city = clip(text(filter.city).trim(), 48);
  return {
    ...(province ? { province } : {}),
    ...(city ? { city } : {}),
  };
}
/** 落库后的地域列（需求表 `region_mode` / 服务表 `service_area_mode` 同名其余列）。 */
export type RegionRow = {
  regionMode?: string | null;
  serviceAreaMode?: string | null;
  province?: string | null;
  city?: string | null;
  longitude?: number | null;
  latitude?: number | null;
  radiusKm?: number | null;
};
/**
 * 需求行 → 平台 `a2aConfig` 地域字段：三态跟着需求本身走，顶层 province/city 会被平台拒收。
 * `NONE` 不带任何地域明细；`RADIUS` 同时带坐标与解析出的省市（平台只留坐标，省市供本地筛选）。
 */
export function demandGeoConfig(row: RegionRow): DemandGeoConfig {
  const mode = normalizeMode(String(row.regionMode || '')) || 'NONE';
  if (mode === 'NONE') return { geoMatchMode: 'NONE' };
  return {
    geoMatchMode: mode,
    ...(row.province ? { province: row.province } : {}),
    ...(row.city ? { city: row.city } : {}),
    ...(mode === 'RADIUS'
      ? {
          longitude: row.longitude ?? undefined,
          latitude: row.latitude ?? undefined,
          radiusKm: row.radiusKm ?? undefined,
        }
      : {}),
  };
}
/**
 * 服务行 → 平台 `serviceArea`：`NONE`（不限制）在服务侧是平台值 `NATIONWIDE`，
 * 存量 `REMOTE`（远程交付）原样透传（平台仍接受，界面已不提供）。
 */
export function serviceAreaPayload(row: RegionRow): ServiceAreaInput {
  const stored = String(row.serviceAreaMode || '').toUpperCase();
  const mode =
    stored === 'REGION' || stored === 'RADIUS'
      ? stored
      : SERVICE_AREA_UNRESTRICTED;
  if (mode === 'REGION') {
    return {
      mode,
      ...(row.province ? { province: row.province } : {}),
      ...(row.city ? { city: row.city } : {}),
    };
  }
  if (mode === 'RADIUS') {
    return {
      mode,
      ...(row.province ? { province: row.province } : {}),
      ...(row.city ? { city: row.city } : {}),
      longitude: row.longitude ?? undefined,
      latitude: row.latitude ?? undefined,
      radiusKm: row.radiusKm ?? undefined,
    };
  }
  return { mode };
}
