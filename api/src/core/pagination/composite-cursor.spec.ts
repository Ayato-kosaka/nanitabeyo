// api/src/core/pagination/composite-cursor.spec.ts
//
// #1599 複合カーソルの単体テスト。
//
// ここで固定しているのは「同時刻の行がページ境界をまたいでも飛ばない」という 1 点。
// 実際の Prisma を通した経路は各 repository の spec 側で見る。

import {
  buildCursorFilter,
  buildCursorOrderBy,
  formatCompositeCursor,
  parseCompositeCursor,
} from './composite-cursor';

const AT = new Date('2026-08-10T00:00:00.000Z');

describe('formatCompositeCursor / parseCompositeCursor', () => {
  it('往復して同じ値になる', () => {
    const cursor = formatCompositeCursor(AT, 'row-1');
    expect(cursor).toBe('2026-08-10T00:00:00.000Z|row-1');

    const parsed = parseCompositeCursor(cursor);
    expect(parsed?.at.toISOString()).toBe(AT.toISOString());
    expect(parsed?.id).toBe('row-1');
  });

  it('旧形式（ISO8601 のみ）は id なしとして受ける（配信済みクライアント互換）', () => {
    const parsed = parseCompositeCursor('2026-08-10T00:00:00.000Z');
    expect(parsed?.at.toISOString()).toBe(AT.toISOString());
    expect(parsed?.id).toBeNull();
  });

  it('UUID に `|` は現れないので id 側が壊れない', () => {
    const uuid = '3f1a2b4c-5d6e-4f70-8a9b-0c1d2e3f4a5b';
    expect(parseCompositeCursor(formatCompositeCursor(AT, uuid))?.id).toBe(uuid);
  });

  // 壊れたカーソルは «先頭ページ» へ倒す。Invalid Date をそのまま Prisma へ渡すと 500 になり、
  // 一覧が丸ごと見られなくなる（カーソルはクライアントから来る任意の文字列である）。
  it.each([
    ['空文字', ''],
    ['日付として読めない', 'not-a-date'],
    ['区切りだけ', '|'],
    ['id だけ', '|row-1'],
    ['null', null],
    ['undefined', undefined],
  ])('壊れたカーソル（%s）は null を返す', (_label, input) => {
    expect(parseCompositeCursor(input as string | null | undefined)).toBeNull();
  });
});

describe('buildCursorFilter', () => {
  it('カーソルが無ければ空（先頭ページ）', () => {
    expect(buildCursorFilter(undefined)).toEqual({});
    expect(buildCursorFilter('')).toEqual({});
  });

  it('壊れたカーソルでも throw せず先頭ページへ倒す', () => {
    expect(buildCursorFilter('not-a-date')).toEqual({});
  });

  it('複合カーソルは「時刻がより古い」か「同時刻で id がより小さい」', () => {
    expect(buildCursorFilter(formatCompositeCursor(AT, 'row-5'))).toEqual({
      OR: [
        { created_at: { lt: AT } },
        { created_at: AT, id: { lt: 'row-5' } },
      ],
    });
  });

  it('旧形式は従来どおり時刻だけで絞る', () => {
    expect(buildCursorFilter('2026-08-10T00:00:00.000Z')).toEqual({
      created_at: { lt: AT },
    });
  });

  it('列名を差し替えられる（updated_at 順の一覧用）', () => {
    expect(buildCursorFilter(formatCompositeCursor(AT, 'row-5'), 'updated_at'))
      .toEqual({
        OR: [
          { updated_at: { lt: AT } },
          { updated_at: AT, id: { lt: 'row-5' } },
        ],
      });
  });
});

describe('buildCursorOrderBy', () => {
  // 比較条件と並び順が食い違うと、飛ばす代わりに重複が出る。対で使うことを固定する。
  it('第 2 キーに id を含む', () => {
    expect(buildCursorOrderBy()).toEqual([
      { created_at: 'desc' },
      { id: 'desc' },
    ]);
    expect(buildCursorOrderBy('updated_at')).toEqual([
      { updated_at: 'desc' },
      { id: 'desc' },
    ]);
  });
});

describe('#1599 同時刻の行がページ境界をまたぐ状況を再現する', () => {
  // 「1 ページ 2 件・3 件とも同時刻」を手で回して、3 件目が拾えることを確かめる。
  // 旧実装（時刻単独）では 2 ページ目が空になり、3 件目はどのページにも現れなかった。
  type Row = { id: string; created_at: Date };
  const rows: Row[] = [
    { id: 'c', created_at: AT },
    { id: 'b', created_at: AT },
    { id: 'a', created_at: AT },
  ];

  /** buildCursorFilter が返す条件を、この配列に対して手で適用する */
  function page(cursor: string | undefined, limit: number): Row[] {
    const filter = buildCursorFilter(cursor) as {
      OR?: Array<Record<string, unknown>>;
      created_at?: { lt: Date };
    };

    const matches = rows.filter((row) => {
      if (filter.created_at) {
        return row.created_at.getTime() < filter.created_at.lt.getTime();
      }
      if (!filter.OR) return true;
      const [older, sameMoment] = filter.OR as [
        { created_at: { lt: Date } },
        { created_at: Date; id: { lt: string } },
      ];
      return (
        row.created_at.getTime() < older.created_at.lt.getTime() ||
        (row.created_at.getTime() === sameMoment.created_at.getTime() &&
          row.id < sameMoment.id.lt)
      );
    });

    // orderBy [created_at desc, id desc]
    return matches
      .sort(
        (x, y) =>
          y.created_at.getTime() - x.created_at.getTime() ||
          (x.id < y.id ? 1 : x.id > y.id ? -1 : 0),
      )
      .slice(0, limit);
  }

  it('全 3 件が、重複も欠落もなく 2 ページで拾える', () => {
    const first = page(undefined, 2);
    expect(first.map((r) => r.id)).toEqual(['c', 'b']);

    const cursor = formatCompositeCursor(
      first[first.length - 1].created_at,
      first[first.length - 1].id,
    );
    const second = page(cursor, 2);

    // 旧実装ではここが [] になり、'a' は永久に見えなかった
    expect(second.map((r) => r.id)).toEqual(['a']);

    const seen = [...first, ...second].map((r) => r.id);
    expect(seen).toEqual(['c', 'b', 'a']);
    expect(new Set(seen).size).toBe(seen.length);
  });

  it('旧形式カーソルだと同時刻の行が飛ぶ（後方互換のため意図的に残している挙動）', () => {
    const first = page(undefined, 2);
    const legacyCursor = first[first.length - 1].created_at.toISOString();
    expect(page(legacyCursor, 2)).toEqual([]);
  });
});
