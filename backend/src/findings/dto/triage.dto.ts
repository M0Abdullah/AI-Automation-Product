import { IsIn, IsOptional, IsString, Length } from 'class-validator';
import { CLASSIFICATIONS } from '../../llm/schemas/triage.schema';

const SEVERITIES = ['S1_BLOCKER', 'S2_MAJOR', 'S3_MINOR', 'S4_TRIVIAL'];

/**
 * The human decision. This - not the AI - is what makes something a bug.
 */
export class TriageFindingDto {
  /** CONFIRM = it is a real product defect. REJECT = it is not. */
  @IsIn(['CONFIRM', 'REJECT'])
  decision!: 'CONFIRM' | 'REJECT';

  /** Required on REJECT so the reason is recorded, not lost. */
  @IsIn(CLASSIFICATIONS as unknown as string[])
  classification!: string;

  @IsOptional()
  @IsIn(SEVERITIES)
  severity?: string;

  @IsOptional()
  @IsString()
  @Length(0, 2000)
  note?: string;

  @IsOptional()
  @IsString()
  @Length(0, 120)
  assignee?: string;

  @IsOptional()
  @IsString()
  @Length(0, 120)
  actor?: string;

  /** Which part of the product this defect lives in. Goes on the bug report. */
  @IsOptional()
  @IsString()
  @Length(0, 100)
  module?: string;

  /** Build / version / commit under test. Goes on the bug report. */
  @IsOptional()
  @IsString()
  @Length(0, 100)
  build?: string;

  /** How soon it must be fixed - a separate axis from severity. */
  @IsOptional()
  @IsIn(['P0', 'P1', 'P2', 'P3'])
  priority?: string;
}

export class FindingNoteDto {
  @IsOptional()
  @IsString()
  @Length(0, 2000)
  note?: string;

  @IsOptional()
  @IsString()
  @Length(0, 120)
  actor?: string;
}
