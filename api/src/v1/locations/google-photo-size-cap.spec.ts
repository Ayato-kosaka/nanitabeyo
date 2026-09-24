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
 * 1. **原寸を超えて要求しない**（#429 の事情。縮める方向だけに使う）
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

  it('原寸より大きくは要求しない（#429）', () => {
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
