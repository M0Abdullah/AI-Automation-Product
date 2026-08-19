import { Type } from 'class-transformer';
import {
  ArrayMaxSize,
  IsArray,
  IsBoolean,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  ValidateNested,
} from 'class-validator';

export class CredentialsDto {
  @IsOptional()
  @IsString()
  @Length(1, 200)
  email?: string;

  @IsOptional()
  @IsString()
  @Length(1, 200)
  password?: string;
}

/**
 * EXACTLY WHAT WE ASK THE USER FOR.
 *
 * Three things: a URL, the requirements, and (optionally) test credentials.
 * Plus one authorisation checkbox, because we are about to open somebody's
 * website with an automated browser.
 */
export class CreateRunDto {
  @IsUrl(
    { require_tld: false, require_protocol: true },
    { message: 'url must be a full URL including http:// or https://' },
  )
  url!: string;

  /**
   * Free text, one requirement per line. The source of truth for business rules.
   *
   * Optional now: a run is valid with ticked checks and no prose, because the
   * standard checks carry their own meaning. One of the two must be present -
   * enforced in the service, since neither field alone can express that.
   */
  @IsOptional()
  @IsString()
  @Length(0, 20000)
  requirements?: string;

  /**
   * Ids from the check catalogue — the boxes the user ticked.
   * Unknown ids are dropped rather than rejected, so an older client cannot
   * break against a newer catalogue.
   */
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(40)
  @IsString({ each: true })
  checks?: string[];

  @IsOptional()
  @IsString()
  @Length(2, 120)
  name?: string;

  @IsOptional()
  @ValidateNested()
  @Type(() => CredentialsDto)
  credentials?: CredentialsDto;

  /** The user confirms they are allowed to test this site. Required. */
  @IsBoolean()
  authorized!: boolean;

  /** Off by default. When false, destructive-looking steps are rejected. */
  @IsOptional()
  @IsBoolean()
  allowDestructive?: boolean;
}
