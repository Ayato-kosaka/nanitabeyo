/*
#819 Google の photoUri を «表示するサイズ» へ書き換える純関数のテスト。

ここで固定したいのは 3 点。

1. **Places が実際に返してくる形**（`=s4800-w3024`）を置き換えられること。
   期待値は本番ログから取った実物で、写経ではない
2. **自前 CDN の署名付き URL を壊さないこと。** 署名付き URL の末尾を触ると 403 になる
3. **読めない入力で落ちないこと。** 取り込み経路は null / 空が混ざりうる
*/
import { withGooglePhotoWidth } from './google-photo-uri';

// 本番ログ（external_api_logs / api_name = 'Google Places Photos API'）から取った実物の形。
// token は伏せてあるが、長さと文字種は同じ。
const REAL_TOKEN =
  'ACvplmOjjlLdKVtBAaBUR86KfOMvDsBEFATbxsEZRGmydFXZhM5I0thIfh3NCAvJp9Rm3e0psgaOwUWLoCjzW652WjOwvw';
const REAL_URI = `https://lh3.googleusercontent.com/grass-cs/${REAL_TOKEN}=s4800-w3024`;

describe('#819 withGooglePhotoWidth', () => {
  it('Places が返す =s4800-w3024 を、指定した幅の JPEG へ置き換える', () => {
    expect(withGooglePhotoWidth(REAL_URI, 256)).toBe(
      `https://lh3.googleusercontent.com/grass-cs/${REAL_TOKEN}=w256-rj`,
    );
  });

  it('サイズ指定が無い URL には足す', () => {
    expect(
      withGooglePhotoWidth(
        `https://lh3.googleusercontent.com/grass-cs/${REAL_TOKEN}`,
        64,
      ),
    ).toBe(`https://lh3.googleusercontent.com/grass-cs/${REAL_TOKEN}=w64-rj`);
  });

  it('別の suffix（=s512 など）でも置き換える', () => {
    expect(
      withGooglePhotoWidth(
        `https://lh3.googleusercontent.com/a/${REAL_TOKEN}=s512`,
        1024,
      ),
    ).toBe(`https://lh3.googleusercontent.com/a/${REAL_TOKEN}=w1024-rj`);
  });

  // ⚠️ 署名付き URL の末尾を触ると 403 になる。自前 CDN は対象外であること
  it('googleusercontent 以外は 1 文字も変えない', () => {
    const signed =
      'https://cdn-public.nanitabeyo.net/restaurants/image_path/abc-256.webp?token=xyz';
    expect(withGooglePhotoWidth(signed, 64)).toBe(signed);
    const gcs = 'https://storage.googleapis.com/bucket/obj.png';
    expect(withGooglePhotoWidth(gcs, 64)).toBe(gcs);
  });

  // ⚠️ ホスト名の部分一致で «googleusercontent.com.evil.test» を拾わないこと
  it('似せたホスト名は対象にしない', () => {
    const spoof = 'https://lh3.googleusercontent.com.evil.test/a/x=s4800-w3024';
    expect(withGooglePhotoWidth(spoof, 64)).toBe(spoof);
  });

  it('URL として読めないもの・空文字はそのまま返す', () => {
    expect(withGooglePhotoWidth('', 64)).toBe('');
    expect(withGooglePhotoWidth('not a url', 64)).toBe('not a url');
  });

  it('幅が不正なら書き換えない（0 / 負 / 小数）', () => {
    for (const width of [0, -1, 12.5]) {
      expect(withGooglePhotoWidth(REAL_URI, width)).toBe(REAL_URI);
    }
  });

  it('クエリ文字列を落とさない', () => {
    expect(withGooglePhotoWidth(`${REAL_URI}?x=1`, 64)).toBe(
      `https://lh3.googleusercontent.com/grass-cs/${REAL_TOKEN}=w64-rj?x=1`,
    );
  });
});
