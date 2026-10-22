import { Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { NotificationService } from '../application/notification.service';
import { NotificationStatusDto } from './notifications.dto';

@ApiTags('notifications')
@Controller('notifications')
export class NotificationsController {
  constructor(private readonly notifications: NotificationService) {}

  /** Whether Telegram notifications are configured. */
  @Get('status')
  status(): NotificationStatusDto {
    return { enabled: this.notifications.enabled, channel: 'telegram' };
  }

  /** Sends a test message. 409 when not configured, 502 when Telegram rejects it. */
  @Post('test')
  @HttpCode(204)
  test(): Promise<void> {
    return this.notifications.sendTest();
  }
}
