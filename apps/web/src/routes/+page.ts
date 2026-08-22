import { getProtocolStats } from '$api/stats';
import type { PageLoad } from './$types';

export const ssr = false;

export type { ProtocolStats } from '$api/stats';

export const load: PageLoad = () => {
  const statsPromise = getProtocolStats();

  return { streamed: { statsPromise } };
};
