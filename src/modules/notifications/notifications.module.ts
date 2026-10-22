import { Module } from '@nestjs/common';
import { NotificationService } from './application/notification.service';
import { NOTIFIER } from './domain/notifier.port';
import { TelegramNotifier } from './infrastructure/telegram.notifier';
import { NotificationsController } from './presentation/notifications.controller';

/** Leaf module: other modules send messages through NotificationService; it depends on none of them. */
@Module({
  controllers: [NotificationsController],
  providers: [NotificationService, { provide: NOTIFIER, useClass: TelegramNotifier }],
  exports: [NotificationService],
})
export class NotificationsModule {}
