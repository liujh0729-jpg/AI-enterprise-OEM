import { describe, expect, it } from "vitest";
import { mentionAlive, nextMentionLabel, wiredMentions } from "./mention-field";

describe("nextMentionLabel", () => {
  it("按类型从 1 起编号，接着已用过的记号往后排，不受其它类型影响", () => {
    expect(nextMentionLabel([], "image")).toBe("图片1");
    expect(nextMentionLabel(["图片1", "图片2"], "image")).toBe("图片3");
    expect(nextMentionLabel(["图片1", "视频1"], "video")).toBe("视频2");
    expect(nextMentionLabel(["图片9", "视频2"], "audio")).toBe("音频1");
  });
});

describe("mentionAlive", () => {
  it("记号还在提示词里就算引用有效；数字后缀不算命中", () => {
    expect(mentionAlive("把 @图片1 放到海边", "图片1")).toBe(true);
    expect(mentionAlive("把 @图片11 放到海边", "图片1")).toBe(false);
    expect(mentionAlive("把 图片1 放到海边", "图片1")).toBe(false);
  });
});

describe("wiredMentions", () => {
  it("按类型编号并按地址去重，同时带上连线角色", () => {
    const list = wiredMentions([
      { role: "素材", media: "image", name: "人.png", url: "https://x/a.png", assetId: -1 },
      { role: "首帧", media: "image", name: "首.png", url: "https://x/b.png", assetId: -2 },
      { role: "素材", media: "audio", name: "乐.mp3", url: "https://x/c.mp3", assetId: -3 },
      { role: "素材", media: "image", name: "同图.png", url: "https://x/a.png", assetId: -4 },
    ]);
    expect(list.map((item) => item.label)).toEqual(["图片1", "图片2", "音频1"]);
    expect(list[1].roleLabel).toBe("首帧");
    expect(list.every((item) => item.source === "wired")).toBe(true);
  });

  it("没有地址的素材不进菜单", () => {
    expect(wiredMentions([{ role: "素材", media: "image", name: "空", url: "", assetId: 0 }])).toEqual(
      [],
    );
  });
});
