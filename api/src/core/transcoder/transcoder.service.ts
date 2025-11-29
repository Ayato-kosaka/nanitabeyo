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

export interface CreateTranscodeJobParams {
  /** 入力動画の GCS URI (例: gs://bucket/uploads/video.mp4) */
  inputUri: string;
  /** 出力先の GCS URI prefix (例: gs://bucket/transcoded/dish_media/media_path/recordId/) */
  outputUri: string;
  /** レコードID（dish_media.id） */
  recordId: string;
  /** リトライ回数（0: 初回、1: video-only リトライ） */
  retry?: number;
  /** video-only モード（音声トラックなしで再実行） */
  videoOnly?: boolean;
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
      recordId,
      retry = 0,
      videoOnly = false,
    } = params;

    this.logger.log('CreateTranscodeJobStarted', 'createTranscodeJob', {
      inputUri,
      outputUri,
      recordId,
      retry,
      videoOnly,
    });

    const parent = this.client.locationPath(
      env.GCP_PROJECT,
      env.TRANSCODER_LOCATION,
    );

    // HLS 形式での出力設定
    const job: protos.google.cloud.video.transcoder.v1.IJob = videoOnly
      ? this.buildVideoOnlyJobConfig(inputUri, outputUri, recordId, retry)
      : this.buildDefaultJobConfig(inputUri, outputUri, recordId, retry);

    try {
      const [response] = await this.client.createJob({
        parent,
        job,
      });

      const jobName = response.name || '';

      this.logger.log('CreateTranscodeJobSuccess', 'createTranscodeJob', {
        jobName,
        recordId,
      });

      return jobName;
    } catch (error) {
      this.logger.error('CreateTranscodeJobError', 'createTranscodeJob', {
        inputUri,
        outputUri,
        recordId,
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
   * デフォルト（音声あり）の Job 設定を構築
   */
  private buildDefaultJobConfig(
    inputUri: string,
    outputUri: string,
    recordId: string,
    retry: number,
  ): protos.google.cloud.video.transcoder.v1.IJob {
    return {
      inputUri,
      outputUri,
      labels: {
        dish_media_id: recordId,
        retry: String(retry),
      },
      config: {
        pubsubDestination: env.TRANSCODER_PUBSUB_TOPIC
          ? { topic: env.TRANSCODER_PUBSUB_TOPIC }
          : undefined,
        elementaryStreams: [
          {
            key: 'video-1080p',
            videoStream: {
              h264: {
                heightPixels: 1080,
                bitrateBps: 8000000,
                frameRate: 30,
              },
            },
          },
          {
            key: 'video-720p',
            videoStream: {
              h264: {
                heightPixels: 720,
                bitrateBps: 5000000,
                frameRate: 30,
              },
            },
          },
          {
            key: 'video-480p',
            videoStream: {
              h264: {
                heightPixels: 480,
                bitrateBps: 2500000,
                frameRate: 30,
              },
            },
          },
          {
            key: 'audio',
            audioStream: {
              codec: 'aac',
              bitrateBps: 128000,
              channelCount: 2,
              sampleRateHertz: 48000,
            },
          },
        ],
        muxStreams: [
          {
            key: 'hls-1080p',
            container: 'ts',
            elementaryStreams: ['video-1080p', 'audio'],
          },
          {
            key: 'hls-720p',
            container: 'ts',
            elementaryStreams: ['video-720p', 'audio'],
          },
          {
            key: 'hls-480p',
            container: 'ts',
            elementaryStreams: ['video-480p', 'audio'],
          },
        ],
        manifests: [
          {
            fileName: 'master.m3u8',
            type: 'HLS' as const,
            muxStreams: ['hls-1080p', 'hls-720p', 'hls-480p'],
          },
        ],
      },
    };
  }

  /**
   * video-only（音声なし）の Job 設定を構築
   * AudioMissing エラー時のリトライ用
   */
  private buildVideoOnlyJobConfig(
    inputUri: string,
    outputUri: string,
    recordId: string,
    retry: number,
  ): protos.google.cloud.video.transcoder.v1.IJob {
    return {
      inputUri,
      outputUri,
      labels: {
        dish_media_id: recordId,
        retry: String(retry),
        video_only: 'true',
      },
      config: {
        pubsubDestination: env.TRANSCODER_PUBSUB_TOPIC
          ? { topic: env.TRANSCODER_PUBSUB_TOPIC }
          : undefined,
        elementaryStreams: [
          {
            key: 'video-1080p',
            videoStream: {
              h264: {
                heightPixels: 1080,
                bitrateBps: 8000000,
                frameRate: 30,
              },
            },
          },
          {
            key: 'video-720p',
            videoStream: {
              h264: {
                heightPixels: 720,
                bitrateBps: 5000000,
                frameRate: 30,
              },
            },
          },
          {
            key: 'video-480p',
            videoStream: {
              h264: {
                heightPixels: 480,
                bitrateBps: 2500000,
                frameRate: 30,
              },
            },
          },
        ],
        muxStreams: [
          {
            key: 'hls-1080p',
            container: 'ts',
            elementaryStreams: ['video-1080p'],
          },
          {
            key: 'hls-720p',
            container: 'ts',
            elementaryStreams: ['video-720p'],
          },
          {
            key: 'hls-480p',
            container: 'ts',
            elementaryStreams: ['video-480p'],
          },
        ],
        manifests: [
          {
            fileName: 'master.m3u8',
            type: 'HLS' as const,
            muxStreams: ['hls-1080p', 'hls-720p', 'hls-480p'],
          },
        ],
      },
    };
  }
}
