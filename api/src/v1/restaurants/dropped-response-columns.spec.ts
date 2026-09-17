import { RestaurantsAssembler } from './restaurants.assembler';
import { stripDroppedRestaurantColumns } from '@shared/v1/res';
import type { PrismaRestaurants } from '../../../../shared/converters/convert_restaurants';
import type { StorageService } from '../../core/storage/storage.service';

/**
 * #1779 **落とすと決めた列を、API のレスポンスへ二度と載せない。**
 *
 * ## 何を守るテストか
 *
 * `image_url` / `plus_code` は DB から削除する列である。型を `Omit` にしただけでは
 * **実行時には残る**（スプレッドは余剰プロパティ検査をすり抜ける）。
 * 実際 `restaurants.assembler.ts` は `{ ...supabaseRestaurants, imageUrls }` を
 * 返しており、`Omit` を入れただけの時点では 2 列とも JSON に載ったままだった。
 *
 * ⚠️ 個別の列名ではなく **«落とす列の一覧に載っているものは出ない»** を固定する。
 *    次に列を足したときも、一覧へ足すだけでこのテストが効く。
 */
describe('#1779 落とす列はレスポンスへ載らない', () => {
  const storage = {
    generateCdnSignedURL: (url: string) => `${url}?signed=1`,
  } as unknown as StorageService;

  const assembler = new RestaurantsAssembler(storage);

  /** DB から来る行を模す。**落とす列にわざと値を入れる**（素通ししたら赤くなる） */
  const rowFromDb = () =>
    ({
      id: 'rest-1',
      google_place_id: 'place-1',
      name: 'エビデンス用ラーメン',
      name_language_code: 'ja',
      latitude: 35,
      longitude: 139,
      image_url: 'https://lh3.googleusercontent.com/places/legacy.jpg',
      image_path: 'dev/restaurants/image_path/rest-1/orig.jpg',
      address_components: null,
      plus_code: { globalCode: '8Q7XMQ4V+9G' },
      created_at: new Date('2026-01-01T00:00:00Z'),
    }) as unknown as PrismaRestaurants;

  const DROPPED = ['image_url', 'plus_code'] as const;

  it.each(DROPPED)('assembler の出力に `%s` が現れない', (column) => {
    const entity = assembler.enrichRestaurantsWithImageUrls(rowFromDb());

    expect(Object.keys(entity)).not.toContain(column);
    expect(JSON.stringify(entity)).not.toContain(column);
  });

  it('残す列と imageUrls は消えない（消しすぎの検知）', () => {
    const entity = assembler.enrichRestaurantsWithImageUrls(rowFromDb());

    expect(entity.id).toBe('rest-1');
    expect(entity.name).toBe('エビデンス用ラーメン');
    expect(entity.address_components).toBeNull();
    expect(entity.imageUrls?.sm).toContain('signed=1');
  });

  it.each(DROPPED)(
    'stripDroppedRestaurantColumns が `%s` を取り除く',
    (column) => {
      const stripped = stripDroppedRestaurantColumns({
        id: 'rest-1',
        image_url: 'https://example.invalid/x.jpg',
        plus_code: { globalCode: '8Q7XMQ4V+9G' },
      });

      expect(Object.keys(stripped)).not.toContain(column);
      expect(Object.keys(stripped)).toContain('id');
    },
  );

  it('列が既に無いオブジェクトへ当てても壊れない（削除後もそのまま使える）', () => {
    // DB から列が落ちたあとの行を模す。無いキーの delete は no-op であること
    expect(stripDroppedRestaurantColumns({ id: 'rest-1' })).toEqual({
      id: 'rest-1',
    });
  });

  it('元のオブジェクトは書き換えない（呼び出し元が持つ行を壊さない）', () => {
    const row = { id: 'rest-1', image_url: 'https://example.invalid/x.jpg' };
    stripDroppedRestaurantColumns(row);

    expect(row.image_url).toBe('https://example.invalid/x.jpg');
  });
});
