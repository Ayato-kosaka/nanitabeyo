/*
#1375（9 巡目・オーナー指摘「リストにインスタマークが欲しい（インスタのサムネだったら）」）
**SNS provider のロゴを 1 箇所に置く。**

取り込み画面（`app/[locale]/add-record.tsx`）が持っていた対応表を、一覧のサムネイルからも
使えるようにここへ移した。同じ provider に別のロゴが出る状態を作らないための集約である。

⚠️ lucide に TikTok の公式グリフは無いので音符（`Music2`）で代用している。
⚠️ 未知の provider は `Link2`（汎用リンク）へ落とす。**フォールバックを外さないこと。**
   サーバーが将来 provider を増やしたときに、ここで `undefined` を描いて落ちる。
*/
import { Instagram, Link2, Music2, Youtube } from "lucide-react-native";
import type { SnsProvider } from "@shared/utils/snsUrl";

export const PROVIDER_LABELS: Record<SnsProvider, string> = {
	instagram: "Instagram",
	tiktok: "TikTok",
	youtube: "YouTube Shorts",
};

export const PROVIDER_ICONS: Record<SnsProvider, typeof Instagram> = {
	instagram: Instagram,
	tiktok: Music2,
	youtube: Youtube,
};

/** provider 文字列（サーバー由来なので何が来るか保証が無い）→ ロゴ。未知なら汎用リンク */
export const resolveProviderIcon = (provider: string | null | undefined): typeof Instagram =>
	(provider && PROVIDER_ICONS[provider as SnsProvider]) || Link2;

/** provider 文字列 → 表示名。未知ならその文字列自身（空なら null） */
export const resolveProviderLabel = (provider: string | null | undefined): string | null =>
	provider ? (PROVIDER_LABELS[provider as SnsProvider] ?? provider) : null;
