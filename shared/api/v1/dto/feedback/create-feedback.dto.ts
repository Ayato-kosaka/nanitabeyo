export enum FeedbackType {
  REQUEST = 'request',
  BUG = 'bug',
}

export interface CreateFeedbackDto {
  type: FeedbackType;
  title: string;
  message: string;
  os: string;
  device: string;
}