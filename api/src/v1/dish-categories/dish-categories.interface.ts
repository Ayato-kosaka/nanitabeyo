
// 正規化されたカテゴリ候補検索用入力データ
export type DishCategoryCandidateNormalizedInput = {
    // addressをカンマ区切りで分割したトークン群
    addressTokens: string[];
    // addressTokens の接頭辞に "region:" を付与したもの
    regionTokens: string[];
    // market_salience / orderability 用の地域フォールバックキー
    // （狭い地域→広い地域→global）
    regionFallbackKeys: string[];
    timeSlotKey: string | null;
    sceneKey: string | null;
    satietyKey: string | null;
    tasteKey: string | null;
    langCandidates: string[];
}