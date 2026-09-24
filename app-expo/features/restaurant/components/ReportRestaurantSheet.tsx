/**
 * 🏪 店舗情報の «この情報が違う» を報告するシート（#1933 / 決定元: #1827）
 *
 * ## 責務
 * 受け入れ条件 2〜5 だけを持つ。「何が違うかを選ぶ → 正しい値を入れる → 送る →
 * 受け付けたことを伝える」。**店の情報はその場では変わらない。**
 * 誤報・荒らしがそのまま本番へ乗らないための規則で、OSM / Google / 食べログの
 * 3 例に共通していた（#1827 の調査）。したがってこのシートは店の表示を一切書き換えない。
 *
 * ## 通報シート（`ReportContentSheet`）と共通化しない
 * 2026-09-23 オーナー判断「テーブルが違うなら分けるべき」。通報は «消すかどうか»、
 * 報告は «値を直すかどうか» で、選択肢の意味・入力欄の有無・送信先が違う。
 * 共通化すると «理由を 1 つ足す» が «店舗の項目が 1 つ増える» と同じ操作に見え始める。
 *
 * ⚠️ **入力欄は空で始める。** 画面に出ている値（Google 由来のことがある）を初期値に
 * 入れると、ユーザーが何も直さず送ったときに **Google の値がユーザー入力の顔をして**
 * `restaurants` へ入る。ToS 上の «保存しない» が見かけ倒しになる
 * （migration のコメントにも同じ警告がある）。
 *
 * ⚠️ **二重報告の差を出さない。** API は 2 回目以降を 409 にせず既存の受付番号を返す。
 * 「既に報告済みです」と伝えると、**却下済みであること**まで読めてしまう。
 */
import React, { useCallback, useMemo, useState } from "react";
import {
	KeyboardAvoidingView,
	Modal,
	Platform,
	Pressable,
	ScrollView,
	StyleSheet,
	Text,
	TextInput,
	TouchableOpacity,
	View,
} from "react-native";
import { Check, CircleCheck, X } from "lucide-react-native";

import { PrimaryButton } from "@/components/PrimaryButton";
import type { Palette } from "@/constants/Palette";
import { useAppTheme, useThemedStyles } from "@/contexts/ThemeProvider";
import i18n from "@/lib/i18n";
import { useAPICall } from "@/hooks/useAPICall";
import { useLogger } from "@/hooks/useLogger";
import { useHaptics } from "@/hooks/useHaptics";
import { useSheetBottomPadding } from "@/hooks/useSheetBottomPadding";
import { toErrorLogMessage } from "@/lib/errorMessage";
import type { CreateRestaurantReportDto } from "@shared/api/v1/dto";
import type { CreateRestaurantReportResponse } from "@shared/api/v1/res";
import {
	RESTAURANT_REPORT_FIELDS,
	RESTAURANT_REPORT_FIELDS_WITHOUT_VALUE,
	RESTAURANT_REPORT_PROPOSED_VALUE_MAX_LENGTH,
	type RestaurantReportField,
} from "@shared/api/v1/constants/restaurantReports";

interface ReportRestaurantSheetProps {
	/** シートを開いているか */
	visible: boolean;
	/** 報告対象の店（`restaurants.id`） */
	restaurantId: string;
	/** どの店の話かを読み上げるための店名 */
	restaurantName: string;
	/** 閉じる（キャンセル・完了のいずれでも呼ばれる） */
	onClose: () => void;
}

/** シートの状態。`accepted` まで来たら選択には戻さない */
type Phase = "form" | "submitting" | "accepted";

/** シート下端のデザイン上の余白。実際の余白はこれに safe area の inset を足したもの */
const SHEET_PADDING_BOTTOM = 28;

/**
 * その項目が «正しい値» の入力を伴うか。
 *
 * ⚠️ **項目名をここへ書き写さないこと。** 正は shared の
 * `RESTAURANT_REPORT_FIELDS_WITHOUT_VALUE` で、API の正規化も DB の NULL 許容も
 * そこと 1 対 1 に対応している。画面側にもう 1 つ一覧を持つと、項目を増やしたときに
 * **入力欄だけ出ない / 入力欄だけ出る**という食い違いが起きる。
 */
function requiresValue(field: RestaurantReportField): boolean {
	return !RESTAURANT_REPORT_FIELDS_WITHOUT_VALUE.includes(field);
}

export function ReportRestaurantSheet({
	visible,
	restaurantId,
	restaurantName,
	onClose,
}: ReportRestaurantSheetProps) {
	const styles = useThemedStyles(createStyles);
	const { colors } = useAppTheme();
	const { callBackend } = useAPICall();
	const { logFrontendEvent } = useLogger();
	const { lightImpact } = useHaptics();
	// #1742 Modal はネイティブでは別ウィンドウで、画面側の safe area が届かない
	const sheetPaddingBottom = useSheetBottomPadding(SHEET_PADDING_BOTTOM);

	const [phase, setPhase] = useState<Phase>("form");
	const [field, setField] = useState<RestaurantReportField | null>(null);
	const [proposedValue, setProposedValue] = useState("");
	const [errorMessage, setErrorMessage] = useState<string | null>(null);

	// 表示順は shared の定数がそのまま。画面側で並べ替えると API・DB・UI の 3 箇所で
	// 順番の解釈が割れる
	const fields = useMemo(() => RESTAURANT_REPORT_FIELDS, []);

	const needsValue = field !== null && requiresValue(field);
	const trimmedValue = proposedValue.trim();
	const canSubmit = field !== null && (!needsValue || trimmedValue.length > 0);

	/** 閉じるときに状態を初期化する。次に開いたとき前回の入力が残っていると誤送信になる */
	const handleClose = useCallback(() => {
		setPhase("form");
		setField(null);
		setProposedValue("");
		setErrorMessage(null);
		onClose();
	}, [onClose]);

	/**
	 * 項目を切り替えたら «正しい値» を捨てる。
	 *
	 * ⚠️ 残すと «店名を直すつもりで書いた文字列» が «営業時間» として送られる。
	 * 項目ごとに意味がまるで違うので、持ち越してよい入力は 1 つも無い。
	 */
	const handleSelectField = useCallback((next: RestaurantReportField) => {
		setField(next);
		setProposedValue("");
		setErrorMessage(null);
	}, []);

	const handleSubmit = useCallback(async () => {
		// 送信ボタンは disabled にしてあるが、連打・再入を同期的にも弾く
		if (!field || !canSubmit || phase === "submitting") return;

		lightImpact();
		setPhase("submitting");
		setErrorMessage(null);

		try {
			const response = await callBackend<CreateRestaurantReportDto, CreateRestaurantReportResponse>(
				"v1/restaurant-reports",
				{
					method: "POST",
					requestPayload: {
						restaurantId,
						field,
						// 値を伴わない項目（閉店した）では送らない。API 側も NULL へ倒すが、
						// «入力していない» を «空文字を入力した» として送る理由が無い
						...(needsValue ? { proposedValue: trimmedValue } : {}),
					},
				},
			);

			// ⚠️ **payload に proposedValue を入れないこと。** 第三者の個人情報が書かれうる。
			// フロントのログは BigQuery まで流れるので、«値が入っていたか» までに留める
			logFrontendEvent({
				event_name: "restaurant_reported",
				error_level: "log",
				payload: {
					restaurantId,
					field,
					hasProposedValue: needsValue,
					alreadyReported: response.alreadyReported,
				},
			});

			setPhase("accepted");
		} catch (error) {
			logFrontendEvent({
				event_name: "restaurant_report_failed",
				error_level: "warn",
				payload: { restaurantId, field, error: toErrorLogMessage(error) },
			});
			// 失敗しても入力は残す。もう一度押せば送り直せる
			setErrorMessage(i18n.t("Restaurant.report.errors.submitFailed"));
			setPhase("form");
		}
	}, [
		callBackend,
		canSubmit,
		field,
		lightImpact,
		logFrontendEvent,
		needsValue,
		phase,
		restaurantId,
		trimmedValue,
	]);

	return (
		<Modal
			visible={visible}
			transparent
			animationType="slide"
			onRequestClose={handleClose}
			accessibilityViewIsModal>
			{/* #1629 Modal の中は親のキーボード回避が届かない（別ウィンドウで描かれる）。ここに自前で持つ */}
			<KeyboardAvoidingView style={styles.backdrop} behavior={Platform.select({ ios: "padding", android: "height" })}>
				{/* 背景タップで閉じる。送信中だけは閉じさせない */}
				<Pressable
					style={styles.backdropTouchable}
					onPress={phase === "submitting" ? undefined : handleClose}
					accessibilityElementsHidden
					importantForAccessibility="no-hide-descendants"
				/>

				<View style={[styles.sheet, { paddingBottom: sheetPaddingBottom }]} testID="restaurant-report-sheet">
					{phase === "accepted" ? (
						<AcceptedView onClose={handleClose} />
					) : (
						<>
							<View style={styles.header}>
								<Text style={styles.title}>{i18n.t("Restaurant.report.title")}</Text>
								<TouchableOpacity
									onPress={handleClose}
									disabled={phase === "submitting"}
									hitSlop={{ top: 12, bottom: 12, left: 12, right: 12 }}
									accessibilityRole="button"
									accessibilityLabel={i18n.t("Common.close")}
									testID="restaurant-report-cancel">
									<X size={20} color={colors.textSecondary} />
								</TouchableOpacity>
							</View>

							<Text style={styles.description}>{i18n.t("Restaurant.report.description")}</Text>

							<ScrollView style={styles.fieldList} keyboardShouldPersistTaps="handled">
								{fields.map((code) => {
									const selected = code === field;
									return (
										<TouchableOpacity
											key={code}
											style={[styles.fieldRow, selected && styles.fieldRowSelected]}
											onPress={() => handleSelectField(code)}
											accessibilityRole="radio"
											// #1031 選択状態が色でしか出ていないと Detox から読めない。
											// aria-selected と «状態別のラベル» の両方で観測できるようにする
											aria-selected={selected}
											accessibilityLabel={i18n.t(
												selected
													? "Restaurant.report.accessibility.fieldSelected"
													: "Restaurant.report.accessibility.field",
												{ field: i18n.t(`Restaurant.report.fields.${code}`) },
											)}
											testID={`restaurant-report-field-${code}`}>
											<Text style={[styles.fieldLabel, selected && styles.fieldLabelSelected]}>
												{i18n.t(`Restaurant.report.fields.${code}`)}
											</Text>
											{selected ? <Check size={18} color={colors.brand} /> : null}
										</TouchableOpacity>
									);
								})}

								{/* 値を伴う項目のときだけ入力欄を出す。«閉店した» に正しい値は無い */}
								{needsValue && field ? (
									<>
										<Text style={styles.valueLabel}>{i18n.t(`Restaurant.report.valueLabel.${field}`)}</Text>
										<TextInput
											style={styles.valueInput}
											value={proposedValue}
											onChangeText={setProposedValue}
											// ⚠️ 画面に出ている値を初期値・プレースホルダに入れない（上の設計コメント）
											placeholder={i18n.t(`Restaurant.report.valuePlaceholder.${field}`)}
											placeholderTextColor={colors.textTertiary}
											multiline={field === "opening_hours"}
											// DB の CHECK（500 文字）と同じ上限。ここで止めておけば
											// «書ききってから 400 で弾かれる» 体験にならない
											maxLength={RESTAURANT_REPORT_PROPOSED_VALUE_MAX_LENGTH}
											accessibilityLabel={i18n.t(`Restaurant.report.valueLabel.${field}`)}
											testID="restaurant-report-value-input"
										/>
									</>
								) : null}
							</ScrollView>

							{errorMessage ? (
								<Text style={styles.error} testID="restaurant-report-error">
									{errorMessage}
								</Text>
							) : null}

							<PrimaryButton
								label={i18n.t(phase === "submitting" ? "Restaurant.report.submitting" : "Restaurant.report.submit")}
								onPress={handleSubmit}
								loading={phase === "submitting"}
								disabled={!canSubmit || phase === "submitting"}
								accessibilityLabel={i18n.t("Restaurant.report.accessibility.submit", { name: restaurantName })}
								testID="restaurant-report-submit"
							/>
						</>
					)}
				</View>
			</KeyboardAvoidingView>
		</Modal>
	);
}

/**
 * 受付完了の面。
 *
 * 受付番号は出さない。問い合わせ窓口が無い今それを見せても使い道が無く、
 * 「番号があるなら進捗が見られるはず」という誤解だけが残る（通報シートと同じ判断）。
 */
function AcceptedView({ onClose }: { onClose: () => void }) {
	const styles = useThemedStyles(createStyles);
	const { colors } = useAppTheme();

	return (
		<View style={styles.accepted} testID="restaurant-report-accepted">
			<CircleCheck size={44} color={colors.success} />
			<Text style={styles.acceptedTitle}>{i18n.t("Restaurant.report.accepted.title")}</Text>
			<Text style={styles.acceptedDescription}>{i18n.t("Restaurant.report.accepted.description")}</Text>
			<PrimaryButton
				label={i18n.t("Restaurant.report.accepted.close")}
				onPress={onClose}
				style={styles.acceptedButton}
				testID="restaurant-report-accepted-close"
			/>
		</View>
	);
}

const createStyles = (colors: Palette) =>
	StyleSheet.create({
		backdrop: {
			flex: 1,
			justifyContent: "flex-end",
			backgroundColor: "rgba(0, 0, 0, 0.45)",
		},
		backdropTouchable: {
			...StyleSheet.absoluteFillObject,
		},
		sheet: {
			backgroundColor: colors.surface,
			borderTopLeftRadius: 20,
			borderTopRightRadius: 20,
			paddingHorizontal: 20,
			paddingTop: 16,
			maxHeight: "85%",
		},
		header: {
			flexDirection: "row",
			alignItems: "center",
			gap: 8,
		},
		title: {
			flex: 1,
			fontSize: 17,
			fontWeight: "700",
			color: colors.textPrimaryAlt,
		},
		description: {
			marginTop: 8,
			fontSize: 13,
			lineHeight: 19,
			color: colors.textSecondary,
		},
		fieldList: {
			marginTop: 12,
			marginBottom: 12,
		},
		fieldRow: {
			flexDirection: "row",
			alignItems: "center",
			justifyContent: "space-between",
			paddingVertical: 13,
			paddingHorizontal: 14,
			borderRadius: 12,
			borderWidth: 1,
			borderColor: colors.borderMuted,
			marginBottom: 8,
		},
		// デザインガイドライン §1「選択中チップの強調」。赤を使ってよい 3 箇所のうちの 1 つ
		fieldRowSelected: {
			borderColor: colors.brand,
			backgroundColor: colors.brandTint,
		},
		fieldLabel: {
			fontSize: 15,
			color: colors.textPrimaryAlt,
		},
		fieldLabelSelected: {
			color: colors.brand,
			fontWeight: "600",
		},
		valueLabel: {
			marginTop: 8,
			marginBottom: 6,
			fontSize: 13,
			fontWeight: "600",
			color: colors.textSecondaryStrong,
		},
		valueInput: {
			minHeight: 48,
			borderWidth: 1,
			borderColor: colors.borderMuted,
			borderRadius: 12,
			padding: 12,
			fontSize: 14,
			color: colors.textPrimaryAlt,
			textAlignVertical: "top",
		},
		error: {
			marginBottom: 10,
			fontSize: 13,
			color: colors.danger,
		},
		accepted: {
			alignItems: "center",
			paddingVertical: 12,
			gap: 10,
		},
		acceptedTitle: {
			fontSize: 17,
			fontWeight: "700",
			color: colors.textPrimaryAlt,
		},
		acceptedDescription: {
			fontSize: 13,
			lineHeight: 19,
			color: colors.textSecondary,
			textAlign: "center",
		},
		acceptedButton: {
			marginTop: 8,
			alignSelf: "stretch",
		},
	});
