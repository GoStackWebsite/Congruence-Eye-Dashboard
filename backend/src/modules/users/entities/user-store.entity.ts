import { Entity, Index, JoinColumn, ManyToOne, PrimaryColumn } from 'typeorm';
import { Store } from '../../stores/entities/store.entity';
import { User } from './user.entity';

@Entity('user_stores')
export class UserStore {
  @PrimaryColumn({ type: 'int' }) userId: number;
  @Index('IX_user_stores_storeId')
  @PrimaryColumn({ type: 'int' })
  storeId: number;
  @ManyToOne(() => User, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'userId' })
  user?: User;
  @ManyToOne(() => Store, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'storeId' })
  store?: Store;
}
