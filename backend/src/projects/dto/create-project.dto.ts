import { IsString, IsUrl, Length } from 'class-validator';

export class CreateProjectDto {
  @IsString()
  @Length(2, 100)
  name!: string;

  @IsUrl({ require_tld: false, require_protocol: true }, { message: 'baseUrl must include http:// or https://' })
  baseUrl!: string;
}
