/*
#1513 墓標の «読めなさ» を赤で守る。

墓標は写真の代わりに出るので、そこに何が書いてあるか読めなければ意味が無い。
アイコンだけの variant（カレンダーのセル・地図のピン・通知のサムネイル枠）では、
**そのアイコンが «削除された» を伝える唯一の手掛かり**である。

実際、最初の実装は文字 `textSecondary` / アイコン `textTertiary` で組んでいて、
ライトでは 4.39:1 / 2.31:1 と WCAG を割っていた（エビデンスを撮って測って気づいた）。
淡いトークンへ「見た目が上品だから」と戻すと同じことが起きるので、ここで数値を固定する。

必要値:
- 文字 10pt = «小さい文字» なので AA は 4.5:1（WCAG 1.4.3）
- アイコンは非文字のグラフィック要素なので 3:1（WCAG 1.4.11）
*/
import { Palettes } from "@/constants/Palette";

/** WCAG 2.x の相対輝度 */
const luminance = (hex: string): number => {
	const h = hex.replace("#", "");
	const channels = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
	const linear = channels.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
	return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
};

const contrast = (a: string, b: string): number => {
	const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
	return (hi + 0.05) / (lo + 0.05);
};

describe.each(["light", "dark"] as const)("#1513 墓標のコントラスト（%s）", (scheme) => {
	const colors = Palettes[scheme];
	// DeletedMediaTombstone.tsx の createStyles と同じ組み合わせ
	const surface = colors.divider;

	it("文字は 4.5:1 以上（AA・10pt = 小さい文字）", () => {
		expect(contrast(colors.textSecondaryAlt, surface)).toBeGreaterThanOrEqual(4.5);
	});

	it("アイコンは 3:1 以上（WCAG 1.4.11 非文字のグラフィック）", () => {
		expect(contrast(colors.textSecondary, surface)).toBeGreaterThanOrEqual(3);
	});
});
