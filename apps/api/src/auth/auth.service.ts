import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomBytes } from 'crypto';
import { ethers } from 'ethers';
import { LoginDto } from './dto/login.dto';

type NonceEntry = { nonce: string; createdAt: number };

@Injectable()
export class AuthService {
  private nonces: Record<string, NonceEntry> = {};
  private nonceTtlMs = 10 * 60 * 1000; // 10 minutes

  constructor(private readonly jwtService: JwtService) {
    setInterval(() => this.cleanupOldNonces(), 60 * 1000);
  }

  getNonce(address: string) {
    if (!address) throw new Error('Missing address');

    const nonce = randomBytes(16).toString('hex');
    this.nonces[address.toLowerCase()] = { nonce, createdAt: Date.now() };

    return nonce;
  }

  login({ address, signature, loginMessage }: LoginDto) {
    const match = loginMessage.match(/Nonce: ([a-fA-F0-9]{32})/);
    const nonce = match ? match[1] : undefined;
    if (!nonce) throw new Error('No nonce for address');

    const entry = this.nonces[address.toLowerCase()];
    if (!entry) throw new Error('No stored nonce for address');
    if (nonce !== entry.nonce) throw new Error('Nonce does not match');

    const recovered = ethers.verifyMessage(loginMessage, signature);
    if (recovered.toLowerCase() !== address.toLowerCase())
      throw new Error('Invalid signature');

    const payload = { address };
    const token = this.jwtService.sign(payload);

    delete this.nonces[address.toLowerCase()];

    return token;
  }

  private cleanupOldNonces() {
    const now = Date.now();

    for (const [address, entry] of Object.entries(this.nonces)) {
      if (now - entry.createdAt > this.nonceTtlMs) delete this.nonces[address];
    }
  }
}
