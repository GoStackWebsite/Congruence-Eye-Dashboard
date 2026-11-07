import { Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { BoolColumn, CreatedAtColumn, IntColumn, StrColumn } from '../../../common/db-types';
import { User } from '../../users/entities/user.entity';

@Entity('notifications')
@Index('IX_notifications_user_created', ['userId', 'createdAt'])
export class Notification {
  @PrimaryGeneratedColumn() id: number;
  @IntColumn() userId: number;
  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user?: User;
  @StrColumn(200) title: string;
  @StrColumn(1000, { default: '' }) body: string;
  @StrColumn(300, { nullable: true }) link: string | null;
  @BoolColumn({ default: false }) isRead: boolean;
  @CreatedAtColumn() createdAt: Date;
}
