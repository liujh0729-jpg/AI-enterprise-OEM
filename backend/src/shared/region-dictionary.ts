import { GEO_CENTERS } from './geo-regions';

/**
 * 本地内置省市字典（AIworkin 通道未启用 / 平台与用户均未绑定 AIPDD Key 时的兜底）。
 * 数据来自 `GEO_CENTERS`（482 条省 + 地级市，同名口径与平台省市字典一致，见该文件注释），
 * 结构与上游 `GET /enterprise/connections/resources/locations` 完全对齐：
 * 一级为省（label/value 同名），二级 children 为该省城市（label/value 同名）。
 * 直辖市与港澳台在源表里已带「省市同名」一条，前端 `citiesOf()` 的补「全市」逻辑天然不触发。
 */
export type RegionOption = {
  label: string;
  value: string;
  children: { label: string; value: string }[];
};

let dictionary: RegionOption[] | null = null;

/** 构建（并缓存）本地省市字典：省与省内城市都按源表出现顺序排列，重复项去重。 */
export function localRegionDictionary(): RegionOption[] {
  if (dictionary) return dictionary;
  const provinces: RegionOption[] = [];
  const indexOf = new Map<string, RegionOption>();
  const citiesOf = new Map<string, Set<string>>();
  for (const [province, city] of GEO_CENTERS) {
    if (!province) continue;
    let row = indexOf.get(province);
    if (!row) {
      row = { label: province, value: province, children: [] };
      indexOf.set(province, row);
      citiesOf.set(province, new Set<string>());
      provinces.push(row);
    }
    if (!city || city === province) continue;
    const seen = citiesOf.get(province)!;
    if (seen.has(city)) continue;
    seen.add(city);
    row.children.push({ label: city, value: city });
  }
  dictionary = provinces;
  return provinces;
}
