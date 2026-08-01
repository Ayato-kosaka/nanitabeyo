// api/src/v1/dish-media/language-where.spec.ts
//
// #1052 WHERE 句の組み立てを固定する。
//
// language-code.spec.ts は helper の戻り値だけを検証しており、
// 「repository が実際に候補展開を通しているか」は守れていなかった。
// ここでは組み立て結果そのものを検証し、候補展開を外すと落ちるようにする。

import { buildLanguageWhereClause } from './language-where';

/** 生成された条件から、突き合わせ対象になるタグだけを取り出す */
const matchedTags = (codes: readonly string[]) =>
  buildLanguageWhereClause(codes).map((clause) => {
    const value = clause.original_language_code;
    return 'equals' in value ? value.equals : value.startsWith;
  });

describe('buildLanguageWhereClause', () => {
  it('優先言語が空なら空配列', () => {
    expect(buildLanguageWhereClause([])).toEqual([]);
  });

  it('各候補について equals と 前方一致 の2条件を出す', () => {
    expect(buildLanguageWhereClause(['ja'])).toEqual([
      { original_language_code: { equals: 'ja', mode: 'insensitive' } },
      { original_language_code: { startsWith: 'ja-', mode: 'insensitive' } },
    ]);
  });

  // ここが本丸。正規形 zh-hans をそのまま突き合わせると DB の zh-CN に当たらない。
  it('zh-hans は DB 実値の region 表記へ展開される', () => {
    const tags = matchedTags(['zh-hans']);

    expect(tags).toContain('zh-hans');
    expect(tags).toContain('zh-cn');
    expect(tags).toContain('zh-sg');
    // 繁体の region は含めない
    expect(tags).not.toContain('zh-tw');
  });

  it('zh-hant は繁体の region 表記へ展開される', () => {
    const tags = matchedTags(['zh-hant']);

    expect(tags).toEqual(
      expect.arrayContaining(['zh-hant', 'zh-tw', 'zh-hk', 'zh-mo']),
    );
    expect(tags).not.toContain('zh-cn');
  });

  // #1052 Google import は script を持たない素の `zh` で保存されうる
  it('zh-hans を希望したとき、素の zh も候補に含まれる', () => {
    expect(matchedTags(['zh-hans'])).toContain('zh');
  });

  // ⚠️ 弱い一致は完全一致のみ。前方一致に混ぜると zh- が zh-TW に当たり
  // 簡体希望へ繁体が混ざる（#817 が避けたかった状態）
  it('素の zh は完全一致だけで拾い、前方一致には出さない', () => {
    const clauses = buildLanguageWhereClause(['zh-hans']);

    expect(clauses).toContainEqual({
      original_language_code: { equals: 'zh', mode: 'insensitive' },
    });
    expect(clauses).not.toContainEqual({
      original_language_code: { startsWith: 'zh-', mode: 'insensitive' },
    });
  });

  it('簡体を希望したとき繁体の実値には当たらない', () => {
    const clauses = buildLanguageWhereClause(['zh-hans']);
    const matches = (dbValue: string) =>
      clauses.some((clause) => {
        const v = clause.original_language_code;
        const value = dbValue.toLowerCase();
        return 'equals' in v
          ? value === v.equals
          : value.startsWith(v.startsWith);
      });

    expect(matches('zh-CN')).toBe(true);
    expect(matches('zh')).toBe(true);
    expect(matches('zh-TW')).toBe(false);
    expect(matches('zh-HK')).toBe(false);
  });

  it('複数の優先言語を順に展開し、重複した候補は1回だけ出す', () => {
    const tags = matchedTags(['ja', 'zh-hans', 'zh-hant']);

    // zh は zh-hans / zh-hant の両方から出るが、条件は重複させない
    expect(tags.filter((tag) => tag === 'zh')).toHaveLength(1);
    expect(tags[0]).toBe('ja');
  });

  it('ja-JP のような region 付きの実値は前方一致で拾える', () => {
    const clauses = buildLanguageWhereClause(['ja']);

    expect(clauses).toContainEqual({
      original_language_code: { startsWith: 'ja-', mode: 'insensitive' },
    });
  });
});
