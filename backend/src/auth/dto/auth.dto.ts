import { IsEmail, IsIn, IsOptional, IsString, Length, Matches } from 'class-validator';
import { UserRole } from '../../common/enums';

export class RegisterDto {
  @IsEmail({}, { message: 'A valid email address is required' })
  email!: string;

  @IsString()
  @Length(8, 200, { message: 'Password must be at least 8 characters' })
  // Enforced deliberately: this account can start browser automation against
  // real websites, so a two-character password is not acceptable.
  @Matches(/[a-zA-Z]/, { message: 'Password must contain at least one letter' })
  @Matches(/[0-9]/, { message: 'Password must contain at least one number' })
  password!: string;

  @IsString()
  @Length(2, 80)
  name!: string;

  /** Ignored unless the caller is an OWNER. The first account is always OWNER. */
  @IsOptional()
  @IsIn(Object.keys(UserRole))
  role?: string;
}

export class LoginDto {
  @IsEmail({}, { message: 'A valid email address is required' })
  email!: string;

  @IsString()
  @Length(1, 200)
  password!: string;
}

export class RefreshDto {
  @IsString()
  @Length(10, 500)
  refreshToken!: string;
}
