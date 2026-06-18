export type YoutubeChannelSummary = {
  channelId: string;
  title: string;
  customUrl?: string;
  thumbnailUrl?: string;
};

type ChannelsListResponse = {
  items?: Array<{
    id?: string;
    snippet?: {
      title?: string;
      customUrl?: string;
      thumbnails?: { default?: { url?: string } };
    };
  }>;
};

/** Resolve the authenticated user's primary YouTube channel (OAuth token). */
export async function fetchPrimaryYoutubeChannel(
  accessToken: string
): Promise<YoutubeChannelSummary | null> {
  const url = new URL("https://www.googleapis.com/youtube/v3/channels");
  url.searchParams.set("part", "snippet");
  url.searchParams.set("mine", "true");
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${accessToken}`, Accept: "application/json" },
  });
  if (!res.ok) return null;
  const data = (await res.json()) as ChannelsListResponse;
  const item = data.items?.[0];
  const channelId = item?.id?.trim();
  if (!channelId) return null;
  return {
    channelId,
    title: item?.snippet?.title?.trim() || channelId,
    customUrl: item?.snippet?.customUrl?.trim() || undefined,
    thumbnailUrl: item?.snippet?.thumbnails?.default?.url,
  };
}
