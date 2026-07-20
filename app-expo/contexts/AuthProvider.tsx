import { createContext, useContext, useEffect, useState, ReactNode, useRef, useCallback, useMemo } from "react";
import { supabase } from "@/lib/supabase";
import { Session, User, Provider, SignOut } from "@supabase/supabase-js";
import * as Linking from "expo-linking";
import { useLogger } from "@/hooks/useLogger";
import { useLocale } from "@/hooks/useLocale";
import { Platform } from "react-native";
import * as AuthSession from "expo-auth-session";
import * as WebBrowser from "expo-web-browser";
import { Href, useRouter } from "expo-router";
import { useDishMediaEntriesStore } from "@/stores/useDishMediaEntriesStore";
import { useTopicsStore } from "@/stores/useTopicsStore";
import { useProfileStore } from "@/features/profile/stores/useProfileStore";
import { useCdnCookieStore } from "@/stores/useCdnCookieStore";

type AuthContextType = {
	user: User | null;
	getSession: () => Session | null;
	refreshSession: () => Promise<Session | null>;
	loading: boolean;
	loginWithEmail: (email: string, password: string) => Promise<void>;
	logout: (options?: SignOut) => Promise<void>;
	signUpWithEmail: (email: string, password: string) => Promise<void>;
	signInWithOAuth: (provider: Provider, options?: { queryParams?: { [key: string]: string } }) => Promise<void>;
	signInWithOtp: (phone: string) => Promise<void>;
	verifyOtp: (phone: string, token: string) => Promise<void>;
	linkIdentity: (provider: Provider, options?: { queryParams?: { [key: string]: string } }) => Promise<void>;
	handleOAuthResultUrl: (url?: string | null) => Promise<User | null | undefined>;
};

const AuthContext = createContext<AuthContextType | undefined>(undefined);

/**
 * 🔐 認証状態と認証APIを提供するコンテキストプロバイダ。
 *
 * - `supabase.auth` によるセッション監視を行い、ログイン状態を保持
 * - 初期化時には `getSession()` を通じて状態を復元
 * - OAuth, メールログイン・サインアップ機能を提供
 */
export const AuthProvider = ({ children }: { children: ReactNode }) => {
	const router = useRouter();
	const { logFrontendEvent } = useLogger();
	const [user, setUser] = useState<User | null>(null);
	const [loading, setLoading] = useState(true);
	const { locale } = useLocale();
	const sessionRef = useRef<Session | null>(null);
	const getSession = useCallback(() => sessionRef.current, []);
	/**
	 * 401 を受けたリクエストが、新しい access token で即時再試行できるようにする。
	 * Supabase の自動更新は後続リクエストには効くが、既に失敗した通信は再送しないため、
	 * 更新済み Session を呼び出し元へ返しつつ、同期参照する sessionRef も先に更新する。
	 */
	const refreshSession = useCallback(async (): Promise<Session | null> => {
		const { data, error } = await supabase.auth.refreshSession();
		if (error) throw error;

		const refreshedSession = data.session;
		if (refreshedSession) {
			sessionRef.current = refreshedSession;
			setUser(refreshedSession.user);
		}

		return refreshedSession;
	}, []);

	useEffect(() => {
		/**
		 * 🔐 初期セッションの復元 or 匿名ログイン。
		 * - アプリ起動時に呼び出され、常にセッション状態を確認する。
		 * - セッションがなければ匿名ログインを自動的に実施。
		 * - Supabase Auth は永続化済みなので、基本的にセッションは復元される前提。
		 */
		const initializeAuth = async () => {
			try {
				const { data: sessionData, error: sessionError } = await supabase.auth.getSession();
				if (sessionError) throw sessionError;
				const restoredSession = sessionData?.session;

				if (restoredSession) {
					await supabase.auth.setSession({
						access_token: restoredSession.access_token,
						refresh_token: restoredSession.refresh_token,
					});

					logFrontendEvent({
						event_name: "sessionRestored",
						error_level: "log",
						payload: { user_id: restoredSession.user.id },
					});

					sessionRef.current = restoredSession;
					setUser(restoredSession.user);
				} else {
					const { data: anonData, error: anonError } = await supabase.auth.signInAnonymously();
					if (anonError) throw anonError;

					logFrontendEvent({
						event_name: "signInAnonymously",
						error_level: "log",
						payload: { user_id: anonData.session?.user.id },
					});

					if (anonData?.session) {
						sessionRef.current = anonData.session;
						setUser(anonData.session.user);
					}
				}
			} catch (err: any) {
				logFrontendEvent({
					event_name: "authInitError",
					error_level: "error",
					payload: { message: err.message },
				});
			} finally {
				setLoading(false);
			}
		};

		initializeAuth();

		/**
		 * 👀 認証状態のリアルタイム監視。
		 * - ログイン/ログアウトなどのイベントを自動検出
		 */
		const { data: authListener } = supabase.auth.onAuthStateChange(async (event, session) => {
			const newUserId = session?.user?.id ?? null;
			const prevUser = sessionRef.current?.user ?? null;
			const hasUserChanged = (prevUser?.id ?? null) !== (newUserId ?? null);
			logFrontendEvent({
				event_name: `onAuthStateChange:${event}`,
				error_level: "debug",
				payload: { user_id: newUserId, event },
			});

			if (hasUserChanged) {
				// ✅ ユーザーが切り替わったときにストアをクリア
				useDishMediaEntriesStore.getState().clearByKey();
				useTopicsStore.getState().clearByKey();
				useProfileStore.getState().resetProfile();
				useCdnCookieStore.getState().clearCookies();
			}

			if (event === "INITIAL_SESSION") {
				// initializeAuth で処理済
			} else if (event === "SIGNED_IN") {
				if (!session) return;
				if (hasUserChanged) {
					// signInWithOAuth は、未登録なら新規ユーザーを作り、匿名ユーザーから切り替わる可能性がある
					// そのため、 user.id の変化を検出してログを出す
					logFrontendEvent({
						event_name: "userChanged",
						error_level: "log",
						payload: { previous_user_id: sessionRef.current?.user.id, new_user_id: session.user.id },
					});
				}
				setUser(session.user);
				sessionRef.current = session;
				// router.replace('/');
			} else if (event === "SIGNED_OUT") {
				sessionRef.current = null;
				setUser(null);

				try {
					const { data: anonData, error: anonError } = await supabase.auth.signInAnonymously();
					if (!anonError && anonData?.session) {
						sessionRef.current = anonData.session;
						setUser(anonData.session.user);
					}
				} finally {
					router.replace("/");
				}
			} else if (event === "PASSWORD_RECOVERY") {
				// パスワード制のログイン機能を持たせる予定がないなら不要
			} else if (event === "TOKEN_REFRESHED") {
				if (!session) return;
				setUser(session.user);
				sessionRef.current = session;
			} else if (event === "USER_UPDATED") {
				// setUser(session.user);
				// setSession(session);
			}
		});

		return () => {
			authListener?.subscription.unsubscribe();
		};
	}, []);

	/**
	 * メールアドレスとパスワードでログインする。
	 * @throws エラーが発生した場合は呼び出し元でキャッチする
	 */
	const loginWithEmail = async (email: string, password: string) => {
		const { error } = await supabase.auth.signInWithPassword({ email, password });
		if (error) throw error;
	};

	/**
	 * メールアドレスとパスワードでサインアップする。
	 * @throws エラーが発生した場合は呼び出し元でキャッチする
	 */
	const signUpWithEmail = async (email: string, password: string) => {
		const { data, error } = await supabase.auth.signUp({ email, password });
		if (error) throw error;
	};

	/**
	 * OAuthプロバイダーでログインする。
	 * 新規ユーザー作成 または 既存ユーザー へのログインを行う。
	 * @param provider - 'google' などのOAuthプロバイダー名
	 */
	const signInWithOAuth = async (provider: Provider, options?: { queryParams?: { [key: string]: string } }) => {
		const { queryParams = {} } = options || {};

		// Google のときはデフォルトで毎回アカウント選択を出す
		const defaultQueryParamsForProvider: Record<Provider, { [k: string]: string }> = {
			google: { prompt: "select_account" },
			// 他のプロバイダ用に何かあればここに書く
		} as any;

		const mergedQueryParams = {
			...(defaultQueryParamsForProvider[provider] ?? {}),
			...queryParams, // 呼び出し側で上書きしたければこちらが優先
		};

		const redirectTo =
			Platform.OS === "web"
				? `${window.location.origin}/${locale}/auth/callback?intent=signin`
				: AuthSession.makeRedirectUri({ scheme: "nanitabeyo", path: `${locale}/auth/callback?intent=signin` });
		const { data, error } = await supabase.auth.signInWithOAuth({
			provider,
			options: {
				redirectTo,
				queryParams: mergedQueryParams,
				...(Platform.OS === "web" ? {} : { skipBrowserRedirect: true }),
			},
		});
		if (error) throw error;
		if (Platform.OS !== "web" && data?.url) {
			const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
			if (result.type === "success" && result.url) {
				const parsed = Linking.parse(result.url);
				const locale = (parsed.hostname ?? "ja-JP") as string;
				const qp = Object.fromEntries(Object.entries(parsed.queryParams ?? {}).map(([k, v]) => [k, String(v)])); // queryParams は string | number | boolean | null などが来るので文字列化
				const href: Href = {
					pathname: "/[locale]/auth/callback",
					params: { locale, ...qp },
				};
				router.replace(href);
			}
		}
	};

	/**
	 * 電話番号でOTPを送信する（ログイン/サインアップ兼用）
	 * @param phone - E.164フォーマットの電話番号
	 */
	const signInWithOtp = async (phone: string) => {
		const { error } = await supabase.auth.signInWithOtp({ phone });
		if (error) throw error;
	};

	/**
	 * OTPを検証してログインする
	 * @param phone - E.164フォーマットの電話番号
	 * @param token - 6桁のOTPコード
	 */
	const verifyOtp = async (phone: string, token: string): Promise<void> => {
		const { data, error } = await supabase.auth.verifyOtp({
			phone,
			token,
			type: "sms",
		});
		if (error) throw error;
	};

	/**
	 * 匿名ユーザーにOAuthアイデンティティをリンクする
	 * 成功時は 同一 auth.users.id を維持して昇格可能。
	 * ただし、既に他のユーザーにリンク済みの OAuth であれば失敗する。
	 * @param provider - 'google' などのOAuthプロバイダー名
	 */
	const linkIdentity = async (
		provider: Provider,
		options?: { queryParams?: { [key: string]: string } },
	): Promise<void> => {
		const { queryParams = {} } = options || {};

		// Google のときはデフォルトで毎回アカウント選択を出す
		const defaultQueryParamsForProvider: Record<Provider, { [k: string]: string }> = {
			google: { prompt: "select_account" },
			// 他のプロバイダ用に何かあればここに書く
		} as any;

		const mergedQueryParams = {
			...(defaultQueryParamsForProvider[provider] ?? {}),
			...queryParams, // 呼び出し側で上書きしたければこちらが優先
		};

		const redirectTo =
			Platform.OS === "web"
				? // linkIdentity の場合は、 匿名アップグレード由来のリダイレクトであることを示すために `?intent=link` を付与
					`${window.location.origin}/${locale}/auth/callback?intent=link&provider=${provider}`
				: AuthSession.makeRedirectUri({
						scheme: "nanitabeyo",
						path: `${locale}/auth/callback?intent=link&provider=${provider}`,
					});
		const { data, error } = await supabase.auth.linkIdentity({
			provider,
			options: {
				redirectTo,
				queryParams: mergedQueryParams,
				...(Platform.OS === "web" ? {} : { skipBrowserRedirect: true }),
			},
		});
		if (error) throw error;
		if (Platform.OS !== "web" && data?.url) {
			const result = await WebBrowser.openAuthSessionAsync(data.url, redirectTo);
			if (result.type === "success" && result.url) {
				const parsed = Linking.parse(result.url);
				const locale = (parsed.hostname ?? "ja-JP") as string;
				const qp = Object.fromEntries(Object.entries(parsed.queryParams ?? {}).map(([k, v]) => [k, String(v)])); // queryParams は string | number | boolean | null などが来るので文字列化
				const href: Href = {
					pathname: "/[locale]/auth/callback",
					params: { locale, ...qp },
				};
				router.replace(href);
			}
		}
	};

	/** OAuthのリダイレクトURIから認証結果を処理する
	 * - PKCE (codeフロー) と 旧インプリシット (#access_token) の両方に対応
	 */
	const handleOAuthResultUrl = async (url?: string | null) => {
		if (!url) return;

		const parsed = Linking.parse(url);
		const code = parsed.queryParams?.code as string | undefined;
		const intent = parsed.queryParams?.intent as string | undefined;
		const provider = parsed.queryParams?.provider as Provider | undefined;
		const error = parsed.queryParams?.error as string | undefined;
		const error_code = parsed.queryParams?.error_code as string | undefined;
		const error_description = parsed.queryParams?.error_description as string | undefined;

		// エラーがある場合は、そのまま例外として throw する
		// callback.tsx 側で処理するため、ここでは自動フォールバックしない
		if (error) {
			const errorObj = new Error(error_description ?? error_code ?? error) as any;
			errorObj.error_code = error_code;
			errorObj.intent = intent;
			errorObj.provider = provider;
			throw errorObj;
		}

		// 1) PKCE (codeフロー)
		if (code) {
			const { data, error } = await supabase.auth.exchangeCodeForSession(code);
			if (error) throw error;
			return data.user;
		}

		// 2) 旧: インプリシット（#access_token）
		const hash = url.split("#")[1] ?? "";
		if (hash) {
			const params = new URLSearchParams(hash);
			const access_token = params.get("access_token");
			const refresh_token = params.get("refresh_token");
			const expires_at = params.get("expires_at");
			if (access_token && refresh_token) {
				await supabase.auth.setSession({ access_token, refresh_token });
				const {
					data: { user },
				} = await supabase.auth.getUser();
				return user ?? null;
			}
		}
		return null;
	};

	/**
	 * 現在のセッションをログアウトする。
	 */
	const logout = async (options?: SignOut) => {
		const { error } = await supabase.auth.signOut(options);
		if (error) throw error;
	};

	const value = useMemo<AuthContextType>(
		() => ({
			user,
			getSession,
			refreshSession,
			loading,
			loginWithEmail,
			signUpWithEmail,
			logout,
			signInWithOAuth,
			signInWithOtp,
			verifyOtp,
			linkIdentity,
			handleOAuthResultUrl,
		}),
		[
			user,
			getSession,
			refreshSession,
			loading,
			loginWithEmail,
			signUpWithEmail,
			logout,
			signInWithOAuth,
			signInWithOtp,
			verifyOtp,
			linkIdentity,
			handleOAuthResultUrl,
		],
	);

	return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
};

/**
 * 🎣 `AuthContext` から認証状態と関数を取得するカスタムフック。
 * - `AuthProvider` 内でのみ使用可能。
 * - 使用場所が誤っている場合は例外を投げる。
 */
export const useAuth = (): AuthContextType => {
	const context = useContext(AuthContext);
	if (context === undefined) {
		throw new Error("useAuth must be used within an AuthProvider");
	}
	return context;
};

/* ヘルパー関数群 */

/** OAuthのリダイレクトURIを構築する
 * - WebではアプリのURLに対応するURIを生成
 * - ネイティブではカスタムスキームURIを生成
 */
export const buildRedirectTo = (locale?: string) => {
	// 画面を使わないので、ネイティブは固定でOK（ロケールなし推奨）
	if (Platform.OS === "web") return `${window.location.origin}/${locale}/auth/callback`; // Webは任意
	return AuthSession.makeRedirectUri({ scheme: "nanitabeyo", path: "auth/callback" });
};
