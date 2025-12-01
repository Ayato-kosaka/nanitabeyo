// app-expo/app/[locale]/tools/dish-category-image-review.tsx
//
// #516 【フロント】DishCategories 画像差分レビュー用ツールページ
// 運営用ツール - ユーザー向けアプリからの導線は不要
// 変更前/変更後の画像を比較し、「変更後に差し替えるべきか」を目視でレビューするツール

import React, { useState, useEffect, useCallback, useMemo } from "react";
import {
	View,
	StyleSheet,
	ScrollView,
	Pressable,
	Text,
	TextInput,
	TouchableOpacity,
	useWindowDimensions,
	Keyboard,
} from "react-native";
import { Image } from "expo-image";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Check, Circle, CheckCircle2 } from "lucide-react-native";

import { useBlurModal } from "@/features/blurModal/hooks/useBlurModal";
import { useSnackbar } from "@/contexts/SnackbarProvider";
import { useHaptics } from "@/hooks/useHaptics";
import { useLogger } from "@/hooks/useLogger";
import { PrimaryButton } from "@/components/PrimaryButton";

import type { SupabaseDishCategories } from "@shared/converters/convert_dish_categories";

/* -------------------------------------------------------------------------- */
/*                                    型定義                                   */
/* -------------------------------------------------------------------------- */

/** #516 【設計】変更前/変更後のカテゴリ情報の型 */
type DishCategoryItem = {
	dishCategory: Pick<SupabaseDishCategories, "id" | "image_url"> & {
		name: string;
	};
};

/** #516 【設計】選択状態の型 */
type Choice = "before" | "after" | null;

/** #516 【設計】カテゴリごとの選択状態 */
type CategorySelection = {
	choice: Choice;
	reason: string; // choice === "before" のときのみ必須
};

/* -------------------------------------------------------------------------- */
/*                               ハードコードデータ                              */
/* -------------------------------------------------------------------------- */

// #516 【設計】変更前のカテゴリデータ（ハードコード）
const BEFORE_DISH_CATEGORIES: DishCategoryItem[] = [
	{
		dishCategory: {
			id: "category-001",
			name: "カレー",
			image_url: "https://placehold.co/400x600/FFD700/000000?text=カレー（変更前）",
		},
	},
	{
		dishCategory: {
			id: "category-002",
			name: "ラーメン",
			image_url: "https://placehold.co/400x600/FFA500/FFFFFF?text=ラーメン（変更前）",
		},
	},
	{
		dishCategory: {
			id: "category-003",
			name: "寿司",
			image_url: "https://placehold.co/400x600/FF6347/FFFFFF?text=寿司（変更前）",
		},
	},
];

// #516 【設計】変更後のカテゴリデータ（ハードコード）- id・nameは同じだが image_url が異なる
const AFTER_DISH_CATEGORIES: DishCategoryItem[] = [
	{
		dishCategory: {
			id: "category-001",
			name: "カレー",
			image_url: "https://placehold.co/400x600/DAA520/000000?text=カレー（変更後）",
		},
	},
	{
		dishCategory: {
			id: "category-002",
			name: "ラーメン",
			image_url: "https://placehold.co/400x600/FF8C00/FFFFFF?text=ラーメン（変更後）",
		},
	},
	{
		dishCategory: {
			id: "category-003",
			name: "寿司",
			image_url: "https://placehold.co/400x600/DC143C/FFFFFF?text=寿司（変更後）",
		},
	},
];

// #516 【設計】理由候補のラジオボタン用文字列
const REASON_OPTIONS = [
	"変更後の料理が違う料理になっている",
	"変更後の画像のクオリティが低い",
	"色味が不自然で美味しそうに見えない",
] as const;

/* -------------------------------------------------------------------------- */
/*                                  メインページ                               */
/* -------------------------------------------------------------------------- */

export default function DishCategoryImageReviewPage() {
	const insets = useSafeAreaInsets();
	const { width: screenWidth, height: screenHeight } = useWindowDimensions();
	const { showSnackbar } = useSnackbar();
	const { lightImpact } = useHaptics();
	const { logFrontendEvent } = useLogger();

	// #516 【設計】説明文表示フラグ
	const [showDescription, setShowDescription] = useState(false);

	// #516 【設計】ローカルstate: 選択マップ (categoryId -> { choice, reason })
	const [selectionMap, setSelectionMap] = useState<Record<string, CategorySelection>>({});

	// #516 【設計】モーダル用: 現在選択中のカテゴリ
	const [activeCategory, setActiveCategory] = useState<DishCategoryItem | null>(null);

	// #516 【設計】モーダル内一時state: 理由テキスト
	const [modalReason, setModalReason] = useState("");

	// #516 【設計】モーダル内一時state: 選択中の理由候補インデックス
	const [selectedReasonIndex, setSelectedReasonIndex] = useState<number | null>(null);

	// #516 【設計】差分画像を非表示にするフラグ（モーダル内共通）
	const [hideDiffImages, setHideDiffImages] = useState(false);

	const {
		BlurModal,
		open: openModal,
		close: closeModal,
	} = useBlurModal({
		intensity: 80,
		closeOnBackdropPress: false,
	});

	// #516 【設計】レイアウト計算
	const PADDING_HORIZONTAL = 16;
	const GAP = 12;
	const cardWidth = screenWidth - PADDING_HORIZONTAL * 2;
	const imageWidth = (cardWidth - GAP * 3) / 2;
	const imageHeight = (imageWidth / 9) * 16;

	// #516 【設計】モーダル内の画像サイズ
	const modalImageWidth = screenWidth - 32 - 32; // padding
	const modalImageHeight = (modalImageWidth / 9) * 16;

	/* ------------------------------------------------------------------ */
	/*                           初期化処理                                 */
	/* ------------------------------------------------------------------ */

	useEffect(() => {
		const initial: Record<string, CategorySelection> = {};
		BEFORE_DISH_CATEGORIES.forEach((item) => {
			initial[item.dishCategory.id] = { choice: null, reason: "" };
		});
		setSelectionMap(initial);
	}, []);

	/* ------------------------------------------------------------------ */
	/*                           計算プロパティ                             */
	/* ------------------------------------------------------------------ */

	const selectedCount = useMemo(() => {
		return Object.values(selectionMap).filter((s) => s.choice !== null).length;
	}, [selectionMap]);

	const totalCount = BEFORE_DISH_CATEGORIES.length;

	// #516 【設計】送信ボタン活性条件: 全カテゴリでchoice決定 & beforeの場合はreason必須
	const canSubmit = useMemo(() => {
		return BEFORE_DISH_CATEGORIES.every((item) => {
			const sel = selectionMap[item.dishCategory.id];
			if (!sel || sel.choice === null) return false;
			if (sel.choice === "before" && sel.reason.trim().length === 0) return false;
			return true;
		});
	}, [selectionMap]);

	/* ------------------------------------------------------------------ */
	/*                           イベントハンドラ                          */
	/* ------------------------------------------------------------------ */

	/** #516 【設計】変更後カードタップ → 即座に「変更後」を選択状態にする */
	const handleAfterSelect = useCallback(
		(categoryId: string) => {
			lightImpact();
			setSelectionMap((prev) => ({
				...prev,
				[categoryId]: { choice: "after", reason: "" },
			}));
		},
		[lightImpact],
	);

	/** #516 【設計】変更前カードタップ → 理由入力モーダルを開く */
	const handleBeforeSelect = useCallback(
		(category: DishCategoryItem) => {
			lightImpact();
			setActiveCategory(category);
			// 既存の選択状態があればそれを復元
			const existingSel = selectionMap[category.dishCategory.id];
			if (existingSel && existingSel.choice === "before") {
				setModalReason(existingSel.reason);
				// 理由候補に一致するものがあればインデックスをセット
				const idx = REASON_OPTIONS.findIndex((opt) => opt === existingSel.reason);
				setSelectedReasonIndex(idx >= 0 ? idx : null);
			} else {
				setModalReason("");
				setSelectedReasonIndex(null);
			}
			openModal();
		},
		[lightImpact, openModal, selectionMap],
	);

	/** #516 【設計】理由候補をタップ → テキストエリアに反映 */
	const handleReasonOptionSelect = useCallback(
		(index: number) => {
			lightImpact();
			setSelectedReasonIndex(index);
			setModalReason(REASON_OPTIONS[index]);
		},
		[lightImpact],
	);

	/** #516 【設計】モーダルのキャンセルボタン */
	const handleModalCancel = useCallback(() => {
		Keyboard.dismiss();
		closeModal();
		setActiveCategory(null);
		setModalReason("");
		setSelectedReasonIndex(null);
	}, [closeModal]);

	/** #516 【設計】モーダルの保存ボタン */
	const handleModalSave = useCallback(() => {
		if (!activeCategory) return;
		if (modalReason.trim().length === 0) return;

		lightImpact();
		setSelectionMap((prev) => ({
			...prev,
			[activeCategory.dishCategory.id]: {
				choice: "before",
				reason: modalReason.trim(),
			},
		}));
		Keyboard.dismiss();
		closeModal();
		setActiveCategory(null);
		setModalReason("");
		setSelectedReasonIndex(null);
	}, [activeCategory, modalReason, lightImpact, closeModal]);

	/** #516 【設計】リセットボタン */
	const handleReset = useCallback(() => {
		lightImpact();
		const initial: Record<string, CategorySelection> = {};
		BEFORE_DISH_CATEGORIES.forEach((item) => {
			initial[item.dishCategory.id] = { choice: null, reason: "" };
		});
		setSelectionMap(initial);
	}, [lightImpact]);

	/** #516 【設計】送信処理 */
	const handleSubmit = useCallback(() => {
		if (!canSubmit) return;

		lightImpact();

		const payload = BEFORE_DISH_CATEGORIES.map((beforeItem) => {
			const afterItem = AFTER_DISH_CATEGORIES.find((a) => a.dishCategory.id === beforeItem.dishCategory.id);
			const sel = selectionMap[beforeItem.dishCategory.id];

			return {
				beforeId: beforeItem.dishCategory.id,
				beforeImageUrl: beforeItem.dishCategory.image_url,
				name: beforeItem.dishCategory.name,
				afterImageUrl: afterItem?.dishCategory.image_url ?? null,
				choice: sel?.choice ?? null,
				reason: sel?.choice === "before" ? sel.reason.trim() : "",
			};
		});

		logFrontendEvent({
			event_name: "tools_dish_category_image_review_submitted",
			error_level: "log",
			payload,
		});

		showSnackbar("送信しました");

		// 送信後リセット
		const initial: Record<string, CategorySelection> = {};
		BEFORE_DISH_CATEGORIES.forEach((item) => {
			initial[item.dishCategory.id] = { choice: null, reason: "" };
		});
		setSelectionMap(initial);
	}, [canSubmit, lightImpact, logFrontendEvent, showSnackbar, selectionMap]);

	/* ------------------------------------------------------------------ */
	/*                             レンダリング                            */
	/* ------------------------------------------------------------------ */

	/** #516 【設計】カテゴリカードのレンダリング */
	const renderCategoryCard = useCallback(
		(beforeItem: DishCategoryItem) => {
			const afterItem = AFTER_DISH_CATEGORIES.find((a) => a.dishCategory.id === beforeItem.dishCategory.id);
			const sel = selectionMap[beforeItem.dishCategory.id];
			const isBeforeSelected = sel?.choice === "before";
			const isAfterSelected = sel?.choice === "after";

			return (
				<View key={beforeItem.dishCategory.id} style={styles.categoryCard}>
					{/* カテゴリ名 */}
					<Text style={styles.categoryName}>{beforeItem.dishCategory.name}</Text>

					{/* 2列: 変更前 / 変更後 */}
					<View style={styles.imageRow}>
						{/* 変更前 */}
						<Pressable
							style={[styles.imageCard, { width: imageWidth }, isBeforeSelected && styles.imageCardSelected]}
							onPress={() => handleBeforeSelect(beforeItem)}
							android_ripple={{ color: "rgba(0,0,0,0.1)" }}>
							<Text style={styles.imageLabel}>変更前</Text>
							<View style={[styles.imageContainer, { height: imageHeight }]}>
								<Image
									source={{ uri: beforeItem.dishCategory.image_url }}
									style={StyleSheet.absoluteFill}
									contentFit="cover"
									transition={100}
								/>
								{isBeforeSelected && (
									<View style={styles.checkBadge}>
										<Check size={16} color="#FFF" />
									</View>
								)}
							</View>
						</Pressable>

						{/* 変更後 */}
						<Pressable
							style={[styles.imageCard, { width: imageWidth }, isAfterSelected && styles.imageCardSelected]}
							onPress={() => handleAfterSelect(beforeItem.dishCategory.id)}
							android_ripple={{ color: "rgba(0,0,0,0.1)" }}>
							<Text style={styles.imageLabel}>変更後</Text>
							<View style={[styles.imageContainer, { height: imageHeight }]}>
								<Image
									source={{ uri: afterItem?.dishCategory.image_url }}
									style={StyleSheet.absoluteFill}
									contentFit="cover"
									transition={100}
								/>
								{isAfterSelected && (
									<View style={styles.checkBadge}>
										<Check size={16} color="#FFF" />
									</View>
								)}
							</View>
						</Pressable>
					</View>
				</View>
			);
		},
		[selectionMap, imageWidth, imageHeight, handleBeforeSelect, handleAfterSelect],
	);

	// #516 【設計】モーダル内の変更前/変更後画像を取得
	const activeBefore = activeCategory;
	const activeAfter = activeCategory
		? AFTER_DISH_CATEGORIES.find((a) => a.dishCategory.id === activeCategory.dishCategory.id)
		: null;

	return (
		<View style={[styles.container, { paddingTop: insets.top }]}>
			{/* ヘッダー */}
			<View style={styles.header}>
				<Text style={styles.headerTitle}>料理カテゴリ画像レビュー</Text>
				<Text style={styles.headerSubtitle}>変更前と変更後の画像を比較し、どちらを採用するか選択してください</Text>
			</View>

			{/* 使い方説明 */}
			<View style={styles.descriptionSection}>
				<TouchableOpacity onPress={() => setShowDescription(!showDescription)} style={styles.descriptionToggle}>
					<Text style={styles.descriptionToggleText}>
						{showDescription ? "この画面の使い方を閉じる" : "この画面の使い方を開く"}
					</Text>
					<Text style={styles.descriptionToggleIcon}>{showDescription ? "▲" : "▼"}</Text>
				</TouchableOpacity>

				{showDescription && (
					<Text style={styles.descriptionText}>
						料理カテゴリごとに、変更前と変更後の画像を見比べて
						{"\n"}
						どちらの画像を採用するかを選択するための管理ツールです。
						{"\n\n"}
						1. 各カードの「変更前」または「変更後」の画像をタップします。
						{"\n"}
						2. 変更後をタップすると、そのまま「変更後の画像を採用」として選択されます。
						{"\n"}
						3. 変更前をタップすると、「変更前を採用する理由」を入力するモーダルが表示されます。
						{"\n"}
						4. すべてのカテゴリについて選択が完了したら、画面下部の「送信」ボタンを押してください。
						{"\n\n"}※ 変更前を選ぶ場合は、必ず理由を入力してください。
						{"\n"}※ 「リセット」ボタンで、すべての選択を初期状態に戻すことができます。
					</Text>
				)}
			</View>

			{/* カテゴリ一覧 */}
			<ScrollView
				style={styles.scrollView}
				contentContainerStyle={[styles.scrollViewContent, { paddingBottom: 140 }]}
				showsVerticalScrollIndicator={false}>
				{BEFORE_DISH_CATEGORIES.map(renderCategoryCard)}
			</ScrollView>

			{/* フッター */}
			<View style={[styles.footer, { paddingBottom: insets.bottom + 16 }]}>
				<Text style={styles.footerStatus}>
					選択済み: {selectedCount}/{totalCount}件
				</Text>
				<View style={styles.footerButtons}>
					<PrimaryButton
						label="リセット"
						onPress={handleReset}
						colors={["#6B7280", "#4B5563"]}
						style={styles.resetButton}
					/>
					<PrimaryButton
						label={`送信（${selectedCount}/${totalCount}）`}
						onPress={handleSubmit}
						disabled={!canSubmit}
						colors={canSubmit ? ["#22C55E", "#16A34A"] : ["#9CA3AF", "#6B7280"]}
						style={styles.submitButton}
					/>
				</View>
			</View>

			{/* 理由入力モーダル */}
			<BlurModal contentContainerStyle={styles.modalContent}>
				{activeCategory && (
					<ScrollView
						style={{ maxHeight: screenHeight - 150 }}
						showsVerticalScrollIndicator={false}
						keyboardShouldPersistTaps="handled">
						<Text style={styles.modalTitle}>{activeCategory.dishCategory.name}</Text>
						<Text style={styles.modalSubtitle}>「変更前の画像を採用する理由」を入力してください。</Text>

						{/* 差分画像を表示しないチェックボックス */}
						<TouchableOpacity style={styles.checkboxRow} onPress={() => setHideDiffImages(!hideDiffImages)}>
							{hideDiffImages ? <CheckCircle2 size={20} color="#22C55E" /> : <Circle size={20} color="#6B7280" />}
							<Text style={styles.checkboxLabel}>差分画像を表示しない（次回以降も）</Text>
						</TouchableOpacity>

						{/* 差分画像エリア */}
						{!hideDiffImages && (
							<View style={styles.modalImageSection}>
								<Text style={styles.modalImageLabel}>■ 変更前の画像</Text>
								<View style={[styles.modalImageContainer, { height: modalImageHeight }]}>
									<Image
										source={{ uri: activeBefore?.dishCategory.image_url }}
										style={StyleSheet.absoluteFill}
										contentFit="cover"
										transition={100}
									/>
								</View>

								<Text style={[styles.modalImageLabel, { marginTop: 12 }]}>■ 変更後の画像</Text>
								<View style={[styles.modalImageContainer, { height: modalImageHeight }]}>
									<Image
										source={{ uri: activeAfter?.dishCategory.image_url }}
										style={StyleSheet.absoluteFill}
										contentFit="cover"
										transition={100}
									/>
								</View>
							</View>
						)}

						{/* 理由入力エリア */}
						<Text style={styles.modalSectionLabel}>■ 理由</Text>
						<TextInput
							style={styles.reasonInput}
							value={modalReason}
							onChangeText={setModalReason}
							placeholder="例: 変更後の料理が違う料理になっている"
							placeholderTextColor="#9CA3AF"
							multiline
							numberOfLines={3}
							textAlignVertical="top"
						/>

						{/* 理由候補 */}
						<Text style={styles.modalSectionLabel}>（よくある理由）</Text>
						{REASON_OPTIONS.map((option, index) => (
							<TouchableOpacity
								key={index}
								style={styles.reasonOptionRow}
								onPress={() => handleReasonOptionSelect(index)}>
								{selectedReasonIndex === index ? (
									<CheckCircle2 size={18} color="#22C55E" />
								) : (
									<Circle size={18} color="#6B7280" />
								)}
								<Text style={styles.reasonOptionText}>{option}</Text>
							</TouchableOpacity>
						))}

						{/* ボタン */}
						<View style={styles.modalButtonRow}>
							<PrimaryButton
								label="キャンセル"
								onPress={handleModalCancel}
								colors={["#6B7280", "#4B5563"]}
								style={styles.modalButton}
							/>
							<PrimaryButton
								label="保存"
								onPress={handleModalSave}
								disabled={modalReason.trim().length === 0}
								colors={modalReason.trim().length > 0 ? ["#22C55E", "#16A34A"] : ["#9CA3AF", "#6B7280"]}
								style={styles.modalButton}
							/>
						</View>
					</ScrollView>
				)}
			</BlurModal>
		</View>
	);
}

/* -------------------------------------------------------------------------- */
/*                               スタイル定義                                  */
/* -------------------------------------------------------------------------- */

const styles = StyleSheet.create({
	container: {
		flex: 1,
		backgroundColor: "#F8F9FA",
	},
	header: {
		paddingHorizontal: 16,
		paddingVertical: 12,
		backgroundColor: "#FFF",
		borderBottomWidth: 1,
		borderBottomColor: "#E5E7EB",
	},
	headerTitle: {
		fontSize: 20,
		fontWeight: "700",
		color: "#1A1A1A",
	},
	headerSubtitle: {
		fontSize: 12,
		color: "#6B7280",
		marginTop: 4,
	},
	descriptionSection: {
		paddingHorizontal: 16,
		paddingVertical: 12,
		backgroundColor: "#FFF",
		borderBottomWidth: 1,
		borderBottomColor: "#E5E7EB",
	},
	descriptionToggle: {
		flexDirection: "row",
		alignItems: "center",
		paddingVertical: 6,
	},
	descriptionToggleText: {
		fontSize: 14,
		fontWeight: "600",
		flex: 1,
		color: "#1A1A1A",
	},
	descriptionToggleIcon: {
		fontSize: 16,
		color: "#6B7280",
	},
	descriptionText: {
		fontSize: 12,
		lineHeight: 18,
		color: "#4B5563",
		marginTop: 8,
	},
	scrollView: {
		flex: 1,
	},
	scrollViewContent: {
		paddingHorizontal: 16,
		paddingTop: 16,
	},
	categoryCard: {
		backgroundColor: "#FFF",
		borderRadius: 12,
		padding: 12,
		marginBottom: 16,
		shadowColor: "#000",
		shadowOffset: { width: 0, height: 2 },
		shadowOpacity: 0.1,
		shadowRadius: 4,
		elevation: 3,
	},
	categoryName: {
		fontSize: 16,
		fontWeight: "700",
		color: "#1A1A1A",
		marginBottom: 12,
	},
	imageRow: {
		flexDirection: "row",
		justifyContent: "space-between",
		gap: 12,
	},
	imageCard: {
		borderRadius: 8,
		overflow: "hidden",
		borderWidth: 2,
		borderColor: "#E5E7EB",
	},
	imageCardSelected: {
		borderColor: "#22C55E",
		borderWidth: 3,
	},
	imageLabel: {
		fontSize: 12,
		fontWeight: "600",
		color: "#4B5563",
		textAlign: "center",
		paddingVertical: 6,
		backgroundColor: "#F3F4F6",
	},
	imageContainer: {
		position: "relative",
	},
	checkBadge: {
		position: "absolute",
		top: 8,
		right: 8,
		width: 24,
		height: 24,
		borderRadius: 12,
		backgroundColor: "#22C55E",
		justifyContent: "center",
		alignItems: "center",
	},
	footer: {
		position: "absolute",
		bottom: 0,
		left: 0,
		right: 0,
		padding: 16,
		backgroundColor: "#FFF",
		borderTopWidth: 1,
		borderTopColor: "#E5E7EB",
	},
	footerStatus: {
		fontSize: 14,
		color: "#4B5563",
		marginBottom: 12,
		textAlign: "center",
	},
	footerButtons: {
		flexDirection: "row",
		gap: 12,
	},
	resetButton: {
		flex: 1,
	},
	submitButton: {
		flex: 2,
	},
	modalContent: {
		paddingHorizontal: 16,
		paddingTop: 16,
	},
	modalTitle: {
		fontSize: 18,
		fontWeight: "700",
		color: "#1A1A1A",
		marginBottom: 4,
	},
	modalSubtitle: {
		fontSize: 14,
		color: "#6B7280",
		marginBottom: 16,
	},
	checkboxRow: {
		flexDirection: "row",
		alignItems: "center",
		gap: 8,
		paddingVertical: 8,
		marginBottom: 12,
	},
	checkboxLabel: {
		fontSize: 14,
		color: "#4B5563",
	},
	modalImageSection: {
		marginBottom: 16,
	},
	modalImageLabel: {
		fontSize: 14,
		fontWeight: "600",
		color: "#1A1A1A",
		marginBottom: 8,
	},
	modalImageContainer: {
		borderRadius: 8,
		overflow: "hidden",
		backgroundColor: "#E5E7EB",
	},
	modalSectionLabel: {
		fontSize: 14,
		fontWeight: "600",
		color: "#1A1A1A",
		marginBottom: 8,
		marginTop: 8,
	},
	reasonInput: {
		borderWidth: 1,
		borderColor: "#D1D5DB",
		borderRadius: 8,
		padding: 12,
		fontSize: 14,
		color: "#1A1A1A",
		backgroundColor: "#FFF",
		minHeight: 80,
	},
	reasonOptionRow: {
		flexDirection: "row",
		alignItems: "center",
		gap: 8,
		paddingVertical: 10,
	},
	reasonOptionText: {
		fontSize: 14,
		color: "#4B5563",
		flex: 1,
	},
	modalButtonRow: {
		flexDirection: "row",
		gap: 12,
		marginTop: 20,
		marginBottom: 32,
	},
	modalButton: {
		flex: 1,
	},
});
