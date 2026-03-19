import { Injectable } from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import { randomBytes } from 'crypto';
import { ethers } from 'ethers';
import { LoginDto } from './dto/login.dto';

@Injectable()
export class AuthService {
  private nonces: Record<string, string> = {};

  constructor(private readonly jwtService: JwtService) {}

  getNonce(address: string) {
    if (!address) throw new Error('Missing address');

    const nonce = randomBytes(16).toString('hex');
    this.nonces[address.toLowerCase()] = nonce;

    return nonce;
  }

  login({ address, signature, loginMessage }: LoginDto) {
    if (!address || !signature) throw new Error('Missing address or signature');

    const match = loginMessage.match(/Nonce: ([a-fA-F0-9]{32})/);
    const nonce = match ? match[1] : undefined;

    if (!nonce) throw new Error('No nonce for address');

    const recovered = ethers.verifyMessage(loginMessage, signature);

    if (recovered.toLowerCase() !== address.toLowerCase())
      throw new Error('Invalid signature');

    const payload = { address };
    const token = this.jwtService.sign(payload);

    delete this.nonces[address.toLowerCase()];

    return token;
  }
}
