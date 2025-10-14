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
    const { inputUri, outputUri, recordId } = params;

    this.logger.log('CreateTranscodeJobStarted', 'createTranscodeJob', {
      inputUri,
      outputUri,
      recordId,
    });

    const parent = this.client.locationPath(
      env.GCP_PROJECT,
      env.TRANSCODER_LOCATION,
    );

    // HLS 形式での出力設定
    const job: protos.google.cloud.video.transcoder.v1.IJob = {
      inputUri,
      outputUri,
      config: {
        // 複数のビットレートでエンコード（ABR: Adaptive Bitrate Streaming）
        elementaryStreams: [
          // 1080p video stream
          {
            key: 'video-1080p',
            videoStream: {
              h264: {
                heightPixels: 1080,
                widthPixels: 1920,
                bitrateBps: 8000000,
                frameRate: 30,
              },
            },
          },
          // 720p video stream
          {
            key: 'video-720p',
            videoStream: {
              h264: {
                heightPixels: 720,
                widthPixels: 1280,
                bitrateBps: 5000000,
                frameRate: 30,
              },
            },
          },
          // 480p video stream
          {
            key: 'video-480p',
            videoStream: {
              h264: {
                heightPixels: 480,
                widthPixels: 854,
                bitrateBps: 2500000,
                frameRate: 30,
              },
            },
          },
          // Audio stream
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
        // HLS マルチビットレート設定
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
        // HLS マニフェスト設定
        manifests: [
          {
            fileName: 'master.m3u8',
            type: 'HLS' as const,
            muxStreams: ['hls-1080p', 'hls-720p', 'hls-480p'],
          },
        ],
      },
    };

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
}
