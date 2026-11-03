import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { test } from "node:test";
import { runInNewContext } from "node:vm";

const require = createRequire(
  new URL("../backend/package.json", import.meta.url),
);
const ts = require("typescript");
const source = readFileSync(
  new URL("../frontend/src/lib/upload-attachments.ts", import.meta.url),
  "utf8",
);
const { outputText } = ts.transpileModule(source, {
  compilerOptions: {
    module: ts.ModuleKind.CommonJS,
    target: ts.ScriptTarget.ES2022,
  },
});

function setup() {
  const exports = {};
  class FileReader {
    readAsDataURL(file) {
      if (file.name === "unreadable.png") {
        queueMicrotask(() => this.onerror());
        return;
      }
      void file.arrayBuffer().then((bytes) => {
        this.result = `data:${file.type};base64,${Buffer.from(bytes).toString("base64")}`;
        this.onload();
      });
    }
  }
  runInNewContext(outputText, {
    exports,
    Error,
    FileReader,
  });
  return exports;
}

const file = (name = "test.png", size = 3) =>
  new File([Buffer.alloc(size)], name, { type: "image/png" });
const success = (name) => ({
  files: [{name,url:`https://example.test/${name}`}],
});

test("each 10MB file gets its own request and is retained immediately", async () => {
  const accepted = [];
  const requests = [];
  const { uploadAttachments } = setup();
  const upload=async ({body}) => {
    assert.equal(accepted.length, requests.length);
    assert.equal(body.files.length, 1);
    assert.equal(
      Buffer.from(body.files[0].contentBase64, "base64").length,
      10 * 1024 * 1024,
    );
    assert.ok(Buffer.byteLength(JSON.stringify(body)) < 16 * 1024 * 1024);
    requests.push(body);
    return success(body.files[0].name);
  };
  const count = await uploadAttachments(
    upload,
    [file("one.png", 10 * 1024 * 1024), file("two.png", 10 * 1024 * 1024)],
    (rows) => accepted.push(...rows),
  );
  assert.equal(count, 2);
  assert.deepEqual(
    accepted.map((row) => row.name),
    ["one.png", "two.png"],
  );
});

test("a later OSS failure preserves earlier files and stops the remaining uploads", async () => {
  let requests = 0;
  const accepted = [];
  const { uploadAttachments } = setup();
  const upload=async()=>{if(++requests===1)return success("one.png");throw new Error("OSS unavailable");};
  await assert.rejects(
    uploadAttachments(
      upload,
      [file("one.png"), file("two.png"), file("three.png")],
      (rows) => accepted.push(...rows),
    ),
    /two.png.*OSS unavailable.*已保留 1/,
  );
  assert.equal(requests, 2);
  assert.equal(accepted.length, 1);
});

for (const [name, size, message] of [
  ["too-large.png", 10 * 1024 * 1024 + 1, /超过 10MB/],
  ["empty.png", 0, /内容为空/],
  ["page.html", 3, /仅支持/],
]) {
  test(`validates the entire selection before uploading: ${name}`, async () => {
    let requests = 0;
    const { uploadAttachments } = setup();
    const upload=async()=>{
      requests++;
      return success("unexpected");
    };
    await assert.rejects(
      uploadAttachments(upload, [file(), file(name, size)], () => {}),
      message,
    );
    assert.equal(requests, 0);
  });
}

test("network failures include the file name", async () => {
  const { uploadAttachments } = setup();
    const upload=async()=>{
    throw new Error("network down");
  };
  await assert.rejects(
    uploadAttachments(upload, [file("license.PNG")], () => {}),
    /license.PNG.*network down/,
  );
});

test("file read failures surface before sending a request", async () => {
  const { uploadAttachments } = setup();
  const upload=async()=>assert.fail("must not send an unreadable file");
  await assert.rejects(
    uploadAttachments(upload, [file("unreadable.png")], () => {}),
    /读取.*失败/,
  );
});

test("malformed success responses cannot silently discard attachments", async () => {
  const { uploadAttachments } = setup();
  const upload=async()=>({files:[]});
  await assert.rejects(
    uploadAttachments(upload, [file()], () =>
      assert.fail("must not accept an empty result"),
    ),
    /结果异常/,
  );
});
