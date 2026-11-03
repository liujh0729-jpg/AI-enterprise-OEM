import type { ProLayoutProps } from "@ant-design/pro-components";
import { PRODUCT_LOGO_SRC, PRODUCT_NAME } from "@/lib/brand";

export const defaultSettings: ProLayoutProps & { logo?: string } = {
  navTheme: "light",
  colorPrimary: "#1677ff",
  layout: "mix",
  contentWidth: "Fluid",
  fixedHeader: false,
  fixSiderbar: true,
  colorWeak: false,
  title: PRODUCT_NAME,
  logo: PRODUCT_LOGO_SRC,
  token: {},
};

export const PRO_AVATAR =
  "https://gw.alipayobjects.com/zos/antfincdn/XAosXuNZyF/BiazfanxmamNRoxxVxka.png";

export const PRO_LAYOUT_BACKGROUNDS = [
  {
    src: "https://mdn.alipayobjects.com/yuyan_qk0oxh/afts/img/D2LWSqNny4sAAAAAAAAAAAAAFl94AQBr",
    left: 85,
    bottom: 100,
    height: "303px",
  },
  {
    src: "https://mdn.alipayobjects.com/yuyan_qk0oxh/afts/img/C2TWRpJpiC0AAAAAAAAAAAAAFl94AQBr",
    bottom: -68,
    right: -45,
    height: "303px",
  },
  {
    src: "https://mdn.alipayobjects.com/yuyan_qk0oxh/afts/img/F6vSTbj8KpYAAAAAAAAAAAAAFl94AQBr",
    bottom: 0,
    left: 0,
    width: "331px",
  },
];
