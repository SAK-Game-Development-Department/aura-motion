# AURA — 指と手で術を繰り出す、光の術バトル（学園祭展示）

カメラの前に手をかざすと、手が光の骨格と粒子になる。手の**形**（にぎる・ひらく・さす…）と**動き**（はらう・おす・ひく・はじく・空中の印）で「術」を出し、迫る敵を倒す。
1プレイ約90秒。音は一切使わない。静的サイト（Cloudflare Pages）で動作し、費用はかからない。映像は端末の外に出さない。

## 現在のフェーズ
- **P1 実現性の検証が完了**（ジェスチャー認識・ラボ・合成データ評価）。**実機での確認待ち**。結果を見てジェスチャーセットを確定してから P2（戦闘の最小ループ）に進む
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
| ビルド / デプロイ | `npm run build`（Pages の制限チェック付き）／`npm run deploy`（→ https://aura-motion.pages.dev） |
| 展示用ZIP | `npm run zip` |

URLパラメータ（開発・スタッフ用）: `?source=camera|synth|autoplay|mouse|replay|empty`、`?flags=-sigils,+qr`、`?onehand=1`、`?debug=1`、`?calm=1`、`?webgl=1`、
`?quality=0..5`、`?particles=N`、`?vt=1`（仮想時間。遅い GPU でスクショを撮るとき）、`?bench=1`、`?fast=1`（時間短縮。テスト用）

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
- `src/app.ts` — 全体の状態遷移（P1: Loading → Title → Calibrate → Practice）

## 規約
- 数値はすべて `src/config/` に置く（ジェスチャーの閾値は `gesture.ts`、判定は `game.ts`、手の配置は `hand.ts`）
- ゲームロジックと認識は**決定的**にする。`Math.random()`・`performance.now()`・`Date.now()` を使わない（Rng と注入した時刻を使う）。ゲームは `GestureEvent` だけに依存する
- 認識の変更は `npm run gesture-eval` で数値を確かめ、`docs/gesture-eval.md` を更新する。品質ゲート（`tests/unit/gesture.test.ts`）を緩めて通すことはしない
- 購読は必ず解除する。毎フレームのアロケーションは避ける（8時間稼働）
- Tier 1/2 の機能はフラグ（`src/config/flags.ts`）で個別に無効化でき、無効時は Tier 0 に戻ること
- コミットは小さく、英語で。各コミットはビルドが通る状態にする

## 禁止事項
- **音を出さない**（AudioContext、`<audio>`、効果音など、すべて禁止）。マイクも使わない
- **映像を保存・録画・送信しない**。ランドマークも送信しない。記録機能はラボ（tools/）だけに置き、展示ビルドに入れない（E2E で検証している）
- **外部CDN・外部への通信を使わない**（CSP の `connect-src 'self'`、eslint、E2E で担保）
- 顔の認識・識別をしない（手のランドマークのみ）
- **既存作品の技・印の組み方・名称・造形を使わない**（両手の指を組む印は使わない。技名・敵・用語はすべてオリジナル）
- 光過敏への配慮: 全画面の明滅は毎秒3回以下。フラッシュと揺れは必ず `render/fx/safety.ts` を通す
- Tier を飛ばさない。フォールバック（暗所で3形、片手、マウスの緊急モード、WebGL2）を壊さない

## ドキュメント
`docs/art-direction.md`、`docs/decisions.md`、`docs/gesture-eval.md`、`docs/perf.md`、`docs/visual-checklist.md`、`docs/venue-checklist.md`、`docs/operations.md`、`CREDITS.md`
