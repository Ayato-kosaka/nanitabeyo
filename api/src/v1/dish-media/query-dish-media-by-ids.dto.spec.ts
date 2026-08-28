// api/src/v1/dish-media/query-dish-media-by-ids.dto.spec.ts
//
// #1599 `GET /v1/dish-media?ids=` の件数上限。
//
// 上限が無いと、1 リクエストに 10,000 件の UUID を並べるだけで
// `WHERE id IN (...)` が 10,000 件になり、さらに後続のレビュー取得・リアクション集計も
// 同じサイズで走る。**認証は AuthAnonGuard なので、匿名でも投げられる。**

import 'reflect-metadata';
import { plainToInstance } from 'class-transformer';
import { validateSync } from 'class-validator';

// バレル（`@shared/v1/dto`）ではなく個別ファイルを指す。
// バレル経由だと無関係な DTO のデコレータまで評価され、この suite が別の理由で落ちる。
import { QueryDishMediaByIdsDto } from '@shared/v1/dto/dish-media/query-dish-media-by-ids.dto';

/** `?ids=` のクエリ文字列（カンマ区切り）を DTO へ通したときのエラー一覧 */
function validateIds(raw: string) {
  const dto = plainToInstance(QueryDishMediaByIdsDto, { ids: raw });
  return validateSync(dto);
}

const uuid = (n: number) =>
  `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

describe('#1599 QueryDishMediaByIdsDto の件数上限', () => {
  it('クライアントが実際に送る 1 ページぶん（42 件）は通る', () => {
    const ids = Array.from({ length: 42 }, (_, i) => uuid(i)).join(',');
    expect(validateIds(ids)).toHaveLength(0);
  });

  it('上限ちょうど（100 件）は通る', () => {
    const ids = Array.from({ length: 100 }, (_, i) => uuid(i)).join(',');
    expect(validateIds(ids)).toHaveLength(0);
  });

  it('上限を 1 件でも超えたら弾く', () => {
    const ids = Array.from({ length: 101 }, (_, i) => uuid(i)).join(',');
    const errors = validateIds(ids);
    expect(errors).not.toHaveLength(0);
    expect(JSON.stringify(errors)).toContain('arrayMaxSize');
  });

  it('10,000 件は弾く（これが塞ぎたかった形）', () => {
    const ids = Array.from({ length: 10_000 }, (_, i) => uuid(i)).join(',');
    expect(validateIds(ids)).not.toHaveLength(0);
  });

  it('空は従来どおり弾く（ArrayNotEmpty）', () => {
    expect(validateIds('')).not.toHaveLength(0);
  });

  it('UUID でない値は従来どおり弾く', () => {
    expect(validateIds('not-a-uuid')).not.toHaveLength(0);
  });
});
