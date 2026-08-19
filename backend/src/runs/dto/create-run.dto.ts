import { Type } from 'class-transformer';
import {
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

  /** Free text, one requirement per line. This is the source of truth. */
  @IsString()
  @Length(10, 20000, {
    message: 'requirements must be at least 10 characters - describe what should work',
  })
  requirements!: string;

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
