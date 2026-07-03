import {
  CanActivate,
  ExecutionContext,
  Injectable,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';

@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(private readonly jwtService: JwtService) {}

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest<{
      user?: { address: string };
      headers: Record<string, string | string[] | undefined>;
    }>();
    const authHeader =
      request.headers['authorization'] || request.headers['Authorization'];
    if (
      !authHeader ||
      typeof authHeader !== 'string' ||
      !authHeader.startsWith('Bearer ')
    ) {
      throw new UnauthorizedException(
        'Missing or invalid Authorization header',
      );
    }
    const token = authHeader.slice(7);
    try {
      const { address } = this.jwtService.verify<{ address?: string }>(token, {
        algorithms: ['ES256', 'HS256'],
      });
      if (!address || typeof address !== 'string')
        throw new UnauthorizedException('Invalid token payload');

      request.user = { address };
      return true;
    } catch {
      throw new UnauthorizedException('Invalid or expired token');
    }
  }
}
