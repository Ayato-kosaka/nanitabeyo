// api/src/share/share-links.web-path.ts
//
// #721 【設計】共有リンクの target を、Web 側の «実在する» パスへ変換する。
//
// ⚠️ 任意のパスを保存して redirect する作りにはしない。ここで許すのは
// `target_type` ごとに手で書いた 2 本だけで、それ以外は既定へ落とす。
// 保存された文字列をそのまま遷移先にすると Open Redirect の入口になる。

import type { PublicLocale } from '@shared/v1/constants/publicLocales';
import type { ShareLinkTargetType } from '@shared/v1/constants/shareLinks';

/**
 * OIA relay の配信元。
 *
 * iOS Safari / Chrome は「同一サイト起点の Universal Link」を抑止するため、
 * `app.nanitabeyo.net` のページから同ドメインのリンクを踏んでもアプリが開かない。
 * 既存の `OpenInAppBanner`（app-expo/components/deepLinking/）と同じく、
 * **別オリジンの relay を経由**して外部起点を作る。
 *
 * relay 側は `ALLOW_ORIGIN` を `https://app.nanitabeyo.net` に固定しており、
 * それ以外の origin へは飛ばさない（app-expo/relay-public/oia/open/index.html）。
 */
const OIA_RELAY_BASE = 'https://oia-relay.web.app';

/** 「アプリで開く」導線の URL を作る */
export function buildOpenInAppUrl(targetUrl: string): string {
  return `${OIA_RELAY_BASE}/oia/open/?u=${encodeURIComponent(targetUrl)}`;
}

/**
 * target を Web 側のパスへ変換する（先頭スラッシュ付き・ホストは含まない）。
 *
 * `dish_media` は既存の `/{locale}/posts?ids=...` をそのまま使う。
 * 新しい URL を作らないことで、既に共有済みのリンクと同じ画面に着地する。
 */
export function buildTargetWebPath(
  targetType: ShareLinkTargetType,
  targetId: string,
  targetParams: Record<string, unknown>,
  locale: PublicLocale,
): string {
  switch (targetType) {
    case 'dish_media': {
      const ids = Array.isArray(targetParams.ids) ? targetParams.ids.map(String) : [targetId];
      // ids は UUID しか入らない（作成時に検証済み）が、保存後に手で書き換えられた
      // 場合に備えて encode する。ここを素通しにすると `?ids=` を経由した注入になる
      return `/${locale}/posts?ids=${encodeURIComponent(ids.join(','))}`;
    }
    case 'dish_category_group_vote_sessions': {
      const shareToken =
        typeof targetParams.shareToken === 'string' ? targetParams.shareToken : '';
      // shareToken が失われている行は、投票画面ではなくホームへ落とす
      if (!shareToken) return `/${locale}`;
      return `/${locale}/search/dish-category-group-votes/${encodeURIComponent(shareToken)}/vote`;
    }
  }
}

/**
 * 共有ページの導線ラベル。
 *
 * app-expo の i18n（`languages/*.json`）は Web バンドル側の資産で API からは読めないため、
 * この 2 語だけをここに持つ。増やすときは共有カード専用に留めること
 *（アプリの文言をここへ写し始めると、二重管理になって必ずずれる）。
 */
export const SHARE_PAGE_LABELS: Record<PublicLocale, { openInApp: string; openInWeb: string }> = {
  'ja-JP': { openInApp: 'アプリで開く', openInWeb: 'ブラウザで見る' },
  'en-US': { openInApp: 'Open in app', openInWeb: 'View in browser' },
  'fr-FR': { openInApp: "Ouvrir dans l'app", openInWeb: 'Voir dans le navigateur' },
  'zh-CN': { openInApp: '在应用中打开', openInWeb: '在浏览器中查看' },
  'ar-SA': { openInApp: 'افتح في التطبيق', openInWeb: 'العرض في المتصفح' },
  'ko-KR': { openInApp: '앱에서 열기', openInWeb: '브라우저에서 보기' },
  'es-ES': { openInApp: 'Abrir en la app', openInWeb: 'Ver en el navegador' },
  'hi-IN': { openInApp: 'ऐप में खोलें', openInWeb: 'ब्राउज़र में देखें' },
};
