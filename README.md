# AURA

カメラに手をかざすと、手が光の骨格と粒子になる。手の形と動きで「術」を繰り出し、迫る敵を倒す ── 光の術バトル（学園祭展示用、約90秒）。
迫る「かげ」の上に出る弱点の印に合わせて術を出し、最後はボス「夜ノ主」を印の連携で倒して奥義「天輪結界」を放つ。術の一覧は [docs/techniques.md](docs/techniques.md)。

- 音は一切使いません。キーボード・マウスも不要です（手をかざすだけで始まる）
- カメラ映像は端末内でだけ処理し、保存も送信もしません。顔の識別は行いません
- 静的サイトなので Cloudflare Pages で無料で配信できます。ネットワークが切れても Service Worker とローカルサーバーで動きます

## 必要なもの
- Chrome または Edge の最新版（Windows / macOS）。WebGPU が無い環境では WebGL2 で動きます
- 一般的な Web カメラ（720p / 30fps）
- 開発: Node.js 20 以上

## 開発
```bash
npm install
npm run dev          # http://localhost:5173 （localhost なのでカメラが使える）
npm run test         # ロジックのテスト（Vitest）
npm run e2e          # E2E（Playwright。ビルドしてから preview に対して実行）
npm run check:all    # 型チェック・lint・テスト・ビルド・E2E をまとめて実行
```
カメラが無くても動かせます: `http://localhost:5173/?source=autoplay`（自動で遊ぶボット）、`?source=mouse`（マウスで手、数字キーで形）。
ジェスチャーラボ: `npm run lab` → http://localhost:5174 （`?source=synth` で合成の手）。
そのほかの URL パラメータは `CLAUDE.md` を参照してください。

## 公開中の URL
- 展示アプリ: **https://aura-motion.pages.dev/** （Chrome / Edge で開き、カメラを許可する。観客向けの画面は `/audience`）
- ジェスチャーラボ（開発者ツール）: **https://aura-lab-csq.pages.dev/** （認識の確認・ランドマークの記録・混同行列）

## デプロイ（Cloudflare Pages、無料）
### A. GitHub 連携（推奨）
1. このリポジトリを GitHub に push する
2. Cloudflare ダッシュボード → Workers & Pages → Create → Pages → *Connect to Git* でリポジトリを選ぶ
3. ビルドの設定:
   - Framework preset: `None`
   - Build command: `npm run build`
   - Build output directory: `dist`
   - 環境変数: `NODE_VERSION = 20`（またはそれ以上）
4. Save and Deploy。以後は push するたびに自動でデプロイされる
   （`dist/_headers` で CSP やキャッシュのヘッダーも配信される）

### B. Wrangler で直接アップロード
```bash
npm run build
npx wrangler pages deploy dist --project-name aura-motion --branch main
```
（プロジェクト `aura-motion` は作成済みです。新しく作る場合は `npx wrangler pages project create <名前> --production-branch main` を実行します。
新しい Wrangler は Pages のコマンドを Workers に回そうとするので、**作成時だけ** `--force` を付けてください）
初回は `npx wrangler login` でブラウザからログインします（無料プランで動き、クレジットカードの登録は不要です）。

ビルドの最後に `scripts/check-pages-limits.mjs` が、Pages の制限（1ファイル 25 MiB 以下、20,000 ファイル以下など）を自動で確認します。

## 展示当日（ネット障害への備え）
```bash
npm run build && npm run zip     # → release/aura-YYYY-MM-DD.zip
```
展示 PC で ZIP を展開し、`node serve-local.mjs` を実行してから http://localhost:8080 を開きます。
localhost なので HTTPS が無くてもカメラが使えます。一度オンラインで開いていれば、Service Worker のキャッシュだけでも起動します。
詳しくは [docs/operations.md](docs/operations.md) を参照してください。

## ドキュメント
| ファイル | 内容 |
|---|---|
| [CLAUDE.md](CLAUDE.md) | 設計方針・コマンド・規約・禁止事項 |
| [docs/art-direction.md](docs/art-direction.md) | 色・動き・情報の伝え方・光過敏への安全基準 |
| [docs/decisions.md](docs/decisions.md) | 技術判断とその根拠 |
| [docs/gesture-eval.md](docs/gesture-eval.md) | ジェスチャー認識の評価（合成データ）と実機での評価手順 |
| [docs/perf.md](docs/perf.md) | 性能の測定結果と方法 |
| [docs/visual-checklist.md](docs/visual-checklist.md) | 見た目の確認項目 |
| [docs/venue-checklist.md](docs/venue-checklist.md) | 実機でしか確認できない項目と合格基準 |
| [docs/operations.md](docs/operations.md) | 展示当日の運用（起動、設置、トラブル時の復旧） |
| [CREDITS.md](CREDITS.md) | ライセンスと出典 |
