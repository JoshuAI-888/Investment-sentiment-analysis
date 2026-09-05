export type CanonicalRedditUrl = {
  canonicalUrl: string;
  externalId: string;
  sourceKind: 'post' | 'comment';
  subreddit: string;
};

const REDDIT_HOST = 'reddit.com';
const REDDIT_ID = /^[a-z0-9]+$/iu;

export function isRedditHost(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/\.$/u, '');
  return normalized === REDDIT_HOST || normalized.endsWith(`.${REDDIT_HOST}`);
}

export function canonicalizeRedditUrl(value: string): CanonicalRedditUrl | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }

  if ((url.protocol !== 'https:' && url.protocol !== 'http:') || !isRedditHost(url.hostname)) {
    return null;
  }

  const segments = url.pathname
    .split('/')
    .filter(Boolean)
    .map((segment) => {
      try {
        return decodeURIComponent(segment);
      } catch {
        return '';
      }
    });

  if (
    segments.length < 4 ||
    segments[0]?.toLowerCase() !== 'r' ||
    segments[2]?.toLowerCase() !== 'comments'
  ) {
    return null;
  }

  const subreddit = segments[1];
  const postId = segments[3]?.toLowerCase();
  if (subreddit === undefined || postId === undefined || !REDDIT_ID.test(postId)) return null;

  const commentId = segments.length >= 6 ? segments[5]?.toLowerCase() : undefined;
  if (commentId !== undefined && !REDDIT_ID.test(commentId)) return null;

  const subredditPath = subreddit.toLowerCase();
  if (commentId !== undefined) {
    return {
      canonicalUrl: `https://www.reddit.com/r/${subredditPath}/comments/${postId}/_/${commentId}/`,
      externalId: `t1_${commentId}`,
      sourceKind: 'comment',
      subreddit,
    };
  }

  return {
    canonicalUrl: `https://www.reddit.com/r/${subredditPath}/comments/${postId}/`,
    externalId: `t3_${postId}`,
    sourceKind: 'post',
    subreddit,
  };
}
