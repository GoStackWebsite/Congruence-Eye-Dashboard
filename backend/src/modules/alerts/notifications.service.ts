import { Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { toIso } from '../../common/db-types';
import { Notification } from './entities/notification.entity';

@Injectable()
export class NotificationsService {
  constructor(private readonly ds: DataSource) {}
  static view(n: Notification) {
    return { id: n.id, title: n.title, body: n.body, link: n.link ?? null, isRead: n.isRead, createdAt: toIso(n.createdAt) };
  }
  async list(userId: number) {
    const rows = await this.ds.getRepository(Notification).find({ where: { userId }, order: { createdAt: 'DESC', id: 'DESC' }, take: 100 });
    return rows.map(NotificationsService.view);
  }
  async read(userId: number, id: number) {
    const repo = this.ds.getRepository(Notification);
    const n = await repo.findOne({ where: { id, userId } });
    if (!n) throw new NotFoundException('Notification not found');
    n.isRead = true;
    return NotificationsService.view(await repo.save(n));
  }
  async readAll(userId: number) {
    await this.ds.getRepository(Notification).update({ userId, isRead: false }, { isRead: true });
    return { ok: true };
  }
}
