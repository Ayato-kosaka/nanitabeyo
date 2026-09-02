/*
このファイルの責務
- Supabase の OAuth 認証コールバックを処理する画面。
- Deep Link / Web リダイレクトで遷移してきた URL を解析し、セッション確立後に必要であればユーザープロフィールを作成し、プロフィールタブへ遷移する。
- linkIdentity の衝突時に警告ダイアログを表示し、ユーザーの確認後に切替/キャンセルを選択可能にする。
- 処理中はスピナーのみを表示し、ユーザー操作は不要（ダイアログ表示時を除く）。

衝突の告知をどこに出すか（#1370 / 設計 #1359 §6）
- ルートにはしない。この状態は「直前の OAuth 試行の結果」で、リロード・共有・ディープリンクでは
  再現できない。ルート化すると provider と error を params で運ぶ必要が出て、この画面の状態機械が増える。
- 入力欄なし・2 択なので DialogProvider の confirm() で足りる。confirm() は Promise なので
  «決着させてから遷移» が 1 本の流れで書ける（旧実装は close() と router.replace を手で並べていた）。

認証結果 URL の選び方について（#1062）
- ネイティブでは expo-router のパラメータ（signInWithOAuth の router.replace / OS のディープリンク）で、
  Web では現在の URL として、認証結果が届きます。
- どちらを使うかは「出所の優先順位」ではなく「認証結果を実際に含んでいるか」で決めます（lib/oauthResultUrl.ts）。
  Android の development build を QR 起動すると Linking.getInitialURL() が dev launcher の起動 URL を
  返し続けるため、出所で優先すると code を取り落とします（実機で QR 起動＝失敗 / アイコン起動＝成功 を確認）。

ログイン後の行き先（#1370 / 設計 #1359 §3）
- `?next=` は OAuth の redirectTo（contexts/AuthProvider.tsx）に載って URL を一往復して戻ってきます。
  web の OAuth は全画面リダイレクトでページごと作り直されるため、これが唯一の引き継ぎ手段です。
- 受け取った `next` は必ず lib/authNext.ts の resolveNextPath を通してから遷移します（open redirect 対策）。
  採用できない場合は従来どおり /[locale]/profile です。

補足
- セッションを確立できなかった場合は oauth_callback_no_result を error レベルで記録し、
  成功ログもプロフィール作成も行いません。いずれの場合も next（無ければ /[locale]/profile）に遷移します。
*/
import { useCallback, useEffect, useRef } from "react";
import { LoadingIndicator } from "@/components/LoadingIndicator";
import { View, Text, StyleSheet, Linking } from "react-native";
import { useLocalSearchParams, useRouter } from "expo-router";
import { useAuth } from "@/contexts/AuthProvider";
import { useDialog } from "@/contexts/DialogProvider";
import { useLogger } from "@/hooks/useLogger";
import i18n from "@/lib/i18n";
import { Provider } from "@supabase/supabase-js";
import { useProfile } from "@/features/profile/hooks/useProfile";
import { describeOAuthUrl, pickOAuthResultUrl, type OAuthUrlCandidate } from "@/lib/oauthResultUrl";
import { resolveNextPath } from "@/lib/authNext";
import { toErrorLogMessage } from "@/lib/errorMessage";
import type { ExternalPathString } from "expo-router";
import { type Palette } from "@/constants/Palette";
import { useThemedStyles } from "@/contexts/ThemeProvider";

/**
 * router のパラメータを URL の形に載せるための器。
 * #1062 【設計】クエリしか読まないため、ホスト部分に意味は無い。
 * 以前はここで Platform 分岐と AuthSession.makeRedirectUri による再構築を行っていたが、
 * 認証結果の判定に redirect URI の正確な復元は不要なので廃止した。
 */
const ROUTER_PARAM_URL_BASE = "nanitabeyo://oauth-result";

/**
 * OAuth認証のコールバック画面
 * Deep Linkで呼び出され、認証完了後にホーム画面にリダイレクトする
 */
export default function AuthCallbackScreen() {
	const router = useRouter();
	const { handleOAuthResultUrl, signInWithOAuth } = useAuth();
	const { createUserProfile } = useProfile();
	const { logFrontendEvent } = useLogger();
	const { confirm } = useDialog();
	const { locale, ...rest } = useLocalSearchParams<{ locale: string; [k: string]: string }>();
	const styles = useThemedStyles(createStyles);

	// 同じ code を二度交換しないためのラッチ（effect が再実行されても処理は一度きり）
	const hasHandledRef = useRef(false);

	/**
	 * 🔒 #1370 ログイン後の行き先。**この画面で `next` を読むのはここ 1 箇所だけ**にしてある。
	 *
	 * `next` は OAuth の redirectTo（contexts/AuthProvider.tsx）に載って URL を一往復して戻ってくる値で、
	 * 途中で第三者が書き換えられる。web なら open redirect、native ならディープリンク
	 * （`nanitabeyo://ja-JP/auth/callback?next=...`）経由で任意画面へ飛ばす経路になるため、
	 * router へ渡す前に必ず `resolveNextPath`（先頭 / の内部パスだけを通す）を通す。
	 * 生の `rest.next` を別の場所で読むと、その検証を迂回する経路ができる。
	 */
	const nextPath = resolveNextPath(rest.next, locale);

	/**
	 * 認証結果の «行き先»。`next` を採用できるならそこへ、無ければ従来どおりマイページへ。
	 *
	 * ⚠️ #1370 【バグ】渡す href の «形» に注意すること。lib/logoutRedirect.ts:1-7 に
	 * 「Android では認証イベント直後の router.replace に query 付き文字列や object href を渡すと
	 * フリーズした」実測が残っており、この replace はまさにその形（認証直後 / next はクエリを含みうる）。
	 * next が無いときは従来と同じ object href のままにしてあるので、既存経路の挙動は変えていない。
	 * next 経路は Android 実機での確認が必須（#1370 の PR 本文参照）。
	 */
	const goAfterCallback = useCallback(() => {
		if (nextPath) {
			// resolveNextPath が「先頭 / の内部パス」まで絞り込んだ後の値なので、typed routes の
			// 型と一致しないことを承知でキャストする（app/[locale]/auth/login.tsx と同じ扱い）
			router.replace(nextPath as ExternalPathString);
			return;
		}
		router.replace({ pathname: "/[locale]/profile", params: { locale } });
	}, [router, nextPath, locale]);

	/**
	 * プロバイダ競合（identity_already_exists）を告知し、選ばれた方へ決着させる。
	 *
	 * #1370 【設計】告知が閉じるまで «待つ» のが要点。DialogProvider は app/[locale]/_layout.tsx で
	 * ナビゲータの «外側» にあるため、先に遷移してもダイアログだけが次の画面に残る。
	 * confirm() の Promise を await して決着させてから router を触ること。
	 *
	 * #1370 【バグ】`dismissable` / `backHandlerEnabled` を false にするのは、旧実装（useBlurModal を
	 * オプション無しで使用 = 戻るキーで閉じる）では **Android の戻るキーで告知«だけ»が消え、
	 * 「処理中…」のスピナーが残る** ためである。この画面は hasHandledRef で処理を一度きりに
	 * しているので再実行もされず、そこから先へ進めなくなる。選ぶまで閉じない、が正しい契約。
	 */
	const handleIdentityConflict = useCallback(
		async (provider: Provider) => {
			const switched = await confirm({
				title: i18n.t("auth.conflict_dialog_title"),
				message: i18n.t("auth.conflict_dialog_message"),
				confirmLabel: i18n.t("auth.conflict_dialog_switch"),
				cancelLabel: i18n.t("auth.conflict_dialog_cancel"),
				dismissable: false,
				backHandlerEnabled: false,
			});

			if (!switched) {
				logFrontendEvent({
					event_name: "oauth_conflict_cancel",
					error_level: "log",
					payload: { provider },
				});
				goAfterCallback();
				return;
			}

			try {
				logFrontendEvent({
					event_name: "oauth_conflict_switch_existing",
					error_level: "log",
					payload: { provider },
				});

				// 既存アカウントに切り替え（prompt=none でサイレント認証）。
				// #1370 【設計】2 周目の redirectTo にも next を載せる。ここは callback へもう一度
				// 戻ってくる経路なので、載せないと «昇格を諦めて既存アカウントへ切り替えた人だけ»
				// マイページに着地して元の画面へ戻れない（設計 #1359 §4-3）
				const launch = await signInWithOAuth(provider, { next: nextPath ?? undefined });

				// #1062 【設計】結末は記録するだけで、ここでは画面遷移しない。
				// Android の dismiss は「ユーザーが閉じた」を意味しない（deep link 成功時にも起こる）。
				// ここでプロフィールへ戻すと、成功時に expo-router の callback 遷移と競合して
				// code を処理できないまま離脱しうる。成否の判断と遷移は callback 画面へ一本化する。
				// 本当にユーザーが閉じた場合にスピナーが残るのは修正前からの挙動で、本 PR では変えない。
				if (launch.outcome === "cancelled") {
					logFrontendEvent({
						event_name: "oauth_signin_browser_dismissed",
						error_level: "log",
						payload: {
							provider,
							outcome: launch.outcome,
							browser_result_type: launch.browserResultType,
							context: "conflict_switch",
						},
					});
				}
			} catch (error) {
				logFrontendEvent({
					event_name: "oauth_conflict_switch_error",
					error_level: "error",
					payload: { provider, error: (error as Error).message },
				});
				goAfterCallback();
			}
		},
		[confirm, goAfterCallback, logFrontendEvent, nextPath, signInWithOAuth],
	);

	useEffect(() => {
		if (hasHandledRef.current) return;
		hasHandledRef.current = true;

		const handleAuthCallback = async () => {
			const qs = new URLSearchParams(Object.entries(rest).map(([k, v]) => [k, String(v)])).toString();
			// 初回URL（フラグメント含む）。Web では現在の URL、ネイティブでは起動時の URL。
			const initialUrl = await Linking.getInitialURL();

			// #1062 【設計】出所の順序ではなく「認証結果を実際に含むか」で選ぶ。
			// router_params を先に置くのは、これが最も新しい結果だから（順序は保険で、正しさは順序に依存しない）。
			const candidates: OAuthUrlCandidate[] = [
				{ source: "router_params", url: qs ? `${ROUTER_PARAM_URL_BASE}?${qs}` : null },
				{ source: "initial_url", url: initialUrl },
			];
			const picked = pickOAuthResultUrl(candidates);

			if (!picked) {
				// ここが従来の「無言の失敗」の出口。成功ログもプロフィール作成も行わない。
				logFrontendEvent({
					event_name: "oauth_callback_no_result",
					error_level: "error",
					payload: {
						intent: rest.intent ?? null,
						provider: rest.provider ?? null,
						candidates: candidates.map((candidate) => ({
							source: candidate.source,
							...(describeOAuthUrl(candidate.url) ?? {}),
						})),
					},
				});
				goAfterCallback();
				return;
			}

			try {
				const result = await handleOAuthResultUrl(picked.url);

				if (result.status !== "authenticated") {
					logFrontendEvent({
						event_name: "oauth_callback_no_result",
						error_level: "error",
						payload: {
							intent: rest.intent ?? null,
							provider: rest.provider ?? null,
							source: picked.source,
							url_shape: describeOAuthUrl(picked.url),
						},
					});
					goAfterCallback();
					return;
				}

				const { user, via } = result;

				logFrontendEvent({
					event_name: "oauth_callback_success",
					error_level: "log",
					payload: {
						user_id: user.id,
						is_anonymous: user.is_anonymous ?? null,
						via,
						source: picked.source,
						intent: rest.intent ?? null,
					},
				});

				// 必要ならプロフィール作成（セッションを確立できた場合のみ）
				await createUserProfile({
					displayName: user.user_metadata?.name ?? user.identities?.[0]?.identity_data?.name,
					avatar: user.user_metadata?.avatar_url ?? user.identities?.[0]?.identity_data?.avatar_url,
				});
				goAfterCallback();
			} catch (error: unknown) {
				// linkIdentity による identity_already_exists エラーの場合は警告ダイアログを表示
				const err = error as any;
				if (err?.error_code === "identity_already_exists" && err?.intent === "link" && err?.provider) {
					logFrontendEvent({
						event_name: "oauth_link_conflict",
						error_level: "warn",
						payload: { provider: err.provider, error_code: err.error_code },
					});
					// #1370 【設計】await して決着（切り替える / キャンセル）まで見届ける。
					// 遷移はその決着の中で行うので、ここでは goAfterCallback を «呼ばない»
					await handleIdentityConflict(err.provider as Provider);
					return;
				} else {
					goAfterCallback();
				}

				// #1433 【設計】`access_denied` は **ユーザーが自分で止めたとき**にプロバイダが返すコード。
				// 同意画面で拒否した / ブラウザを閉じた、が該当する。障害ではないので人間の対応は要らない。
				//
				// 実測（本番 2026-08-18T11:19:49Z / 1 ユーザー）: 直前に `oauth_signin_browser_dismissed` が
				// **log レベルで**記録されており、同じ 1 回の操作をここで error として二重に積んでいた。
				// そのユーザーはこの直後そのまま検索へ戻り、普通にアプリを使い続けている。
				//
				// ⚠️ 判定は `access_denied` に限ること。error があること自体を warn にすると、
				// `server_error` や `temporarily_unavailable`（＝プロバイダ側の障害で、こちらは知りたい）まで畳む。
				const urlShape = describeOAuthUrl(picked.url);
				const isUserCancelled = urlShape?.error === "access_denied";

				logFrontendEvent({
					event_name: "oauth_callback_error",
					error_level: isUserCancelled ? "warn" : "error",
					payload: {
						// #1249 【バグ】旧実装は `error instanceof Error ? error.message : String(error)` で、
						// message が空の Error / plain object が来ると本文に何も残らず、
						// 「サインインが失敗したのに理由が永久に分からない」ログが本番に出ていた。
						// toErrorLogMessage(#1092) は message → String(error) の順に拾うので最低でも名前が残る。
						error: toErrorLogMessage(error),
						// #1249 【観測】message が空でも原因を辿れるよう、Supabase AuthError / ApiError が
						// 持つ構造化フィールドを個別に残す（無ければ null）。
						error_name: typeof err?.name === "string" ? err.name : null,
						error_code: err?.error_code ?? err?.code ?? null,
						status: err?.status ?? null,
						// どのログイン動線か。兄弟ログ(oauth_callback_no_result / oauth_link_conflict)は
						// 以前から積んでおり、ここだけ欠けていた。
						intent: rest.intent ?? null,
						provider: rest.provider ?? null,
						// #1062 【設計】生の URL は code / access_token を含むため記録しない
						source: picked.source,
						url_shape: urlShape,
					},
				});
			}
		};

		handleAuthCallback();
	}, [router, logFrontendEvent]);

	return (
		<View style={styles.container}>
			<LoadingIndicator size="large" />
			<Text style={styles.text}>{i18n.t("auth.callback_processing")}</Text>
		</View>
	);
}

// #1509 【設計】`StyleSheet.create` はモジュール評価時に 1 度だけ走るためテーマを追従できない。
// パレットを受け取るファクトリにし、画面側で `useThemedStyles` から呼ぶ（`contexts/ThemeProvider.tsx`）。
const createStyles = (c: Palette) =>
	StyleSheet.create({
		container: {
			flex: 1,
			justifyContent: "center",
			alignItems: "center",
			backgroundColor: c.surface,
			paddingHorizontal: 24,
		},
		text: {
			marginTop: 16,
			fontSize: 16,
			color: c.textSecondary,
			textAlign: "center",
		},
	});
