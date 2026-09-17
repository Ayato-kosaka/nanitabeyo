/*
#1641 YouTube の説明文抽出。

オーナー報告:「YouTube shorts のキャプションが取れてないので、店が入らない」。

YouTube の oEmbed は `description` を返さない。店舗情報（店名・住所）は**説明文**に
書かれているので、視聴ページの HTML から取り出す必要がある。ここではその抽出だけを見る
（ネットワークは `SnsOembedService` 側の責務）。
*/
import { parseYouTubeDescription } from './sns-oembed.service';

/**
 * 実際の視聴ページと同じ形の断片を作る。
 *
 * 説明文は `runs` の**配列**として入っており、ハッシュタグやリンクが別の run に割れる。
 */
const buildHtml = (runs: { text: string }[], extra = ''): string =>
  `<!doctype html><script>var ytInitialData = {"contents":{"x":1},` +
  `"engagementPanels":[{"expandableVideoDescriptionBodyRenderer":{"descriptionBodyText":{"runs":` +
  JSON.stringify(runs) +
  `}}}]};</script>${extra}`;

describe('parseYouTubeDescription', () => {
  it('runs に割れた説明文を 1 本につなぐ', () => {
    const html = buildHtml([
      { text: '#月島グルメ' },
      { text: '\n\n【店舗情報】\n店名：焼鶏ばんちょう\n' },
      { text: '住所：東京都中央区月島1-22-1 ミッドタワーグランド 102' },
    ]);

    const description = parseYouTubeDescription(html);

    // 店舗照合が要求するのは «住所が入っていること»。実測した並びをそのまま再現する
    expect(description).toContain('店名：焼鶏ばんちょう');
    expect(description).toContain('東京都中央区月島1-22-1');
    expect(description).toContain('#月島グルメ');
  });

  /*
	⚠️ **ページ全体から `"text":"…"` を拾ってはいけない。**

	実装中に実際にやってしまい、プレイヤーのキーボードショートカット説明
	（「再生 / 一時停止の切り替え」「10 秒巻き戻す」…）まで説明文へ混入させた。
	`runs` の配列の内側だけを読むこと。
	*/
  it('runs の外にある text は拾わない（プレイヤーの UI 文言を混ぜない）', () => {
    const html = buildHtml(
      [{ text: '店名：焼鶏ばんちょう' }],
      '<script>var other = {"text":"再生 / 一時停止の切り替え"};</script>',
    );

    const description = parseYouTubeDescription(html);

    expect(description).toBe('店名：焼鶏ばんちょう');
    expect(description).not.toContain('一時停止');
  });

  it('文字列の中の ] で配列の終わりを誤判定しない', () => {
    const html = buildHtml([
      { text: '営業時間［17:00〜23:00］' },
      { text: ' / 住所：東京都中央区月島1-22-1' },
    ]);

    expect(parseYouTubeDescription(html)).toContain(
      '住所：東京都中央区月島1-22-1',
    );
  });

  it('エスケープされた引用符を含む説明文も壊さない', () => {
    const html = buildHtml([{ text: '店名："ばんちょう"' }]);

    expect(parseYouTubeDescription(html)).toBe('店名："ばんちょう"');
  });

  /*
	YouTube は bot 判定・ログイン壁で JS シェルだけを返すことがある。
	**推測で組み立てず null を返す**こと。呼び出し側は «説明文は取れなかった» として
	既存の «候補ゼロ → 手入力» へ縮退する。
	*/
  it('説明文が無ければ null（推測で組み立てない）', () => {
    expect(
      parseYouTubeDescription('<!doctype html><body>JS shell</body>'),
    ).toBeNull();
  });

  it('説明文が空文字なら null', () => {
    expect(parseYouTubeDescription(buildHtml([{ text: '   ' }]))).toBeNull();
  });

  /*
	#1641 **置き場所は 1 つではない。**

	開発環境では `descriptionBodyText.runs` から取れたのに、Cloud Run が受け取る HTML には
	その鍵が無かった（実ログ: `YouTubeDescriptionNotFound` / htmlLength 1.1MB）。
	ページは取れているのに鍵だけが違う、という形である。
	1 つの鍵に賭けると «こちらでは通るのに本番では取れない» に戻るので、順に試す。
	*/
  describe('置き場所が変わっても取れる', () => {
    it('videoDetails.shortDescription から取れる', () => {
      const html =
        '<!doctype html><script>var ytInitialPlayerResponse = {"videoDetails":' +
        '{"shortDescription":"店名：焼鶏ばんちょう\\n住所：東京都中央区月島1-22-1"}};</script>';

      expect(parseYouTubeDescription(html)).toBe(
        '店名：焼鶏ばんちょう\n住所：東京都中央区月島1-22-1',
      );
    });

    it('attributedDescription.content から取れる', () => {
      const html =
        '<!doctype html><script>var x = {"attributedDescription":{"content":"住所：東京都中央区月島1-22-1"}};</script>';

      expect(parseYouTubeDescription(html)).toBe(
        '住所：東京都中央区月島1-22-1',
      );
    });

    it('エスケープされた引用符で終端を誤らない', () => {
      const html =
        '<!doctype html><script>var y = {"shortDescription":"店名：\\"ばんちょう\\" 月島"};</script>';

      expect(parseYouTubeDescription(html)).toBe('店名："ばんちょう" 月島');
    });

    it('どの置き場所にも無ければ null', () => {
      expect(
        parseYouTubeDescription(
          '<!doctype html><script>var z = {"other":"x"};</script>',
        ),
      ).toBeNull();
    });
  });
});
