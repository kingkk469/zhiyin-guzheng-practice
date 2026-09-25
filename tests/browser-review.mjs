// Synthetic audio and mobile viewport; NOT a physical iPhone/guzheng test.
import { chromium } from "playwright";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
function wav() {
  const rate = 44100,
    length = rate * 3,
    b = Buffer.alloc(44 + length * 2);
  b.write("RIFF");
  b.writeUInt32LE(b.length - 8, 4);
  b.write("WAVEfmt ", 8);
  b.writeUInt32LE(16, 16);
  b.writeUInt16LE(1, 20);
  b.writeUInt16LE(1, 22);
  b.writeUInt32LE(rate, 24);
  b.writeUInt32LE(rate * 2, 28);
  b.writeUInt16LE(2, 32);
  b.writeUInt16LE(16, 34);
  b.write("data", 36);
  b.writeUInt32LE(length * 2, 40);
  for (let i = 0; i < length; i++) {
    let x = 0;
    for (const [n, m] of [62, 66, 69].entries()) {
      const age = i / rate - (0.25 + n * 0.7);
      if (age < 0) continue;
      const p = 2 * Math.PI * 440 * 2 ** ((m - 69) / 12) * age;
      x += 0.15 * Math.exp(-6 * age) * (Math.sin(p) + 0.3 * Math.sin(2 * p));
    }
    b.writeInt16LE(
      Math.max(-32767, Math.min(32767, Math.round(x * 32767))),
      44 + i * 2,
    );
  }
  return b;
}
const browser = await chromium.launch({
  channel: "msedge",
  headless: true,
  args: ["--no-proxy-server"],
});
try {
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } }),
    errors = [],
    uploads = [];
  page.on("pageerror", (e) => errors.push(e.message));
  page.on("request", (r) => {
    if (r.method() !== "GET") uploads.push(r.url());
  });
  await page.goto(
    process.env.TEST_BASE_URL ??
      "http://127.0.0.1:3219/zhiyin-guzheng-practice/",
  );
  await page
    .getByRole("button", { name: "试用新识别 · 录音复核", exact: true })
    .click();
  const dialog = page.getByRole("dialog");
  await dialog.waitFor();
  await page.getByLabel("选择手机录音").setInputFiles({
    name: "synthetic-three-notes.wav",
    mimeType: "audio/wav",
    buffer: wav(),
  });
  await page.getByLabel(/关联乐谱（可选/).selectOption({ index: 1 });
  await page
    .getByRole("button", { name: "开始新引擎识别", exact: true })
    .click();
  await page.waitForFunction(
    () =>
      document.querySelector(".review-notes") ||
      /识别未完成|未能启动|无法|Cannot|not defined/.test(
        document.querySelector("[role=status]")?.textContent ?? "",
      ),
    {},
    { timeout: 90000 },
  );
  console.log(
    "Review status:",
    await page.getByRole("status").allTextContents(),
  );
  await page
    .getByText("查看 Basic Pitch 原始候选与旧整理结果（诊断参考）", {
      exact: true,
    })
    .click();
  assert.ok(
    await page
      .getByRole("button", { name: "导出识别结果", exact: true })
      .count(),
  );
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.getByRole("button", { name: "导出识别结果", exact: true }).click(),
  ]);
  const result = JSON.parse(await readFile(await download.path(), "utf8"));
  assert.ok(
    result.referenceScore?.notes.length > 0,
    "explicit score snapshot reaches worker export",
  );
  assert.deepEqual(result.residual.referenceScore, result.referenceScore);
  assert.equal(
    await page
      .getByRole("heading", { name: "拨弦识别结果", exact: true })
      .count(),
    1,
  );
  assert.equal(await page.locator(".residual-notes button").count(), 3);
  for (const pitch of [62, 66, 69])
    assert.ok(
      result.notes.some((n) => n.pitchMidi === pitch),
      `missing ${pitch}`,
    );
  assert.equal(result.mode, "experimental-transcription");
  assert.equal(result.residual.ruleVersion, "residual-offline-2");
  assert.deepEqual(
    result.residual.events
      .filter((n) => n.pitchMidi !== null)
      .map((n) => Math.round(n.pitchMidi)),
    [62, 66, 69],
  );
  assert.equal(result.review.ruleVersion, "guzheng-candidates-1");
  assert.equal(result.review.candidates.length, result.notes.length);
  assert.equal(
    await page.locator(".review-notes:not(.residual-notes) button").count(),
    result.review.retainedCount,
  );
  for (const pitch of [62, 66, 69])
    assert.ok(
      result.review.candidates.some(
        (n) => n.pitchMidi === pitch && n.status === "candidate",
      ),
    );
  await page.getByRole("checkbox", { name: /展开全部原始候选/ }).check();
  assert.equal(
    await page.locator(".review-notes:not(.residual-notes) button").count(),
    result.notes.length,
  );
  for (const n of result.review.candidates) {
    const raw = result.notes[n.rawIndex];
    for (const key of [
      "pitchMidi",
      "startTimeSeconds",
      "durationSeconds",
      "amplitude",
    ])
      assert.equal(n[key], raw[key]);
  }
  assert.ok(await dialog.evaluate((el) => el.scrollWidth <= el.clientWidth));
  assert.equal(uploads.length, 0);
  await page
    .locator(".review-notes:not(.residual-notes) button")
    .first()
    .click();
  assert.ok(await dialog.locator("audio").evaluate((a) => !a.paused));
  await dialog.screenshot({ path: "outputs/review-mobile.png" });
  // Original bytes are downloadable before/after reload, not the 22050Hz model input.
  const downloadNamed = async (name) => {
    const [d] = await Promise.all([
      page.waitForEvent("download"),
      page.getByRole("button", { name, exact: true }).click(),
    ]);
    return readFile(await d.path());
  };
  assert.deepEqual(await downloadNamed("下载原始录音"), wav());
  await page.getByLabel("实际弹奏的音符序列").fill("D4 F#4 A4");
  await page.getByRole("button", { name: "保存纠正答案", exact: true }).click();
  await page
    .getByText("纠正答案已保存；只用于对照，不会改变模型识别。", {
      exact: true,
    })
    .waitFor();
  assert.ok(
    (await page.locator(".review-comparison").innerText()).includes("匹配3"),
  );
  const backup = await downloadNamed("下载完整备份（含录音）");
  const exported = JSON.parse(backup.toString());
  assert.equal(exported.truth, "D4 F#4 A4");
  assert.equal(exported.runs.length, 1);
  assert.deepEqual(
    Buffer.from(exported.audioDataUrl.split(",")[1], "base64"),
    wav(),
  );
  await page.reload();
  await page
    .getByRole("button", { name: "试用新识别 · 录音复核", exact: true })
    .click();
  await page.getByText("打开已保存样本（1）", { exact: true }).click();
  await page.locator(".review-sample").first().click();
  assert.equal(
    await page.getByLabel("实际弹奏的音符序列").inputValue(),
    "D4 F#4 A4",
  );
  assert.deepEqual(await downloadNamed("下载原始录音"), wav());
  // Restore adds a new sample instead of replacing a newer local correction.
  await page.getByLabel("恢复完整备份").setInputFiles({
    name: "sample.json",
    mimeType: "application/json",
    buffer: backup,
  });
  await page.getByText("打开已保存样本（2）", { exact: true }).waitFor();
  await page.getByText("打开已保存样本（2）", { exact: true }).click();
  await page
    .getByRole("button", { name: "依次复测所有已纠正样本", exact: true })
    .click();
  await page
    .getByText("整组复测完成，各样本已保留本次结果，可在样本库查看对照。", {
      exact: true,
    })
    .waitFor({ timeout: 180000 });
  const savedRuns = await page.evaluate(
    () =>
      new Promise((resolve, reject) => {
        const req = indexedDB.open("zhiyin-review-samples-v1", 1);
        req.onsuccess = () => {
          const db = req.result,
            tx = db.transaction("samples"),
            q = tx.objectStore("samples").getAll();
          tx.oncomplete = () => {
            resolve(
              q.result.map((s) => ({
                truth: s.truth,
                runs: s.runs.length,
                ids: s.runs.map((r) => r.id),
              })),
            );
            db.close();
          };
          tx.onerror = () => reject(tx.error);
        };
        req.onerror = () => reject(req.error);
      }),
  );
  assert.equal(savedRuns.length, 2);
  assert.ok(
    savedRuns.every(
      (s) =>
        s.truth === "D4 F#4 A4" && s.runs === 2 && new Set(s.ids).size === 2,
    ),
  );
  await page.getByLabel("实际弹奏的音符序列").scrollIntoViewIfNeeded();
  await dialog.screenshot({ path: "outputs/review-notebook-mobile.png" });
  await page.getByText("打开已保存样本（2）", { exact: true }).click();
  await page
    .getByRole("button", { name: "依次复测所有已纠正样本", exact: true })
    .click();
  await page.getByRole("button", { name: "取消处理", exact: true }).click();
  await page.getByRole("status").filter({ hasText: "已取消" }).waitFor();
  await page.getByLabel("选择手机录音").setInputFiles({
    name: "broken.wav",
    mimeType: "audio/wav",
    buffer: Buffer.from("not audio"),
  });
  await page
    .getByRole("button", { name: "开始新引擎识别", exact: true })
    .click();
  await page
    .getByRole("button", { name: "开始新引擎识别", exact: true })
    .waitFor();
  await page.waitForFunction(
    () => !document.querySelector(".review-actions .primary-button")?.disabled,
  );
  assert.equal(
    await page.locator(".review-notes:not(.residual-notes) button").count(),
    0,
  );
  // Real MediaRecorder over a synthetic browser stream; no physical mic.
  await page.evaluate(() => {
    navigator.mediaDevices.getUserMedia = async () => {
      const ctx = new AudioContext(),
        dest = ctx.createMediaStreamDestination(),
        osc = ctx.createOscillator(),
        gain = ctx.createGain();
      gain.gain.value = 0.05;
      osc.connect(gain).connect(dest);
      osc.start();
      window.__trialStream = dest.stream;
      window.__trialContext = ctx;
      await ctx.resume();
      return dest.stream;
    };
  });
  await page.getByRole("button", { name: "直接录一段", exact: true }).click();
  await page.waitForTimeout(650);
  await page.getByRole("button", { name: /停止录音/ }).click();
  await page.getByText("刚录制的片段 · 最多30秒", { exact: true }).waitFor();
  await page.waitForFunction(
    () => document.querySelector(".review-dialog audio")?.duration > 0,
  );
  assert.ok(
    await page.evaluate(() =>
      window.__trialStream.getTracks().every((t) => t.readyState === "ended"),
    ),
  );
  await page.evaluate(() => window.__trialContext.close());
  const captured = await downloadNamed("下载原始录音");
  assert.ok(captured.length > 100);
  await page
    .getByText("已保存到本机样本库，可关闭后重新打开。", { exact: true })
    .waitFor();
  await page.getByLabel("关闭录音复核").click();
  assert.equal(await page.getByRole("dialog").count(), 0);
  assert.deepEqual(errors, []);
  // Storage failure must never masquerade as saved or disable the raw download.
  const failure = await browser.newPage({
    viewport: { width: 390, height: 844 },
  });
  await failure.addInitScript(() => {
    IDBFactory.prototype.open = function () {
      throw new DOMException("Storage unavailable", "QuotaExceededError");
    };
  });
  await failure.goto(
    process.env.TEST_BASE_URL ??
      "http://127.0.0.1:3219/zhiyin-guzheng-practice/",
  );
  await failure
    .getByRole("button", { name: "试用新识别 · 录音复核", exact: true })
    .click();
  await failure
    .getByLabel("选择手机录音")
    .setInputFiles({ name: "keep.wav", mimeType: "audio/wav", buffer: wav() });
  await failure.getByText(/本机保存失败/).waitFor();
  const [fallback] = await Promise.all([
    failure.waitForEvent("download"),
    failure.getByRole("button", { name: "下载原始录音", exact: true }).click(),
  ]);
  assert.deepEqual(await readFile(await fallback.path()), wav());
  await failure.close();
  console.log(
    JSON.stringify({
      backend: result.backend,
      notes: result.notes.length,
      retained: result.review.retainedCount,
      suspects: result.review.suspectCount,
      pitches: result.notes.map((n) => n.pitchMidi),
      uploads: uploads.length,
      checks:
        "inference, original-byte download, persisted reload, correction, backup restore, sequential replay history, cancel, corrupt input, recorded download, storage failure fallback, close",
    }),
  );
} finally {
  await browser.close();
}
