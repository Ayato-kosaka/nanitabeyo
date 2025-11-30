// api/src/core/transcoder/transcoder.service.ts
//
// Google Cloud Video Transcoder API サービス
// 責務: 動画のトランスコードジョブ作成
//

import { Injectable } from '@nestjs/common';
import {
  TranscoderServiceClient,
  protos,
} from '@google-cloud/video-transcoder';
import { env } from '../config/env';
import { AppLoggerService } from '../logger/logger.service';
import { TranscoderJobLabels } from 'src/internal/transcoder/transcoder-webhook.interface';

export interface CreateTranscodeJobParams {
  /** 入力動画の GCS URI (例: gs://bucket/uploads/video.mp4) */
  inputUri: string;
  /** 出力先の GCS URI prefix (例: gs://bucket/transcoded/dish_media/media_path/recordId/) */
  outputUri: string;
  /** Transcoder Job の labels（tableName, columnName, recordId など） */
  labels: TranscoderJobLabels;
}

@Injectable()
export class TranscoderService {
  private client: TranscoderServiceClient;

  constructor(private readonly logger: AppLoggerService) {
    this.client = new TranscoderServiceClient();
  }

  /**
   * HLS トランスコードジョブを作成する
   *
   * 出力:
   * - 1080p / 720p / 480p の HLS ストリーム
   * - master.m3u8 プレイリスト
   */
  async createTranscodeJob(params: CreateTranscodeJobParams): Promise<string> {
    const {
      inputUri,
      outputUri,
      labels,
    } = params;
    this.logger.log('CreateTranscodeJobStarted', 'createTranscodeJob', {
      inputUri,
      outputUri,
      labels
    });

    const parent = this.client.locationPath(
      env.GCP_PROJECT,
      env.TRANSCODER_LOCATION,
    );

    // HLS 形式での出力設定
    const job = this.buildJobConfig(
      inputUri,
      outputUri,
      labels,
    );

    try {
      const [response] = await this.client.createJob({
        parent,
        job,
      });

      const jobName = response.name || '';

      this.logger.log('CreateTranscodeJobSuccess', 'createTranscodeJob', {
        jobName,
        labels,
      });

      return jobName;
    } catch (error) {
      this.logger.error('CreateTranscodeJobError', 'createTranscodeJob', {
        inputUri,
        outputUri,
        labels,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }

  /**
   * トランスコードジョブの状態を取得
   */
  async getJobStatus(jobName: string): Promise<string> {
    try {
      const [job] = await this.client.getJob({ name: jobName });
      return String(job.state || 'UNKNOWN');
    } catch (error) {
      this.logger.error('GetJobStatusError', 'getJobStatus', {
        jobName,
        error: error instanceof Error ? error.message : 'Unknown error',
      });
      throw error;
    }
  }


  /**
   * トランスコードジョブの設定を構築
   */
  private buildJobConfig(
    inputUri: string,
    outputUri: string,
    labels: TranscoderJobLabels,
  ): protos.google.cloud.video.transcoder.v1.IJob {
    const isAudioInclude = labels.videoOnly !== 'true';

    const resolutions = [
      { key: 'video-1080p', hlsKey: 'hls-1080p', height: 1080, bitrate: 8_000_000 },
      { key: 'video-720p', hlsKey: 'hls-720p', height: 720, bitrate: 5_000_000 },
      { key: 'video-480p', hlsKey: 'hls-480p', height: 480, bitrate: 2_500_000 },
    ];

    // elementaryStreams: 常に video ストリームを追加し、必要なら audio を追加
    const elementaryStreams: protos.google.cloud.video.transcoder.v1.IElementaryStream[] = [
      ...resolutions.map(r => ({
        key: r.key,
        videoStream: {
          h264: {
            heightPixels: r.height,
            bitrateBps: r.bitrate,
            frameRate: 30,
          },
        },
      })),
    ];

    if (isAudioInclude) {
      elementaryStreams.push({
        key: 'audio',
        audioStream: {
          codec: 'aac',
          bitrateBps: 128000,
          channelCount: 2,
          sampleRateHertz: 48000,
        },
      });
    }

    // muxStreams: video 毎に対応する mux を作成し、audio の有無で elementaryStreams を切り替える
    const muxStreams = resolutions.map(r => ({
      key: r.hlsKey,
      container: 'ts',
      elementaryStreams: isAudioInclude ? [r.key, 'audio'] : [r.key],
    }));

    const manifests = [
      {
        fileName: 'master.m3u8',
        type: 'HLS' as const,
        muxStreams: muxStreams.map(m => m.key),
      },
    ];

    return {
      inputUri,
      outputUri,
      labels,
      config: {
        pubsubDestination: { topic: env.TRANSCODER_PUBSUB_TOPIC },
        elementaryStreams,
        muxStreams,
        manifests,
      },
    };
  }
}
