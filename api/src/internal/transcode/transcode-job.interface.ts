// api/src/internal/transcode/transcode-job.interface.ts
//
// Transcoding ジョブのペイロード定義
//

export interface TranscodeJobPayload {
  /** 入力動画の GCS URI */
  inputUri: string;
  /** 出力先の GCS URI prefix */
  outputUri: string;
  /** dish_media.id */
  recordId: string;
}
