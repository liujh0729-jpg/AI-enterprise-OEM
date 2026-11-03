/** 建联失败提示的离线回归：运行真实组件及异步回调，不连接数据库或线上平台。 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import test from "node:test";
import { runInNewContext } from "node:vm";

const require = createRequire(new URL("../frontend/package.json", import.meta.url));
const ts = require("typescript");
const filename = new URL("../frontend/src/app/marketing-tools/_components/connections-tab.tsx", import.meta.url);
const { outputText } = ts.transpileModule(readFileSync(filename, "utf8"), {
  fileName: filename.pathname,
  compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 },
});
const resource = {
  id: "upstream-resource", sourceType: "talent", category: "marketing",
  name: "平台资源", tags: [], favorited: false,
};
const upstreamPage = { list: [resource], total: 42, page: 1, pageSize: 9, source: "AIWORKIN" };

function mount(reply) {
  const states = [];
  const effects = [];
  const calls = [];
  const errors = [];
  let stateIndex = 0;
  let effectIndex = 0;
  let pendingEffects = [];
  let dirty = true;
  let tree;
  // 组件无 DOM 依赖；用最小 hook 驱动器运行真实加载、重试及回滚逻辑。
  const hooks = {
    useState(initial) {
      const index = stateIndex++;
      if (!(index in states)) states[index] = typeof initial === "function" ? initial() : initial;
      return [states[index], (value) => {
        const next = typeof value === "function" ? value(states[index]) : value;
        if (!Object.is(states[index], next)) { states[index] = next; dirty = true; }
      }];
    },
    useEffect(callback, dependencies) {
      const index = effectIndex++;
      const previous = effects[index];
      if (!previous || dependencies.some((value, i) => !Object.is(value, previous.dependencies[i]))) {
        pendingEffects.push(() => {
          previous?.cleanup?.();
          effects[index] = { dependencies, cleanup: callback() };
        });
      }
    },
    useMemo: (callback) => callback(),
    useCallback: (callback) => callback,
    useRef(initial) {
      return hooks.useState(() => ({ current: initial }))[0];
    },
  };
  const exports = {};
  runInNewContext(outputText, {
    exports, AbortController, URLSearchParams, Error,
    require: (name) => {
      if (name === "react") return hooks;
      if (name === "react/jsx-runtime") return require(name);
      if (name === "@ant-design/icons") return new Proxy({}, { get: (_, key) => String(key) });
      if (name === "antd") return {
        App: { useApp: () => ({ message: { error: (text) => errors.push(text), warning: (text) => errors.push(text) } }) },
        Button: "button", Input: "input", Modal: "dialog", Select: "select", Spin: "span",
      };
      if (name === "@/components/ui/panel") return { Panel: "section", Notice: "aside", ColumnSwitch: "column-switch" };
      if (name === "@/lib/session") return { useSession: () => ({ me: { userId: "fixture" } }) };
      if (name === "@/lib/api") return {
        apiData: async (url, options = {}) => {
          calls.push({ url, options });
          if (reply) {
            const result = await reply(url, options);
            if (result !== undefined) return result;
          }
          return url.includes("resources?") ? upstreamPage : { list: [], source: "AIWORKIN" };
        },
      };
      throw new Error(`Unexpected import: ${name}`);
    },
  });
  return {
    calls, errors,
    get tree() { return tree; },
    async settle() {
      for (let pass = 0; pass < 20; pass++) {
        if (dirty) {
          dirty = false;
          stateIndex = 0;
          effectIndex = 0;
          pendingEffects = [];
          tree = exports.ConnectionsTab();
          pendingEffects.forEach((effect) => effect());
        }
        await new Promise(setImmediate);
        if (!dirty) return;
      }
      throw new Error("Component did not settle");
    },
    unmount() { effects.forEach((effect) => effect.cleanup?.()); },
  };
}

function nodes(node) {
  if (node == null || typeof node === "boolean") return [];
  if (Array.isArray(node)) return node.flatMap(nodes);
  return [node, ...nodes(node.props?.children)];
}
const text = (node) => nodes(node).filter((item) => typeof item === "string" || typeof item === "number").join("");
const find = (app, predicate) => nodes(app.tree).find((node) => node?.props && predicate(node));
const card = (app) => find(app, (node) => node.type?.name === "ResourceCard");
const button = (app, label) => find(app, (node) => node.type === "button" && text(node) === label);
const alertText = (app) => nodes(app.tree).filter((node) => node?.props?.role === "alert").map(text).join(" ");

test("资源鉴权失败显示原因与重试，重试成功后显示平台资源", async () => {
  let failed = true;
  const app = mount((url) => {
    if (failed && url.includes("resources?")) throw new Error("AIworkin 通道鉴权失败：令牌已过期");
  });
  await app.settle();
  assert.match(alertText(app), /AIworkin 通道鉴权失败：令牌已过期/);
  assert.match(text(app.tree), /资源数量暂不可用/);
  assert(!text(app.tree).includes("没有找到符合条件"));
  assert.equal(card(app), undefined);
  failed = false;
  button(app, "重试").props.onClick();
  await app.settle();
  assert.equal(alertText(app), "");
  assert.equal(card(app).props.resource.id, resource.id);
  assert.match(text(app.tree), /共计42/);
  app.unmount();
});

test("筛选字典失败显示具体选项与原因，允许单独重试", async () => {
  let failed = true;
  const app = mount((url) => {
    if (failed && url.includes("operation_platforms")) throw new Error("AIworkin 能力暂不可用");
  });
  await app.settle();
  assert.match(alertText(app), /筛选选项加载失败（运营平台）：AIworkin 能力暂不可用/);
  assert(card(app), "字典失败不掩盖已经成功加载的资源");
  failed = false;
  button(app, "重试筛选选项").props.onClick();
  await app.settle();
  assert.equal(alertText(app), "");
  assert.equal(app.calls.filter(({ url }) => url.includes("operation_platforms")).length, 2);
  app.unmount();
});

test("收藏写入失败恢复原状态并提示上游错误", async () => {
  let rejectWrite;
  const app = mount((url, options) => {
    if (options.method === "POST" && url.includes("favorites/talent/")) {
      return new Promise((_, reject) => { rejectWrite = reject; });
    }
  });
  await app.settle();
  card(app).props.onFavorite();
  await app.settle();
  assert.equal(card(app).props.resource.favorited, true);
  rejectWrite(new Error("AIworkin 能力暂不可用"));
  await app.settle();
  assert.equal(card(app).props.resource.favorited, false);
  assert.equal(card(app).props.favoritePending, false);
  assert.deepEqual(app.errors, ["收藏操作失败：AIworkin 能力暂不可用"]);
  assert.equal(app.calls.filter(({ options }) => options.method === "POST").length, 1);
  app.unmount();
});

test("收藏请求进行中阻止重复提交，完成后允许取消收藏", async () => {
  let completeWrite;
  const app = mount((url, options) => {
    if (options.method) return new Promise((resolve) => { completeWrite = resolve; });
  });
  await app.settle();
  const originalButton = card(app).props.onFavorite;
  originalButton();
  originalButton();
  await app.settle();
  assert.equal(app.calls.filter(({ options }) => options.method).length, 1);
  assert.equal(card(app).props.favoritePending, true);
  const pendingCard = card(app);
  const pendingFavorite = nodes(pendingCard.type(pendingCard.props)).find((node) => node?.type?.name === "FavoriteButton");
  assert.equal(pendingFavorite.type(pendingFavorite.props).props.disabled, true);
  assert.equal(pendingFavorite.type(pendingFavorite.props).props.loading, true);
  card(app).props.onFavorite();
  await app.settle();
  assert.equal(app.calls.filter(({ options }) => options.method).length, 1);
  completeWrite({ favorited: true, source: "AIWORKIN" });
  await app.settle();
  assert.equal(card(app).props.favoritePending, false);
  card(app).props.onFavorite();
  await app.settle();
  assert.equal(app.calls.filter(({ options }) => options.method).at(-1).options.method, "DELETE");
  completeWrite({ favorited: false, source: "AIWORKIN" });
  await app.settle();
  assert.equal(card(app).props.resource.favorited, false);
  app.unmount();
});

for (const [category, sourceType, favoriteType] of [
  ["marketing", "talent", "talent"],
  ["individual", "profile", "profile"],
  ["company", "profile", "profile"],
]) {
  test(`${category} 收藏与取消收藏使用对应资源接口并采用平台返回状态`, async () => {
    const fixture = { ...resource, category, sourceType };
    const app = mount((url, options) => {
      if (url.includes("resources?")) return { ...upstreamPage, list: [fixture] };
      if (options.method) return { favorited: options.method === "POST", source: "AIWORKIN" };
    });
    await app.settle();
    find(app, (node) => node.type === "column-switch").props.onChange(category);
    await app.settle();
    card(app).props.onFavorite();
    await app.settle();
    assert.equal(card(app).props.resource.favorited, true);
    card(app).props.onFavorite();
    await app.settle();
    assert.equal(card(app).props.resource.favorited, false);
    assert.deepEqual(app.calls.filter(({ options }) => options.method).map(({ url, options }) => [url, options.method]), [
      [`/enterprise/connections/favorites/${favoriteType}/${resource.id}`, "POST"],
      [`/enterprise/connections/favorites/${favoriteType}/${resource.id}`, "DELETE"],
    ]);
    assert.deepEqual(app.errors, []);
    app.unmount();
  });
}

test("联系方式权限失败显示原因，不显示尚未提供联系方式", async () => {
  const app = mount((url) => {
    if (url.endsWith("/contact")) throw new Error("当前账号无权查看联系方式");
  });
  await app.settle();
  card(app).props.onDetails();
  await app.settle();
  assert.match(alertText(app), /联系方式获取失败：当前账号无权查看联系方式/);
  assert(!text(app.tree).includes("该资源暂未提供联系方式"));
  app.unmount();
});

test("拒绝演示响应，并在后续查询失败时清除旧资源及旧数量", async () => {
  let mode = "success";
  const app = mount((url) => {
    if (!url.includes("resources?")) return;
    if (mode === "demo") return { ...upstreamPage, source: "DEMO" };
    if (mode === "failed") throw new Error("AIworkin 通道不可达");
  });
  await app.settle();
  assert(card(app));
  mode = "failed";
  find(app, (node) => node.type === "select" && node.props.value === 9).props.onChange(18);
  await app.settle();
  assert.match(alertText(app), /AIworkin 通道不可达/);
  assert.equal(card(app), undefined);
  assert(!text(app.tree).includes("共计42"));
  const tabs = find(app, (node) => node.type === "column-switch");
  assert.equal(tabs.props.options[0].label, "营销达人");
  mode = "demo";
  button(app, "重试").props.onClick();
  await app.settle();
  assert.match(alertText(app), /建联资源未返回平台数据/);
  assert.equal(card(app), undefined);
  app.unmount();
});
