// api/src/v1/dish-media/dish-reviews-soft-delete-boundary.spec.ts
//
// #1596 **`dish_reviews` を読むすべての経路が `deleted_at` で絞っていること**を
// 静的に強制するラチェット。
//
// ## なぜ要るのか
//
// `shared/prisma/schema.prisma` の `dish_reviews.deleted_at` には
// 「読み取り経路は必ず deleted_at IS NULL で絞る」と書いてある。にもかかわらず
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

import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, sep } from 'node:path';

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

/**
 * 削除済みも読むのが正しい場所。**理由を必ず書くこと。**
 * キーはリポジトリルートからの相対パス（POSIX 区切り）。
 */
const EXCLUSIONS: Readonly<Record<string, string>> = {
  // 通報の対象が «実在するか» の存在確認。削除済みのレビューを通報しようとしたときに
  // 「そんなものは無い」と返すと、通報者からは «消えたのに通報できない» に見える。
  // ここは意図的に deleted_at を見ない。
  'src/v1/content-reports/content-reports.repository.ts':
    '通報対象の存在確認。削除済みでも «存在した» として扱う',
  // 論理削除そのものを行う経路。deleted_at を立てる対象を探すので、
  // ここで deleted_at: null を要求するのは自己矛盾ではないが、
  // 更新系の where は本ファイルの検査対象外（find* のみを見る）。
};

const API_SRC = join(__dirname, '..', '..');
const REPO_API_ROOT = join(API_SRC, '..');

function listSourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...listSourceFiles(full));
      continue;
    }
    if (!entry.endsWith('.ts')) continue;
    if (entry.endsWith('.spec.ts')) continue;
    out.push(full);
  }
  return out;
}

/**
 * `text` の `openIndex`（`(` の位置）に対応する `)` までを返す。
 * 文字列リテラル・テンプレートリテラルの中の括弧は数えない。
 */
function readCallArguments(text: string, openIndex: number): string {
  let depth = 0;
  let quote: string | null = null;

  for (let i = openIndex; i < text.length; i += 1) {
    const ch = text[i];

    if (quote) {
      if (ch === '\\') {
        i += 1;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }

    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
      continue;
    }
    if (ch === '(') depth += 1;
    if (ch === ')') {
      depth -= 1;
      if (depth === 0) return text.slice(openIndex, i + 1);
    }
  }
  return text.slice(openIndex);
}


/**
 * コメントを取り除く。
 *
 * ⚠️ これが無いと **「`deleted_at` について説明したコメント」が本文と見分けられず、
 * 絞っていないのに緑になる**。実際、この検査を書いた直後にその形で一度騙された
 * （fix を revert しても赤くならなかった）。検査の正しさは
 * 「壊した状態で赤くなること」でしか確かめられない。
 */
function stripComments(text: string): string {
  let out = '';
  let quote: string | null = null;

  for (let i = 0; i < text.length; i += 1) {
    const ch = text[i];
    const next = text[i + 1];

    if (quote) {
      out += ch;
      if (ch === '\\') {
        out += next ?? '';
        i += 1;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }

    if (ch === "'" || ch === '"' || ch === '`') {
      quote = ch;
      out += ch;
      continue;
    }

    if (ch === '/' && next === '/') {
      const end = text.indexOf('\n', i);
      i = end === -1 ? text.length : end - 1;
      continue;
    }

    if (ch === '/' && next === '*') {
      const end = text.indexOf('*/', i + 2);
      i = end === -1 ? text.length : end + 1;
      continue;
    }

    out += ch;
  }
  return out;
}

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

describe('#1596 dish_reviews の読み取りは必ず deleted_at で絞る', () => {
  const files = listSourceFiles(API_SRC);

  it('検査対象のソースを実際に走査できている（0 件なら検査自体が壊れている）', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it('dish_reviews を読むすべての経路が deleted_at を条件に含む', () => {
    const violations: string[] = [];

    for (const file of files) {
      const relPath = relative(REPO_API_ROOT, file).split(sep).join('/');
      if (EXCLUSIONS[relPath]) continue;

      const text = readFileSync(file, 'utf8');
      const commentFreeText = stripComments(text);

      for (const method of READ_METHODS) {
        const needle = `dish_reviews.${method}(`;
        let from = 0;

        for (;;) {
          const at = text.indexOf(needle, from);
          if (at === -1) break;
          from = at + needle.length;

          const openIndex = at + needle.length - 1;
          const args = readCallArguments(text, openIndex);

          // `where: whereClause` のように変数で渡している場合は、
          // その変数の宣言まで見に行く（`dish-media.repository.ts` の一覧がこの形）。
          const code = stripComments(args);
          const satisfied =
            code.includes('deleted_at') ||
            whereVariableHasDeletedAt(commentFreeText, code);

          if (!satisfied) {
            const line = text.slice(0, at).split('\n').length;
            violations.push(`${relPath}:${line} → dish_reviews.${method}()`);
          }
        }
      }
    }

    expect(violations).toEqual([]);
  });
});
