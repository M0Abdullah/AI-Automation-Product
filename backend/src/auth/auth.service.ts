import {
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as crypto from 'node:crypto';
import { UserRole } from '../common/enums';
import { AppConfigService } from '../config/app-config.service';
import { PrismaService } from '../prisma/prisma.service';
import { LoginDto, RegisterDto } from './dto/auth.dto';
import { PasswordService } from './password.service';

export interface JwtPayload {
  sub: string;
  email: string;
  role: string;
  name: string;
}

export interface AuthResult {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  user: { id: string; email: string; name: string; role: string };
}

/**
 * ACCOUNTS AND SESSIONS.
 *
 * Two tokens, on purpose:
 *  - access token  : short-lived JWT, sent on every request, not stored server-side
 *  - refresh token : long-lived random string, hashed in the database
 *
 * The refresh row doubles as the login history ("who signed in, from where,
 * when"), and it is what makes logout actually revoke access rather than just
 * forgetting a token in the browser.
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly passwords: PasswordService,
    private readonly jwt: JwtService,
    private readonly config: AppConfigService,
  ) {}

  async register(dto: RegisterDto, meta: { userAgent?: string; ip?: string }): Promise<AuthResult> {
    const email = dto.email.trim().toLowerCase();

    const existing = await this.prisma.user.findUnique({ where: { email } });
    if (existing) {
      throw new ForbiddenException('An account with that email already exists. Try signing in.');
    }

    const userCount = await this.prisma.user.count();

    // The very first account always becomes OWNER - somebody has to be able to
    // administer the instance. After that, registration can be closed off.
    if (userCount > 0 && !this.config.auth.allowOpenRegistration) {
      throw new ForbiddenException(
        'Registration is closed on this instance. Ask an owner to create your account.',
      );
    }

    const user = await this.prisma.user.create({
      data: {
        email,
        name: dto.name.trim(),
        passwordHash: await this.passwords.hash(dto.password),
        role: userCount === 0 ? UserRole.OWNER : UserRole.QA,
      },
    });

    this.logger.log(`Registered ${user.email} as ${user.role}`);
    return this.issueTokens(user, meta);
  }

  async login(dto: LoginDto, meta: { userAgent?: string; ip?: string }): Promise<AuthResult> {
    const email = dto.email.trim().toLowerCase();
    const user = await this.prisma.user.findUnique({ where: { email } });

    // Same message and roughly the same work whether the email exists or not,
    // so the response cannot be used to enumerate accounts.
    if (!user) {
      await this.passwords.hash(dto.password);
      throw new UnauthorizedException('Email or password is incorrect.');
    }
    if (!(await this.passwords.verify(dto.password, user.passwordHash))) {
      throw new UnauthorizedException('Email or password is incorrect.');
    }
    if (!user.isActive) {
      throw new ForbiddenException('This account has been deactivated.');
    }

    await this.prisma.user.update({
      where: { id: user.id },
      data: { lastLoginAt: new Date() },
    });

    return this.issueTokens(user, meta);
  }

  /** Exchanges a refresh token for a new pair, rotating the stored row. */
  async refresh(refreshToken: string, meta: { userAgent?: string; ip?: string }) {
    const tokenHash = hashToken(refreshToken);
    const session = await this.prisma.loginSession.findUnique({
      where: { tokenHash },
      include: { user: true },
    });

    if (!session || session.revokedAt || session.expiresAt < new Date()) {
      throw new UnauthorizedException('Your session has expired. Please sign in again.');
    }

    // Rotate: the old token stops working the moment a new one is issued, so a
    // stolen refresh token has a short useful life.
    await this.prisma.loginSession.update({
      where: { id: session.id },
      data: { revokedAt: new Date() },
    });

    return this.issueTokens(session.user, meta);
  }

  async logout(refreshToken?: string, userId?: string) {
    if (refreshToken) {
      await this.prisma.loginSession
        .updateMany({
          where: { tokenHash: hashToken(refreshToken), revokedAt: null },
          data: { revokedAt: new Date() },
        })
        .catch(() => undefined);
    } else if (userId) {
      // No token supplied: revoke every session for the user.
      await this.prisma.loginSession.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      });
    }
    return { loggedOut: true };
  }

  async me(userId: string) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        name: true,
        role: true,
        createdAt: true,
        lastLoginAt: true,
      },
    });
    if (!user) throw new UnauthorizedException('Account no longer exists.');
    return user;
  }

  /** Login history for the current user - the "record of login" requirement. */
  loginHistory(userId: string) {
    return this.prisma.loginSession.findMany({
      where: { userId },
      orderBy: { createdAt: 'desc' },
      take: 25,
      select: {
        id: true,
        userAgent: true,
        ipAddress: true,
        createdAt: true,
        expiresAt: true,
        revokedAt: true,
      },
    });
  }

  /** Team list, used by the ticket assignee dropdown. */
  listUsers() {
    return this.prisma.user.findMany({
      where: { isActive: true },
      orderBy: { name: 'asc' },
      select: { id: true, email: true, name: true, role: true, lastLoginAt: true },
    });
  }

  // ------------------------------------------------------------- internals

  private async issueTokens(
    user: { id: string; email: string; name: string; role: string },
    meta: { userAgent?: string; ip?: string },
  ): Promise<AuthResult> {
    const { accessTtlMinutes, refreshTtlDays } = this.config.auth;

    const payload: JwtPayload = {
      sub: user.id,
      email: user.email,
      role: user.role,
      name: user.name,
    };
    const accessToken = await this.jwt.signAsync(payload, {
      expiresIn: `${accessTtlMinutes}m`,
    });

    const refreshToken = crypto.randomBytes(48).toString('base64url');
    await this.prisma.loginSession.create({
      data: {
        userId: user.id,
        tokenHash: hashToken(refreshToken),
        userAgent: meta.userAgent?.slice(0, 300),
        ipAddress: meta.ip?.slice(0, 60),
        expiresAt: new Date(Date.now() + refreshTtlDays * 24 * 60 * 60 * 1000),
      },
    });

    return {
      accessToken,
      refreshToken,
      expiresIn: accessTtlMinutes * 60,
      user: { id: user.id, email: user.email, name: user.name, role: user.role },
    };
  }
}

/** The raw refresh token is never stored - only this hash. */
function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}
