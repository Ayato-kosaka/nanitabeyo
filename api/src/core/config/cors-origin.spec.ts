import { parseCorsOrigins } from './cors-origin';

/**
 * `cors` パッケージ（NestJS の `enableCors` が内部で使う）の `isOriginAllowed`
 * と同じ判定をここに写して検証する。実装は下記のとおり
 * 「文字列は完全一致・RegExp は test」のみで、glob 展開は行わない。
 * この前提が崩れると本番の CORS 判定も変わるため、テスト側でも明示しておく。
 */
function isOriginAllowed(
  origin: string,
  allowed: (string | RegExp)[],
): boolean {
  return allowed.some((a) =>
    typeof a === 'string' ? origin === a : a.test(origin),
  );
}

describe('parseCorsOrigins', () => {
  it('カンマ区切りを分割し、前後の空白と空要素を落とす', () => {
    expect(
      parseCorsOrigins(' http://localhost:8081 , https://example.web.app ,, '),
    ).toEqual(['http://localhost:8081', 'https://example.web.app']);
  });

  it('`*` を含まない項目は文字列のまま（完全一致）', () => {
    const allowed = parseCorsOrigins('https://nanitabeyo-dev.web.app');

    expect(allowed).toEqual(['https://nanitabeyo-dev.web.app']);
    expect(isOriginAllowed('https://nanitabeyo-dev.web.app', allowed)).toBe(
      true,
    );
    expect(
      isOriginAllowed('https://nanitabeyo-dev.web.app.evil.com', allowed),
    ).toBe(false);
  });

  it('`*` を含む項目は RegExp になり、preview チャンネルの URL に一致する', () => {
    const allowed = parseCorsOrigins(
      'https://nanitabeyo-dev--preview-*.web.app',
    );

    expect(allowed[0]).toBeInstanceOf(RegExp);
    expect(
      isOriginAllowed(
        'https://nanitabeyo-dev--preview-3lfz8fnu.web.app',
        allowed,
      ),
    ).toBe(true);
  });

  it('`*` はドットを跨がない（サフィックスを足した別ドメインを弾く）', () => {
    const allowed = parseCorsOrigins(
      'https://nanitabeyo-dev--preview-*.web.app',
    );

    // `*` を `.*` に展開してしまうと、以下がすべて通ってしまう
    expect(
      isOriginAllowed(
        'https://nanitabeyo-dev--preview-x.web.app.evil.com',
        allowed,
      ),
    ).toBe(false);
    expect(
      isOriginAllowed('https://nanitabeyo-dev--preview-x.evil.com', allowed),
    ).toBe(false);
    expect(
      isOriginAllowed(
        'https://evil.com/nanitabeyo-dev--preview-x.web.app',
        allowed,
      ),
    ).toBe(false);
  });

  it('パターン内のドットはメタ文字ではなくリテラルとして扱う', () => {
    const allowed = parseCorsOrigins('https://*.web.app');

    expect(isOriginAllowed('https://foo.web.app', allowed)).toBe(true);
    expect(isOriginAllowed('https://fooXweb.app', allowed)).toBe(false);
  });

  it('部分一致では通さない（前後にアンカーが付いている）', () => {
    const allowed = parseCorsOrigins('https://*.web.app');

    expect(isOriginAllowed('https://foo.web.app.evil.com', allowed)).toBe(
      false,
    );
    expect(
      isOriginAllowed('http://evil.com?https://foo.web.app', allowed),
    ).toBe(false);
  });

  it('複数指定で、固定 Origin とワイルドカードを混在できる', () => {
    const allowed = parseCorsOrigins(
      'http://localhost:4173,http://localhost:8081,https://nanitabeyo-dev.web.app,https://nanitabeyo-dev--preview-*.web.app',
    );

    expect(allowed).toHaveLength(4);
    expect(isOriginAllowed('http://localhost:8081', allowed)).toBe(true);
    expect(isOriginAllowed('https://nanitabeyo-dev.web.app', allowed)).toBe(
      true,
    );
    expect(
      isOriginAllowed(
        'https://nanitabeyo-dev--preview-abc123.web.app',
        allowed,
      ),
    ).toBe(true);
    expect(isOriginAllowed('https://nanitabeyo.web.app', allowed)).toBe(false);
  });
});
