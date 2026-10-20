/**
 * The channel's catalogue.
 *
 * Stands in for what a Fire TV publisher would supply. The shape is the
 * point: a title either carries a description track or it does not, and in a
 * real archive catalogue almost none do. The library screen shows that
 * honestly rather than listing only the one title that works, because the
 * gap between those two states is the entire argument for this project.
 */

import type { CueManifest } from '../player/DescriptionPlayer';
import { ATTACHED } from './tracks.generated';

export interface Title {
  id: string;
  name: string;
  /** Rights line, shown in the library. Required for CC-BY material. */
  attribution: string;
  /** Fragmented HLS. Vega plays nothing else — see FRICTION.md entry 5. */
  videoUrl: string;

  /**
   * Present only once a description track has been built for this title.
   * Absent is the normal case, and the library says so.
   */
  description?: {
    trackUrl: string;
    manifest: CueManifest;
    /** How the track came to exist, shown so nobody has to guess. */
    provenance: string;
    /** Stills shown where the device cannot decode. Absent on hardware. */
    preview?: { baseUrl: string; fps: number; count: number; frames: string[] };
  };
}

/**
 * The demo catalogue.
 *
 * Deliberately mostly undescribed. A library where everything is described
 * would show a solved problem; this shows the one that exists.
 */
const TITLES: Title[] = [
  {
    id: 'bbb',
    name: 'Big Buck Bunny',
    attribution: '(c) copyright 2008 Blender Foundation · CC-BY 3.0 · peach.blender.org',
    videoUrl: '', // replaced from the attached track; see below
  },
  {
    // The headline title: a real film, feature-length silences, real
    // dialogue, and no audio description anywhere it is published.
    id: 'sintel',
    name: 'Sintel',
    attribution: '(c) copyright Blender Foundation · CC-BY 3.0 · durian.blender.org',
    videoUrl: '', // replaced from the attached track; see below
  },
  {
    id: 'archive-reel',
    name: 'Archive Reel',
    attribution: 'Public domain',
    videoUrl:
      'https://devstreaming-cdn.apple.com/videos/streaming/examples/bipbop_4x3/bipbop_4x3_variant.m3u8',
  },
];

/**
 * The decode control lived here: Apple's own reference stream, reached through
 * the identical code path with an empty cue list, so that a failure could be
 * attributed to the device rather than to our packaging. It did fail, which is
 * how FRICTION.md entry 10 could be written as a statement about the Vega
 * Virtual Device rather than a suspicion about us.
 *
 * Removed from the catalogue once that question was settled. It is diagnostic
 * scaffolding, and a library is a list of things somebody might watch. The
 * control is still reproducible from the entry recorded in FRICTION.md.
 */

/**
 * Merge in whatever tracks have actually been built and published.
 *
 * A title is described only if a track exists for it, and the catalogue
 * cannot claim otherwise: the badge in the library reads straight off this.
 */
export const CATALOGUE: Title[] = TITLES.map((t) => {
  const attached = ATTACHED[t.id];
  if (!attached) return t;
  return {
    ...t,
    videoUrl: attached.videoUrl,
    description: {
      trackUrl: attached.trackUrl,
      manifest: attached.manifest,
      provenance: attached.provenance,
      preview: attached.preview,
    },
  };
});

export const findTitle = (id: string): Title | undefined =>
  CATALOGUE.find((t) => t.id === id);

/** How many titles in this catalogue a blind viewer can actually follow. */
export const describedCount = (titles: Title[] = CATALOGUE): number =>
  titles.filter((t) => t.description).length;
