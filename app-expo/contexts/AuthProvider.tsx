import { createContext, useContext, useEffect, useState, ReactNode } from "react";
import { supabase } from "@/lib/supabase";
import { Session, User, Provider } from "@supabase/supabase-js";
import * as Linking from "expo-linking";
import { useLogger } from "@/hooks/useLogger";
import { useLocale } from "@/hooks/useLocale";

type AuthContextType = {
	user: User | null;
	session: Session | null;
	isAuthenticated: boolean;
	loading: boolean;
	loginWithEmail: (email: string, password: string) => Promise<void>;
	logout: () => Promise<void>;
	signUpWithEmail: (email: string, password: string) => Promise<void>;
	signInWithOAuth: (provider: Provider) => Promise<void>;
	signInWithOtp: (phone: string) => Promise<void>;
	verifyOtp: (phone: string, token: string) => Promise<void>;
	linkIdentity: (provider: Provider) => Promise<void>;
	createUserProfile: (displayName?: string) => Promise<void>;
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
	const [user, setUser] = useState<User | null>(null);
	const [session, setSession] = useState<Session | null>(null);
	const [loading, setLoading] = useState(true);
	const { logFrontendEvent } = useLogger();
	const locale = useLocale();

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

					setSession(restoredSession);
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
						setSession(anonData.session);
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
			logFrontendEvent({
				event_name: `onAuthStateChange:${event}`,
				error_level: "debug",
				payload: { user_id: newUserId, event },
			});

			if (event === "INITIAL_SESSION") {
				// initializeAuth で処理済
			} else if (event === "SIGNED_IN") {
				if (!session) return;
				// setUser(session.user);
				// setSession(session);
				// router.replace('/');
			} else if (event === "SIGNED_OUT") {
				// setUser(null);
				// setSession(null);
				// router.replace('/login');
			} else if (event === "PASSWORD_RECOVERY") {
				// パスワード制のログイン機能を持たせる予定がないなら不要
			} else if (event === "TOKEN_REFRESHED") {
				if (!session) return;
				setUser(session.user);
				setSession(session);
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
	 * @param provider - 'google' などのOAuthプロバイダー名
	 */
	const signInWithOAuth = async (provider: Provider) => {
		const redirectUrl = Linking.createURL(`/${locale}/auth/callback`);
		const { error } = await supabase.auth.signInWithOAuth({
			provider,
			options: { redirectTo: redirectUrl },
		});
		if (error) throw error;
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

		// ユーザープロフィールを作成（存在しなければ）
		if (data.user) {
			await createUserProfile();
		}
	};

	/**
	 * 匿名ユーザーにOAuthアイデンティティをリンクする
	 * @param provider - 'google' などのOAuthプロバイダー名
	 */
	const linkIdentity = async (provider: Provider): Promise<void> => {
		const redirectUrl = Linking.createURL(`/${locale}/auth/callback`);
		const { data, error } = await supabase.auth.linkIdentity({
			provider,
			options: { redirectTo: redirectUrl },
		});
		if (error) throw error;
	};

	/**
	 * ユーザープロフィールを作成する（存在しなければ）
	 * @param displayName - 表示名（オプション）
	 */
	const createUserProfile = async (displayName?: string) => {
		if (!user) return;

		try {
			// 既存のユーザープロフィールをチェック
			const { data: existingProfile, error: fetchError } = await supabase
				.from("users")
				.select("id")
				.eq("id", user.id)
				.single();

			if (fetchError && fetchError.code !== "PGRST116") {
				// PGRST116 = not found, それ以外のエラーは投げる
				throw fetchError;
			}

			if (!existingProfile) {
				// ユーザープロフィールが存在しない場合のみ作成
				const timestamp = Date.now();
				const randomSuffix = Math.floor(Math.random() * 1000)
					.toString()
					.padStart(3, "0");
				const username = `user${(timestamp + parseInt(randomSuffix)).toString().slice(0, 13)}`;

				const { error: insertError } = await supabase.from("users").insert({
					id: user.id,
					username,
					display_name: displayName || "nickname",
				});

				if (insertError) throw insertError;

				logFrontendEvent({
					event_name: "user_profile_created",
					error_level: "log",
					payload: { user_id: user.id, username },
				});
			}
		} catch (error) {
			logFrontendEvent({
				event_name: "user_profile_creation_error",
				error_level: "error",
				payload: { user_id: user.id, error: (error as Error).message },
			});
			// プロフィール作成エラーは致命的ではないので、ログのみ
		}
	};

	/**
	 * 現在のセッションをログアウトする。
	 */
	const logout = async () => {
		const { error } = await supabase.auth.signOut();
		if (error) throw error;
	};

	const value: AuthContextType = {
		user,
		session,
		isAuthenticated: !!user,
		loading,
		loginWithEmail,
		signUpWithEmail,
		logout,
		signInWithOAuth,
		signInWithOtp,
		verifyOtp,
		linkIdentity,
		createUserProfile,
	};

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
