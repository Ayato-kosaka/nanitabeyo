import i18n from "@/lib/i18n";
// #1577 ダイアログは «画面の面» として開くので、テーマに追従させる。
// 直書きのままだと暗い画面の上に白いダイアログが浮く。
import { FixedColors, type Palette } from "@/constants/Palette";
import { useAppTheme, useThemedStyles } from "@/contexts/ThemeProvider";
import React, {
	createContext,
	useCallback,
	useContext,
	useEffect,
	useMemo,
	useRef,
	useState,
	type ReactNode,
} from "react";
import { BackHandler, Platform, ScrollView, StyleSheet, View } from "react-native";
import { Portal, Dialog, Button, Paragraph, Text, TextInput, HelperText } from "react-native-paper";
import { useContentWidth } from "@/hooks/useContentWidth";

/**
 * =========================
 * 全方位ベストプラクティス版 DialogProvider
 * =========================
 *
 * 盛り込みポイント (1〜13):
 * 1) onConfirm async 対応 + ローディング + 多重タップ防止 + エラー制御
 * 2) Promise ベース API (confirm / prompt) を追加し型安全に
 * 3) キュー対応（表示中に複数 show が来ても壊れない）
 * 4) state を 1 オブジェクトに集約
 * 5) unmount/遷移中の setState/未解決 Promise を安全に掃除
 * 6) Cancel / Dismiss の区別 + dismissable/back 制御
 * 7) アクションを配列化（2択に限らない）+ danger/disabled/mode
 * 8) i18n デフォルトラベルを「表示要求時」に評価（言語切替に強い）
 * 9) 長文スクロール + a11y への配慮
 * 10) Context value を useMemo で安定化
 * 11) 同期 throw / async reject を try/catch で吸収して UI/コールバックへ
 * 12) ロジック分離しやすい形（request/state を明確化）
 * 13) debugId / onShow/onHide 等で運用しやすく
 */

/** ダイアログの閉じ方（ユーザーがどう閉じたか） */
type DialogCloseReason = "confirm" | "cancel" | "dismiss" | "system";

/** ボタン定義（柔軟な actions） */
export type DialogAction = {
	key: string;
	label: string;
	/** 押下時の処理（async も可） */
	onPress?: () => void | Promise<void>;
	/** paper Button mode */
	mode?: "text" | "outlined" | "contained";
	/** 破壊的操作など（テーマ側で色を出し分けたい場合のフラグ） */
	danger?: boolean;
	disabled?: boolean;
	accessibilityLabel?: string;
	testID?: string;
};

/** showDialog 互換の options（従来 API を維持しつつ強化） */
type ShowDialogOptions = {
	title?: string;
	okLabel?: string;
	cancelLabel?: string;
	onConfirm?: () => void | Promise<void>;

	/**
	 * 成功時/失敗時に閉じるか
	 * - closeOnConfirm: confirm が成功したら閉じる（デフォルト true）
	 * - closeOnError: confirm が失敗しても閉じる（デフォルト false）
	 */
	closeOnConfirm?: boolean;
	closeOnError?: boolean;

	/** confirm 失敗時の表示文言（簡易） */
	errorMessage?: string;
	/** confirm 失敗時コールバック（toast/log など） */
	onError?: (e: unknown) => void;

	/** Cancel ボタン押下時 */
	onCancel?: () => void;
	/** 背景タップや戻るなど「Dismiss」で閉じた時 */
	onDismiss?: () => void;

	/** 背景タップで閉じるか（デフォルト true だが confirm中は強制無効化） */
	dismissable?: boolean;
	/** Android 戻るキーで閉じるか（デフォルト true だが confirm中は強制無効化） */
	backHandlerEnabled?: boolean;

	/** 運用/デバッグ用 */
	debugId?: string;
	onShow?: () => void;
	onHide?: (reason: DialogCloseReason) => void;

	/** a11y */
	accessibilityLabel?: string;
};

/** confirm 用のオプション（Promise<boolean>） */
type ConfirmDialogOptions = Omit<ShowDialogOptions, "onConfirm" | "okLabel" | "cancelLabel"> & {
	message: string;
	title?: string;
	confirmLabel?: string;
	cancelLabel?: string;
	/** 「確認」ではなく単なる通知にしたい場合など */
	showCancel?: boolean;
};

/** prompt 用のオプション（Promise<string | null>） */
type PromptDialogOptions = Omit<ShowDialogOptions, "onConfirm" | "okLabel" | "cancelLabel" | "errorMessage"> & {
	message: string;
	title?: string;
	confirmLabel?: string;
	cancelLabel?: string;

	/** 初期値 */
	defaultValue?: string;
	/** バリデーション（エラーメッセージを返す。OK で閉じない） */
	validate?: (value: string) => string | null;

	/** TextInput props */
	placeholder?: string;
	secureTextEntry?: boolean;
	autoFocus?: boolean;
	keyboardType?: React.ComponentProps<typeof TextInput>["keyboardType"];
};

/** 内部 request（キューに入る単位） */
type DialogRequest =
	| {
			kind: "custom";
			id: string;
			title: string;
			message: string;
			actions: DialogAction[];
			/** confirm 実行がある場合に使う */
			onConfirm?: () => void | Promise<void>;
			/** cancel/dismiss */
			onCancel?: () => void;
			onDismiss?: () => void;

			/** 閉じる挙動 */
			closeOnConfirm: boolean;
			closeOnError: boolean;

			/** エラー */
			errorMessage?: string;
			onError?: (e: unknown) => void;

			/** 閉じ方制御 */
			dismissable: boolean;
			backHandlerEnabled: boolean;

			/** debug */
			debugId?: string;
			onShow?: () => void;
			onHide?: (reason: DialogCloseReason) => void;

			/** a11y */
			accessibilityLabel?: string;
	  }
	| {
			kind: "confirm";
			id: string;
			title: string;
			message: string;
			confirmLabel: string;
			cancelLabel: string;
			showCancel: boolean;

			dismissable: boolean;
			backHandlerEnabled: boolean;

			debugId?: string;
			onShow?: () => void;
			onHide?: (reason: DialogCloseReason) => void;
			onCancel?: () => void;
			onDismiss?: () => void;
			accessibilityLabel?: string;

			/** Promise 解決 */
			resolve: (ok: boolean) => void;
			reject: (e: unknown) => void;
	  }
	| {
			kind: "prompt";
			id: string;
			title: string;
			message: string;
			confirmLabel: string;
			cancelLabel: string;

			dismissable: boolean;
			backHandlerEnabled: boolean;

			debugId?: string;
			onShow?: () => void;
			onHide?: (reason: DialogCloseReason) => void;
			onCancel?: () => void;
			onDismiss?: () => void;
			accessibilityLabel?: string;

			defaultValue: string;
			validate?: (value: string) => string | null;

			placeholder?: string;
			secureTextEntry?: boolean;
			autoFocus?: boolean;
			keyboardType?: React.ComponentProps<typeof TextInput>["keyboardType"];

			/** Promise 解決 */
			resolve: (value: string | null) => void;
			reject: (e: unknown) => void;
	  };

type DialogState = {
	visible: boolean;
	current: DialogRequest | null;

	/** confirm 実行中（OK ボタンなどを抑止） */
	confirming: boolean;

	/** 画面内に表示するエラー（confirm/prompt どちらにも使える） */
	inlineError: string | null;

	/** prompt の入力値 */
	promptValue: string;
};

/** 公開 Context API */
export type DialogContextType = {
	/**
	 * 互換 API：任意メッセージと OK/Cancel でダイアログ表示（fire-and-forget）
	 * - 内部では custom request をキューに積む
	 */
	showDialog: (message: string, options?: ShowDialogOptions) => void;

	/**
	 * Promise API：ユーザーが OK を押したら true、Cancel/Dismiss なら false
	 */
	confirm: (options: ConfirmDialogOptions) => Promise<boolean>;

	/**
	 * Promise API：入力を返す（Cancel/Dismiss なら null）
	 * validate がエラーを返した場合は閉じずにエラー表示
	 */
	prompt: (options: PromptDialogOptions) => Promise<string | null>;

	/** 現在表示中を閉じる（理由は system 扱い） */
	hideDialog: () => void;

	/** デバッグ：キュー長（任意） */
	getQueueSize: () => number;
};

const DialogContext = createContext<DialogContextType | undefined>(undefined);

/** 安全な ID 生成 */
const makeId = () => `${Date.now()}_${Math.random().toString(16).slice(2)}`;

/** mounted ガード */
const useIsMountedRef = () => {
	const ref = useRef(true);
	useEffect(() => {
		ref.current = true;
		return () => {
			ref.current = false;
		};
	}, []);
	return ref;
};

export const DialogProvider = ({ children }: { children: ReactNode }) => {
	const styles = useThemedStyles(createStyles);
	const { colors } = useAppTheme();
	const isMountedRef = useIsMountedRef();

	// #958 【修正】paper の Portal は PaperProvider 直下のホスト(=CenteredAppShell の外側)に
	// 描画されるため、Dialog がウィンドウ全幅に広がり web の中央カラムからはみ出していた。
	// Dialog 自体をカラム幅(-左右マージン26px相当)に制約し中央寄せする。
	// native では contentWidth = 画面幅のため、paper 既定(marginHorizontal:26)と同じ見た目になる。
	const contentWidth = useContentWidth();
	const dialogWidth = Math.max(0, contentWidth - 52);

	/**
	 * キューは ref で持つ（state で持つと無駄レンダーが増えやすい）
	 * - current は state で描画に反映
	 */
	const queueRef = useRef<DialogRequest[]>([]);

	const [state, setState] = useState<DialogState>({
		visible: false,
		current: null,
		confirming: false,
		inlineError: null,
		promptValue: "",
	});

	/**
	 * #1205 【修正】ダイアログのアクション（OK / custom action）の多重実行を防ぐ同期ガード。
	 *
	 * `state.confirming`（useState）は **ボタンを disabled にし、dismiss / 戻るキーを塞ぐ表示用途**
	 * であって、多重実行の判定には使えない。React が再レンダリングをコミットする前に 2 発目の
	 * 押下が処理されると、両方が `state.confirming === false` を読んで通過しうるためで、
	 * 通過すると custom（`showDialog` + `onConfirm`）の `onConfirm` が 2 回走る。
	 * 実害の例：`features/dishCategories/hooks/useBlockDishCategory.ts` のブロックは 2 発目が
	 * `reactions` の一意制約で失敗し、**ブロックできているのにダイアログにエラーが残る**。
	 *
	 * ref への代入は同期的に確定するため、同一 JS タスク内の連続呼び出しでもレースしない。
	 * `features/map/components/ReviewForm.tsx:173-185` の `isSubmittingRef` と同じ方式。
	 * 解除は `runConfirmFlow` / `runCustomAction` の `finally` だけで行う。早期 return する経路
	 *（prompt の validate エラーなど）も finally を通るので「1 回失敗したら二度と押せない」にはならない。
	 */
	const isConfirmingRef = useRef(false);

	/** 現在の request を表示する（キュー先頭をポップして state に載せる） */
	const showNextIfIdle = useCallback(() => {
		setState((prev) => {
			if (prev.visible || prev.current) return prev;

			const next = queueRef.current.shift() ?? null;
			if (!next) return prev;

			// 表示開始フック（運用/デバッグ）
			try {
				next.onShow?.();
			} catch {
				// onShow で落ちても UI は動かす
			}

			return {
				visible: true,
				current: next,
				confirming: false,
				inlineError: null,
				promptValue: next.kind === "prompt" ? next.defaultValue : "",
			};
		});
	}, []);

	/** request をキューに積んで必要なら表示 */
	const enqueue = useCallback(
		(req: DialogRequest) => {
			queueRef.current.push(req);
			// すぐ表示できるなら表示
			showNextIfIdle();
		},
		[showNextIfIdle],
	);

	/** 現在のダイアログを閉じる（共通） */
	const closeCurrent = useCallback(
		(reason: DialogCloseReason) => {
			setState((prev) => {
				const cur = prev.current;

				// onHide は「閉じた」時点で呼ぶ（次表示の前）
				if (cur) {
					try {
						cur.onHide?.(reason);
					} catch {
						// 無視
					}
				}

				return {
					visible: false,
					current: null,
					confirming: false,
					inlineError: null,
					promptValue: "",
				};
			});

			// 次を表示（state 反映を待つ必要はないが、念のため microtask）
			Promise.resolve().then(() => {
				if (!isMountedRef.current) return;
				showNextIfIdle();
			});
		},
		[isMountedRef, showNextIfIdle],
	);

	/**
	 * Dismiss（背景タップ/戻るキー）を処理
	 * - confirm中は dismiss を無効にする
	 */
	const handleDismiss = useCallback(() => {
		setState((prev) => {
			const cur = prev.current;
			if (!cur) return prev;

			// confirm 実行中は閉じさせない（1,6）
			if (prev.confirming) return prev;

			const dismissable = cur.dismissable;
			if (!dismissable) return prev;

			// Dismiss コールバック（6）
			try {
				cur.onDismiss?.();
			} catch {
				// ignore
			}

			// confirm/prompt の場合は Promise 解決も必要（2）
			if (cur.kind === "confirm") {
				try {
					cur.resolve(false);
				} catch {
					// ignore
				}
			}
			if (cur.kind === "prompt") {
				try {
					cur.resolve(null);
				} catch {
					// ignore
				}
			}

			// close は state 外でやる
			Promise.resolve().then(() => closeCurrent("dismiss"));
			return prev;
		});
	}, [closeCurrent]);

	/**
	 * Android 戻るキー
	 * - backHandlerEnabled が false / confirm中は抑止
	 */
	useEffect(() => {
		if (Platform.OS !== "android") return;

		const sub = BackHandler.addEventListener("hardwareBackPress", () => {
			const cur = state.current;
			if (!state.visible || !cur) return false;

			// confirm中は戻るを無効化（1,6）
			if (state.confirming) return true;

			if (!cur.backHandlerEnabled) return true;

			// dismiss と同じ扱い
			handleDismiss();
			return true;
		});

		return () => sub.remove();
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, [state.visible, state.current, state.confirming, handleDismiss]);

	/**
	 * unmount 時の掃除（5）
	 * - 未解決 Promise を reject してリークを避ける
	 */
	useEffect(() => {
		return () => {
			const pending = [...queueRef.current, ...(state.current ? [state.current] : [])];

			for (const req of pending) {
				if (req.kind === "confirm") {
					try {
						req.reject(new Error("DialogProvider unmounted (confirm cancelled)."));
					} catch {
						// ignore
					}
				}
				if (req.kind === "prompt") {
					try {
						req.reject(new Error("DialogProvider unmounted (prompt cancelled)."));
					} catch {
						// ignore
					}
				}
			}

			queueRef.current = [];
		};
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	/** 互換 showDialog（強化版） */
	const showDialog = useCallback(
		(message: string, options?: ShowDialogOptions) => {
			// i18n は「要求時」に評価（8）
			const defaultCancel = i18n.t("Common.cancel");
			const okLabel: string = options?.okLabel ?? i18n.t("Common.ok");
			const cancelLabel = options?.cancelLabel ?? defaultCancel;

			const req: DialogRequest = {
				kind: "custom",
				id: makeId(),
				title: options?.title ?? "",
				message,

				// actions 配列で柔軟化（7）
				actions: [
					{
						key: "cancel",
						label: cancelLabel,
						mode: "text",
						// #1156 【設計】E2E から確実に掴めるよう、既定 2 ボタンには安定した testID を必ず付ける。
						// ラベルは i18n で変わるため、ラベル一致で掴むテストは多言語で壊れる。
						testID: "dialog-action-cancel",
						onPress: () => {
							try {
								options?.onCancel?.();
							} catch {
								// ignore
							}
						},
					},
					{
						key: "ok",
						label: okLabel,
						mode: "text",
						testID: "dialog-action-ok",
						onPress: async () => {
							// 互換 onConfirm をここで実行
							if (options?.onConfirm) {
								await options.onConfirm();
							}
						},
					},
				],

				onConfirm: options?.onConfirm,
				onCancel: options?.onCancel,
				onDismiss: options?.onDismiss,

				closeOnConfirm: options?.closeOnConfirm ?? true,
				closeOnError: options?.closeOnError ?? false,

				errorMessage: options?.errorMessage,
				onError: options?.onError,

				dismissable: options?.dismissable ?? true,
				backHandlerEnabled: options?.backHandlerEnabled ?? true,

				debugId: options?.debugId,
				onShow: options?.onShow,
				onHide: options?.onHide,

				accessibilityLabel: options?.accessibilityLabel,
			};

			enqueue(req);
		},
		[enqueue],
	);

	/** Promise confirm（2） */
	const confirm = useCallback(
		(options: ConfirmDialogOptions) => {
			const defaultCancel = i18n.t("Common.cancel");

			return new Promise<boolean>((resolve, reject) => {
				const req: DialogRequest = {
					kind: "confirm",
					id: makeId(),
					title: options.title ?? "",
					message: options.message,
					confirmLabel: options.confirmLabel ?? i18n.t("Common.ok"),
					cancelLabel: options.cancelLabel ?? defaultCancel,
					showCancel: options.showCancel ?? true,

					dismissable: options.dismissable ?? true,
					backHandlerEnabled: options.backHandlerEnabled ?? true,

					onDismiss: options.onDismiss,

					debugId: options.debugId,
					onShow: options.onShow,
					onHide: options.onHide,
					accessibilityLabel: options.accessibilityLabel,

					resolve,
					reject,
				};

				enqueue(req);
			});
		},
		[enqueue],
	);

	/** Promise prompt（2） */
	const prompt = useCallback(
		(options: PromptDialogOptions) => {
			const defaultCancel = i18n.t("Common.cancel");

			return new Promise<string | null>((resolve, reject) => {
				const req: DialogRequest = {
					kind: "prompt",
					id: makeId(),
					title: options.title ?? "",
					message: options.message,
					confirmLabel: options.confirmLabel ?? i18n.t("Common.ok"),
					cancelLabel: options.cancelLabel ?? defaultCancel,

					dismissable: options.dismissable ?? true,
					backHandlerEnabled: options.backHandlerEnabled ?? true,

					debugId: options.debugId,
					onShow: options.onShow,
					onHide: options.onHide,
					accessibilityLabel: options.accessibilityLabel,

					defaultValue: options.defaultValue ?? "",
					validate: options.validate,

					placeholder: options.placeholder,
					secureTextEntry: options.secureTextEntry,
					autoFocus: options.autoFocus,
					keyboardType: options.keyboardType,

					resolve,
					reject,
				};

				enqueue(req);
			});
		},
		[enqueue],
	);

	/** 外部から強制的に閉じる（system） */
	const hideDialog = useCallback(() => {
		// confirm/prompt の場合はキャンセルとして解決してから閉じる（安全側）
		const cur = state.current;
		if (cur?.kind === "confirm") {
			try {
				cur.resolve(false);
			} catch {
				// ignore
			}
		}
		if (cur?.kind === "prompt") {
			try {
				cur.resolve(null);
			} catch {
				// ignore
			}
		}
		closeCurrent("system");
	}, [closeCurrent, state.current]);

	const getQueueSize = useCallback(() => queueRef.current.length, []);

	/** Context value を安定化（10） */
	const contextValue = useMemo<DialogContextType>(
		() => ({
			showDialog,
			confirm,
			prompt,
			hideDialog,
			getQueueSize,
		}),
		[showDialog, confirm, prompt, hideDialog, getQueueSize],
	);

	/**
	 * confirm（custom の OK / confirm request / prompt の OK）実行
	 * - async 対応、エラー制御（1,11）
	 */
	const runConfirmFlow = useCallback(async () => {
		const cur = state.current;
		if (!cur) return;

		// すでに confirm 中なら多重実行させない（1）
		// #1205 判定は同期的に確定する ref で行う（state.confirming は表示用。宣言のコメント参照）
		if (isConfirmingRef.current || state.confirming) return;
		isConfirmingRef.current = true;

		try {
			// prompt の場合：validate を先に通す（2）
			if (cur.kind === "prompt") {
				const value = state.promptValue;

				const validationError = cur.validate?.(value) ?? null;
				if (validationError) {
					setState((prev) => ({ ...prev, inlineError: validationError }));
					return; // 閉じない
				}

				// OK で解決して閉じる
				try {
					cur.resolve(value);
				} catch {
					// ignore
				}
				closeCurrent("confirm");
				return;
			}

			// confirm request の場合：OK で true を返して閉じる
			if (cur.kind === "confirm") {
				try {
					cur.resolve(true);
				} catch {
					// ignore
				}
				closeCurrent("confirm");
				return;
			}

			// custom request の場合：onConfirm / action 実行（async 対応）
			setState((prev) => ({ ...prev, confirming: true, inlineError: null }));

			try {
				// 「OK action」を探して実行（actions 配列対応）（7）
				const okAction = cur.actions.find((a) => a.key === "ok");
				if (okAction?.onPress) {
					await okAction.onPress();
				} else if (cur.onConfirm) {
					// 念のためフォールバック
					await cur.onConfirm();
				}

				// 成功後に閉じるか（1）
				if (cur.closeOnConfirm) {
					closeCurrent("confirm");
				} else {
					setState((prev) => ({ ...prev, confirming: false }));
				}
			} catch (e) {
				// エラー通知（1,11）
				try {
					cur.onError?.(e);
				} catch {
					// ignore
				}

				const msg: string = cur.errorMessage ?? i18n.t("Common.errors.unexpected");
				setState((prev) => ({ ...prev, confirming: false, inlineError: msg }));

				// 失敗時も閉じるか（1）
				if (cur.closeOnError) {
					closeCurrent("confirm");
				}
			}
		} finally {
			// #1205 成功・失敗・早期 return のいずれでも必ず通る、唯一の解除箇所。
			// エラー表示を残して閉じない（closeOnError:false）経路でも解除されるので再試行できる。
			isConfirmingRef.current = false;
		}
	}, [closeCurrent, state.confirming, state.current, state.promptValue]);

	/** Cancel ボタン */
	const handleCancel = useCallback(() => {
		const cur = state.current;
		if (!cur) return;

		// confirm中は cancel を無効にする（設計上の一貫性）（1）
		if (state.confirming) return;

		try {
			cur.onCancel?.();
		} catch {
			// ignore
		}

		if (cur.kind === "confirm") {
			try {
				cur.resolve(false);
			} catch {
				// ignore
			}
		}
		if (cur.kind === "prompt") {
			try {
				cur.resolve(null);
			} catch {
				// ignore
			}
		}

		closeCurrent("cancel");
	}, [closeCurrent, state.confirming, state.current]);

	/** custom actions の実行（OK/CANCEL 以外） */
	const runCustomAction = useCallback(
		async (action: DialogAction) => {
			const cur = state.current;
			if (!cur || cur.kind !== "custom") return;

			// confirm中は action 無効（1）
			// #1205 ここも判定は ref で行う（state.confirming は表示用。宣言のコメント参照）
			if (isConfirmingRef.current || state.confirming) return;

			// cancel/ok は専用ハンドラへ（ref はまだ立てていないので runConfirmFlow 側で立てる）
			if (action.key === "cancel") {
				handleCancel();
				return;
			}
			if (action.key === "ok") {
				runConfirmFlow();
				return;
			}

			// その他 action は実行して、必要なら閉じる（ここでは「action 側で hideDialog する」方針）
			isConfirmingRef.current = true;
			try {
				setState((prev) => ({ ...prev, confirming: true, inlineError: null }));
				await action.onPress?.();
			} catch (e) {
				try {
					cur.onError?.(e);
				} catch {
					// ignore
				}
				const msg: string = cur.errorMessage ?? i18n.t("Common.error");
				setState((prev) => ({ ...prev, inlineError: msg }));
			} finally {
				// #1205 成功・失敗のどちらでも必ず通る解除箇所（再試行できる状態に戻す）
				isConfirmingRef.current = false;
				setState((prev) => ({ ...prev, confirming: false }));
			}
		},
		[handleCancel, runConfirmFlow, state.confirming, state.current],
	);

	const cur = state.current;
	const visible = state.visible && !!cur;

	/** a11y 用のラベル */
	const a11yLabel =
		cur?.accessibilityLabel ??
		(cur?.title ? i18n.t("Dialog.a11y.dialogWithTitle", { title: cur.title }) : i18n.t("Dialog.a11y.dialog"));

	/**
	 * dismissable/backHandlerEnabled は confirm中は強制 false（1,6）
	 * ※ react-native-paper の Dialog は dismissable 制御を onDismiss の中で行うのが確実
	 */
	const isDismissAllowed = !!cur && !state.confirming && (cur.dismissable ?? true);

	/**
	 * UI 用：actions を組み立てる
	 * - confirm/prompt は固定配置（Cancel / OK）
	 * - custom は actions 配列を描画
	 */
	const renderedActions: DialogAction[] = useMemo(() => {
		if (!cur) return [];

		if (cur.kind === "confirm") {
			const actions: DialogAction[] = [];
			if (cur.showCancel) {
				actions.push({
					key: "cancel",
					label: cur.cancelLabel,
					mode: "text",
				});
			}
			actions.push({
				key: "ok",
				label: cur.confirmLabel,
				mode: "text",
			});
			return actions;
		}

		if (cur.kind === "prompt") {
			return [
				{ key: "cancel", label: cur.cancelLabel, mode: "text" },
				{ key: "ok", label: cur.confirmLabel, mode: "text" },
			];
		}

		// custom
		return cur.actions;
	}, [cur]);

	return (
		<DialogContext.Provider value={contextValue}>
			{children}

			<Portal>
				<Dialog
					visible={visible}
					style={[styles.dialog, { width: dialogWidth, alignSelf: "center" }]}
					/**
					 * onDismiss は「呼ばれる」ので、許可しない場合は handleDismiss 内で弾く（6）
					 */
					onDismiss={handleDismiss}>
					{!!cur?.title && <Dialog.Title style={styles.title}>{cur.title}</Dialog.Title>}

					<Dialog.Content>
						<View accessible accessibilityLabel={a11yLabel}>
							{/* 長文対策：スクロール（9） */}
							<ScrollView
								style={{ maxHeight: 320 }}
								contentContainerStyle={{ paddingBottom: 4 }}
								// confirm中でもスクロールは許可
							>
								{/*
								  #1511 【設計】本文にも安定した testID を与える。ボタン（dialog-confirm-button /
								  dialog-cancel-button）には既に付いているのに本文だけ無く、E2E から «何と書いてあるか» を
								  確かめる手段が by.text() の **完全一致**しか無かった。本文は 1 つの Text に段落まるごと
								  入るため、「この操作は取り消せません。」のような一部分では絶対に一致しない。
								  実際 e2e-mobile の tests/authenticated/account-delete.test.ts はそれで落ち続けていた。
								*/}
								<Paragraph style={styles.message} testID="dialog-message">
									{cur?.message ?? ""}
								</Paragraph>

								{/* prompt UI（2） */}
								{cur?.kind === "prompt" && (
									<View style={{ marginTop: 12 }}>
										<TextInput
											value={state.promptValue}
											onChangeText={(t) => setState((prev) => ({ ...prev, promptValue: t, inlineError: null }))}
											placeholder={cur.placeholder}
											secureTextEntry={cur.secureTextEntry}
											autoFocus={cur.autoFocus}
											keyboardType={cur.keyboardType}
										/>
										{!!state.inlineError && (
											<HelperText type="error" visible={true}>
												{state.inlineError}
											</HelperText>
										)}
									</View>
								)}

								{/* custom/confirm の inline error（1,11） */}
								{cur?.kind !== "prompt" && !!state.inlineError && (
									<View style={{ marginTop: 12 }}>
										<Text accessibilityRole="alert">{state.inlineError}</Text>
									</View>
								)}
							</ScrollView>
						</View>
					</Dialog.Content>

					<Dialog.Actions style={styles.actions}>
						{renderedActions.map((a) => {
							const isOk = a.key === "ok";
							const isCancel = a.key === "cancel";

							const disabled =
								!!a.disabled ||
								// confirm中は全部無効（1）
								state.confirming ||
								// dismiss を許可しない場合でもボタンは押せる（閉じる手段はボタン）
								false;

							const onPress = async () => {
								// confirm中は無視（1）
								// #1205 disabled（下の `state.confirming`）は再レンダリング後にしか効かないため、
								// 押下の入口でも同期的な ref で弾く（宣言のコメント参照）
								if (isConfirmingRef.current || state.confirming) return;

								if (isCancel) {
									handleCancel();
									return;
								}
								if (isOk) {
									runConfirmFlow();
									return;
								}

								// custom action（7）
								await runCustomAction(a);
							};

							// danger 表示はテーマ連携前提（ここでは mode のみ利用）
							return (
								<Button
									key={a.key}
									mode={isOk || isCancel ? "contained" : (a.mode ?? "text")}
									buttonColor={isOk ? colors.brand : isCancel ? colors.surfaceMuted : undefined}
									textColor={isOk ? FixedColors.onFilled : isCancel ? colors.textSecondary : undefined}
									style={isOk || isCancel ? styles.actionButton : undefined}
									contentStyle={isOk || isCancel ? styles.actionButtonContent : undefined}
									labelStyle={[styles.actionButtonLabel, isOk && styles.confirmButtonLabel]}
									onPress={onPress}
									disabled={disabled}
									accessibilityLabel={a.accessibilityLabel}
									// #1131 【設計】OK / キャンセルには既定の testID を与える。
									// ネイティブ（Detox）にはラベル文字列でしか要素を特定できない場面があり、
									// 「設定画面のログアウト行」と「確認ダイアログのログアウトボタン」のように
									// **同じ文言のボタンが同時に 2 つ存在する**と matcher が複数一致して操作できない
									// （Detox は複数一致した matcher の操作を例外にする）。
									// 個別の testID が渡されていればそちらを優先する（custom actions は従来どおり）。
									testID={a.testID ?? (isOk ? "dialog-confirm-button" : isCancel ? "dialog-cancel-button" : undefined)}>
									{a.label}
								</Button>
							);
						})}
					</Dialog.Actions>

					{/* dismiss を許可しない状態が分かりやすいようにする場合は補助テキストを出しても良い */}
					{visible && !isDismissAllowed && (
						<View style={{ paddingHorizontal: 24, paddingBottom: 12 }}>
							{/* ここは任意（UX 次第）。不要なら削除OK */}
						</View>
					)}
				</Dialog>
			</Portal>
		</DialogContext.Provider>
	);
};

const createStyles = (colors: Palette) =>
	StyleSheet.create({
		dialog: {
			backgroundColor: colors.surface,
			borderRadius: 20,
		},
		title: {
			fontSize: 20,
			fontWeight: "700",
			color: colors.dialogTitle,
			letterSpacing: -0.3,
		},
		message: {
			fontSize: 16,
			fontWeight: "500",
			lineHeight: 24,
			color: colors.dialogMessage,
		},
		actions: {
			gap: 4,
			paddingHorizontal: 24,
			paddingBottom: 20,
		},
		actionButton: {
			borderRadius: 16,
		},
		actionButtonContent: {
			minHeight: 48,
			paddingHorizontal: 8,
		},
		actionButtonLabel: {
			fontSize: 16,
			fontWeight: "600",
		},
		confirmButtonLabel: {
			fontWeight: "700",
		},
	});

/** useDialog フック */
export const useDialog = (): DialogContextType => {
	const context = useContext(DialogContext);
	if (!context) {
		throw new Error("[useDialog] This hook must be used within a <DialogProvider>.");
	}
	return context;
};
