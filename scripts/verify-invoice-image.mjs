import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

const require = createRequire(new URL("../backend/package.json", import.meta.url));
const ts = require("typescript");
const { outputText } = ts.transpileModule(readFileSync(new URL("../frontend/src/lib/invoice-image.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
});

function setup({ read = "ok", decode = true, context = true, output = "data:image/jpeg;base64,aW1hZ2U=" } = {}) {
  const exports = {};
  const calls = [];
  const ctx = {
    fillStyle: "",
    fillRect: () => calls.push(["background", ctx.fillStyle]),
    drawImage: () => calls.push(["draw"]),
  };
  const canvas = {
    getContext: () => context ? ctx : null,
    toDataURL: () => output,
  };
  class FileReader {
    readAsDataURL() {
      calls.push(["read"]);
      queueMicrotask(() => {
        if (read === "abort") this.onabort();
        else if (read === "error") this.onerror();
        else { this.result = "data:image/png;base64,aW1hZ2U="; this.onload(); }
      });
    }
  }
  class Image {
    width = 2000;
    height = 1000;
    set src(_value) { queueMicrotask(() => decode ? this.onload() : this.onerror()); }
  }
  runInNewContext(outputText, { exports, Error, FileReader, Image, document: { createElement: () => canvas } });
  return { ...exports, calls, canvas };
}

const image = (name = "发票.png", size = 5) => new File([Buffer.alloc(size)], name, { type: "image/png" });

test("compresses to bounded dimensions with a white background for transparent invoices", async () => {
  const { compressInvoiceImage, calls, canvas } = setup();
  const result = await compressInvoiceImage(image());
  assert.equal(result.mime, "image/jpeg");
  assert.equal(result.base64, "aW1hZ2U=");
  assert.equal(canvas.width, 1600);
  assert.equal(canvas.height, 800);
  assert.deepEqual(calls, [["read"], ["background", "#ffffff"], ["draw"]]);
});

for (const [name, size, reason] of [["发票.svg", 5, /仅支持/], ["发票.png", 0, /内容为空/], ["发票.png", 10 * 1024 * 1024 + 1, /超过 10MB/]]) {
  test(`rejects unsupported or invalid sources before reading: ${name}/${size}`, async () => {
    const { compressInvoiceImage, calls } = setup();
    await assert.rejects(compressInvoiceImage(image(name, size)), reason);
    assert.equal(calls.length, 0);
  });
}

for (const [options, reason] of [
  [{ read: "abort" }, /已取消/],
  [{ read: "error" }, /读取.*失败/],
  [{ decode: false }, /解码失败/],
  [{ context: false }, /无法处理图片/],
  [{ output: "data:," }, /压缩失败/],
  [{ output: `data:image/jpeg;base64,${"x".repeat(12 * 1024 * 1024)}` }, /超过 8MB/],
]) {
  test(`surfaces image processing failures: ${reason}`, async () => {
    await assert.rejects(setup(options).compressInvoiceImage(image()), reason);
  });
}
