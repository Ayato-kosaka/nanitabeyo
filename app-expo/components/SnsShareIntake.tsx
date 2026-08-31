import { useSnsShareIntake } from "@/hooks/useSnsShareIntake";

/**
 * 🔗 #1400 共有された URL の取り込み入口。UI を描かず副作用だけを実行する
 *（`PushTokenRegistration` / `MetaAppEventsInitializer` と同じ形）。
 *
 * ## 置き場所は `app/[locale]/_layout.tsx` の AuthProvider 配下
 *
 * - ログイン状態で行き先が変わるので **AuthProvider の中**でなければならない
 * - ロケール配下のどの画面に居ても «起動済みへの共有» を受けたいので、画面ではなく layout に置く
 * - `app/index.tsx` には置かない。あの画面は起動直後にロケールへ `router.replace()` する担当で、
 *   そこから push すると #1027（ディープリンクの行き先を奪う / 奪われる）と同じ競合を作る。
 *   このレイアウトがマウントされている時点で既にロケール配下へ着地しているので、競合しない
 *
 * 受け取り口はプラットフォームごとに Metro が解決する。PR2 の時点で
 * **Android は `lib/sharedTextSource.android.ts` が実際に共有を運んでくる**。
 * iOS と web は `lib/sharedTextSource.ts`（常に «共有なし»）のままなので no-op で、
 * PR3（#1472 の App Group 待ち）が iOS 側を差し替えると動き出す。
 */
export function SnsShareIntake() {
	useSnsShareIntake();
	return null;
}
