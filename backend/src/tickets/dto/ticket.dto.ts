import {
  IsDateString,
  IsIn,
  IsOptional,
  IsString,
  IsUUID,
  Length,
} from 'class-validator';
import { Priority, TicketStatus } from '../../common/enums';

const SEVERITIES = ['S1_BLOCKER', 'S2_MAJOR', 'S3_MINOR', 'S4_TRIVIAL'];

/**
 * Creating a ticket from a confirmed finding.
 *
 * Everything is optional except the finding: the fields are prefilled from the
 * run evidence, and the user only overrides what they want to change. That is
 * the difference between a two-second action and a form nobody fills in.
 */
export class CreateTicketDto {
  @IsOptional()
  @IsString()
  @Length(3, 200)
  title?: string;

  @IsOptional()
  @IsString()
  @Length(0, 20000)
  description?: string;

  @IsOptional()
  @IsIn(Object.keys(Priority))
  priority?: string;

  @IsOptional()
  @IsIn(SEVERITIES)
  severity?: string;

  @IsOptional()
  @IsString()
  @Length(0, 100)
  module?: string;

  @IsOptional()
  @IsString()
  @Length(0, 100)
  build?: string;

  @IsOptional()
  @IsUUID()
  assigneeId?: string;

  @IsOptional()
  @IsString()
  @Length(0, 200)
  labels?: string;

  @IsOptional()
  @IsDateString()
  dueDate?: string;
}

export class UpdateTicketDto extends CreateTicketDto {
  @IsOptional()
  @IsIn(Object.keys(TicketStatus))
  status?: string;
}

export class TicketCommentDto {
  @IsString()
  @Length(1, 5000)
  body!: string;
}

export class LinkExternalDto {
  /** e.g. JIRA-123 */
  @IsString()
  @Length(1, 60)
  externalKey!: string;

  @IsString()
  @Length(5, 500)
  externalUrl!: string;

  @IsOptional()
  @IsIn(['jira', 'linear', 'github', 'azure'])
  provider?: string;
}
