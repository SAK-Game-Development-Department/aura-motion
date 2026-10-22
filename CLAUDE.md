# AURA — 全身で遊ぶ光のアクションゲーム（学園祭展示）

カメラの前に立つと体が光の粒子になり、約90秒、全身で遊ぶ。音は一切使わない。
静的サイト（Cloudflare Pages）で動作し、費用はかからない。映像は端末の外に出さない。

## コマンド
| 目的 | コマンド |
|---|---|
| 開発サーバー | `npm run dev`（http://localhost:5173 。localhost は secure context なのでカメラが使える） |
| 型チェック / lint | `npm run typecheck` / `npm run lint` |
| ロジックテスト | `npm run test`（Vitest） |
| ステージのファズ（1万シード） | `npm run fuzz` |
| E2E | `npm run e2e`（Playwright。ビルド後の preview に対して実行。ヘッドレスでも WebGPU(SwiftShader)/WebGL2 が動く） |
| ソーク（短縮版の長時間稼働テスト） | `SOAK_MINUTES=30 npm run soak` → `soak-out/` に CSV |
| ビルド | `npm run build`（tsc → vite build → Pagesの制限チェック） |
| 展示用ZIP | `npm run zip` → `release/aura-YYYY-MM-DD.zip` |
| すべてのゲート | `npm run check:all` |

URLパラメータ（開発・スタッフ用）: `?source=camera|synth|autoplay|mouse|replay|empty&replay=fixtures/x.json`、
`?flags=-particles,+qr`、`?seed=123`、`?debug=1`、`?calm=1`、`?webgl=1`（WebGL2を強制）、`?quality=0..5`、`?fast=1`（時間短縮。テスト用）、
`?vt=1`（仮想時間: 1フレームごとに1/60秒進む。遅い GPU でもスクリーンショットの見た目が正しくなる）、`?particles=N`（粒子数を固定）、`?bench=1`（性能測定。docs/perf.md）、`?dev=1`（P キーでランドマークを JSON に記録）

ページ: `index.html`（ゲーム）、`audience.html`（観客向けの画面。ゲームから A キーで開く）、`card.html`（持ち帰り用の結果カード。QR のリンク先）

ヘッドレスで描画を確認する: Chromium の起動オプション `--enable-unsafe-webgpu --use-angle=swiftshader --enable-features=Vulkan --use-vulkan=swiftshader`（playwright.config.ts の `GPU_ARGS`）。
SwiftShader は粒子 3 万個で 1fps 以下になるので、E2E は `flags=-particles` で動かし、粒子の見た目は `?vt=1&particles=12000` で確認する

## アーキテクチャ（要点）
- `src/config/` — **数値はすべてここに置く**（判定幅、ステージ、品質、安全、展示の挙動、機能フラグ）。マジックナンバーをほかの場所に書かない
- `src/core/` — 型、シード付きRNG、注入可能なClock、One Euroフィルタ、Emitter
- `src/input/` — `InputSource`（camera / replay / synth / mouse）→ `PoseFrame`。`BodyTracker` で `BodySnapshot`（平滑化・予測・ジャンプ/しゃがみ/傾きの検出）を作る。`tracking/` は MediaPipe とシルエット場（Worker優先）
- `src/game/` — **純粋で決定的**（DOM・GPU・時計に依存しない）。`GameSession.pushInput()` と `update(t)` だけで動く。`simulate.ts` でヘッドレス再生
- `src/stage/` — シード→ステージの生成と、人体の限界による検証・修復
- `src/render/` — Three.js WebGPURenderer + TSL（WebGL2へのフォールバックは同じコードで動く）
- `src/ui/` — DOM の HUD（文字は最小限）。`src/exhibit/` — 在席判定、手のボタン、ハイスコア、ウォッチドッグ。`src/debug/` — Dキーのオーバーレイ
- `src/app.ts` — 全体の状態遷移（Loading→Title→Calibrate→Play→Results）

## 規約
- TypeScript strict。ゲームロジックに `Math.random()`、`performance.now()`、`Date.now()` を使わない（Rng と注入した時刻を使う）
- 購読したら必ず解除する（Emitter.on は解除関数を返す）。毎フレームのアロケーションは避ける（8時間稼働）
- Tier 1/2 の機能は `src/config/flags.ts` のフラグで個別に無効化でき、無効時は Tier 0 の体験に戻ること
- コミットは小さく、英語で。各コミットはビルドが通る状態にする
- 「叩き心地」、色、強度など人が判断する値は config に置き、PR やコミットの説明に「どこを触ればよいか」を書く

## 禁止事項
- **音を出さない**（AudioContext、`<audio>`、効果音など、すべて禁止）。マイクも使わない（`audio: false`）
- **映像を保存・録画・送信しない**。フレームは推論後すぐに close する。記録してよいのはランドマーク（数値）だけで、それも開発用
- **外部CDN・外部への通信を使わない**。CSP で `connect-src 'self'` を強制している。`fetch` してよいのは同一オリジンの資産だけ
  （eslint で XMLHttpRequest / WebSocket / sendBeacon を禁止。E2E で外部リクエスト0件を検証）
- 顔の認識・識別をしない（姿勢推定と輪郭抽出のみ）
- 光過敏への配慮: 全画面の明滅は毎秒3回以下。フラッシュと揺れは必ず `render/fx/safety.ts` を通す
- Tier を飛ばさない。フォールバック（暗所、上半身モード、マウスの緊急モード、WebGL2）を壊さない

## ドキュメント
`docs/art-direction.md`（見た目の規範）、`docs/decisions.md`（技術判断とその根拠）、`docs/perf.md`、
`docs/visual-checklist.md`、`docs/venue-checklist.md`、`docs/operations.md`（当日の運用）、`CREDITS.md`
