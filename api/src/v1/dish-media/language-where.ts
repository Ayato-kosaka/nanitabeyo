// api/src/v1/dish-media/language-where.ts
//
// #1052 優先言語の WHERE 句組み立てを純粋関数として切り出す。
//
// 【なぜ切り出すか】
// repository に埋め込んだままだと、language-code.spec.ts のように helper の
// 戻り値だけを検証するテストでは「repository が実際に helper を通しているか」を
// 守れない。実際、repository から `.flatMap((code) => languageMatchCandidates(code))`
// の 1 行を削除してバグを再導入しても、#1050 の新規 97 件は全て green のまま通った。
//
// 純粋関数にして「この関数を恒等関数へ差し替えるとテストが落ちる」状態にする。

import {
  languageMatchCandidates,
  languageWeakExactCandidates,
} from '../../../../shared/utils/languageCode';

/**
 * `dish_reviews.original_language_code` に対する OR 条件を組み立てる。
 *
 * 正規形(`zh-hans`)をそのまま DB 値へ突き合わせると、実際に保存されている
 * `zh-CN` に一致しない。必ず `languageMatchCandidates()` で DB 実値の候補集合へ
 * 展開してから条件を作ること。
 *
 * 各候補について「完全一致」と「`候補-` の前方一致」の 2 条件を出す。
 * 後者は `ja` に対する `ja-JP` のような region 付きの実値を拾うため。
 *
 * @returns Prisma の `OR` に渡せる条件配列。優先言語が空なら空配列。
 */
export function buildLanguageWhereClause(
  preferredLanguageCodes: readonly string[],
): Array<{
  original_language_code:
    | { equals: string; mode: 'insensitive' }
    | { startsWith: string; mode: 'insensitive' };
}> {
  const candidates = [
    ...new Set(
      preferredLanguageCodes.flatMap((code) => languageMatchCandidates(code)),
    ),
  ];

  // #1052 script 不明の実値(`zh`)は完全一致でのみ拾う。
  // これを前方一致に混ぜると `zh-` が繁体の `zh-TW` にも当たり、
  // 簡体を希望したユーザーへ繁体が混ざる（#817 が避けたかった状態）。
  const weakCandidates = [
    ...new Set(
      preferredLanguageCodes.flatMap((code) =>
        languageWeakExactCandidates(code),
      ),
    ),
  ].filter((candidate) => !candidates.includes(candidate));

  return [
    ...candidates.flatMap((candidate) => [
      {
        original_language_code: {
          equals: candidate,
          mode: 'insensitive' as const,
        },
      },
      {
        original_language_code: {
          startsWith: `${candidate}-`,
          mode: 'insensitive' as const,
        },
      },
    ]),
    ...weakCandidates.map((candidate) => ({
      original_language_code: {
        equals: candidate,
        mode: 'insensitive' as const,
      },
    })),
  ];
}
