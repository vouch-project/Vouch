import { InjectRedis } from '@nestjs-modules/ioredis';
import {
  BadRequestException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { asAddress } from '@vouch/database-types';
import { randomBytes } from 'crypto';
import { ethers } from 'ethers';
import type { Redis } from 'ioredis';
import { SupabaseService } from '../supabase/supabase.service';
import { LoginDto } from './dto/login.dto';

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private nonceTtlSec = 10 * 60; // 10 minutes in seconds

  constructor(
    private readonly jwtService: JwtService,
    @InjectRedis() private readonly redis: Redis,
    private readonly supabaseService: SupabaseService,
  ) {}

  async getNonce(address: string): Promise<string> {
    if (!address) throw new BadRequestException('Missing address');

    const nonce = randomBytes(16).toString('hex');
    await this.redis.set(this.nonceKey(address), nonce, 'EX', this.nonceTtlSec);

    return nonce;
  }

  async login({ address, signature, loginMessage }: LoginDto): Promise<string> {
    const match = loginMessage.match(/Nonce: ([a-fA-F0-9]{32})/);
    const nonce = match ? match[1] : undefined;
    if (!nonce)
      throw new BadRequestException(
        'Invalid login message format: Nonce not found or invalid',
      );

    const storedNonce = await this.redis.get(this.nonceKey(address));
    if (!storedNonce || nonce !== storedNonce)
      throw new UnauthorizedException('Invalid authentication credentials');

    const recovered = ethers.verifyMessage(loginMessage, signature);
    if (recovered.toLowerCase() !== address.toLowerCase())
      throw new UnauthorizedException('Invalid authentication credentials');

    // Canonical EIP-55 checksum form is what we persist in `users.address`
    // and what we put in the JWT `address` claim so RLS comparisons against
    // `public.current_wallet_address()` line up exactly. (We intentionally
    // do NOT lowercase server-side — that would mangle Solana / Bitcoin /
    // any non-EVM address we add later. Each chain family normalizes in TS.)
    const checksumAddress = asAddress(address);

    const payload = { address: checksumAddress, role: 'authenticated' };
    const token = this.jwtService.sign(payload);

    await this.redis.del(this.nonceKey(address));

    void this.ensureUserProfile(checksumAddress);

    return token;
  }

  private async ensureUserProfile(address: string): Promise<void> {
    try {
      const { error } = await this.supabaseService.client
        .rpc('ensure_user', { p_address: address })
        .abortSignal(AbortSignal.timeout(2_000));

      if (error) {
        this.logger.error(
          `ensure_user failed for ${address}: ${error.message}`,
        );
      }
    } catch (err: unknown) {
      this.logger.error(
        `ensure_user threw for ${address}: ${err instanceof Error ? err.message : String(err)}`,
      );
    }
  }

  private nonceKey(address: string): string {
    return `nonce:${address.toLowerCase()}`;
  }
}
