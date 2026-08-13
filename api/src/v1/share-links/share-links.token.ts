// api/src/v1/share-links/share-links.token.ts
//
// #721 【設計】共有リンクのトークン生成と digest。
//
// 「トークンを知っていること」自体をコンテンツの認可にはしない（削除・非公開・BAN の
// 判定は resolve 時に別途行う）。ここが担保するのは «推測できないこと» だけ。

import { createHash, randomBytes } from 'node:crypto';
import {
  SHARE_LINK_TOKEN_PREFIX,
  SHARE_LINK_TOKEN_RANDOM_BYTES,
  isShareLinkTokenShape,
} from '@shared/v1/constants/shareLinks';

/**
 * 共有トークンを 1 本生成する。
 *
 * 形式: `s1_<base64url(16 bytes)>`
 * - `s1_` は format バージョン。生成方式を変えたくなったときに、既存リンクを壊さず
 *   世代を並行運用するための目印
 * - 16 bytes = 128bit の CSPRNG。総当たりは成立しない
 *
 * ⚠️ dish_media.id / session.id をそのまま URL へ出さないこと。UUID は他の経路
 *（既存 `?ids=` の共有 URL、API レスポンス）から漏れるので、共有 URL の推測に使えてしまう。
 */
export function generateShareToken(): string {
  return `${SHARE_LINK_TOKEN_PREFIX}${randomBytes(SHARE_LINK_TOKEN_RANDOM_BYTES).toString('base64url')}`;
}

/**
 * DB へ保存する digest を作る。
 *
 * 素の sha256 で十分。トークン自体が 128bit の CSPRNG なので、
 * 辞書攻撃もレインボーテーブルも成立しない。
 *
 * ⚠️ **server secret（HMAC）を混ぜないこと。** 共有リンクは SNS 上に長期間残るため、
 * secret をローテーションした瞬間に **過去の共有リンクが全部 404 になる**。
 * どうしても必要なら鍵 ID を列に持って世代管理する設計が要る。
 *
 * @param token 生のトークン（`s1_` 込み）
 * @returns sha256 の生バイト列（`share_links.token_digest` は bytea）
 */
export function toShareTokenDigest(token: string): Buffer {
  return createHash('sha256').update(token, 'utf8').digest();
}

/**
 * トークンとして «形が» 正しいか。存在確認は行わない。
 *
 * DB を引く前に弾くことで、`/s/<任意の文字列>` を投げ続けるだけで
 * クエリを撃たせられる状態を避ける。
 */
export function isValidShareTokenShape(token: string): boolean {
  return isShareLinkTokenShape(token);
}
