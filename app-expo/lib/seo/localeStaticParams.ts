// app-expo/lib/seo/localeStaticParams.ts
//
// #721 【設計】ロケールごとに実体の HTML を事前生成させるためのパラメータ。
//
// これが無いと、`app.config.ts` の `web: { output: "static" }` にもかかわらず、
// 動的セグメント `[locale]` は **リテラル `[locale]` のディレクトリに HTML 1 枚**しか
// 出力されない（`dist/[locale]/posts.html` など）。
//
// その 1 枚をプリレンダするとき `usePathname()` は `/[locale]/posts` を返すため、
// `useLocale()` の `pathname.split("/")[1]` が文字列 `"[locale]"` を拾い、
// `resolvePublicLocale()` のフォールバックで ja-JP に落ちる。
// 結果、Firebase Hosting の rewrite が 8 言語すべてへ **同じ ja-JP 固定の HTML** を返し、
// `/en-US/...` が英語にならなかった（#721 の症状 b）。
//
// 【なぜ _layout.tsx から切り出しているか】
// `app/[locale]/_layout.tsx` を import すると AuthProvider 経由で `lib/supabase.ts` が
// 読み込まれ、モジュール読み込み時点で `createClient` が env を要求して落ちる。
// テストからこのロジックだけを触れるようにするため、独立したモジュールにしている。
//
// 【注意】`?ids=` のようなクエリ依存の内容は、これでも初回 HTML に含められない
// （#721 の症状 a）。そちらは SSR 相当の別対応が要る。

import { PUBLIC_LOCALES } from "@/constants/seoLocales";

/**
 * expo-router の `generateStaticParams` が返す形。
 */
export type LocaleStaticParam = { locale: string };

/**
 * 全公開ロケール分の静的パラメータを返す。
 */
export function buildLocaleStaticParams(): LocaleStaticParam[] {
	return PUBLIC_LOCALES.map((locale) => ({ locale }));
}
