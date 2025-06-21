import { Injectable } from '@nestjs/common';
import vision from '@google-cloud/vision';

/**
 * 🍽️ Cloud Vision API を利用して画像が料理かどうかを判定するサービス
 */
@Injectable()
export class CloudVisionService {
  private client = new vision.ImageAnnotatorClient();

  /**
   * 指定 URL が料理写真かどうかを判定
   */
  async isFoodPhoto(url: string): Promise<boolean> {
    const [result] = await this.client.labelDetection(url);
    const labels = result.labelAnnotations ?? [];
    return labels.some(
      (l) => l.description.toLowerCase() === 'food' && (l.score ?? 0) >= 0.75,
    );
  }
}

