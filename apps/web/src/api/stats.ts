import { axiosApi } from './axiosApi';

export type ProtocolStats = { activeLoansCount: number; tvlUsd: number; totalBorrowedUsd: number };

export const getProtocolStats = async (): Promise<ProtocolStats> => (await axiosApi.get<ProtocolStats>('/stats')).data;
