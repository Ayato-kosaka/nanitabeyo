// api/src/v1/dish-media/dish-reviews-soft-delete-boundary.spec.ts
//
// #1596 **`dish_reviews` / `dish_media` を読むすべての経路が `deleted_at` で絞っていること**を
// 静的に強制するラチェット。
//
// ## なぜ要るのか
//
// `shared/prisma/schema.prisma` は `dish_reviews.deleted_at` と `dish_media.deleted_at` の
// **両方**に「読み取り経路は必ず deleted_at IS NULL で絞る」と書いてある。にもかかわらず
// `dish-media.repository.ts` の «この dish を自分が食べたか»（isEaten）判定 1 本だけが
// 絞り忘れており、**レビューを削除しても «食べたを記録» が記録済みの見た目のまま**だった。
//
// 兄弟の読み取り（一覧・平均点・件数・Calendar の最古日・店舗集計）は
// すべて絞っていたので、レビューでも型検査でも気づけない。**1 箇所漏れれば穴**という
// 性質の不変条件は、人の注意ではなくこういう機械的な検査で守るしかない。
//
// 同じ作法のものが app-expo 側にもある（assert:no-hardcoded-colors 等）。
//
// ## 落ちたときにやること
//
// 新しく `dish_reviews` を読む場所を足したなら、その where へ `deleted_at: null` を足す。
// 「削除済みも含めて読むのが正しい」場合だけ、**理由を書いて** EXCLUSIONS へ足す。

import {
  blankComments,
  lineOf,
  listSourceFiles,
  readBraceBlock,
  readCallArguments,
  toRepoPath,
} from '../../../test/source-scan';
import { readFileSync } from 'node:fs';

/**
 * 検査対象の読み取りメソッド。
 *
 * **`findUnique` / `findUniqueOrThrow` は意図的に外している。** Prisma の
 * `findUnique.where` は一意キーしか受け付けないため、`deleted_at: null` を
 * **構造的に書けない**。この 2 つを使う経路は、取得後に呼び出し側で
 * `deleted_at` を見る責任がある（例: `findReviewForMutation` は «消えている(404)» と
 * «他人のもの(403)» を区別するため、削除済みも返すのが正しい）。
 */
const READ_METHODS = [
  'findMany',
  'findFirst',
  'findFirstOrThrow',
  'count',
  'aggregate',
  'groupBy',
] as const;

/** 検査対象のテーブル。schema.prisma が同じ約束をしているもの */
const GUARDED_TABLES = ['dish_reviews', 'dish_media'] as const;

/**
 * 削除済みも読むのが正しい場所。**理由を必ず書くこと。**
 * キーは `<リポジトリ相対パス>#<テーブル>`。
 */
/**
 * #1599 ネストしたリレーション指定
 * （`include: { dish_reviews: { where: ... } }`）で、削除済みも読むのが正しい場所。
 * **理由を必ず書くこと。** キーは `<api からの相対パス>:<行番号>`。
 *
 * ⚠️ 行番号込みなので、その行が動いたら落ちる。**それは意図した挙動である。**
 * 除外は «この呼び出し» に対して与えたものであって、ファイルに対してではない。
 */
const NESTED_EXCLUSIONS: Readonly<Record<string, string>> = {
  // #829 Google 一括取り込みの «再利用できる media があるか» の探索。
  // どちらも `user_id: null`（= Google 取り込み由来）で絞っており、
  // **その行は現状どの経路からも論理削除されない**。
  // 唯一の削除経路 `softDeleteDishMediaWithReviews` は
  // `deleteDishMedia`（`media.user_id !== userId` なら 403）からしか呼ばれず、
  // `user_id` が NULL の行に一致するリクエスト者は存在しないため。
  //
  // 【もし将来 運営による削除経路を足すなら、ここを作り直すこと】
  // 単に `deleted_at: null` を足すだけでは直らない。#829 は dish_media の id を
  // (placeId, categoryId) から決定論的に導出しており、再利用を諦めて作り直そうとしても
  // 同じ id になって `createDishMedia` の upsert が no-op になる（削除済みのまま）。
  // 復活させるのか作り直すのかは、その削除経路の仕様と一緒に決める必要がある。
  'src/v1/dishes/dishes.repository.ts:225':
    '#829 Google 取り込みの再利用探索（completed）。user_id: null の行は削除されない',
  'src/v1/dishes/dishes.repository.ts:271':
    '#829 Google 取り込みの再利用探索（未完了）。user_id: null の行は削除されない',
};

/**
 * Prisma のリレーション指定であることの目安。
 * `data: { dish_media: { connect: ... } }` のような書き込みを拾わないために要る。
 */
const RELATION_HINT = /\b(where|select|orderBy|take|include|skip|cursor)\s*:/;

const EXCLUSIONS: Readonly<Record<string, string>> = {
  // 通報の対象が «実在するか» の存在確認。削除済みのレビューを通報しようとしたときに
  // 「そんなものは無い」と返すと、通報者からは «消えたのに通報できない» に見える。
  // ここは意図的に deleted_at を見ない。
  'src/v1/content-reports/content-reports.repository.ts#dish_reviews':
    '通報対象の存在確認。削除済みでも «存在した» として扱う',
  // 退会時に GCS の実体を消すための一覧。論理削除で行は残すが、
  // 「参照が消えたあとに実体を残す理由がない」ので **削除済みも含めて**引くのが正しい。
  // ここで deleted_at: null を要求すると、消した投稿のファイルが永久に残る。
  'src/v1/users/users.repository.ts#dish_media':
    '退会時のストレージ実体削除。削除済みの投稿のファイルも消す必要がある',
};

/**
 * `where: someVariable` の形で渡されているとき、その変数の宣言に
 * `deleted_at` が含まれるかを見る。
 *
 * 完全な解析はしない（それは型検査器の仕事）。**「変数名で渡している」だけの理由で
 * 誤検知して、正しいコードを直させることを防ぐ**のが目的。
 */
function whereVariableHasDeletedAt(fileText: string, args: string): boolean {
  const match = args.match(/where:\s*([A-Za-z_$][A-Za-z0-9_$]*)\s*[,}]/);
  if (!match) return false;

  const declaration = new RegExp(
    `(?:const|let|var)\\s+${match[1]}\\s*(?::[^=]+)?=`,
  ).exec(fileText);
  if (!declaration) return false;

  const start = declaration.index;
  // 宣言から次の «行頭が閉じ括弧だけ» まで、あるいは 2000 文字ぶんを見る。
  // where の組み立ては宣言直後にまとまって書かれる前提。
  const scope = fileText.slice(start, start + 2000);
  return scope.includes('deleted_at');
}

describe('#1596 論理削除テーブルの読み取りは必ず deleted_at で絞る', () => {
  const files = listSourceFiles();

  it('検査対象のソースを実際に走査できている（0 件なら検査自体が壊れている）', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it('dish_reviews / dish_media を読むすべての経路が deleted_at を条件に含む', () => {
    const violations: string[] = [];

    for (const file of files) {
      const relPath = toRepoPath(file);

      // コメントを空白で潰した版だけを見る。位置と行番号は元ファイルと一致する。
      const text = blankComments(readFileSync(file, 'utf8'));

      for (const [table, method] of GUARDED_TABLES.flatMap((t) =>
        READ_METHODS.map((m) => [t, m] as const),
      )) {
        if (EXCLUSIONS[`${relPath}#${table}`]) continue;

        const needle = `${table}.${method}(`;
        let from = 0;

        for (;;) {
          const at = text.indexOf(needle, from);
          if (at === -1) break;
          from = at + needle.length;

          const openIndex = at + needle.length - 1;
          const args = readCallArguments(text, openIndex);

          // `where: whereClause` のように変数で渡している場合は、
          // その変数の宣言まで見に行く（`dish-media.repository.ts` の一覧がこの形）。
          const satisfied =
            args.includes('deleted_at') || whereVariableHasDeletedAt(text, args);

          if (!satisfied) {
            const line = lineOf(text, at);
            violations.push(`${relPath}:${line} → ${table}.${method}()`);
          }
        }
      }
    }

    expect(violations).toEqual([]);
  });

  // #1599 上の検査は `dish_reviews.findMany(` のような **トップレベルの呼び出し**しか見ない。
  // Prisma は `include: { dish_reviews: { where: ... } }` でもリレーションを読めるので、
  // そちらは丸ごと素通しだった（#1607 の検証中に判明）。同じ不変条件なので同じ強さで守る。
  it('ネストしたリレーション指定も deleted_at を条件に含む', () => {
    const violations: string[] = [];

    for (const file of files) {
      const relPath = toRepoPath(file);
      const text = blankComments(readFileSync(file, 'utf8'));

      for (const table of GUARDED_TABLES) {
        const pattern = new RegExp(`\\b${table}\\s*:\\s*\\{`, 'g');

        for (const match of text.matchAll(pattern)) {
          const openIndex = text.indexOf('{', match.index);
          const block = readBraceBlock(text, openIndex);

          // 書き込み（`data: { dish_media: { connect } }` 等）は対象外
          if (!RELATION_HINT.test(block)) continue;
          if (block.includes('deleted_at')) continue;

          const line = lineOf(text, match.index);
          if (NESTED_EXCLUSIONS[`${relPath}:${line}`]) continue;

          violations.push(`${relPath}:${line} → include/select の ${table}`);
        }
      }
    }

    expect(violations).toEqual([]);
  });

  it('【自己検査】ネストした指定の絞り忘れを実際に検出できる', () => {
    // 「トップレベルは絞っているがネストは絞っていない」形。上の 1 本目の検査は
    // これを緑にしてしまう（見えていない）ので、2 本目が要る理由そのものになる。
    const sample = `
      await tx.dishes.findMany({
        where: { id },
        include: {
          dish_reviews: {
            orderBy: { created_at: 'asc' },
            take: 3,
          },
        },
      });
    `;
    const openIndex = sample.indexOf('{', sample.indexOf('dish_reviews:'));
    const block = readBraceBlock(sample, openIndex);

    expect(RELATION_HINT.test(block)).toBe(true);
    expect(block.includes('deleted_at')).toBe(false);

    // 絞れば検出されない
    const fixed = block.replace('orderBy:', 'where: { deleted_at: null },\n            orderBy:');
    expect(fixed.includes('deleted_at')).toBe(true);
  });

  it('NESTED_EXCLUSIONS に挙げた行が実在する（消えた行の除外指定が居座らない）', () => {
    const stale = Object.keys(NESTED_EXCLUSIONS).filter((key) => {
      const [relPath, lineText] = key.split(':');
      const file = files.find((candidate) => toRepoPath(candidate) === relPath);
      if (!file) return true;

      const text = blankComments(readFileSync(file, 'utf8'));
      const line = Number(lineText);
      const source = text.split('\n')[line - 1] ?? '';
      return !GUARDED_TABLES.some((table) =>
        new RegExp(`\\b${table}\\s*:\\s*\\{`).test(source),
      );
    });

    expect(stale).toEqual([]);
  });
});
