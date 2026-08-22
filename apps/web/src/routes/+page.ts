import { getProtocolStats } from '$api/stats';
import type { PageLoad } from './$types';

// Stats are fetched via axiosApi which reads localStorage (JWT) in its
// request interceptor — not available during SSR. The landing page has no
// SEO-critical dynamic content, so client-only rendering is acceptable.
export const ssr = false;

export type { ProtocolStats } from '$api/stats';

export const load: PageLoad = () => {
  const statsPromise = getProtocolStats();

  return { streamed: { statsPromise } };
};
