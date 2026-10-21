# Credits / Licenses

AURA のコード、ゲーム名、用語、ビジュアルはすべてオリジナルです。外部の画像・音声アセットは使っていません（音は一切使いません）。

## 同梱しているモデル・ランタイム
| 名前 | 用途 | ライセンス | 出典 |
|---|---|---|---|
| MediaPipe Tasks Vision (`@mediapipe/tasks-vision` 1.1.1) | 姿勢推定と輪郭抽出の WASM ランタイム | Apache License 2.0 | https://github.com/google-ai-edge/mediapipe / npm |
| Pose Landmarker (lite / full, float16) | 姿勢推定モデル | Apache License 2.0 | https://storage.googleapis.com/mediapipe-models/pose_landmarker/pose_landmarker_lite/float16/latest/pose_landmarker_lite.task （full も同じ場所） |
| Selfie Segmenter (float16) | 人物の輪郭抽出モデル | Apache License 2.0 | https://storage.googleapis.com/mediapipe-models/image_segmenter/selfie_segmenter/float16/latest/selfie_segmenter.tflite |

モデルカード: https://ai.google.dev/edge/mediapipe/solutions/vision/pose_landmarker , https://ai.google.dev/edge/mediapipe/solutions/vision/image_segmenter
（姿勢推定と人物の輪郭抽出だけに使い、顔の認識・識別には使いません）

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
