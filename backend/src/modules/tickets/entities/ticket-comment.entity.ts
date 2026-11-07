import { Entity, Index, JoinColumn, ManyToOne, PrimaryGeneratedColumn } from 'typeorm';
import { CreatedAtColumn, IntColumn, StrColumn } from '../../../common/db-types';
import { User } from '../../users/entities/user.entity';
import { Ticket } from './ticket.entity';

@Entity('ticket_comments')
export class TicketComment {
  @PrimaryGeneratedColumn() id: number;
  @Index('IX_ticket_comments_ticket')
  @IntColumn()
  ticketId: number;
  @ManyToOne(() => Ticket, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'ticketId' })
  ticket?: Ticket;
  @IntColumn() userId: number;
  @ManyToOne(() => User, { onDelete: 'NO ACTION' })
  @JoinColumn({ name: 'userId' })
  user?: User;
  @StrColumn(4000) body: string;
  @CreatedAtColumn() createdAt: Date;
}
