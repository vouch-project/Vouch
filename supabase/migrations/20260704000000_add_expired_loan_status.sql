ALTER TYPE "loanStatus" ADD VALUE IF NOT EXISTS 'expired';
ALTER TABLE public.loans ADD COLUMN IF NOT EXISTS "expiredAt" timestamptz;
