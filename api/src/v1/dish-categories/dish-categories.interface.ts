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
};

export interface DishCategoryCandidateWithScores {
  category_id: string;
  macro_genre: string | null;
  time_slot_score: number;
  scene_score: number;
  satiety_score: number;
  taste_score: number;
  rel_score: number;
  market_salience_score: number;
  dine_out_orderability_score: number;
  final_score: number;
  rnd_value: number;
  random_unit: number;
  order_score: number;
}

// #757 【設計】特徴量データ（core_ingredient / cooking_method）
export interface DishCategoryFeature {
  feature_key: string;
  score: number;
}

// #757 【設計】カテゴリごとの特徴量セット
export interface DishCategoryFeatureSet {
  category_id: string;
  core_ingredients: DishCategoryFeature[];
  cooking_methods: DishCategoryFeature[];
}
