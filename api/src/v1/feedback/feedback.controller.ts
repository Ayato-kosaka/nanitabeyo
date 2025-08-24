import { Controller, Post, Body, HttpCode, HttpStatus, BadRequestException } from '@nestjs/common';
import { FeedbackService } from './feedback.service';
import { CreateFeedbackDto, FeedbackType } from '@shared/v1/dto';
import { CreateFeedbackResponseDto } from '@shared/v1/res';

@Controller('feedback')
export class FeedbackController {
  constructor(private readonly feedbackService: FeedbackService) {}

  @Post('issue')
  @HttpCode(HttpStatus.CREATED)
  async createIssue(@Body() createFeedbackDto: CreateFeedbackDto): Promise<CreateFeedbackResponseDto> {
    // Validate input
    if (!createFeedbackDto.type || !Object.values(FeedbackType).includes(createFeedbackDto.type)) {
      throw new BadRequestException('Invalid feedback type');
    }
    
    if (!createFeedbackDto.title || createFeedbackDto.title.length < 5 || createFeedbackDto.title.length > 80) {
      throw new BadRequestException('Title must be between 5 and 80 characters');
    }
    
    if (!createFeedbackDto.message || createFeedbackDto.message.length < 10 || createFeedbackDto.message.length > 2000) {
      throw new BadRequestException('Message must be between 10 and 2000 characters');
    }

    if (!createFeedbackDto.os || !createFeedbackDto.device) {
      throw new BadRequestException('OS and device information are required');
    }

    return this.feedbackService.createIssue(createFeedbackDto);
  }
}