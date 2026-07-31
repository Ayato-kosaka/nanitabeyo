// lib/authGuest.ts
//
// #1092 【設計】「この人はゲストか」の判定を 1 箇所に集める純関数。
//
// これまで各所に `user?.is_anonymous !== false` がコピーされていたが、この式は
// `is_anonymous` が `undefined` のときも「ゲスト」に倒れる。`@supabase/auth-js` の型では
// `User["is_anonymous"]` は **optional** で、GoTrue のバージョンやセッションの復元経路によっては
// 欠落しうる。つまり「ログイン済みなのに通知タブが出ない」「自分のレビュータブが出ない」が
// 型の上では起こりうる状態だった。
//
// PR4b で `SplashHandler` の `!!user` ゲートを外し、認証が確定する前から画面を描くようになったため、
// この判定は「まだ null の user」に対しても毎起動必ず評価される。実際に踏みうる状態になったので、
// 未確定と欠落を分けて扱う。

import type { User } from "@supabase/supabase-js";

/** 判定に必要な最小の形。テストから素の object を渡せるようにしてある */
type GuestCheckTarget = Pick<User, "is_anonymous">;

/**
 * ゲスト（＝ログインしていない匿名ユーザー、または認証がまだ確定していない状態）か。
 *
 * - `user === null`（認証が未確定 / 失敗）… **ゲスト扱い**。
 *   ここをログイン済みに倒すと、認証確定までの数百 ms だけログイン専用 UI が
 *   「出てから消える」（通知タブならタブ本数が 5→4 に変わりタブバーが再レイアウトする）。
 *   「出てから消える」より「出ない→出る」の方が害が小さい。web の SSG は user === null を出力するので、
 *   その観点でも null をゲストへ倒すのが安全。
 * - `is_anonymous === true` … ゲスト。
 * - `is_anonymous === undefined`（型上ありうる欠落）… **ログイン済み扱い**。
 *   user が居る = セッションはある状態なので、ここをゲストへ倒すとログイン済みユーザーが
 *   自分の通知・自分のレビューに到達できなくなる（機能が丸ごと消える）。逆に倒した場合の害は
 *   「ゲストにログイン専用 UI が見えるが、押しても API が弾く」に留まるため、こちら側へ倒す。
 *
 * @param user 現在の user（`useAuth().user`）
 * @returns ゲストなら true
 */
export const isGuestUser = (user: GuestCheckTarget | null | undefined): boolean => {
	if (!user) return true;
	return user.is_anonymous === true;
};
