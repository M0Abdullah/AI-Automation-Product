import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsIn,
  IsOptional,
  IsString,
  Length,
  ValidateNested,
} from 'class-validator';
import { ALLOWED_ACTIONS, ALLOWED_ASSERTIONS } from '../../common/test-plan.types';

export class StepDto {
  @IsIn(ALLOWED_ACTIONS as unknown as string[])
  action!: string;

  @IsString()
  @Length(1, 300)
  target!: string;

  @IsOptional()
  @IsString()
  @Length(1, 60)
  valueRef?: string;

  @IsOptional()
  @IsString()
  @Length(0, 500)
  value?: string;

  @IsOptional()
  @IsString()
  @Length(0, 300)
  description?: string;
}

export class AssertionDto {
  @IsIn(ALLOWED_ASSERTIONS as unknown as string[])
  type!: string;

  @IsOptional()
  @IsString()
  @Length(0, 300)
  target?: string;

  @IsOptional()
  @IsString()
  @Length(0, 500)
  value?: string;

  @IsOptional()
  @IsString()
  @Length(0, 300)
  description?: string;
}

/**
 * A QA engineer editing a generated test case.
 *
 * Edits go through the same allow-list as the model's output. A human is
 * trusted more than a model, but not trusted to type an action that the
 * executor cannot perform.
 */
export class UpdateTestCaseDto {
  @IsOptional()
  @IsString()
  @Length(3, 200)
  title?: string;

  @IsOptional()
  @IsIn(['P0', 'P1', 'P2', 'P3'])
  priority?: string;

  @IsOptional()
  @IsString()
  @Length(0, 500)
  requirement?: string;

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(40)
  @ValidateNested({ each: true })
  @Type(() => StepDto)
  steps?: StepDto[];

  @IsOptional()
  @IsArray()
  @ArrayMaxSize(15)
  @ValidateNested({ each: true })
  @Type(() => AssertionDto)
  assertions?: AssertionDto[];

  @IsOptional()
  @IsBoolean()
  approved?: boolean;
}

export class RejectTestCaseDto {
  @IsOptional()
  @IsString()
  @Length(0, 1000)
  reason?: string;
}
