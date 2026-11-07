import { Module } from '@nestjs/common';
import { AggregationService } from './aggregation.service';
import { VisitBuilderService } from './visit-builder.service';

@Module({ providers: [VisitBuilderService, AggregationService], exports: [VisitBuilderService, AggregationService] })
export class PipelineModule {}
