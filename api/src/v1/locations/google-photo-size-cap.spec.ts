import { LocationsService } from './locations.service';

/**
 * #819 【設計】**Google へ «表示に要る分» までしか頼まない。**
 *
 * 本番 30 日の実測（`PhotoMediaSuccess` n=6,045 / 2026-08-25〜09-24）で、要求幅の
 * 中央値は **3,024px**、3,000px 以上が 68.6% だった。一方アプリが表示する最大は
 * **1,024px**（`dish-media.assembler.ts` の size 1024 派生 / サムネイルは 256）。
 * つまり原寸で取った分は 1 度も表示されない。
 *
 * さらに bulk-import の同期レスポンスは、リサイズが焼き上がる前に **その原寸の
 * Google URI を `thumbnailImageUrl` として返す**ので、店舗選択画面が並べる
 * «サムネイル» が 3,024px の JPEG だった（#819 の症状そのもの）。
 *
 * ここで縛るのは 3 つ。
 *
 * 1. **縮める方向だけに使う**（既に小さい写真は原寸のまま通す）。
 *    ⚠️ #429 が記録した 400 は «原寸を超えるな» ではなく
 *    «`max_width_px` は原寸と **一致** しなければならない» だった。現在の公式
 *    ドキュメントは 1〜4800 の任意の整数を許しており一致要求は無いが、万一
 *    生きていた場合の保険は下の describe で縛る
 * 2. **短辺で切る**。長辺だけで切ると横長のパノラマで短辺が 1,024 を割り、
 *    フルスクリーン派生が拡大になる
 * 3. **幅と高さの両方を返す**。`getPhotoMedia` は幅が無いときだけ高さを見るので、
 *    幅だけ縮めると «幅が分からない写真» が高さ原寸で素通りする
 */
describe('#819 Google の写真を原寸で頼まない', () => {
  /** 表示の最大。ここを割ると拡大になる */
  const LARGEST_DISPLAYED_PX = 1024;

  it('本番で最も多い 3024x4032（縦）は短辺 1280 まで縮む', () => {
    expect(LocationsService.cappedPhotoSize(3024, 4032)).toEqual({
      widthPx: 1280,
      heightPx: 1707,
    });
  });

  it('横向き 4032x3024 でも短辺が 1280 になる（長辺で切らない）', () => {
    const { widthPx, heightPx } = LocationsService.cappedPhotoSize(4032, 3024);
    expect(heightPx).toBe(1280);
    expect(widthPx).toBe(1707);
  });

  it('横長のパノラマ 4800x600 は縮めない（縮めると短辺が表示サイズを割る）', () => {
    expect(LocationsService.cappedPhotoSize(4800, 600)).toEqual({
      widthPx: 4800,
      heightPx: 600,
    });
  });

  it('既に小さい写真はそのまま（原寸より大きくは要求しない）', () => {
    // 既に小さい写真はそのまま
    expect(LocationsService.cappedPhotoSize(800, 600)).toEqual({
      widthPx: 800,
      heightPx: 600,
    });
    expect(LocationsService.cappedPhotoSize(1280, 1280)).toEqual({
      widthPx: 1280,
      heightPx: 1280,
    });
  });

  it('幅しか分からない写真も上限で切る', () => {
    expect(LocationsService.cappedPhotoSize(4032, null)).toEqual({
      widthPx: 1280,
    });
  });

  it('⚠️ 高さしか分からない写真も上限で切る（幅だけ縮めると素通りする）', () => {
    expect(LocationsService.cappedPhotoSize(null, 4032)).toEqual({
      heightPx: 1280,
    });
  });

  it('幅も高さも分からない写真は何も指定しない（getPhotoMedia の既定 1280 に任せる）', () => {
    expect(LocationsService.cappedPhotoSize(null, undefined)).toEqual({});
  });

  it('どの結果も、表示する最大（1024px）を下回らない', () => {
    const samples: [number, number][] = [
      [3024, 4032],
      [4032, 3024],
      [4800, 4800],
      [2160, 3840],
      [1080, 1920],
      [4800, 600],
    ];
    for (const [w, h] of samples) {
      const got = LocationsService.cappedPhotoSize(w, h);
      // 原寸が既に小さい辺はそのまま通るので、«原寸を下回らない» で判定する
      expect(Math.min(got.widthPx ?? w, got.heightPx ?? h)).toBeGreaterThanOrEqual(
        Math.min(LARGEST_DISPLAYED_PX, Math.min(w, h)),
      );
    }
  });
});

/**
 * #819 【設計】**上限つきの要求が失敗したら、同じ写真を原寸でもう 1 度試す。**
 *
 * #429（2025-11）は `maxWidthPx: 1280` に対して Google がこう返したと記録している。
 *
 * > max_width_px or max_height_px must match original width or height.
 *
 * 現在の公式ドキュメントは «1〜4800 の任意の整数» で原寸との一致を要求していないが、
 * **もし今も生きていたら全候補が 400 で落ち、`tryGetPhotoMedia` は `null` を返し、
 * `bulkImportFromGoogle` は «写真が無い» として店を丸ごと捨てる**。
 * ドキュメントを信じて静かに壊れるより、1 度だけ原寸へ落ちる。
 */
describe('#819 上限つきの要求が弾かれたときの保険', () => {
  const photo = { name: 'places/p/photos/x', widthPx: 3024, heightPx: 4032 };

  function build() {
    const getPhotoMedia = jest.fn();
    const logger = { debug: jest.fn(), warn: jest.fn(), error: jest.fn(), log: jest.fn() };
    const service = new LocationsService(
      logger as never,
      { getPhotoMedia } as never,
    );
    return { service, getPhotoMedia, logger };
  }

  it('上限つきが 400 になったら、同じ写真を原寸で 1 度だけやり直す', async () => {
    const { service, getPhotoMedia, logger } = build();
    getPhotoMedia
      .mockRejectedValueOnce(
        new Error('max_width_px or max_height_px must match original width or height.'),
      )
      .mockResolvedValueOnce({ photoUri: 'https://example.test/original.jpg' });

    await expect(service.tryGetPhotoMedia([photo] as never)).resolves.toEqual({
      photoUri: 'https://example.test/original.jpg',
    });

    expect(getPhotoMedia).toHaveBeenCalledTimes(2);
    // 1 回目は上限つき（短辺 1280）
    expect(getPhotoMedia.mock.calls[0].slice(1, 3)).toEqual([1280, 1707]);
    // 2 回目は原寸
    expect(getPhotoMedia.mock.calls[1].slice(1, 3)).toEqual([3024, 4032]);
    // ⚠️ 通ったことを数えられること（通り続けているなら上限は効いていない）
    expect(logger.warn).toHaveBeenCalledWith(
      'PhotoMediaCappedRetryAtOriginal',
      'tryGetPhotoMedia',
      expect.objectContaining({ requestedWidthPx: 1280 }),
    );
  });

  it('⚠️ 縮めていない写真では原寸のやり直しをしない（無駄な 2 回目を撃たない）', async () => {
    const { service, getPhotoMedia, logger } = build();
    // 既に小さい写真は縮まらないので、失敗しても «同じ要求» を繰り返す意味が無い
    getPhotoMedia.mockRejectedValue(new Error('boom'));

    await expect(
      service.tryGetPhotoMedia([
        { name: 'places/p/photos/small', widthPx: 800, heightPx: 600 },
      ] as never),
    ).resolves.toBeNull();

    expect(getPhotoMedia).toHaveBeenCalledTimes(1);
    expect(logger.warn).not.toHaveBeenCalledWith(
      'PhotoMediaCappedRetryAtOriginal',
      expect.anything(),
      expect.anything(),
    );
  });

  it('原寸のやり直しも失敗したら、次の候補へ進む', async () => {
    const { service, getPhotoMedia } = build();
    getPhotoMedia
      .mockRejectedValueOnce(new Error('capped failed'))
      .mockRejectedValueOnce(new Error('original failed'))
      .mockResolvedValueOnce({ photoUri: 'https://example.test/second.jpg' });

    await expect(
      service.tryGetPhotoMedia([
        photo,
        { name: 'places/p/photos/y', widthPx: 2000, heightPx: 3000 },
      ] as never),
    ).resolves.toEqual({ photoUri: 'https://example.test/second.jpg' });

    expect(getPhotoMedia).toHaveBeenCalledTimes(3);
  });
});
