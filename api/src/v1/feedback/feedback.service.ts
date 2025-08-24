// api/src/v1/feedback/feedback.service.ts
//
// ❶ Controller から渡される DTO を受け取り GitHub API を呼び出し
// ❷ 1 メソッド = 1 ユースケース（ロギング込み）
// ❸ GitHub Issues API との連携処理
//

import { Injectable } from '@nestjs/common';
import { CreateFeedbackDto, FeedbackType } from '@shared/v1/dto';
import { CreateFeedbackResponseDto } from '@shared/v1/res';
import { env } from '../../core/config/env';
import { AppLoggerService } from '../../core/logger/logger.service';

interface GitHubIssue {
  number: number;
  html_url: string;
}

@Injectable()
export class FeedbackService {
  private readonly githubToken: string;
  private readonly repoOwner: string;
  private readonly repoName: string;

  constructor(private readonly logger: AppLoggerService) {
    this.githubToken = env.GITHUB_TOKEN || '';
    this.repoOwner = env.GITHUB_REPO_OWNER;
    this.repoName = env.GITHUB_REPO_NAME;
  }

  async createIssue(
    feedbackDto: CreateFeedbackDto,
  ): Promise<CreateFeedbackResponseDto> {
    const { type, title, message, os, device } = feedbackDto;

    // Create GitHub issue title with prefix
    const issueTitle = `[${type}] ${title}`;

    // Create GitHub issue body with additional information
    const issueBody = `
## ${type === FeedbackType.REQUEST ? 'Feature Request' : 'Bug Report'}

**Description:**
${message}

---

**Technical Information:**
- OS: ${os}
- Device: ${device}
- App Version: ${env.API_COMMIT_ID}
- Submitted: ${new Date().toISOString()}

*This issue was automatically created from the mobile app feedback system.*
    `.trim();

    // Determine labels based on type
    const labels = type === FeedbackType.REQUEST ? ['request'] : ['bug'];

    try {
      const response = await fetch(
        `https://api.github.com/repos/${this.repoOwner}/${this.repoName}/issues`,
        {
          method: 'POST',
          headers: {
            Authorization: `token ${this.githubToken}`,
            Accept: 'application/vnd.github.v3+json',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            title: issueTitle,
            body: issueBody,
            labels: labels,
          }),
        },
      );

      if (!response.ok) {
        const errorText = await response.text();
        this.logger.error('GitHub API request failed', 'createIssue', {
          status: response.status,
          statusText: response.statusText,
          errorText,
        });
        throw new Error(
          `Failed to create GitHub issue: ${response.statusText}`,
        );
      }

      const issue: GitHubIssue = await response.json();

      this.logger.log('GitHub issue created successfully', 'createIssue', {
        issueNumber: issue.number,
        feedbackType: type,
        title,
      });

      return {
        issueNumber: issue.number,
        issueUrl: issue.html_url,
      };
    } catch (error) {
      this.logger.error('Failed to create GitHub issue', 'createIssue', {
        error: error.message,
        stack: error.stack,
      });
      throw error;
    }
  }
}
