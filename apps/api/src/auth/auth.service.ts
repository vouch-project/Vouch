import { InjectRedis } from '@nestjs-modules/ioredis';
import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomBytes } from 'crypto';
import { ethers } from 'ethers';
import type { Redis } from 'ioredis';
import { LoginDto } from './dto/login.dto';

@Injectable()
export class AuthService {
  private nonceTtlSec = 10 * 60; // 10 minutes in seconds

  constructor(
    private readonly jwtService: JwtService,
    @InjectRedis() private readonly redis: Redis,
  ) {}

  async getNonce(address: string): Promise<string> {
    if (!address) throw new Error('Missing address');

    const nonce = randomBytes(16).toString('hex');
    await this.redis.set(this.nonceKey(address), nonce, 'EX', this.nonceTtlSec);

    return nonce;
  }

  async login({ address, signature, loginMessage }: LoginDto): Promise<string> {
    const match = loginMessage.match(/Nonce: ([a-fA-F0-9]{32})/);
    const nonce = match ? match[1] : undefined;
    if (!nonce) throw new Error('No nonce for address');

    const storedNonce = await this.redis.get(this.nonceKey(address));
    if (!storedNonce) throw new Error('No stored nonce for address');
    if (nonce !== storedNonce) throw new Error('Nonce does not match');

    const recovered = ethers.verifyMessage(loginMessage, signature);
    if (recovered.toLowerCase() !== address.toLowerCase())
      throw new Error('Invalid signature');

    const payload = { address };
    const token = this.jwtService.sign(payload);

    await this.redis.del(this.nonceKey(address));

    return token;
  }

  private nonceKey(address: string): string {
    return `nonce:${address.toLowerCase()}`;
  }
}
