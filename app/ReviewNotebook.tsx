"use client";
import { useEffect, useState } from "react";
import {
  audioFilename,
  downloadBlob,
  listSamples,
  updateSample,
  type ReviewSample,
} from "../lib/review-samples";
import {
  compareSequence,
  parseTruth,
  validReviewRun,
} from "../lib/review-comparison.mjs";
type Result = {
  runId?: string;
  notes: { pitchMidi: number }[];
  review: {
    candidates: { pitchMidi: number; status: string }[];
    ruleVersion?: string;
  };
};
export default function ReviewNotebook({
  sample,
  result,
  disabled,
  select,
  replayAll,
}: {
  sample: ReviewSample | null;
  result: Result | null;
  disabled: boolean;
  select: (sample: ReviewSample) => void;
  replayAll: (samples: ReviewSample[]) => void;
}) {
  const [items, setItems] = useState<ReviewSample[]>([]),
    [truth, setTruth] = useState(sample?.truth ?? ""),
    [message, setMessage] = useState(""),
    [saved, setSaved] = useState<ReviewSample | null>(null),
    [saving, setSaving] = useState(false);
  useEffect(() => {
    let active = true;
    async function sync() {
      try {
        if (sample) {
          if (active) setMessage("正在保存本机样本…");
          const value = await updateSample(sample.id, (old) => {
            const current = old ?? sample;
            if (
              !result?.runId ||
              current.runs.some((r) => r.id === result.runId)
            )
              return current;
            return {
              ...current,
              runs: [
                ...current.runs,
                {
                  id: result.runId,
                  createdAt: new Date().toISOString(),
                  appVersion: "0.6.0",
                  result,
                },
              ],
            };
          });
          if (active) {
            setSaved(value);
            setMessage("已保存到本机样本库，可关闭后重新打开。");
          }
        }
        const all = await listSamples();
        if (active) setItems(all);
      } catch {
        if (active)
          setMessage(
            "本机保存失败，可能空间不足或浏览器限制。请立即下载原始录音和完整备份。",
          );
      }
    }
    void sync();
    return () => {
      active = false;
    };
  }, [sample, result]);
  async function saveTruth() {
    if (!sample) return;
    try {
      if (!parseTruth(truth).length)
        throw Error("请先填写实际弹奏的音符序列。");
      setSaving(true);
      const value = await updateSample(sample.id, (old) => ({
        ...(old ?? sample),
        truth,
      }));
      setSaved(value);
      setItems(await listSamples());
      setMessage("纠正答案已保存；只用于对照，不会改变模型识别。");
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "保存失败，请下载备份。");
    } finally {
      setSaving(false);
    }
  }
  async function backup() {
    if (!sample) return;
    try {
      // Export current edit as well, so an unsaved correction is never silently lost.
      const latest =
        (await listSamples().catch(() => [])).find((s) => s.id === sample.id) ??
        saved ??
        sample;
      const audioDataUrl = await new Promise<string>((resolve, reject) => {
        const reader = new FileReader();
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = () => reject(reader.error);
        reader.readAsDataURL(sample.audio);
      });
      const { audio: _audio, ...metadata } = latest;
      void _audio;
      downloadBlob(
        new Blob(
          [
            JSON.stringify(
              {
                schema: "zhiyin-review-sample-1",
                ...metadata,
                truth,
                runs:
                  result?.runId &&
                  !latest.runs.some((r) => r.id === result.runId)
                    ? [
                        ...latest.runs,
                        {
                          id: result.runId,
                          createdAt: new Date().toISOString(),
                          appVersion: "0.6.0",
                          result,
                        },
                      ]
                    : latest.runs,
                audioType: sample.audio.type,
                audioDataUrl,
              },
              null,
              2,
            ),
          ],
          { type: "application/json" },
        ),
        `验证样本-${sample.id}.json`,
      );
    } catch {
      setMessage("备份失败，请先下载原始录音。");
    }
  }
  async function restore(file: File) {
    try {
      if (file.size > 45 * 1024 * 1024)
        throw Error("备份文件过大，请使用45MB以内的样本。");
      const data = JSON.parse(await file.text());
      if (
        data.schema !== "zhiyin-review-sample-1" ||
        typeof data.audioDataUrl !== "string" ||
        !/^data:[^,]*;base64,/.test(data.audioDataUrl) ||
        typeof data.truth !== "string" ||
        !Array.isArray(data.runs) ||
        !data.runs.every(validReviewRun)
      )
        throw Error("不是有效的验证样本备份。");
      const encoded = data.audioDataUrl.slice(
          data.audioDataUrl.indexOf(",") + 1,
        ),
        bytes = Uint8Array.from(atob(encoded), (c) => c.charCodeAt(0));
      if (!bytes.length || bytes.length > 20 * 1024 * 1024)
        throw Error("录音需为20MB以内。");
      // Keep incomplete drafts intact; only valid saved sequences join batch evaluation.
      // New identity avoids overwriting a newer local correction when importing an old backup.
      const imported: ReviewSample = {
        id: crypto.randomUUID(),
        createdAt: new Date().toISOString(),
        name: String(data.name ?? "导入的验证样本"),
        truth: data.truth,
        audio: new Blob([bytes], {
          type: typeof data.audioType === "string" ? data.audioType : "",
        }),
        runs: data.runs,
      };
      await updateSample(imported.id, () => imported);
      select(imported);
    } catch (e) {
      setMessage(e instanceof Error ? e.message : "恢复失败。");
    }
  }
  let expected: number[] = [];
  const eligible = items.filter((s) => {
    try {
      return parseTruth(s.truth).length > 0;
    } catch {
      return false;
    }
  });
  let error = "";
  try {
    expected = parseTruth(truth);
  } catch (e) {
    error = e instanceof Error ? e.message : "音名格式有误";
  }
  const summarize = (r: Result, organized: boolean) => {
    const actual = organized
      ? r.review.candidates.filter((n) => n.status !== "suspect")
      : r.notes;
    const c = compareSequence(
      expected,
      actual.map((n) => n.pitchMidi),
    );
    return `匹配${c.matched} · 多检${c.extra} · 漏检${c.missed} · 音名不同${c.wrong}`;
  };
  return (
    <section className="review-notebook" aria-label="本机验证样本">
      <h3>录音与纠正答案</h3>
      {sample && (
        <>
          <div className="review-actions">
            <button
              className="secondary-button"
              onClick={() => downloadBlob(sample.audio, audioFilename(sample))}
            >
              下载原始录音
            </button>
            <button className="secondary-button" onClick={() => void backup()}>
              下载完整备份（含录音）
            </button>
          </div>
          <label>
            实际弹奏的音符序列
            <textarea
              aria-label="实际弹奏的音符序列"
              value={truth}
              onChange={(e) => setTruth(e.target.value)}
              placeholder="例如：D4 D4 F#4 A4 D5 A4"
              rows={3}
            />
          </label>
          <small>
            按实际顺序填写，重复音分别写；用空格或顿号分隔，升号用
            #。不确定时先回听。
          </small>
          <button
            className="secondary-button"
            disabled={saving || disabled}
            onClick={() => void saveTruth()}
          >
            保存纠正答案
          </button>
          {truth !== (saved?.truth ?? sample.truth) && (
            <small>答案有未保存修改，请保存或下载完整备份。</small>
          )}
          {error && <p>{error}</p>}
          {!!expected.length && !error && result && (
            <div className="review-comparison">
              <p>原始候选：{summarize(result, false)}</p>
              <p>整理候选：{summarize(result, true)}</p>
              <small>
                仅比较音符顺序，不评节奏或音分。重复音可能有多种对应方式，这些差异不是演奏评分。
              </small>
            </div>
          )}
          {!!saved?.runs.length && (
            <details>
              <summary>历次识别（{saved.runs.length}次）</summary>
              {saved.runs.map((run) => (
                <div key={run.id}>
                  <small>
                    {new Date(run.createdAt).toLocaleString()} · V
                    {run.appVersion}
                  </small>
                  {expected.length > 0 && !error && (
                    <p>{summarize(run.result as Result, true)}</p>
                  )}
                </div>
              ))}
              <small>
                历史结果使用上方当前答案进行对照；重测请点击“开始新引擎识别”。
              </small>
            </details>
          )}
        </>
      )}
      <p role="status">{message}</p>
      <details>
        <summary>打开已保存样本（{items.length}）</summary>
        <button
          className="secondary-button"
          disabled={
            disabled ||
            saving ||
            !eligible.length ||
            truth !== (saved?.truth ?? sample?.truth ?? "")
          }
          onClick={() => replayAll(eligible)}
        >
          依次复测所有已纠正样本
        </button>
        <small>逐段重新识别并保留历史结果；可取消，不自动调参或发布。</small>
        {items.map((item) => (
          <button
            className="secondary-button review-sample"
            key={item.id}
            disabled={disabled || saving}
            onClick={() => select(item)}
          >
            {item.name} · {new Date(item.createdAt).toLocaleString()} ·{" "}
            {item.runs.length}次识别
          </button>
        ))}
        {!items.length && <p>还没有已保存样本。</p>}
      </details>
      <div className="review-actions">
        <label className="secondary-button">
          恢复完整备份
          <input
            aria-label="恢复完整备份"
            type="file"
            accept=".json,application/json"
            disabled={disabled || saving}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void restore(f);
              e.target.value = "";
            }}
          />
        </label>
      </div>
      <small>
        录音仅保存在当前设备和浏览器。清理网站数据、无痕模式或浏览器回收空间可能使它丢失。请下载原始录音或完整备份到手机“文件”，备份可恢复到这里。关闭或刷新前请先停止录音并确认保存状态。
      </small>
    </section>
  );
}
