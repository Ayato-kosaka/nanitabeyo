/** Push 通知 1 件分の内容 */
export interface PushMessage {
    /** ExpoPushToken[...] */
    to: string;
    title: string;
    body?: string;
    data?: Record<string, unknown>;
    sound?: 'default' | null;
    ttl?: number;
    priority?: 'default' | 'normal' | 'high';
}

/** 成功 or 失敗の結果 */
export interface PushTicket {
    status: 'ok' | 'error';
    id?: string;
    message?: string;
    details?: Record<string, unknown>;
}
