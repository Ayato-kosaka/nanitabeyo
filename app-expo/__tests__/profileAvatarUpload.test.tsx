/*
#1750 【設計】「プロフィール画像を選んでも上がらない」を二度と静かに起こさないための固定。

## 何が起きていたのか

オーナー実機（Android 16）で、編集画面で画像を選んで保存しても反映されなかった。
dev / 本番のログを追うと、原因は 1 つではなく 3 層あった。

1. **Android がピッカー中に MainActivity を殺す**と `launchImageLibraryAsync` の Promise は
   解決も棄却もしない。expo-image-picker が用意している `getPendingResultAsync()` を
   このリポジトリはどこからも呼んでいなかったので、選択が黙って消えていた
2. 消えた状態で保存すると、旧実装は `avatar.uri === null` を **«削除して»** と解釈して
   `avatar_path: null` を送っていた（dev 2026-08-31 16:08:58 UTC に実物がある）。
   «そもそも持っていない» と «削除» が同じ値だったのが原因
3. 何が起きたかログに残らなかった。`hasAvatar: !!avatar` は `avatar` がオブジェクトなので
   **常に true**で、画像を選んだかどうかの手掛かりが 1 つも無かった

## ここが仕様

1. 画像欄に触らずに保存したら `avatar_path` を **送らない**（サーバの列を触らせない）
2. 画像を選んで保存したら、アップロードしてそのパスを送る
3. Android の保留結果を復帰できたら、«選んだ» のと同じ扱いにする

⚠️ 1 が赤くなったら «保存しただけでアバターが消える» に戻っている。
*/
import React, { act } from "react";
import TestRenderer from "react-test-renderer";

const mockLogFrontendEvent = jest.fn();
const mockShowSnackbar = jest.fn();
const mockCallBackend = jest.fn();
const mockUploadFile = jest.fn();
const mockSelectMedia = jest.fn();
const mockRecoverPendingMedia = jest.fn();

jest.mock("@/hooks/useHaptics", () => ({
	useHaptics: () => ({ lightImpact: jest.fn(), mediumImpact: jest.fn() }),
}));
jest.mock("@/hooks/useLogger", () => ({
	useLogger: () => ({ logFrontendEvent: (event: unknown) => mockLogFrontendEvent(event) }),
}));
jest.mock("@/contexts/SnackbarProvider", () => ({
	useSnackbar: () => ({ showSnackbar: (message: string) => mockShowSnackbar(message) }),
}));
jest.mock("@/lib/i18n", () => ({ __esModule: true, default: { t: (key: string) => key } }));
jest.mock("@/hooks/useAPICall", () => ({ useAPICall: () => ({ callBackend: mockCallBackend }) }));
jest.mock("@/hooks/useFileUploader", () => ({ useFileUploader: () => ({ uploadFile: mockUploadFile }) }));
jest.mock("@/lib/mediaSelection", () => ({
	selectMedia: (...args: unknown[]) => mockSelectMedia(...args),
	recoverPendingMedia: (...args: unknown[]) => mockRecoverPendingMedia(...args),
}));
jest.mock("react-native-safe-area-context", () => ({
	useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
	useSafeAreaFrame: () => ({ x: 0, y: 0, width: 390, height: 844 }),
}));

import { ProfileEditForm } from "@/features/profile/components/ProfileEditForm";
import { useProfileStore } from "@/features/profile/stores/useProfileStore";
import type { UserProfile } from "@shared/api/v1/res";

const PROFILE = {
	id: "user-1",
	username: "user-1",
	display_name: "あやと",
	avatar_path: null,
	bio: null,
} as unknown as UserProfile;

/**
 * 保存ボタンを押す。
 *
 * ⚠️ `findAllByType(PrimaryButton)` では引けない（memo でラップされており、
 * テスト側の import と要素の type が一致しない）。props で引くこと。
 */
const pressSave = async (tree: TestRenderer.ReactTestRenderer) => {
	const button = tree.root.findAll(
		(n) => n.props?.label === "Common.save" && typeof n.props?.onPress === "function",
	)[0];
	if (!button) throw new Error("save button not found");
	await act(async () => {
		await button.props.onPress();
	});
};

/** 画像を選んだことにする（ピッカーは開かず、カードのコールバックを直接叩く） */
const pickImage = async (tree: TestRenderer.ReactTestRenderer, media: { uri: string; mimeType: string }) => {
	const card = tree.root.findAll((n) => typeof n.props?.onSelectImage === "function")[0];
	if (!card) throw new Error("avatar card not found");
	await act(async () => {
		card.props.onSelectImage(media);
	});
};

const renderForm = async () => {
	let tree!: TestRenderer.ReactTestRenderer;
	await act(async () => {
		tree = TestRenderer.create(<ProfileEditForm onSaved={jest.fn()} />);
	});
	return tree;
};

const savedDto = () => mockCallBackend.mock.calls.at(-1)?.[1]?.requestPayload;

beforeEach(() => {
	useProfileStore.setState({ profile: PROFILE });
	mockCallBackend.mockResolvedValue({ ...PROFILE });
	mockUploadFile.mockResolvedValue("development/user-uploads/user-1/image-jpeg/1_user-avatar.jpg");
	mockRecoverPendingMedia.mockResolvedValue(null);
});

describe("プロフィール編集のアバター保存", () => {
	it("画像欄に触らずに保存すると avatar_path を送らない（= サーバのアバターを消さない）", async () => {
		const tree = await renderForm();
		await pressSave(tree);

		expect(mockUploadFile).not.toHaveBeenCalled();
		// ⚠️ `toBeNull()` にしないこと。null は «削除して» の意味になる
		expect(savedDto()).toHaveProperty("avatar_path", undefined);
		expect(savedDto()?.display_name).toBe("あやと");
	});

	it("画像を選んで保存すると、アップロードしたパスを送る", async () => {
		const tree = await renderForm();
		await pickImage(tree, { uri: "file:///tmp/a.jpg", mimeType: "image/jpeg" });
		await pressSave(tree);

		expect(mockUploadFile).toHaveBeenCalledWith(
			"file:///tmp/a.jpg",
			expect.objectContaining({ mimeType: "image/jpeg", baseFileName: "user-avatar" }),
		);
		expect(savedDto()?.avatar_path).toBe("development/user-uploads/user-1/image-jpeg/1_user-avatar.jpg");
	});

	it("mimeType が空でも保存を中断せず、アップロードまで進む", async () => {
		const tree = await renderForm();
		await pickImage(tree, { uri: "file:///tmp/a.jpg", mimeType: "" });
		await pressSave(tree);

		expect(mockUploadFile).toHaveBeenCalled();
		expect(mockCallBackend).toHaveBeenCalled();
	});

	it("アップロードに失敗しても、押し直せる（多重実行ガードが戻る）", async () => {
		const tree = await renderForm();
		await pickImage(tree, { uri: "file:///tmp/a.jpg", mimeType: "image/jpeg" });

		mockUploadFile.mockRejectedValueOnce(new Error("boom"));
		await pressSave(tree);
		expect(mockCallBackend).not.toHaveBeenCalled();

		await pressSave(tree);
		expect(mockUploadFile).toHaveBeenCalledTimes(2);
		expect(mockCallBackend).toHaveBeenCalledTimes(1);
	});

	it("Android の保留結果を復帰できたら «選んだ» のと同じ扱いになる", async () => {
		mockRecoverPendingMedia.mockResolvedValue({
			success: true,
			media: { type: "image", uri: "file:///tmp/recovered.jpg", mimeType: "image/jpeg" },
		});

		const tree = await renderForm();
		await pressSave(tree);

		// ⚠️ 持ち主を指定せずに拾いに行くと、料理写真として選んだものがアバターに入る
		expect(mockRecoverPendingMedia).toHaveBeenCalledWith({ owner: "profile-avatar" });

		expect(mockUploadFile).toHaveBeenCalledWith("file:///tmp/recovered.jpg", expect.anything());
		expect(savedDto()?.avatar_path).toBe("development/user-uploads/user-1/image-jpeg/1_user-avatar.jpg");
	});

	it("保存ログから «画像を付けたか» が読める（旧実装は常に true だった）", async () => {
		const tree = await renderForm();
		await pressSave(tree);

		const saved = mockLogFrontendEvent.mock.calls.map((c) => c[0]).find((e) => e.event_name === "profile_edit_saved");
		expect(saved?.payload).toMatchObject({ avatarAction: "unchanged", hasAvatar: false });
	});
});
