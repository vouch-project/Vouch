import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  Injectable,
} from '@nestjs/common';
import { ethers } from 'ethers';
import { isEqual } from 'lodash';

export interface VerifySignatureGuardOptions {
  messageField?: string;
  signatureField?: string;
  addressField?: string;
  headerPrefix?: string;
}

export interface VerifySignatureOptions {
  messageField?: string;
  signatureField?: string;
  addressField?: string;
  headerPrefix?: string;
}

export interface SignatureRequest {
  [key: string]: any;
}

export interface SignatureHeaders {
  [key: string]: string | string[] | undefined;
}

@Injectable()
export class VerifySignatureGuard implements CanActivate {
  canActivate(context: ExecutionContext): boolean {
    const request: { body: SignatureRequest; headers: SignatureHeaders } =
      context.switchToHttp().getRequest();
    const headers: SignatureHeaders = request.headers || {};
    const body: SignatureRequest = request.body || {};

    const messageField = 'message';
    const signatureField = 'signature';
    const addressField = 'address';
    const headerPrefix = 'x-';

    const getHeader = (key: string) => {
      const lowerKey = (headerPrefix + key).toLowerCase();
      const value =
        headers[lowerKey] || headers[key] || headers[key.toLowerCase()];
      if (Array.isArray(value)) return value[0];
      return value;
    };

    const message = getHeader(messageField);
    const signature = getHeader(signatureField);
    const address = getHeader(addressField);

    // Check that the signed message matches the request body
    let parsedMessage: Record<string, unknown>;
    try {
      parsedMessage = JSON.parse(message as string) as Record<string, unknown>;
      delete parsedMessage.timestamp; // Remove timestamp before comparison
    } catch {
      throw new BadRequestException('Signed message is not valid JSON');
    }
    if (!isEqual(parsedMessage, body)) {
      throw new BadRequestException(
        'Signed message does not match request body',
      );
    }

    let recoveredAddress = '';
    try {
      if (!message || !signature || !address) {
        throw new BadRequestException('Missing message, signature, or address');
      }
      recoveredAddress = ethers.verifyMessage(message, signature);
    } catch {
      throw new BadRequestException('Invalid signature');
    }

    if (
      typeof recoveredAddress !== 'string' ||
      typeof address !== 'string' ||
      recoveredAddress.toLowerCase() !== address.toLowerCase()
    ) {
      throw new BadRequestException('Signature does not match address');
    }

    return true;
  }
}
