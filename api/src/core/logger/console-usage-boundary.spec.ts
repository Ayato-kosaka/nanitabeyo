// api/src/core/logger/console-usage-boundary.spec.ts
//
// #1599 **api のアプリケーションコードから `console.*` を締め出す**ラチェット。
//
// ## なぜ要るのか
//
// `AppLoggerService` は `log_type: 'backend_event_logs'` の JSON を stdout へ出し、
// error-triage は **まさにそのフィールドで BigQuery を絞り込む**。
// `console.warn('...', error)` の生テキストはその網に一切かからない。
//
// 実際に `maintenance.guard.ts` の catch がこの形で、**GCS / RemoteConfig が
// 落ちていてメンテナンスモードと強制アップデートのゲートが両方 fail-open している間、
// 自動検知には乗らず誰も気づけない**状態になっていた。
//
// 「見えないものは «無い» ではない」（CLAUDE.md）。観測できない障害は、
// オーナーが踏むまで誰にも見えない。
//
// ## 落ちたときにやること
//
// `this.logger.log / warn / error`（`AppLoggerService`）を使う。DI が使えない場所
// （logger 自身の出力・env 検証のようにログ基盤より前に走るもの）だけ、
// **理由を書いて** ALLOWED へ足す。

import {
  lineOf,
  listSourceFiles,
  readCode,
  toRepoPath,
} from '../../../test/source-scan';

/**
 * `console.*` を使ってよい場所。**理由を必ず書くこと。**
 * キーは `api/` からの相対パス。
 */
const ALLOWED: Readonly<Record<string, string>> = {
  // 構造化ログの出口そのもの。ここが console.log を呼ばないと何も出ない
  'src/core/logger/logger.service.ts': '構造化ログを stdout へ書く出口',
  // Prisma のクエリログを同じ JSON 形式へ整形して流す。logger と同じ層
  'src/prisma/prisma.service.ts': 'Prisma のログを構造化 JSON として流す出口',
  // 環境変数の検証は DI コンテナが立ち上がる前に走るので logger を使えない
  'src/core/config/env.ts': 'DI 起動前に走る env 検証。logger がまだ無い',
};

const CONSOLE_PATTERN =
  /\bconsole\s*\.\s*(log|warn|error|info|debug|trace)\s*\(/g;

describe('#1599 api のアプリケーションコードは console.* を使わない', () => {
  const files = listSourceFiles();

  it('検査対象のソースを実際に走査できている（0 件なら検査自体が壊れている）', () => {
    expect(files.length).toBeGreaterThan(50);
  });

  it('【自己検査】console.warn を実際に検出できる', () => {
    const sample = `
      } catch (error) {
        console.warn('MaintenanceGuard: Failed to retrieve configuration', error);
        return true;
      }
    `;
    expect([...sample.matchAll(CONSOLE_PATTERN)]).toHaveLength(1);
  });

  it('logger 以外から console.* が呼ばれていない', () => {
    const violations: string[] = [];

    for (const file of files) {
      const path = toRepoPath(file);
      if (ALLOWED[path]) continue;

      // コメントを潰した本文だけを見る（「console.warn を使うな」と書いた
      // 説明コメント自体を違反と誤認しないため）
      const text = readCode(file);
      for (const match of text.matchAll(CONSOLE_PATTERN)) {
        violations.push(
          `${path}:${lineOf(text, match.index)} → console.${match[1]}()`,
        );
      }
    }

    expect(violations).toEqual([]);
  });

  it('ALLOWED に挙げた場所は実在する（消えた行が居座らない）', () => {
    const known = new Set(files.map(toRepoPath));
    expect(Object.keys(ALLOWED).filter((path) => !known.has(path))).toEqual([]);
  });
});
