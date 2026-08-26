import { LiveStream } from './xtreamApi';

export interface ChannelQuality {
  label: string;
  streamId: number;
  streamUrl?: string;
}

export interface GroupedChannel {
  baseName: string;
  icon: string;
  categoryId: string;
  epgChannelId: string;
  qualities: ChannelQuality[];
  primaryStreamId: number;
}

// Quality suffixes to detect and strip
const QUALITY_PATTERNS: { regex: RegExp; label: string; priority: number }[] = [
  { regex: /\s*[\|\[\(]?\s*4K\s*[\|\]\)]?\s*$/i, label: '4K', priority: 4 },
  { regex: /\s*[\|\[\(]?\s*FHD\s*[\|\]\)]?\s*$/i, label: 'FHD', priority: 3 },
  { regex: /\s*[\|\[\(]?\s*FULL\s*HD\s*[\|\]\)]?\s*$/i, label: 'FHD', priority: 3 },
  { regex: /\s*[\|\[\(]?\s*HD\s*[\|\]\)]?\s*$/i, label: 'HD', priority: 2 },
  { regex: /\s*[\|\[\(]?\s*SD\s*[\|\]\)]?\s*$/i, label: 'SD', priority: 1 },
];

// Live sources carrying H.265/HEVC are deliberately excluded. The app uses
// the remaining SD/HD/FHD/4K variants of the same channel, avoiding codecs
// that are not reliable across the Android TV and TV Box devices in scope.
const H265_CODEC_PATTERN = /H[.\s-]?265|HEVC|X265/i;

function isH265Variant(name: string): boolean {
  return H265_CODEC_PATTERN.test(name);
}

function parseChannelName(name: string): { baseName: string; qualityLabel: string | null; priority: number } {
  for (const p of QUALITY_PATTERNS) {
    if (p.regex.test(name)) {
      const baseName = name.replace(p.regex, '').trim();
      return { baseName, qualityLabel: p.label, priority: p.priority };
    }
  }
  return { baseName: name.trim(), qualityLabel: null, priority: 2 };
}

export function groupChannels(streams: LiveStream[]): GroupedChannel[] {
  const map = new Map<string, GroupedChannel>();

  for (const stream of streams) {
    if (isH265Variant(stream.name)) continue;

    const { baseName, qualityLabel, priority } = parseChannelName(stream.name);

    const key = `${stream.category_id}::${baseName.toLowerCase()}`;

    if (!map.has(key)) {
      map.set(key, {
        baseName,
        icon: stream.stream_icon,
        categoryId: stream.category_id,
        epgChannelId: stream.epg_channel_id,
        qualities: [],
        primaryStreamId: stream.stream_id,
      });
    }

    const group = map.get(key)!;

    // Use best icon (prefer non-empty)
    if (!group.icon && stream.stream_icon) {
      group.icon = stream.stream_icon;
    }

    const label = qualityLabel || 'PADRÃO';
    group.qualities.push({ label, streamId: stream.stream_id, streamUrl: stream.direct_source });

    // Sort qualities: 4K > FHD > HD > SD > PADRÃO
    group.qualities.sort((a, b) => {
      const order: Record<string, number> = { '4K': 4, 'FHD': 3, 'HD': 2, 'SD': 1, 'PADRÃO': 0 };
      return (order[b.label] ?? 0) - (order[a.label] ?? 0);
    });

    // Primary = highest quality
    group.primaryStreamId = group.qualities[0].streamId;
  }

  return Array.from(map.values());
}
