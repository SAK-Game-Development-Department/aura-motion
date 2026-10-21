# 技術判断の記録（Decision Log）

各項目には、結論、根拠、確認日と情報源、見直す条件を書く。推測で決めたものは「仮」と明記する。

---

## D1. Cloudflare Pages の制限値
- **結論**: 1ファイル 25 MiB 以下、Freeプランで総ファイル数 20,000 以下、`_headers` は 100 ルール以下、`_redirects` は合計 2,100 以下
- **根拠**: 公式ドキュメント https://developers.cloudflare.com/pages/platform/limits/ （2026-10-22 に確認）
- **担保**: `scripts/check-pages-limits.mjs` を `npm run build` の最後に実行する。最大のファイルは MediaPipe の WASM で約 13 MiB
- **見直す条件**: Cloudflare が値を変えたとき（このスクリプトの定数だけ直せばよい）

## D2. 描画エンジン: Three.js r186 WebGPURenderer + TSL（ユーザー承認済み）
| 軸 | Three.js WebGPURenderer + TSL | Babylon.js |
|---|---|---|
| コンピュート | TSL の `compute()` を1回書けば、WebGPU でも WebGL2（transform feedback）でも動く | ComputeShader（WGSL）。WebGPU 専用 |
| GPUパーティクルの実装コスト | `instancedArray` と Sprite の instancing で自前実装。中程度 | 標準の GPUParticleSystem はあるが、力場との連携は自前。WebGL2 用は別実装 |
| ポストエフェクト | `RenderPipeline` と `bloom()`（TSL） | DefaultRenderingPipeline が充実 |
| バンドルサイズ | three.webgpu で約 0.8 MB（minify後） | 2〜4 MB |
| フォールバックの容易さ | `forceWebGL: true` で同じコードが動く | エンジンの切り替えに加え、別実装が必要 |
- r186 では `PostProcessing` が非推奨になり `RenderPipeline` に変わった（`node_modules/three/src/renderers/common/PostProcessing.js` で確認）

## D3. トラッキングをどのスレッドで動かすか
- **結論（実装済み）**: **モジュール Worker を優先**し、失敗したら「メインスレッド + requestVideoFrameCallback」に**自動でフォールバック**する。
  試す順序は worker/GPU → worker/CPU → inline/GPU → inline/CPU で、各段にタイムアウト（`TRACKING.workerInitTimeoutMs`）を設ける
- **根拠**:
  - `@mediapipe/tasks-vision` 1.1.1 の WASM ローダー（`vision_bundle.mjs`）は、`importScripts` がない環境では TypeError を捕まえて別の経路で読み込む。
    `FilesetResolver.forVisionTasks(base, useModule=true)` で `vision_wasm_module_internal.js` が選ばれ、モジュール Worker でも読み込める（ソースで確認）
  - `VisionTaskOptions.canvas` は `HTMLCanvasElement | OffscreenCanvas` を受け付ける（`vision.d.ts` で確認）。Worker 内で `OffscreenCanvas` を渡せば GPU デリゲートを使える
  - フレームは `createImageBitmap(video, {resizeWidth: 640})` で作って transfer する（コピーしない）。推論後すぐに `close()` する
- **検証結果（2026-10-22、ヘッドレス Chromium 156 + SwiftShader + 偽カメラ）**:
  - 最初の実装では worker/GPU と worker/CPU がどちらも `ModuleFactory not set.` で失敗し、inline/GPU にフォールバックしていた
  - 原因: MediaPipe は、タスクを1つ作るたびに `self.ModuleFactory = undefined` に戻す。モジュール Worker では WASM のローダーを `import()` で読み込むが、
    2つ目のタスク（ImageSegmenter）のときには同じ URL がモジュールキャッシュから返され、再評価されないので ModuleFactory が設定されない
    （`importScripts` を使うクラシックな経路では毎回スクリプトが実行されるので、この問題は起きない）
  - 対策: Worker 内でローダーを自分で `import()` して default export（ModuleFactory）を保持し、各タスクを作る直前に `globalThis.ModuleFactory` に戻す（`src/input/tracking/core.ts`）
  - 対策後は **worker/GPU で初期化と推論が動作した**（E2E の `camera.spec.ts` で、選ばれた経路をログに出す）
  - もう1つの不具合: 推論が遅い環境で、メインスレッドが「結果が返らない」と判断して再送したフレームが Worker のキューに溜まり、遅延が 6〜11 秒まで増え続けた。
    → Worker 側で「最新のフレームだけを処理する」（古いフレームは推論せずに close する）ように直した。遅延が溜まらなくなった
  - SwiftShader は GPU を CPU でエミュレートするので、推論に約 0.4 秒かかる（約2fps）。実機の GPU での値は docs/venue-checklist.md A2/A6 で確認する
- **実機での確認事項**（docs/venue-checklist.md）: どの経路が選ばれたかはデバッグオーバーレイの `tracking backend` に出る。展示PCで `worker/GPU` が選ばれ、30fps 以上出ることを確認する
- **見直す条件**: 展示PCで worker/GPU が失敗した場合は、原因を調べてここに追記する

## D4. シルエット場は CPU（トラッキングの Worker 内）で作る。GPU の Jump Flooding は使わない
- **結論**: マスク（192×108）→ 3-4 chamfer 距離変換 → 符号付き距離、時間差分による輪郭の速度、手首・肘の速度スプラットを計算し、RGBA8 のテクスチャ1枚（約83KB）にまとめて GPU に送る
- **根拠**:
  - 192×108 = 約2万画素なら、chamfer の2パスは JS で 1ms 未満で終わる（ユニットテストで正しさを確認）。Worker 内なのでメインスレッドの描画を妨げない
  - 仕様の「トラッキング（GPU）と描画が GPU を取り合う」問題に対して、GPU の負荷を増やさない
  - WebGPU と WebGL2 でまったく同じ場を使えるので、フォールバック時も見た目が変わらない
  - 解像度が低いので、JFA の利点（大きな解像度で log 回のパス）が効かない
- **見直す条件**: 場の解像度を 512 以上にしたいとき（そのときは compute の JFA を検討する）

## D5. 時刻とレイテンシの扱い
- 判定には**撮影時刻**（`requestVideoFrameCallback` の `metadata.captureTime`。無ければコールバックの時刻）を使う。推論にかかった時間は判定に影響しない
- キャリブレーション: 拍に合わせて手を叩いてもらい、「拍の時刻」と「拍手を検出した時刻（撮影時刻の時計、補間あり）」の差の中央値を、判定のオフセットにする（`game/calibration.ts`）。
  サンプル数が足りなければ既定値（`LATENCY.defaultOffsetMs`）を使う
- 表示の遅れ（撮影→推論→描画）は、One Euro で平滑化したうえで速度による予測（`predictFraction` × 計測した遅延）で補う。予測は表示にだけ使い、判定は撮影時刻の実測値で行う

## D6. 決定性
- `GameSession` は入力キュー（撮影時刻順）と 60Hz の固定ステップで進むので、描画のフレームレートが変わっても結果は同じになる（テスト: `render frame rate does not change the outcome`）
- ステージの生成は `Rng`（mulberry32）だけを使い、セクションごとに fork したストリームで生成する

## D7. 人体の限界（ステージの検証）
- **値（仮。実測で調整する）**: `src/config/stage.ts` の `HUMAN_LIMITS`
  - 手の移動速度 ≤ 4.2 body unit/s（肩幅を約0.4mとすると約1.7m/s。腕を振る速度の目安は2〜3 m/s なので、子どもでも届く控えめな値）
  - 同じ手で連続して触る間隔 ≥ 300ms、ポーズの間隔 ≥ 1.8s、ジャンプの間隔 ≥ 2s、回避の間隔 ≥ 1.2s
  - 球と、壁・回避の到着が近すぎないこと（体が忙しい時間帯を避ける）
- **担保**: 生成のたびに検証と修復を行い、修復後に疎になりすぎたシードは捨てて次のシードを使う。`npm run fuzz` で1万シードを検証する

## D8. 判定の寛容さ（一般来場者向け）
- 手が球の当たり判定の円の中にいた時間区間が Perfect の窓と重なれば Perfect にする。早く着いてそのまま待っていても Perfect になる
- 初期設定では、球はどちらの手で触ってもよい（色はヒントにとどめる。`JUDGE.strictHands`）
- トラッキングが不安定なとき（暗い、信頼度が低い、手の揺れが大きい）は、窓を1.5倍に広げ、ポーズの閾値を下げる

## D9. プライバシーの担保
- CSP（`src/config/headers.ts`）: `connect-src 'self'` によって、ブラウザのレベルで外部への通信を禁じる。Pages では `_headers`、ローカルでは vite の preview/dev で同じヘッダーを使う
- eslint で `XMLHttpRequest`、`WebSocket`、`EventSource`、`navigator.sendBeacon` を禁止する
- E2E（`tests/e2e/privacy.spec.ts`）で、全リクエストが同一オリジンで、POST などの送信が0件であることを検証する
- カメラの映像要素は画面に出さない。デバッグオーバーレイでもマスク（輪郭の2値）と場だけを表示し、映像は表示しない

## D10. Service Worker の更新戦略
- ビルド時に、全資産（MediaPipe の WASM とモデルを含む）の precache リストと、内容のハッシュによるバージョンを持つ `sw.js` を生成する
- 新しい SW はインストール後に待機させる。アプリがタイトル画面かつ無人のときにだけ `SKIP_WAITING` を送って再読み込みする（プレイ中には切り替えない）
- fetch は同一オリジンのものだけ cache-first で返す。古いキャッシュは activate 時に削除する

## D11. ヘッドレスでの描画確認
- Playwright の Chromium（headless shell 156）で、`--enable-unsafe-webgpu` を付けると SwiftShader の WebGPU アダプタが取れる（2026-10-22 に確認）。
  付けなければ `requestAdapter()` は null になり、WebGL2（SwiftShader）にフォールバックする。どちらの経路もスクリーンショットで確認できる
- 偽カメラ（`--use-fake-device-for-media-stream`）の映像には人が映っていないので、カメラの経路で確認できるのは「許可の流れ」と「トラッキングの初期化」まで。ゲームの流れは synth/replay で確認する

## D12. 複数人が映る場合の輪郭
- Selfie Segmenter は人物を区別しない（映っている全員が1枚のマスクになる）。プレイヤーの「ロック」は姿勢推定（ランドマーク）で行っているので、ゲームの判定には影響しない。
  影響するのは粒子の見た目だけ（後ろの人も光る）。展示では、後ろの人も光るのは演出として許容する
- 代替案（未実装。実機で負荷を測ってから判断する）: PoseLandmarker の `outputSegmentationMasks` を使えば、人物ごとのマスクが得られる。
  ただし入力解像度のマスクを GPU から CPU に読み戻すコストがかかる
