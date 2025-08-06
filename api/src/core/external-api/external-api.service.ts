// api/src/core/external-api/external-api.service.ts
//
// External API service for Wikidata and Google Custom Search
//

import { Injectable, Logger } from '@nestjs/common';
import { env } from '../config/env';

// Wikidata API のレスポンス型
interface WikidataSearchResponse {
  search: {
    id: string;
    label: string;
    description?: string;
  }[];
}

// Google Custom Search API のレスポンス型
interface GoogleCustomSearchResponse {
  spelling?: {
    correctedQuery: string;
  };
}

@Injectable()
export class ExternalApiService {
  private readonly logger = new Logger(ExternalApiService.name);

  /**
   * Wikidata で料理カテゴリを検索
   */
  async searchWikidata(query: string): Promise<{ id: string; label: string } | null> {
    this.logger.debug(`Searching Wikidata for: ${query}`);

    try {
      const response = await fetch(
        `https://www.wikidata.org/w/api.php?action=wbsearchentities&format=json&language=ja&type=item&limit=1&search=${encodeURIComponent(query)}`
      );

      if (!response.ok) {
        throw new Error(`Wikidata API request failed: ${response.status}`);
      }

      const data: WikidataSearchResponse = await response.json();
      
      if (data.search && data.search.length > 0) {
        const result = data.search[0];
        this.logger.debug(`Found Wikidata result: ${result.label}`);
        return { id: result.id, label: result.label };
      }

      this.logger.debug('No Wikidata results found');
      return null;

    } catch (error) {
      this.logger.error('Failed to search Wikidata', error);
      return null;
    }
  }

  /**
   * Google Custom Search で料理カテゴリのスペルチェック
   */
  async getCorrectedSpelling(query: string): Promise<string | null> {
    this.logger.debug(`Getting corrected spelling for: ${query}`);

    const googleApiKey = env.GOOGLE_API_KEY;
    const searchEngineId = env.GOOGLE_SEARCH_ENGINE_ID;

    if (!googleApiKey || !searchEngineId) {
      this.logger.warn('Google Custom Search API not configured');
      return null;
    }

    try {
      const response = await fetch(
        `https://www.googleapis.com/customsearch/v1?key=${googleApiKey}&cx=${searchEngineId}&q=${encodeURIComponent(query)}`
      );

      if (!response.ok) {
        throw new Error(`Google Custom Search API request failed: ${response.status}`);
      }

      const data: GoogleCustomSearchResponse = await response.json();
      
      if (data.spelling?.correctedQuery) {
        this.logger.debug(`Found corrected spelling: ${data.spelling.correctedQuery}`);
        return data.spelling.correctedQuery;
      }

      this.logger.debug('No spelling correction found');
      return null;

    } catch (error) {
      this.logger.error('Failed to get corrected spelling', error);
      return null;
    }
  }
}