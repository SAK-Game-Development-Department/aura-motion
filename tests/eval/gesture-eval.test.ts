// Writes docs/gesture-eval.md from the full synthetic grid.
//   npm run gesture-eval
// (Skipped in the normal test run; synthetic data only — see the doc.)
import { it } from 'vitest';
import { writeFileSync } from 'node:fs';
import { evalIdle, evalMotions, evalShapes, evalSigils, evalTwoHand, shapeSeparation, variations } from '../../src/gesture/eval';
import { SHAPE_IDS, SHAPE_LABEL, CORE_SHAPES } from '../../src/gesture/handModel';
import { MOTION_LABEL } from '../../src/gesture/motion';
import { SIGIL_LABEL } from '../../src/gesture/sigil';
import { GESTURE } from '../../src/config';

const pct = (x: number) => (Number.isFinite(x) ? `${(x * 100).toFixed(1)}%` : '-');

it.skipIf(!process.env.EVAL_WRITE)('write docs/gesture-eval.md', () => {
  const t0 = Date.now();
  const grid = variations('full');
  const shapes = evalShapes('full');
  const core = evalShapes('full', CORE_SHAPES);
  const idle = evalIdle(30, [101, 102, 103, 104, 105, 106]);
  const idleCore = evalIdle(30, [201, 202, 203, 204, 205, 206], CORE_SHAPES);
  const motions = evalMotions('full');
  const sigils = evalSigils('full');
  const two = evalTwoHand('full');
  const sep = shapeSeparation();
  const pass = (ok: boolean) => (ok ? '✅' : '❌');
  const md: string[] = [];
  md.push('# ジェスチャー認識の評価（合成データ）', '');
  md.push(`生成日時: ${new Date().toISOString()}（\`npm run gesture-eval\`、所要 ${((Date.now() - t0) / 1000).toFixed(0)} 秒）`, '');
  md.push('> **注意: これは合成データ（パラメトリックな手のモデル＋ノイズ）による評価です。実際の手での精度はまだ測っていません。**');
  md.push('> 実機での評価はジェスチャーラボ（`npm run lab` / https://aura-lab.pages.dev）で記録したデータで行います（手順は末尾）。合成データだけで合格を宣言しません。', '');
  md.push('## 条件', '');
  md.push(`- 変化させた条件: 左右の手 × 面内回転 5段階（−35〜35°）× 手の向き（yaw）0/25/45° × 大きさ 0.08/0.15/0.28（画面の高さ比）× ノイズ σ 0.003/0.006/0.01 × 大きな外れ値 0/3% = **${grid.length} 条件**`);
  md.push('- 形ごとに「自然な手 → 180ms で形を作る → 900ms 保持 → 戻す」の系列を作り、指の曲がりに ±0.12 のばらつきを加えた（雑な形）');
  md.push(`- 判定: 保持中（形が完成した後）に正しい形の「構え」が出れば認識成功。形の完成後に別の形が判定されるか、別の形で技が発動したら誤認識`);
  md.push(`- 主要な閾値: enterConf ${GESTURE.enterConf}, exitConf ${GESTURE.exitConf}, margin ${GESTURE.margin}, 連続 ${GESTURE.stableFrames} フレーム（切り替え ${GESTURE.switchFrames}）, 溜め ${GESTURE.chargeMs}ms`, '');
  md.push('## 品質基準との対応（合成データ）', '');
  const minRecall = Math.min(...SHAPE_IDS.map((s) => shapes.recall[s]));
  const maxConf = Math.max(...SHAPE_IDS.map((s) => shapes.confusionRate[s]));
  md.push('| 基準 | 目標 | 合成データでの結果 | |', '|---|---|---|---|');
  md.push(`| 静的ジェスチャーの再現率 | ≥ 95% | 最小 ${pct(minRecall)}（8形） | ${pass(minRecall >= 0.95)} |`);
  md.push(`| 誤認識（別の形と判定） | ≤ 3% | 最大 ${pct(maxConf)}（8形） | ${pass(maxConf <= 0.03)} |`);
  md.push(`| 待機中の誤発動 | ≤ 1回 / 30秒 | ${idle.castsPer30s.toFixed(3)} 回 / 30秒（${idle.minutes}分で ${idle.casts} 回） | ${pass(idle.castsPer30s <= 1)} |`);
  const lat = Math.max(...SHAPE_IDS.map((s) => shapes.latencyMs[s]));
  md.push(`| 認識の反応（形を作り始めてから構えの表示まで、推定処理の遅延を除く） | 形の完成から 120ms 以内 | 最大の中央値 ${lat.toFixed(0)}ms（形を作る動作は 180ms なので、完成の ${(180 - lat).toFixed(0)}ms 前） | ${pass(lat - 180 <= 120)} |`, '');
  md.push('## 静的な形（8形）', '');
  md.push('| 形 | 再現率 | 誤認識率 | 反応の中央値 (ms) | 誤って判定された形の内訳 |', '|---|---|---|---|---|');
  for (const s of SHAPE_IDS) {
    const wrong = Object.entries(shapes.confusion[s]).filter(([k, v]) => k !== s && v > 0).map(([k, v]) => `${k}:${v}`).join(' ') || '-';
    md.push(`| ${SHAPE_LABEL[s]} (${s}) | ${pct(shapes.recall[s])} | ${pct(shapes.confusionRate[s])} | ${shapes.latencyMs[s].toFixed(0)} | ${wrong} |`);
  }
  md.push('', '3形モード（暗い場所のフォールバック、Tier 0）:', '');
  md.push('| 形 | 再現率 | 誤認識率 |', '|---|---|---|');
  for (const s of CORE_SHAPES) md.push(`| ${SHAPE_LABEL[s]} | ${pct(core.recall[s])} | ${pct(core.confusionRate[s])} |`);
  md.push('', '## 待機中の誤発動（自然な手の動き）', '');
  md.push('手をゆっくり動かす・回す・半分握る・画面の外に出る、を乱数で繰り返し、ときどき 120〜280ms だけ偶然に形ができる（頭をかく・袖を直す等）系列（技を出す意図のない動き）。', '');
  md.push('| 形のセット | 時間 | 構え（表示のみ） | 技の発動 | 30秒あたりの発動 | 発動した形 | 発動のきっかけ |', '|---|---|---|---|---|---|---|');
  md.push(`| 8形＋動き＋印 | ${idle.minutes}分 | ${idle.stances} | ${idle.casts} | ${idle.castsPer30s.toFixed(3)} | ${JSON.stringify(idle.byShape)} | ${JSON.stringify(idle.byRelease)} |`);
  md.push(`| 3形 | ${idleCore.minutes}分 | ${idleCore.stances} | ${idleCore.casts} | ${idleCore.castsPer30s.toFixed(3)} | ${JSON.stringify(idleCore.byShape)} | ${JSON.stringify(idleCore.byRelease)} |`, '');
  md.push('## 動き', '');
  md.push('| 動き | 再現率 | 別の動きと判定 |', '|---|---|---|');
  for (const [k, v] of Object.entries(motions.recall)) md.push(`| ${MOTION_LABEL[k as keyof typeof MOTION_LABEL]} | ${pct(v)} | ${pct(motions.wrong[k as keyof typeof motions.wrong])} |`);
  md.push('', `両手（近づけて→離す）: 再現率 ${pct(two)}`, '');
  md.push('## 空中の印（$1 Unistroke ＋ 角の数）', '');
  md.push('| 印 | 再現率 | 判定の内訳 |', '|---|---|---|');
  for (const [k, v] of Object.entries(sigils.recall)) md.push(`| ${SIGIL_LABEL[k as keyof typeof SIGIL_LABEL]} | ${pct(v)} | ${JSON.stringify(sigils.confusion[k as keyof typeof sigils.confusion])} |`);
  md.push('', '## 形どうしの近さ（特徴量空間での距離、小さいほど紛らわしい）', '');
  md.push('| 組 | 距離 |', '|---|---|');
  for (const p of sep.slice(0, 8)) md.push(`| ${SHAPE_LABEL[p.a]} — ${SHAPE_LABEL[p.b]} | ${p.d.toFixed(2)} |`);
  md.push('', `テスト（tests/unit/gesture.test.ts）は、最も近い組の距離が 0.5 を下回ったら失敗する（紛らわしい形の組み合わせの警告）。`, '');
  md.push('## 合成データの限界（実機で確かめること）', '');
  md.push('- 合成の手は、指の太さ・自己遮蔽・MediaPipe 特有の推定の癖（親指の位置のずれ、指が重なったときの推定の崩れ）を再現していない');
  md.push('- 照明・ブレ・肌の色・手袋・爪の装飾の影響は、ノイズとして近似しているだけ');
  md.push('- 特に **つの・たてる・かぎ・つまむ** は、実機で自己遮蔽の影響を受けやすいと予想する。実機のデータで不安定なら、ジェスチャーセットから外す（6形に絞る）', '');
  md.push('## 実機での評価手順（ジェスチャーラボ）', '');
  md.push('1. ラボを開く（`npm run lab` → http://localhost:5174 または https://aura-lab.pages.dev）。入力を「カメラ」にする');
  md.push('2. 「自動校正」を押して、手を 2 秒ひらく → 2 秒にぎる');
  md.push('3. ラベルを選び「60フレーム記録」を押して、その形を作ったまま、ゆっくり手を回す・近づける・遠ざける。8形それぞれと「なし」（自然な手、会話するときの手の動き）を記録する');
  md.push('4. 記録者タグを変えて、複数の人（手の大きさ・年齢の違う人、可能なら子ども）で記録する');
  md.push('5. 「規則ベースで評価」「kNN で評価」を押して混同行列を見る。再現率 95% 以上、別の形への誤認識 3% 以下、「なし」が形と判定される率が低いことを確認する');
  md.push('6. JSON を保存して共有してください。そのデータで閾値と分類器を調整し、この文書に「実機データ」の節を追加します', '');
  writeFileSync('docs/gesture-eval.md', md.join('\n') + '\n');
  console.log(md.slice(0, 40).join('\n'));
}, 1_800_000);
