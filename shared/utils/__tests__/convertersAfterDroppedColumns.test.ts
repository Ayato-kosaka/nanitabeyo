/**
 * #1779 **落とす列が DB から消えたあとも converters が動くこと**を固定する。
 *
 * `infra/supabase/migrations/README.md` は「手で追従させるのは `shared/converters/` だけ」
 * と決めている。ところが converters は生成型（`TableRow` / `Prisma...GroupByOutputType`）を
 * そのまま引数に取っていたため、**列が落ちた瞬間に型が合わなくなる**形だった。
 *
 * ⚠️ **型を緩めただけでは «落ちたあと» を試していない。** 実行時にキーが無いオブジェクトを
 * 渡して、既定値へ落ちることまで見る。ここが無いと、contract migration を当てた直後に
 * `undefined` が DB へ流れる（`address_components` は `JSONB NOT NULL`）。
 *
 * 落とす列（#1779）:
 *   restaurants … image_url / plus_code / address_components
 *   dishes      … name / data_origin
 */
import { test } from "node:test";
import assert from "node:assert/strict";

import { convertSupabaseToPrisma_Restaurants } from "../../converters/convert_restaurants";
import { convertSupabaseToPrisma_Dishes, convertPrismaToSupabase_Dishes } from "../../converters/convert_dishes";

/** restaurants の «落とす列を 1 つも持たない» 行。migration 後の世界を模す */
const restaurantWithoutDroppedColumns = {
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

test("#1779 restaurants: 落とす 3 列が無くても変換できる", () => {
	const prisma = convertSupabaseToPrisma_Restaurants(restaurantWithoutDroppedColumns as never);

	// ⚠️ `undefined` を返してはいけない。address_components は JSONB NOT NULL で、
	//    そのまま INSERT すると落ちる
	assert.deepEqual(prisma.address_components, []);
	assert.equal(prisma.image_url, "");
	assert.equal(prisma.plus_code, null);
	// 残す列は素通しであること（消しすぎの検知）
	assert.equal(prisma.name, "エビデンス用ラーメン");
	assert.equal(prisma.address, "東京都千代田区");
	assert.equal(prisma.country_code, "JP");
});

test("#1779 restaurants: 列があるときは値をそのまま使う（既定値で潰さない）", () => {
	const prisma = convertSupabaseToPrisma_Restaurants({
		...restaurantWithoutDroppedColumns,
		image_url: "https://example.test/a.jpg",
		plus_code: { globalCode: "8Q7XMQ4V+9G" },
		address_components: [{ types: ["country"], shortText: "JP" }],
	} as never);

	assert.equal(prisma.image_url, "https://example.test/a.jpg");
	assert.deepEqual(prisma.plus_code, { globalCode: "8Q7XMQ4V+9G" });
	assert.deepEqual(prisma.address_components, [{ types: ["country"], shortText: "JP" }]);
});

/** dishes の «落とす列を 1 つも持たない» 行 */
const dishWithoutDroppedColumns = {
	id: "22222222-2222-2222-2222-222222222222",
	restaurant_id: "11111111-1111-1111-1111-111111111111",
	category_id: "33333333-3333-3333-3333-333333333333",
	created_at: "2026-09-24T00:00:00.000Z",
	updated_at: "2026-09-24T00:00:00.000Z",
	lock_no: 0,
	synced_at: null,
};

test("#1779 dishes: 落とす 2 列が無くても変換できる（両方向）", () => {
	const prisma = convertSupabaseToPrisma_Dishes(dishWithoutDroppedColumns as never);
	assert.equal(prisma.name, null);
	// DB 側の DEFAULT と同じ値へ落ちること（列が残っている間の INSERT を壊さない）
	assert.equal(prisma.data_origin, "user_or_google");
	assert.equal(prisma.lock_no, 0);

	const supabase = convertPrismaToSupabase_Dishes({
		...dishWithoutDroppedColumns,
		created_at: new Date("2026-09-24T00:00:00.000Z"),
		updated_at: new Date("2026-09-24T00:00:00.000Z"),
		synced_at: null,
	} as never);
	assert.equal(supabase.name, null);
	assert.equal(supabase.data_origin, "user_or_google");
});
