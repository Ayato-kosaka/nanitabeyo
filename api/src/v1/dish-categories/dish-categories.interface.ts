// 正規化されたカテゴリ候補検索用入力データ
export type DishCategoryCandidateNormalizedInput = {
  // addressをカンマ区切りで分割したトークン群
  addressTokens: string[];
  // addressTokens の接頭辞に "region:" を付与したもの
  regionTokens: string[];
  // market_salience / orderability 用の地域フォールバックキー
  // （狭い地域→広い地域→global）
  regionFallbackKeys: string[];
  // #737 【設計】season 用のフォールバックキー。regionFallbackKeys の各要素へ
  // `:month:MM` を付けたもの（例: "region:country:JP:month:08" → … → "global:month:08"）。
  // 狭い地域→広い地域→global の順に最初に見つかった 1 件を採用する。
  seasonFallbackKeys: string[];
  budgetIntentKeys: string[];
  timeSlotKey: string | null;
  sceneKey: string | null;
  satietyKey: string | null;
  diningPaceKey: string | null;
  coreIngredientKey: string | null;
  tasteKey: string | null;
  langCandidates: string[];
};

export interface DishCategoryCandidateWithScores {
  category_id: string;
  macro_genre: string | null;
  budget_intent_score: number;
  time_slot_score: number;
  scene_score: number;
  satiety_score: number;
  dining_pace_score: number;
  core_ingredient_score: number;
  taste_score: number;
  rel_score: number;
  market_salience_score: number;
  dine_out_orderability_score: number;
  // #737 【設計】季節補正スコア。1 = 平常月（＝補正係数がちょうど 1.0 で無影響）。
  // season の行を持たないカテゴリは SQL 側の COALESCE で 1 になる。
  season_score: number;
  final_score: number;
  rnd_value: number;
  random_unit: number;
  order_score: number;
}

// #757 【設計】ペナルティ計算用特徴量データ（core_ingredient / cooking_method）
export interface DishCategoryPenaltyFeature {
  feature_key: string;
  score: number;
}

// #757 【設計】カテゴリごとのペナルティ計算用特徴量セット
export interface DishCategoryPenaltyFeatureSet {
  category_id: string;
  core_ingredients: DishCategoryPenaltyFeature[];
  taste_features: DishCategoryPenaltyFeature[];
  cooking_methods: DishCategoryPenaltyFeature[];
}
