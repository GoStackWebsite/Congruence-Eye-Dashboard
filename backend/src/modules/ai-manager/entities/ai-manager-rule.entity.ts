import { Entity, PrimaryGeneratedColumn } from 'typeorm';
import { BoolColumn, CreatedAtColumn, JsonColumn, StrColumn } from '../../../common/db-types';

/** CCTV-driven checklist rule evaluated by the edge (ai-service) detectors. */
@Entity('ai_manager_rules')
export class AiManagerRule {
  @PrimaryGeneratedColumn() id: number;
  @StrColumn(150) name: string;
  @StrColumn(30) type: string;
  /** [] = all stores */
  @JsonColumn<number[]>([]) storeIds: number[];
  /** detection areas; [] = whole frame */
  @JsonColumn<number[]>([]) zoneIds: number[];
  @StrColumn(5, { default: '00:00' }) windowStart: string;
  @StrColumn(5, { default: '23:59' }) windowEnd: string;
  @JsonColumn<number[]>([0, 1, 2, 3, 4, 5, 6]) daysOfWeek: number[];
  @JsonColumn<Record<string, number | string | boolean>>({}) params: Record<string, number | string | boolean>;
  @StrColumn(10, { default: 'MEDIUM' }) severity: string;
  @JsonColumn<string[]>(['IN_APP']) notifyChannels: string[];
  @StrColumn(1000, { nullable: true }) notifyEmails: string | null;
  @BoolColumn({ default: true }) isActive: boolean;
  @CreatedAtColumn() createdAt: Date;
}
