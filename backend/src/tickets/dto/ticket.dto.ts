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
  /**
   * WHERE THE BUG SHOULD GO.
   *
   * 'jira' | 'clickup' | 'linear' files it in that tracker immediately, in the
   * same request. 'local' keeps it in this tool only. Omitted = whatever the
   * instance has configured as its default.
   *
   * The destination is a per-bug decision, not a deployment setting: a team can
   * have Jira for the product board and Linear for the platform team, and the
   * person filing knows which one this defect belongs to.
   */
  @IsOptional()
  @IsIn(['jira', 'clickup', 'linear', 'local'])
  provider?: 'jira' | 'clickup' | 'linear' | 'local';

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

  /**
   * Comma-separated, e.g. "ui, regression".
   *
   * Still a string on the wire even though the column is now a real array,
   * because that is what the user types into one text field. The service splits
   * it - putting the parsing here rather than in the client keeps a hand-made
   * API call and the UI producing identical rows.
   */
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
