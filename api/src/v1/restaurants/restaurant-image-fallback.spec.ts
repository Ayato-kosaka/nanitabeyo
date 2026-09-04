import { RestaurantsAssembler } from './restaurants.assembler';
import type { PrismaRestaurants } from '../../../../shared/converters/convert_restaurants';
import type { StorageService } from '../../core/storage/storage.service';

/**
 * #1780 【完了条件 4】**画像が無い店でも空の枠にしない。**
 *
 * #1793 で Google の写真を自社 Storage へ複製するのをやめたので、これ以降に作られる
 * 店の `restaurants.image_path` は必ず null になる。`imageUrls` は `image_path` を
 * 持つ行にだけ付いていたため、**新しく作られた店は全部 «画像なし»** になり、
 * 店詳細・店名検索・保存済み店・地図ピンが空の枠を描いていた。
 *
 * オーナー確定仕様（#1780 の 2026-09-02 判断ログ）:
 * > 店舗画像は `dish_media` のサムネイルから出す。
 */
describe('#1780 店の代表画像のフォールバック', () => {
  const storage = {
    generateCdnSignedURL: (url: string) => `${url}?signed=1`,
  } as unknown as StorageService;

  const assembler = new RestaurantsAssembler(storage);

  const restaurant = (overrides: Partial<PrismaRestaurants> = {}) =>
    ({
      id: 'rest-1',
      google_place_id: 'place-1',
      name: 'エビデンス用ラーメン',
      name_language_code: 'ja',
      latitude: 35,
      longitude: 139,
      image_url: '',
      image_path: null,
      address_components: null,
      plus_code: null,
      created_at: new Date('2026-01-01T00:00:00Z'),
      ...overrides,
    }) as unknown as PrismaRestaurants;

  const thumbnail = (overrides: Record<string, unknown> = {}) => ({
    id: 'media-1',
    thumbnail_path: 'dev/dish_media/thumbnail_path/media-1/thumb.jpg',
    thumbnail_processing_status: 'completed',
    ...overrides,
  });

  it('image_path が無い店は dish_media のサムネイルを顔にする', () => {
    const result = assembler.enrichRestaurantsWithImageUrls(
      restaurant(),
      thumbnail(),
    );

    expect(result.imageUrls).toBeDefined();
    expect(result.imageUrls!.md).toContain('/resized-image/dish_media/');
    expect(result.imageUrls!.md).toContain('/256.webp');
  });

  /*
  ⚠️ dish_media の派生サイズは 256 の 1 本しか焼いていない
     （`dish-media.service.ts` が enqueue するのがそれだけ）。64 を組み立てると
     実体が無く 404 になるので、sm にも 256 を入れている。
     ここを «契約どおり 64 にしよう» と直すと、画像が出なくなる。
  */
  it('sm も 256 を指す（64 の実体は焼かれていない）', () => {
    const result = assembler.enrichRestaurantsWithImageUrls(
      restaurant(),
      thumbnail(),
    );

    expect(result.imageUrls!.sm).toBe(result.imageUrls!.md);
    expect(result.imageUrls!.sm).not.toContain('/64.webp');
  });

  it('image_path を持つ店は従来どおりそちらが優先される', () => {
    const result = assembler.enrichRestaurantsWithImageUrls(
      restaurant({ image_path: 'dev/restaurants/image_path/rest-1/a.jpg' }),
      thumbnail(),
    );

    expect(result.imageUrls!.md).toContain('/resized-image/restaurants/');
    expect(result.imageUrls!.sm).toContain('/64.webp');
  });

  it('代替も無ければ imageUrls は付かない（表示側が placeholder を出す）', () => {
    const result = assembler.enrichRestaurantsWithImageUrls(restaurant());

    expect(result.imageUrls).toBeUndefined();
  });

  /*
  #1399 SNS 取り込み（render_type='external_embed'）は自ストレージにサムネイルを
  持たず `thumbnail_path: ''` で作られる。guard を外すと `buildResizedPath` が
  `Invalid originalPath` を throw し、その店を含む一覧が丸ごと 500 になる。
  */
  it('thumbnail_path が空の行が渡っても throw せず imageUrls を付けない', () => {
    const result = assembler.enrichRestaurantsWithImageUrls(
      restaurant(),
      thumbnail({ thumbnail_path: '' }),
    );

    expect(result.imageUrls).toBeUndefined();
  });

  it('リサイズ未完了の行はオリジナルパスを指す（#511 の規則をそのまま使う）', () => {
    const result = assembler.enrichRestaurantsWithImageUrls(
      restaurant(),
      thumbnail({ thumbnail_processing_status: 'processing' }),
    );

    expect(result.imageUrls!.md).toContain('/thumb.jpg');
    expect(result.imageUrls!.md).not.toContain('/resized-image/');
  });
});
