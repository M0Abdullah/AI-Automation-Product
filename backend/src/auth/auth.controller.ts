import { Body, Controller, Get, Ip, Post, Req } from '@nestjs/common';
import type { Request } from 'express';
import type { JwtPayload } from './auth.service';
import { AuthService } from './auth.service';
import { CurrentUser, Public } from './auth.guard';
import { LoginDto, RefreshDto, RegisterDto } from './dto/auth.dto';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  /** POST /api/auth/register — the first account created becomes OWNER. */
  @Public()
  @Post('register')
  register(@Body() dto: RegisterDto, @Req() req: Request, @Ip() ip: string) {
    return this.auth.register(dto, { userAgent: req.headers['user-agent'], ip });
  }

  @Public()
  @Post('login')
  login(@Body() dto: LoginDto, @Req() req: Request, @Ip() ip: string) {
    return this.auth.login(dto, { userAgent: req.headers['user-agent'], ip });
  }

  @Public()
  @Post('refresh')
  refresh(@Body() dto: RefreshDto, @Req() req: Request, @Ip() ip: string) {
    return this.auth.refresh(dto.refreshToken, { userAgent: req.headers['user-agent'], ip });
  }

  @Post('logout')
  logout(@Body() body: { refreshToken?: string }, @CurrentUser() user: JwtPayload) {
    return this.auth.logout(body?.refreshToken, user.sub);
  }

  /** GET /api/auth/me — who am I. Used by the frontend on every page load. */
  @Get('me')
  me(@CurrentUser() user: JwtPayload) {
    return this.auth.me(user.sub);
  }

  /** GET /api/auth/sessions — this account's login history. */
  @Get('sessions')
  sessions(@CurrentUser() user: JwtPayload) {
    return this.auth.loginHistory(user.sub);
  }

  /** GET /api/auth/users — the team, for the ticket assignee dropdown. */
  @Get('users')
  users() {
    return this.auth.listUsers();
  }
}
