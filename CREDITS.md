# Credits / Licenses

AURA のコード、ゲーム名、用語、ビジュアルはすべてオリジナルです。外部の画像・音声アセットは使っていません（音は一切使いません）。

## 同梱しているモデル・ランタイム
| 名前 | 用途 | ライセンス | 出典 |
|---|---|---|---|
| MediaPipe Tasks Vision (`@mediapipe/tasks-vision` 1.1.1) | 手のランドマーク推定（と任意の輪郭抽出）の WASM ランタイム | Apache License 2.0 | https://github.com/google-ai-edge/mediapipe / npm |
| Hand Landmarker (float16) | 手のランドマーク推定モデル（21点） | Apache License 2.0 | https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/latest/hand_landmarker.task |
| Selfie Segmenter (float16) | 人物の輪郭抽出モデル（Tier 1 の任意要素。既定はオフ） | Apache License 2.0 | https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite |

モデルカード: https://ai.google.dev/edge/mediapipe/solutions/vision/hand_landmarker , https://ai.google.dev/edge/mediapipe/solutions/vision/image_segmenter
（手のランドマーク推定と、任意で人物の輪郭抽出だけに使います。顔の認識・識別には使いません）

## アルゴリズム
- $1 Unistroke Recognizer（Wobbrock, Wilson, Li, UIST 2007）を論文に基づいて自前で実装（`src/gesture/sigil.ts`）
- One Euro Filter（Casiez, Roussel, Vogel, CHI 2012）を論文に基づいて自前で実装（`src/core/oneEuro.ts`）

## ライブラリ（ビルドに含まれるもの）
| 名前 | ライセンス |
|---|---|
| three.js (r186) | MIT |
| @mediapipe/tasks-vision | Apache-2.0 |
| qrcode-generator 2.0.4（Kazuhiko Arase） | MIT（結果カードの QR、Tier 2。「QRコード」はデンソーウェーブの登録商標） |

## 開発ツール（配信物には含まれないもの）
Vite (MIT), TypeScript (Apache-2.0), Vitest (MIT), Playwright (Apache-2.0), ESLint (MIT), typescript-eslint (MIT), fflate (MIT)

## CC0 アセット
なし（使う場合はここに出典を記録すること）。
