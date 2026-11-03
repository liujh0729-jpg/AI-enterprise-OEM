"use client";

import { CheckOutlined, GlobalOutlined } from "@ant-design/icons";
import { Button, Dropdown } from "antd";
import { accountApi } from "@/api/account";
import { LANGUAGES, useI18n } from "@/lib/i18n/i18n";
import { useSession } from "@/lib/session";

/**
 * 界面语言切换器（登录页右上角 / 工作台顶栏）：
 * 选项一律用母语自称（任何语言的使用者都能找到自己）；
 * 已登录时顺手把语言码写回账号（users.lang），作为跨设备偏好记录，失败不打扰。
 */
export function LanguageSwitcher({ compact = false }: { compact?: boolean }) {
  const { lang, setLang } = useI18n();
  const { me } = useSession();
  return (
    <Dropdown
      trigger={["click"]}
      menu={{
        selectedKeys: [lang],
        items: LANGUAGES.map((l) => ({
          key: l.code,
          icon: l.code === lang ? <CheckOutlined /> : null,
          label: l.label,
        })),
        onClick: ({ key }) => {
          setLang(key);
          if (me) void accountApi.saveLang(key).catch(() => {});
        },
      }}
    >
      <Button type="text" size="small" icon={<GlobalOutlined aria-hidden />} aria-label="切换语言">
        {compact ? null : LANGUAGES.find((l) => l.code === lang)?.label}
      </Button>
    </Dropdown>
  );
}
