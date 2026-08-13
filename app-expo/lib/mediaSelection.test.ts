// #1156 【設計】iOS のフォトピッカーが HEIC を返してしまう回帰を赤で守るテスト。
//
// 背景（#1156 実機確認）:
// `launchImageLibraryAsync` の `preferredAssetRepresentationMode` は既定が `Automatic` で、
// iOS はこのとき端末が撮った写真を **HEIC のまま**返す。HEIC は API 側の EXTENSION_TABLE
// （api/src/core/storage/storage.utils.ts）に無いため `getExt()` が "bin" を返し、
// `..._media.bin` という名前で GCS へ上がる。**アップロード自体は HTTP 200 で成功する**ので
// UI 上は投稿できたように見えるが、後段の resize（sharp → webp）がデコードできず
// `media_processing_status = "failed"` になり、フィードには
// 「このメディアは現在ご利用いただけません」とだけ表示される。
//
// 実測（dev の frontend_event_logs, 2026-08-07 17:55:48）:
//   mimeType "image/heic" / objectPath ".../image-heic/..._media.bin"
//
// ## なぜ E2E ではなくユニットテストなのか
// E2E（Detox）は `lib/e2e/selectMediaStub.ts` が OS のピッカーを迂回して固定画像を返す。
// ピッカーはアプリ外プロセスで動き Detox から操作できないためで、**実ピッカーの
// 表現モードは E2E では原理的に踏めない**。したがってこの不変条件はここで固定する。
import * as ImagePicker from "expo-image-picker";

import { selectMedia } from "@/lib/mediaSelection";

jest.mock("expo-image-picker", () => ({
	launchImageLibraryAsync: jest.fn(),
	requestMediaLibraryPermissionsAsync: jest.fn(),
	VideoExportPreset: { Passthrough: "Passthrough" },
	UIImagePickerPreferredAssetRepresentationMode: {
		Automatic: "automatic",
		Compatible: "compatible",
		Current: "current",
	},
}));

// サムネイル生成は画像では走らないが、import 時に native module を触らせないためスタブ化する
jest.mock("expo-video-thumbnails", () => ({ getThumbnailAsync: jest.fn() }));

// E2E スタブは通常ビルドでは metro の resolver が noop へ差し替える。
// jest は resolver を通らないので、ここで明示的に「素通り（null）」へ寄せる。
jest.mock("@/lib/e2e/selectMediaStub", () => ({ selectMediaForE2E: jest.fn(async () => null) }));

const mockedPicker = ImagePicker as jest.Mocked<typeof ImagePicker>;

describe("selectMedia", () => {
	beforeEach(() => {
		mockedPicker.requestMediaLibraryPermissionsAsync.mockResolvedValue({
			status: "granted",
		} as never);
		mockedPicker.launchImageLibraryAsync.mockResolvedValue({
			canceled: false,
			assets: [
				{
					uri: "file:///tmp/photo.jpg",
					width: 100,
					height: 100,
					mimeType: "image/jpeg",
					type: "image",
				},
			],
		} as never);
	});

	// ─ テストケース: iOS のフォトピッカーへ「互換表現」を要求する ─
	// これが Automatic に戻ると、iOS は HEIC をそのまま返し、投稿は成功したように見えて
	// サーバ側のメディア処理だけが落ちる（＝ ユーザーからは「このメディアは現在ご利用いただけません」）。
	it("フォトピッカーへ互換表現（HEIC ではなく JPEG）を要求する", async () => {
		await selectMedia(["images"]);

		expect(mockedPicker.launchImageLibraryAsync).toHaveBeenCalledTimes(1);

		const options = mockedPicker.launchImageLibraryAsync.mock.calls[0][0];
		expect(options?.preferredAssetRepresentationMode).toBe(
			ImagePicker.UIImagePickerPreferredAssetRepresentationMode.Compatible,
		);
	});

	// ─ テストケース: 選んだアセットの mimeType がそのまま伝わる ─
	// アップロード先のオブジェクト拡張子は API 側がこの mimeType から決める。
	// ここが取りこぼされると、上と同じ「拡張子 .bin で上がって処理が落ちる」経路に戻る。
	it("選択したアセットの mimeType をそのまま返す", async () => {
		const result = await selectMedia(["images"]);

		expect(result.success).toBe(true);
		expect(result.media?.mimeType).toBe("image/jpeg");
	});
});
