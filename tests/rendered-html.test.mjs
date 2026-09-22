import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("server renders the guzheng practice product", async () => {
  const html = await readFile(
    new URL("../.next/server/app/index.html", import.meta.url),
    "utf8",
  );
  assert.match(html, /<title>知音 · 古筝智能陪练<\/title>/i);
  assert.match(html, /古筝智能陪练/);
  assert.match(html, /每一个音/);
  assert.match(html, /原始录音不上云/);
  assert.match(html, /勾托指序/);
  assert.match(html, /待老师审核/);
  assert.doesNotMatch(html, /codex-preview|react-loading-skeleton/i);
});
