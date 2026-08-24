/*
#1513 «墓標（削除されました）» のエビデンス。

削除済みの投稿が混ざった いいね一覧 / 通知一覧 を、ライト・ダークの両方で撮る。
撮りたいのは 3 点で、そのすべてが 1 枚に写る:
  1. 行が消えていない（削除済みも一覧に残っている）
  2. 写真の代わりに墓標が出ている（別の絵へフォールバックしていない）
  3. 生きている投稿は従来どおり写真が出る（＝全部が墓標になっていない）

「押せない」ことは絵に写らないので、赤で守るのは
features/profile/tabs/LikeTab.tombstone.test.tsx と __tests__/notificationsTombstone.test.tsx。

⚠️ API はモックである。映っているのは «画面» であって実データではない。
*/
import { record, ok, solidCard, writeNote, OUT } from "./harness.mjs";

const IMG = `data:image/svg+xml;base64,${Buffer.from(solidCard("F05537")).toString("base64")}`;
const AVATAR = `data:image/svg+xml;base64,${Buffer.from(solidCard("5856D6")).toString("base64")}`;

const restaurant = {
	id: "restaurant-1",
	name: "エビデンス食堂",
	image_url: IMG,
	latitude: 35.0,
	longitude: 139.0,
};

/** 削除済みの dish_media は mediaUrl / thumbnailImageUrl が null で返る（API 側 62b05622） */
const entry = (id, { deleted }) => ({
	restaurant,
	dish: {
		id: `dish-${id}`,
		name: deleted ? "削除した投稿" : "生きている投稿",
		restaurant_id: "restaurant-1",
		category_id: null,
		reviewCount: 7,
		averageRating: 4.2,
		// 「跡地に別の絵」が入らないことを見たいので、フォールバック先は敢えて用意しておく
		categoryImageUrl: IMG,
	},
	dish_media: {
		id,
		dish_id: `dish-${id}`,
		user_id: "11111111-1111-1111-1111-111111111111",
		media_path: "x",
		media_type: "image",
		thumbnail_path: "x",
		created_at: "2026-08-20T00:00:00.000Z",
		deleted_at: deleted ? "2026-08-21T00:00:00.000Z" : null,
		isMine: true,
		isSaved: false,
		isLiked: true,
		likeCount: 3,
		mediaUrl: deleted ? null : IMG,
		thumbnailImageUrl: deleted ? null : IMG,
	},
	dish_reviews: [],
});

// 削除済みと生存を混ぜる。全部墓標だと「全滅しているだけ」と見分けが付かない
const LIKED = [
	entry("media-deleted-1", { deleted: true }),
	entry("media-alive-1", { deleted: false }),
	entry("media-deleted-2", { deleted: true }),
	entry("media-alive-2", { deleted: false }),
];

const notification = (id, actionType, deleted) => ({
	notification: {
		id,
		user_id: "11111111-1111-1111-1111-111111111111",
		target_table: "dish_media",
		target_id: deleted ? "media-deleted-1" : "media-alive-1",
		action_type: actionType,
		created_at: "2026-08-21T00:00:00.000Z",
		updated_at: "2026-08-21T00:00:00.000Z",
	},
	actors: [{ id: "actor-1", display_name: "テス太", avatarUrls: { sm: AVATAR, md: AVATAR, lg: AVATAR } }],
	dishMediaEntries: deleted ? LIKED[0] : LIKED[1],
});

const NOTIFICATIONS = [
	notification("notif-1", "like", true),
	notification("notif-2", "save", false),
	notification("notif-3", "like", true),
];

const mock = (url) => {
	if (url.includes("liked-dish-media")) return { body: ok({ data: LIKED, nextCursor: null }) };
	if (url.includes("/v1/notifications/unread-count")) return { body: ok({ unread: 2 }) };
	if (url.includes("/v1/notifications/mark-all-read"))
		return { body: ok({ lastReadAt: "2026-08-21T00:00:00.000Z" }) };
	if (url.includes("/v1/notifications")) return { body: ok({ data: NOTIFICATIONS, nextCursor: null }) };
	return null;
};

const flow = async (page, shot) => {
	await page.goto(`${process.env.EVIDENCE_BASE || "http://localhost:8788"}/ja-JP/profile/liked`);
	await page.waitForTimeout(4000);
	await shot("01-liked");

	await page.goto(`${process.env.EVIDENCE_BASE || "http://localhost:8788"}/ja-JP/notifications`);
	await page.waitForTimeout(4000);
	await shot("02-notifications");
};

for (const scheme of ["light", "dark"]) {
	await record({
		name: `tombstone-1513-${scheme}`,
		mock,
		// 設定は "system" のままなので、OS のスキームがそのまま解決結果になる
		// （contexts/ThemeProvider.ts の resolveScheme）
		contextOptions: { colorScheme: scheme },
		flow,
	});
}

await writeNote("tombstone-1513", [
	"# #1513 墓標（削除されました）のエビデンス",
	"",
	"- 01-liked … いいね一覧。1・3 枚目が削除済み（墓標）、2・4 枚目は生存（写真）",
	"- 02-notifications … 通知一覧。1・3 行目が削除済み（サムネイル位置が墓標）、2 行目は生存",
	"- light / dark の 2 セット",
	"",
	"⚠️ 認証・API・地図はすべてモック。映っているのは «画面» であって実データではない。",
	"「押せない」ことは絵に写らないため、LikeTab.tombstone.test.tsx /",
	"notificationsTombstone.test.tsx で赤に落として守っている。",
	"",
	`出力先: ${OUT}`,
]);
