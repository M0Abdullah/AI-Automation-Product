import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  SetMetadata,
  UnauthorizedException,
  createParamDecorator,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { JwtService } from '@nestjs/jwt';
import type { Request } from 'express';
import { UserRole, WRITE_ROLES } from '../common/enums';
import type { JwtPayload } from './auth.service';

export const IS_PUBLIC_KEY = 'isPublic';
export const ROLES_KEY = 'requiredRoles';

/** Marks an endpoint as reachable without a token (login, register, health). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

/** Restricts an endpoint to the listed roles. */
export const Roles = (...roles: string[]) => SetMetadata(ROLES_KEY, roles);

/** Shorthand for "must be OWNER or QA" - anything that changes test state. */
export const RequireWrite = () => Roles(...WRITE_ROLES);

export interface AuthenticatedRequest extends Request {
  user?: JwtPayload;
}

/**
 * Extracts the signed-in user in a controller:
 *   findAll(@CurrentUser() user: JwtPayload) { ... }
 */
export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  const req = ctx.switchToHttp().getRequest<AuthenticatedRequest>();
  return req.user;
});

/**
 * REGISTERED GLOBALLY in AppModule.
 *
 * Default-deny: every endpoint requires a valid token unless it is explicitly
 * marked @Public(). That ordering matters — a new endpoint added later is
 * protected by default rather than accidentally open.
 */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    const req = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const token = extractToken(req);

    // Public routes still decode a token when one is present, so endpoints can
    // optionally personalise without requiring auth.
    if (isPublic) {
      if (token) {
        try {
          req.user = await this.jwt.verifyAsync<JwtPayload>(token);
        } catch {
          /* ignore - the route is public */
        }
      }
      return true;
    }

    if (!token) {
      throw new UnauthorizedException('Sign in to continue.');
    }

    try {
      req.user = await this.jwt.verifyAsync<JwtPayload>(token);
    } catch (err) {
      const expired = (err as Error)?.name === 'TokenExpiredError';
      throw new UnauthorizedException(
        expired ? 'Your session expired. Please sign in again.' : 'Invalid session token.',
      );
    }

    const required = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);

    if (required?.length) {
      const role = req.user.role;
      // OWNER always passes: an instance owner locked out of their own tooling
      // is a worse failure than an over-broad permission.
      if (role !== UserRole.OWNER && !required.includes(role)) {
        throw new ForbiddenException(
          `Your role (${role}) cannot do this. Required: ${required.join(' or ')}.`,
        );
      }
    }

    return true;
  }
}

function extractToken(req: Request): string | undefined {
  const header = req.headers.authorization;
  if (header?.startsWith('Bearer ')) return header.slice(7).trim() || undefined;
  return undefined;
}
