/**
 * #1779 **落とした列が converters の出力に «復活していない» こと**を固定する。
 *
 * ## 経緯（このテストは 1 度書き直している）
 *
 * 最初の版は «列が落ちたあとも既定値（`''` / `null` / `[]`）へ落ちること» を縛っていた。
 * それは **列がまだ DB にある間**の不変条件で、`address_components` が `JSONB NOT NULL`
 * だったため `undefined` を流さないことに意味があった。
 *
 * **2026-09-24 に列を実際に dev から削除した**（migration
 * `20260924T0100_drop_google_derived_columns.sql` / run 35990341765）。
 * もう列は存在しないので、正しい不変条件は逆になる:
 *
 * > **落とした列のキーを出力に含めてはいけない。**
 *
 * 含めると、`INSERT` / `UPDATE` が存在しない列を指定して落ちる。
 *
 * ⚠️ このとき `DROPPED_COLUMNS` を `keyof` の制約に使う型（`Omit` + `Partial<Pick<…>>`）が
 *    `TS2344` で落ちた。**列が消えた瞬間に壊れる形**だったので、型から名前ごと消した。
 *
 * 落とした列:
 *   restaurants … image_url / plus_code / address_components
 *   dishes      … name / data_origin
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import {
	convertSupabaseToPrisma_Restaurants,
	convertPrismaToSupabase_Restaurants,
} from "../../converters/convert_restaurants";
import { convertSupabaseToPrisma_Dishes, convertPrismaToSupabase_Dishes } from "../../converters/convert_dishes";

const RESTAURANT_DROPPED = ["image_url", "plus_code", "address_components"] as const;
const DISH_DROPPED = ["name", "data_origin"] as const;

/** migration 適用後の restaurants の行（落とした列は存在しない） */
const restaurantRow = {
	id: "11111111-1111-1111-1111-111111111111",
	google_place_id: "place-1",
	name: "エビデンス用ラーメン",
	name_language_code: "ja",
	latitude: 35.681,
	longitude: 139.767,
	location: null,
	image_path: "dev/restaurants/image_path/rest-1/orig.jpg",
	created_by_source: "pipeline",
	address: "東京都千代田区",
	country_code: "JP",
	subterritory_code: null,
	created_at: "2026-09-24T00:00:00.000Z",
	source_seed_id: null,
	source_names: [],
	source_row_hash: null,
	synced_at: null,
};

test("#1779 restaurants: 落とした 3 列が出力に復活しない（Supabase → Prisma）", () => {
	const prisma = convertSupabaseToPrisma_Restaurants(restaurantRow as never) as Record<string, unknown>;
	for (const col of RESTAURANT_DROPPED) {
		assert.ok(!(col in prisma), `${col} が出力に復活している。存在しない列を INSERT して落ちる`);
	}
	// 残す列は素通しであること（消しすぎの検知）
	assert.equal(prisma.name, "エビデンス用ラーメン");
	assert.equal(prisma.address, "東京都千代田区");
	assert.equal(prisma.country_code, "JP");
	assert.equal(prisma.image_path, "dev/restaurants/image_path/rest-1/orig.jpg");
});

test("#1779 restaurants: 落とした 3 列が出力に復活しない（Prisma → Supabase）", () => {
	const supabase = convertPrismaToSupabase_Restaurants({
		...restaurantRow,
		created_at: new Date("2026-09-24T00:00:00.000Z"),
		synced_at: null,
	} as never) as Record<string, unknown>;
	for (const col of RESTAURANT_DROPPED) {
		assert.ok(!(col in supabase), `${col} が出力に復活している`);
	}
	assert.equal(supabase.country_code, "JP");
});

/** migration 適用後の dishes の行 */
const dishRow = {
	id: "22222222-2222-2222-2222-222222222222",
	restaurant_id: "11111111-1111-1111-1111-111111111111",
	category_id: "33333333-3333-3333-3333-333333333333",
	created_at: "2026-09-24T00:00:00.000Z",
	updated_at: "2026-09-24T00:00:00.000Z",
	lock_no: 0,
	synced_at: null,
};

test("#1779 dishes: 落とした 2 列が出力に復活しない（両方向）", () => {
	const prisma = convertSupabaseToPrisma_Dishes(dishRow as never) as Record<string, unknown>;
	for (const col of DISH_DROPPED) {
		assert.ok(!(col in prisma), `${col} が出力に復活している`);
	}
	assert.equal(prisma.lock_no, 0);

	const supabase = convertPrismaToSupabase_Dishes({
		...dishRow,
		created_at: new Date("2026-09-24T00:00:00.000Z"),
		updated_at: new Date("2026-09-24T00:00:00.000Z"),
		synced_at: null,
	} as never) as Record<string, unknown>;
	for (const col of DISH_DROPPED) {
		assert.ok(!(col in supabase), `${col} が出力に復活している`);
	}
});

test("#1779 生成型に落とした列が残っていないこと（DB と型のずれの検知）", () => {
	// ⚠️ converters を直すだけでなく **生成型そのもの**を見る。introspect が古いまま
	//    main へ入ると、型にはある / DB には無い というずれが静かに残る。
	const types = require("node:fs").readFileSync(
		require("node:path").join(__dirname, "..", "..", "supabase", "database.types.ts"),
		"utf8",
	) as string;
	const restaurants = /\n {6}restaurants: \{\n {8}Row: \{\n([\s\S]*?)\n {8}\}\n/.exec(types);
	assert.ok(restaurants, "restaurants の Row 定義が見つからない");
	for (const col of RESTAURANT_DROPPED) {
		assert.ok(
			!new RegExp(`^\\s+${col}\\??:`, "m").test(restaurants[1]),
			`database.types.ts の restaurants に ${col} が残っている（introspect が古い）`,
		);
	}
});
