// api/src/v1/share-links/share-links.preview-text.ts
//
// #721 【設計】共有カード（OGP）の文言テンプレート。
//
// ## なぜ API 側に文言を持つのか
// preview の生成責務はサーバに置く。クライアントから任意の title / description を
// 保存できると、共有カードで別サービスを騙る phishing が作れてしまう。
// app-expo の i18n（`languages/*.json`）は Web バンドル側の資産で API からは読めないため、
// 共有カード専用の最小限の文言だけをここへ持つ。
//
// ## 8 言語すべてを持つ理由
// `PUBLIC_LOCALES` に載っているロケールは URL prefix として実在し、そのロケールで
// 共有される。1 つでも欠けると、そのロケールのユーザーの共有カードだけが英語になる。

import type { PublicLocale } from '@shared/v1/constants/publicLocales';

/** 共有カードのテンプレートに差し込む値 */
export type SharePreviewVars = {
  /** 料理名（dishes.name か、無ければ料理カテゴリのローカライズ名） */
  dishName: string;
  /** 店舗名 */
  restaurantName: string;
  /**
   * 共有に含まれる投稿の件数。
   *
   * ⚠️ **1 件と複数件で文言を変えるために要る。** アプリの共有は「今見ている 1 件」だけでなく
   * **検索結果をまとめて共有する**経路があり（`idsForShare`）、そこで先頭 1 件の
   * 「料理名 - 店名」だけを出すと、受け取った側には単品の共有にしか見えない。
   * 実機フィードバックで「文言が一括シェアに見えない」と指摘された。
   */
  count: number;
};

/**
 * `dish_media` の共有カード文言。
 *
 * 1 件なら「料理名 - 店舗名」。SNS のカードはタイトルを 2 行前後で切るので、
 * 一番情報量の多い 2 つだけを前に置く。
 *
 * ⚠️ **複数件（`count > 1`）では必ず件数を出すこと。** 検索結果をまとめて共有する経路が
 * あり、先頭 1 件の「料理名 - 店舗名」だけを出すと受け取った側には単品の共有に見える。
 * 店舗名は複数件では外す。共有された投稿が同じ店とは限らず、先頭の店名を代表として
 * 出すと «その店の話» だと誤解させるため。
 */
export const DISH_MEDIA_PREVIEW_TEXT: Record<
  PublicLocale,
  { title: (v: SharePreviewVars) => string; description: (v: SharePreviewVars) => string }
> = {
  'ja-JP': {
    title: (v) => (v.count > 1 ? `${v.dishName} ほか${v.count - 1}件 - なに食べよ` : `${v.dishName} - ${v.restaurantName}`),
    description: (v) => (v.count > 1 ? `${v.dishName}（${v.restaurantName}）を含む ${v.count} 件の料理。なに食べよ で写真とレビューを見る。` : `${v.restaurantName} の ${v.dishName}。なに食べよ で写真とレビューを見る。`),
  },
  'en-US': {
    title: (v) => (v.count > 1 ? `${v.dishName} and ${v.count - 1} more - CraveCatch` : `${v.dishName} - ${v.restaurantName}`),
    description: (v) => (v.count > 1 ? `${v.count} dishes including ${v.dishName} at ${v.restaurantName}. See photos and reviews on CraveCatch.` : `${v.dishName} at ${v.restaurantName}. See photos and reviews on CraveCatch.`),
  },
  'fr-FR': {
    title: (v) => (v.count > 1 ? `${v.dishName} et ${v.count - 1} autres - CraveCatch` : `${v.dishName} - ${v.restaurantName}`),
    description: (v) => (v.count > 1 ? `${v.count} plats dont ${v.dishName} chez ${v.restaurantName}. Photos et avis sur CraveCatch.` : `${v.dishName} chez ${v.restaurantName}. Photos et avis sur CraveCatch.`),
  },
  'zh-CN': {
    title: (v) => (v.count > 1 ? `${v.dishName} 等 ${v.count} 道菜 - CraveCatch` : `${v.dishName} - ${v.restaurantName}`),
    description: (v) => (v.count > 1 ? `包含 ${v.restaurantName} 的${v.dishName}在内的 ${v.count} 道菜。在 CraveCatch 查看照片和评价。` : `${v.restaurantName} 的${v.dishName}。在 CraveCatch 查看照片和评价。`),
  },
  'ar-SA': {
    title: (v) => (v.count > 1 ? `${v.dishName} و${v.count - 1} أخرى - CraveCatch` : `${v.dishName} - ${v.restaurantName}`),
    description: (v) => (v.count > 1 ? `${v.count} أطباق منها ${v.dishName} في ${v.restaurantName}. شاهد الصور والمراجعات على CraveCatch.` : `${v.dishName} في ${v.restaurantName}. شاهد الصور والمراجعات على CraveCatch.`),
  },
  'ko-KR': {
    title: (v) => (v.count > 1 ? `${v.dishName} 외 ${v.count - 1}건 - CraveCatch` : `${v.dishName} - ${v.restaurantName}`),
    description: (v) => (v.count > 1 ? `${v.restaurantName}의 ${v.dishName}을(를) 포함한 ${v.count}건의 요리. CraveCatch에서 사진과 리뷰를 확인하세요.` : `${v.restaurantName}의 ${v.dishName}. CraveCatch에서 사진과 리뷰를 확인하세요.`),
  },
  'es-ES': {
    title: (v) => (v.count > 1 ? `${v.dishName} y ${v.count - 1} más - CraveCatch` : `${v.dishName} - ${v.restaurantName}`),
    description: (v) => (v.count > 1 ? `${v.count} platos incluyendo ${v.dishName} en ${v.restaurantName}. Fotos y reseñas en CraveCatch.` : `${v.dishName} en ${v.restaurantName}. Fotos y reseñas en CraveCatch.`),
  },
  'hi-IN': {
    title: (v) => (v.count > 1 ? `${v.dishName} और ${v.count - 1} अन्य - CraveCatch` : `${v.dishName} - ${v.restaurantName}`),
    description: (v) => (v.count > 1 ? `${v.restaurantName} के ${v.dishName} सहित ${v.count} व्यंजन। CraveCatch पर तस्वीरें और समीक्षाएँ देखें।` : `${v.restaurantName} का ${v.dishName}। CraveCatch पर तस्वीरें और समीक्षाएँ देखें।`),
  },
};

/**
 * 友達投票（`dish_category_group_vote_sessions`）の共有カード文言。
 *
 * 投票は「何を食べるか」がまだ決まっていない状態を共有するものなので、
 * 対象固有の値を差し込まない共通テンプレートで足りる
 *（dish_media のような重い preview 生成を行わない、と設計で決めた部分）。
 */
export const GROUP_VOTE_PREVIEW_TEXT: Record<PublicLocale, { title: string; description: string }> = {
  'ja-JP': {
    title: 'みんなで食べたいものを決めよう！',
    description: 'なに食べよ の友達投票に参加して、みんなで料理を選ぼう。',
  },
  'en-US': {
    title: 'Vote on what to eat together!',
    description: 'Join this CraveCatch group vote and pick a dish together.',
  },
  'fr-FR': {
    title: 'Votons ensemble pour le repas !',
    description: 'Rejoignez ce vote de groupe CraveCatch et choisissez un plat ensemble.',
  },
  'zh-CN': {
    title: '一起来决定吃什么吧！',
    description: '加入 CraveCatch 的好友投票，一起挑选今天的美食。',
  },
  'ar-SA': {
    title: 'لنصوّت معًا على ما سنأكله!',
    description: 'انضم إلى تصويت المجموعة على CraveCatch واختاروا طبقًا معًا.',
  },
  'ko-KR': {
    title: '무엇을 먹을지 함께 정해요!',
    description: 'CraveCatch 친구 투표에 참여해 함께 메뉴를 골라보세요.',
  },
  'es-ES': {
    title: '¡Votemos qué comer juntos!',
    description: 'Únete a esta votación de grupo en CraveCatch y elegid un plato juntos.',
  },
  'hi-IN': {
    title: 'मिलकर तय करें कि क्या खाना है!',
    description: 'CraveCatch के ग्रुप वोट में शामिल हों और साथ मिलकर व्यंजन चुनें।',
  },
};

/**
 * OGP のテキストは SNS 側で切り詰められる。DB に無制限の長さを入れないための上限。
 *
 * 実測上、X は title 70 / description 200 前後で切る。切られる前提でも、
 * DB に極端に長い値を入れると `/s/:token` のレスポンスが無駄に太る。
 */
export const PREVIEW_TITLE_MAX_LENGTH = 120;
export const PREVIEW_DESCRIPTION_MAX_LENGTH = 300;

/** 末尾を `…` にして丸める（切らない場合はそのまま返す） */
export function truncatePreviewText(text: string, max: number): string {
  const normalized = text.replace(/\s+/g, ' ').trim();
  if (normalized.length <= max) return normalized;
  return `${normalized.slice(0, max - 1)}…`;
}
