// 弹窗脚本：显示版本，并提供「信任此站点」开关。
// 分发是敏感操作（会在你已登录的平台代发内容），后台只接受白名单里的 origin 触发；
// 这里把当前标签页的 origin 增删到 chrome.storage.local.trustedOrigins，与 background 共用同一份。
(async () => {
  const manifest = chrome.runtime.getManifest();
  const ver = document.querySelector(".ver");
  if (ver && manifest) {
    ver.textContent = `v${manifest.version} · 多平台内容分发`;
  }

  const originEl = document.getElementById("origin");
  const btn = document.getElementById("trustBtn");
  const statusEl = document.getElementById("status");

  // 取当前活动标签页的 origin；无法解析（如浏览器内部页）则不允许信任。
  let origin = "";
  try {
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    origin = tab?.url ? new URL(tab.url).origin : "";
  } catch (_) {
    origin = "";
  }
  const usable = origin && origin !== "null";
  originEl.textContent = usable ? origin : "（非普通网页）";

  async function readTrusted() {
    const stored = await chrome.storage.local.get("trustedOrigins");
    return Array.isArray(stored?.trustedOrigins) ? stored.trustedOrigins : [];
  }

  async function render() {
    if (!usable) {
      btn.disabled = true;
      btn.textContent = "无法在此页信任";
      btn.classList.add("off");
      return;
    }
    const list = await readTrusted();
    const trusted = list.includes(origin);
    btn.disabled = false;
    btn.textContent = trusted ? "取消信任此站点" : "信任此站点";
    btn.classList.toggle("off", trusted);
    statusEl.textContent = trusted
      ? "已信任：此站点可触发分发。"
      : "未信任：此站点无法触发分发，需要时请点击上方按钮。";
  }

  btn.addEventListener("click", async () => {
    if (!usable) return;
    const list = await readTrusted();
    const next = list.includes(origin)
      ? list.filter((item) => item !== origin)
      : [...list, origin];
    await chrome.storage.local.set({ trustedOrigins: next });
    await render();
  });

  await render();
})();
