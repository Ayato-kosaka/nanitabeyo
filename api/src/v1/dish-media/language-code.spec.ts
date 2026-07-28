import {
  BCP47_LANGUAGE_TAG_PATTERN,
  languageMatchCandidates,
  languagePriorityRank,
  normalizeLanguageCode,
  normalizePreferredLanguageCodes,
} from '../../../../shared/utils/languageCode';

/**
 * #817 レビュー優先言語の一致判定。
 *
 * `dish_reviews.original_language_code` には Google import 由来の `ja` と
 * ユーザー投稿由来の `ja-JP` が混在するため、素の `===` では取りこぼす。
 * ここが壊れると「日本語レビューがあるのに英語が出る」症状が再発する。
 */
describe('normalizeLanguageCode', () => {
  it.each([
    ['ja', 'ja'],
    ['ja-JP', 'ja'],
    ['JA-jp', 'ja'],
    ['en-US', 'en'],
    ['ja_JP', 'ja'], // アンダースコア区切りも吸収する
    ['  ja-JP  ', 'ja'],
  ])('%s を %s へ正規化する', (input, expected) => {
    expect(normalizeLanguageCode(input)).toBe(expected);
  });

  it.each([
    ['zh-Hans', 'zh-hans'],
    ['zh-Hant', 'zh-hant'],
    ['zh-CN', 'zh-hans'], // region から script を復元する
    ['zh-SG', 'zh-hans'],
    ['zh-TW', 'zh-hant'],
    ['zh-HK', 'zh-hant'],
    ['zh-Hant-TW', 'zh-hant'],
    ['zh', 'zh'],
  ])('中国語 %s は script を保持して %s になる', (input, expected) => {
    expect(normalizeLanguageCode(input)).toBe(expected);
  });

  it.each([undefined, null, '', '   '])(
    '空値 %p は空文字になり、どの言語とも一致しない',
    (input) => {
      expect(normalizeLanguageCode(input)).toBe('');
      expect(languagePriorityRank(input, ['ja'])).toBe(1);
    },
  );
});

describe('languagePriorityRank', () => {
  const preferred = ['ja', 'en']; // 端末言語 → 検索地点の言語

  it('UGC 投稿の ja-JP が端末言語 ja と一致する（#817 の回帰防止）', () => {
    expect(languagePriorityRank('ja-JP', preferred)).toBe(0);
  });

  it('Google import の ja も端末言語 ja と一致する', () => {
    expect(languagePriorityRank('ja', preferred)).toBe(0);
  });

  it('第二優先の言語は rank 1 になる', () => {
    expect(languagePriorityRank('en-US', preferred)).toBe(1);
  });

  it('どの優先言語にも当たらない言語は最下位になる', () => {
    expect(languagePriorityRank('fr', preferred)).toBe(preferred.length);
  });

  it('簡体と繁体は別言語として扱う', () => {
    expect(languagePriorityRank('zh-TW', ['zh-Hans'])).toBe(1);
    expect(languagePriorityRank('zh-CN', ['zh-Hans'])).toBe(0);
  });

  it('優先指定が空なら最上位と最下位が縮退する（＝並び替えが起きない）', () => {
    const noPreference: string[] = [];

    expect(languagePriorityRank('ja', noPreference)).toBe(noPreference.length);
  });
});

describe('normalizePreferredLanguageCodes', () => {
  it('端末言語と検索地点言語が同じ場合は 1 件に畳まれる', () => {
    expect(normalizePreferredLanguageCodes(['ja-JP', 'ja'])).toEqual(['ja']);
  });

  it('優先順を保ったまま空値を落とす', () => {
    expect(
      normalizePreferredLanguageCodes(['', 'en-US', undefined, 'ja']),
    ).toEqual(['en', 'ja']);
  });

  it('未指定なら空配列（＝従来動作）', () => {
    expect(normalizePreferredLanguageCodes()).toEqual([]);
  });
});

describe('BCP47_LANGUAGE_TAG_PATTERN', () => {
  it.each(['ja', 'en', 'ko', 'fr', 'zh-Hans', 'zh-Hant', 'zh-Hant-TW', 'fil'])(
    'reverse geocoding / locale が生成しうる %s を通す',
    (value) => {
      expect(BCP47_LANGUAGE_TAG_PATTERN.test(value)).toBe(true);
    },
  );

  it.each(['ja-JP', 'en-US', 'zh-CN'])('UGC 側の保存値 %s も通す', (value) => {
    expect(BCP47_LANGUAGE_TAG_PATTERN.test(value)).toBe(true);
  });

  it.each(['', 'japanese', 'j', 'not_a_locale'])(
    '不正な値 %p は弾く',
    (value) => {
      expect(BCP47_LANGUAGE_TAG_PATTERN.test(value)).toBe(false);
    },
  );
});

/**
 * #817 【回帰防止】正規化は zh-CN → zh-hans のようにタグを書き換えるため、
 * 正規形をそのまま DB 値へ突き合わせると中国語だけ一致しない。
 * 補充クエリの WHERE 句はこの候補集合で組み立てること。
 */
describe('languageMatchCandidates', () => {
  /** dish-media.repository.ts の WHERE 句と同じ判定を再現する */
  const matchesDbValue = (normalizedCode: string, dbValue: string) =>
    languageMatchCandidates(normalizedCode).some((candidate) => {
      const value = dbValue.toLowerCase();
      return value === candidate || value.startsWith(`${candidate}-`);
    });

  it.each([
    ['ja', 'ja'],
    ['ja', 'ja-JP'], // UGC 投稿の保存値
    ['en', 'en-US'],
    ['zh-hans', 'zh-Hans'],
    ['zh-hans', 'zh-CN'], // #817 これが拾えないと中国語で補充が空振りする
    ['zh-hans', 'zh-SG'],
    ['zh-hant', 'zh-Hant'],
    ['zh-hant', 'zh-TW'],
    ['zh-hant', 'zh-HK'],
    ['zh-hant', 'zh-MO'],
  ])('正規形 %s が DB 実値 %s に一致する', (normalized, dbValue) => {
    expect(matchesDbValue(normalized, dbValue)).toBe(true);
  });

  it.each([
    ['zh-hans', 'zh-TW'], // 簡体を指定して繁体を拾わない
    ['zh-hant', 'zh-CN'],
    ['ja', 'java'], // ハイフン無しの前方一致で誤爆しない
    ['ja', 'en'],
  ])('正規形 %s は DB 実値 %s に一致しない', (normalized, dbValue) => {
    expect(matchesDbValue(normalized, dbValue)).toBe(false);
  });

  it('正規化 → 候補展開 が端末ロケールから一気通貫で動く', () => {
    const [normalized] = normalizePreferredLanguageCodes(['zh-CN']);

    expect(normalized).toBe('zh-hans');
    expect(languageMatchCandidates(normalized)).toEqual(
      expect.arrayContaining(['zh-hans', 'zh-cn', 'zh-sg']),
    );
  });

  it('空文字は候補なし', () => {
    expect(languageMatchCandidates('')).toEqual([]);
  });
});
