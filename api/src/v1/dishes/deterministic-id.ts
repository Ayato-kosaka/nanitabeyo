import { createHash } from 'node:crypto';

/**
 * #829 【設計】Google import の ID を (placeId, categoryId) から決定論的に導出する。
 *
 * bulk-import は「既存 dish_media を DB から読んで再利用するか決める」が、その行を実際に
 * 書くのは非同期の Cloud Tasks handler である。つまり 1 本目の handler が commit する前に
 * 2 本目の bulk-import が走ると、どちらの preflight lookup も「既存なし」と判定し、
 * それぞれ別の randomUUID を採番してしまう。結果として同じ Google レビューが
 * dish_reviews へ二重登録され、reviewCount と averageRating が水増しされる。
 *
 * ID をリクエスト間で決定論的にすると、DB を先に読まなくても両者が同じ ID を出すため、
 * 既存の `dish_media.upsert` と `dish_reviews.createMany({ skipDuplicates: true })` が
 * そのままクロスリクエストの重複防止として機能する。
 * preflight lookup は「Photo Media 課金を skip するための最適化」に純化でき、
 * 正しさが実行タイミングに依存しなくなる。
 *
 * RFC 4122 の UUID v5（SHA-1 + 名前空間）に準拠する。
 */

/** UUID 文字列を 16 バイトへ変換する */
const uuidToBytes = (uuid: string): Buffer => {
  const bytes = Buffer.from(uuid.replace(/-/g, ''), 'hex');
  // Buffer.from(..., 'hex') は不正な文字で静かに打ち切るため、長さを必ず検証する。
  // 検証しないと 0〜15 バイトの名前空間で黙ってハッシュしてしまう。
  if (bytes.length !== 16) {
    throw new Error(`Invalid UUID namespace: ${uuid}`);
  }
  return bytes;
};

/**
 * RFC 4122 UUID v5 を生成する。
 * 外部依存を増やさないため node:crypto だけで実装する。
 */
export function uuidV5(name: string, namespace: string): string {
  const hash = createHash('sha1')
    .update(uuidToBytes(namespace))
    .update(Buffer.from(name, 'utf8'))
    .digest();

  const bytes = Buffer.from(hash.subarray(0, 16));
  bytes[6] = (bytes[6] & 0x0f) | 0x50; // version 5
  bytes[8] = (bytes[8] & 0x3f) | 0x80; // RFC 4122 variant

  const hex = bytes.toString('hex');
  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20, 32),
  ].join('-');
}

/**
 * 名前空間。値を変更すると既存レコードと ID が一致しなくなるため、変更しないこと。
 */
const NS_DISH_MEDIA = '8f2b1c94-4d7e-5a13-9c60-2e4f8a1b3d57';
const NS_DISH_REVIEW = 'b41d7e26-9a83-5f04-8d15-6c9e2b7a4f80';

/**
 * 区切り文字の取り違えによる衝突を防ぐため、各要素を長さ接頭辞付きで連結する。
 * 単純な `a:b` 連結だと ("a:b", "c") と ("a", "b:c") が同じキーになる。
 */
const joinKeyParts = (...parts: string[]): string =>
  parts.map((part) => `${part.length}:${part}`).join('');

/** Google import の dish_media.id を (placeId, categoryId) から導出する */
export function buildGoogleImportDishMediaId(
  placeId: string,
  categoryId: string,
): string {
  return uuidV5(joinKeyParts(placeId, categoryId), NS_DISH_MEDIA);
}

/**
 * Google import の dish_reviews.id を (placeId, categoryId, レビュー本文) から導出する。
 *
 * index ではなく本文でキーを作る。Google が返すレビューの並び順は保証されないため、
 * index を使うと並びが変わっただけで別 ID になり重複してしまう。
 *
 * 本文・投稿者が空でも区別できるよう rating まで含める。
 */
export function buildGoogleImportDishReviewId(
  placeId: string,
  categoryId: string,
  reviewComment: string,
  authorUri: string,
  rating: number,
): string {
  // rating も含める。本文も authorAttribution.uri も無い「評価のみ」のレビューが
  // 複数返ると、rating が無いキーでは同一 ID に潰れて件数がズレる。
  return uuidV5(
    joinKeyParts(placeId, categoryId, authorUri, reviewComment, String(rating)),
    NS_DISH_REVIEW,
  );
}
