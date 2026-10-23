# AURA — 指と手で術を繰り出す、光の術バトル（学園祭展示）

カメラの前に手をかざすと、手が光の骨格と粒子になる。手の**形**（にぎる・ひらく・さす…）と**動き**（はらう・おす・ひく・はじく・空中の印）で「術」を出し、迫る敵を倒す。
1プレイ約90秒。音は Web Audio で合成した効果音・BGM・環境音（設定で OFF 可）。静的サイト（Cloudflare Pages）で動作し、費用はかからない。映像は端末の外に出さない。

## 現在のフェーズ
- P1（認識・ラボ）完了。ユーザーの指示で P2/P3 を先に進め、**戦闘（敵・術・印・ボス・奥義・演出）を実装済み**。実機での認識の評価（ラボ）は並行して待っている
- 術と敵の一覧: `docs/techniques.md`
- 計画: `~/.claude/plans/parsed-seeking-karp.md`（P0 整理 → P1 検証 → P2 Tier0 → P3 Tier1 → P4 堅牢化 → P5 Tier2）

## コマンド
| 目的 | コマンド |
|---|---|
| 開発サーバー（展示アプリ） | `npm run dev`（http://localhost:5173 。localhost は secure context なのでカメラが使える） |
| ジェスチャーラボ（開発者ツール） | `npm run lab`（http://localhost:5174）／`npm run deploy:lab`（→ https://aura-lab-csq.pages.dev） |
| 型チェック / lint / テスト | `npm run typecheck` / `npm run lint` / `npm run test` |
| 認識の評価レポート | `npm run gesture-eval` → `docs/gesture-eval.md`（合成データ） |
| E2E | `npm run e2e`（ビルド後の preview に対して。ヘッドレスでも WebGPU(SwiftShader)/WebGL2 が動く） |
| ソーク | `SOAK_MINUTES=30 npm run soak` → `soak-out/*.csv` |
| ビルド / デプロイ | `npm run build`（Pages の制限チェック付き）／`npm run deploy`（→ https://aura-motion.pages.dev。`functions/` と D1 のバインドは `wrangler.toml`） |
| ランキングの DB | `npx wrangler d1 migrations apply aura-scores --remote`（スキーマは `migrations/`）。ローカル確認は `npx wrangler pages dev dist --binding RUN_SECRET=x` |
| 展示用ZIP | `npm run zip` |

URLパラメータ（開発・スタッフ用）: `?source=camera|synth|autoplay|mouse|replay|empty`、`?flags=-sigils,+qr`、`?onehand=1`、`?stage=easy|normal|hard`（難易度の固定。選択画面を飛ばす）、`?debug=1`、`?calm=1`、`?webgl=1`、
`?quality=0..5`（S キーで設定パネル: 明るさ・演出・粒子など）、`?particles=N`、`?vt=1`（仮想時間。遅い GPU でスクショを撮るとき）、`?bench=1`、`?fast=1`（時間短縮。テスト用）

ヘッドレスで描画を確認するときの Chromium の起動オプション: `--enable-unsafe-webgpu --use-angle=swiftshader --enable-features=Vulkan --use-vulkan=swiftshader`。
SwiftShader は粒子が多いと 1fps 以下になるので、E2E は `flags=-particles` で動かし、粒子の見た目は `?vt=1&particles=12000` で確認する。

## アーキテクチャ
- `src/gesture/` — **認識の核（独立モジュール）**。ランドマーク → `features.ts`（正規化: 手首原点・手のひらサイズ・回転・鏡像。指の曲がり・到達比・親指・つまみ・指の開き）
  → `shapes.ts`（規則ベース＋kNN、ヒステリシス＋連続フレーム）→ `motion.ts`（はらう・おす・ひく・はじく・両手）／`sigil.ts`（$1＋角の数）
  → `engine.ts`（状態機械: 待機 → 構え → 発動 → 余韻。`GestureEvent` のストリームを出す）。`calibrate.ts`（ひらく・にぎるで個人の閾値を合わせる）。
  `handModel.ts`（パラメトリックな手の合成）、`synth.ts`／`eval.ts`（評価）、`performer.ts`（ゴーストハンド・アトラクト・ボット）
- `src/input/` — `InputSource`（camera / replay / synth / mouse）→ `PoseFrame.hands`。`tracking/` は Hand Landmarker を Worker で動かす（D3）
- `src/render/` — Three.js WebGPURenderer + TSL（手の粒子、光の骨格、指先の軌跡、技の演出）。`src/ui/` HUD、`src/exhibit/` 展示機能、`src/debug/` Dキーのオーバーレイ
- `tools/gesture-lab/` — ジェスチャーラボ（ライブ認識・ランドマークだけの記録・混同行列・閾値調整）。**展示ビルドには含めない**（別の Vite 設定 `vite.lab.config.ts`）
- `src/battle/` — 戦闘（決定的）: `stages.ts`（初級・中級・上級のステージ。名前・敵の姿・主・背景。難易度の数値は `config/game.ts` の `STAGE_TUNE`）、`techniques.ts`（術の一覧と条件）、`stage.ts`（シードから敵の生成と人の手の限界での検証）、`session.ts`（判定・スコア）、`bot.ts`（自動プレイ）
- `src/render/battleView.ts` / `enemies.ts` — 影の敵、弱点の印、術ごとの演出、出現の裂け目・撃破の破片、奥義の結界、隠しボス。`src/ui/hud.ts` のカットイン、`src/ui/techLens.ts`（T キー。技術の可視化）
- `src/render/background.ts` — ステージごとの背景（湖・星・結晶・月蝕・嵐。テーマごとに別メッシュ）
- `src/app.ts` — 全体の状態遷移（Loading → Title(アトラクト) → Select(難易度。手をカードにかざす) → Calibrate → Play(戦闘90秒) → Results → Title。`?practice=1` で練習モード）

## 規約
- 数値はすべて `src/config/` に置く（ジェスチャーの閾値は `gesture.ts`、判定は `game.ts`、手の配置は `hand.ts`）
- ゲームロジックと認識は**決定的**にする。`Math.random()`・`performance.now()`・`Date.now()` を使わない（Rng と注入した時刻を使う）。ゲームは `GestureEvent` だけに依存する
- 認識の変更は `npm run gesture-eval` で数値を確かめ、`docs/gesture-eval.md` を更新する。品質ゲート（`tests/unit/gesture.test.ts`）を緩めて通すことはしない
- 購読は必ず解除する。毎フレームのアロケーションは避ける（8時間稼働）
- Tier 1/2 の機能はフラグ（`src/config/flags.ts`）で個別に無効化でき、無効時は Tier 0 に戻ること
- コミットは小さく、英語で。各コミットはビルドが通る状態にする

## 禁止事項
- 音は `src/audio/sound.ts`（効果音・環境音）と `src/audio/music.ts`（ステージごとの BGM。敵の拍に合わせて生成）で Web Audio から合成したものだけ（既定で ON、S キーの設定で OFF・音量調整）。音声ファイル・`<audio>` は使わない。**マイクは使わない**（getUserMedia は audio: false。E2E で検証）。既存作品の音は使わない（雰囲気だけ参考にしたオリジナル）
- **映像を保存・録画・送信しない**。ランドマークも送信しない。記録機能はラボ（tools/）だけに置き、展示ビルドに入れない（E2E で検証している）
- **外部CDN・外部への通信を使わない**（CSP の `connect-src 'self'`、eslint、E2E で担保）。例外は同じオリジンの全国ランキング API（`functions/api/*` → Cloudflare D1）だけで、送るのは `src/exhibit/scorePolicy.ts` の `SUBMISSION_KEYS`（スコア・内訳・プレイヤーが入れた名前・ステージ・端末のランダム ID）に限る。カメラで遊んだときだけ送る（E2E で検証）
- 顔の認識・識別をしない（手のランドマークのみ）
- 名前は分かりやすく、かっこよく。作った漢字の熟語や「○ノ○」のような大げさな名前は使わない（技・ステージ・ボスとも、スーパーノヴァの系統の光・天体・物理の短いカタカナ。日本語の名前は小見出し `reading` に置く）
- **既存作品の技名・キャラクター名・印の組み方・造形をそのまま使わない**（演出の「雰囲気」は参考にしてよいが、名前と形はオリジナル。両手の指を組む印は認識が崩れるので使わない）
- 光過敏への配慮: 全画面の明滅は毎秒3回以下。フラッシュと揺れは必ず `render/fx/safety.ts` を通す
- Tier を飛ばさない。フォールバック（暗所で3形、片手、マウスの緊急モード、WebGL2）を壊さない

## ドキュメント
`docs/art-direction.md`、`docs/decisions.md`、`docs/gesture-eval.md`、`docs/perf.md`、`docs/visual-checklist.md`、`docs/venue-checklist.md`、`docs/operations.md`、`CREDITS.md`
