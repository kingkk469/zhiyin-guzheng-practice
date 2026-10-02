# 知音 · 古筝智能陪练 V0.11.0

乐曲练习已改为**按谱带练**：软件用本机古筝拨弦合成音色演奏当前谱子，用户自由调速、听示范跟着弹。取消自动节奏准确性检测、早晚判定、节奏扣分、综合成绩及旧评分建议。

体验站：[打开古筝带练](https://kingkk469.github.io/zhiyin-guzheng-practice/?v=0.11.0)。main 分支通过 GitHub Actions 发布，以部署成功为准。

## 当前功能

- 选择内置曲目，或导入结构化 JSON 曲谱后预览核对；按谱演奏音符、时值、休止、反复与渐快/渐慢。
- 开始、暂停、从当前位置继续、重新播放；20–240拍/分钟自由调速，播放中也可调整，音高不随速度改变。
- 简谱光标与声音共享音频时钟，按行跟随；可选择连续小节慢练。带练无需麦克风、无需校音，不录音、不评分。
- 本机原创古筝拨弦近似合成音色，包含弦泛音衰减、拨弦瞬态和琴体共鸣；不是实琴采样或老师示范，复杂技法按所记单音播放，仍需真人试听。
- 保留21弦巡检、逐弦精调和音高对照；保留录音复核、原始录音保存/下载、人工音序纠正、备份恢复及批量重测。音频仅在设备本机处理。
- 历史原始记录保留，不改写旧成绩；当前界面和导出不再展示节奏与综合成绩。

没有图片自动识谱。图片谱需人工转为音符/时值后导入；JSON模板可从“曲谱管理”下载。内置原创练习稿和手工转录谱仍待老师审核。

详细格式、声音来源、兼容方式与验证限制见 [按谱带练说明](docs/按谱带练说明.md)。[V0.10判定说明](docs/乐谱驱动判定与异常情况.md) 是历史资料，其评分方案已退出应用。

## 本机运行

使用 Node.js >=22.13（本机24.13.0）：

```powershell
npm ci
npm run dev
```

打开 <http://127.0.0.1:3219/>。生产版运行 `npm run build` 后 `npm start`。手机使用 HTTPS 体验站，点“开始带练”开启声音；仅校音和录音复核需要授权麦克风。推荐 Safari/Chrome；微信和蓝牙音频仍待实机验证。

## 验证

```powershell
npm test
npm run typecheck
npm run lint
npm run build
npm run test:render
# 另一个终端先运行 npm start
npm run test:browser
npm run test:audio
npm run test:fine
npm run test:sweep
# 历史算法仅用于存档回归
npm run test:legacy
```

当前49项单测通过。浏览器验证包括实际 Web Audio 输出、导入/休止/附点/反复/变速、暂停续播、手机尺寸交互、零麦克风调用、零上传、历史记录与导出过滤；录音复核和精调回归通过。测试使用 Edge 和程序合成音，不能代替 iPhone/Android 实机与真人古筝听感验收。`outputs/` 保存本机证据，不提交Git。

## 主要文件

| 文件 | 用途 |
|---|---|
| `app/AccompanimentPanel.tsx` | 带练、调速、分段、记录 |
| `lib/accompaniment.ts` | 音频时钟、调度、暂停续播与变速 |
| `lib/guzheng-voice.ts` | 原创程序合成古筝拨弦近似音色 |
| `lib/practice-core.ts` | 曲谱校验、变速时间轴和校音规则，无节奏评分 |
| `app/NumberedSheet.tsx` / `app/ScorePlayhead.tsx` | 简谱和同步光标 |
| `app/GuzhengApp.tsx` | 选曲、校音、导入与历史入口 |
| `app/ReviewTrial.tsx` / `app/ReviewNotebook.tsx` | 本机录音复核和样本库 |
| `tests/legacy/` | 仅供测试的旧评分规则存档 |

旧 `zheng-practice-records`、`zhiyin-v2-records` 和原音样本库不迁移或删除；带练记录使用 `zhiyin-v3-accompaniment`。发布只包含代码与已有合法模型，不含用户真实录音、人工标注或私人报告。
