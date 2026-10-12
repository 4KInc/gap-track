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
  };
}

/**
 * The demo catalogue.
 *
 * Deliberately mostly undescribed. A library where everything is described
 * would show a solved problem; this shows the one that exists.
 */
export const CATALOGUE: Title[] = [
  {
    id: 'bipbop',
    name: 'Reference Stream',
    attribution: 'Apple Inc. · developer test stream',
    videoUrl:
      'https://devstreaming-cdn.apple.com/videos/streaming/examples/img_bipbop_adv_example_fmp4/master.m3u8',
    // Description is filled in at build time by scripts/attach-track.ts once
    // the pipeline has produced a manifest for it.
  },
  {
    id: 'archive-reel',
    name: 'Archive Reel',
    attribution: 'Public domain',
    videoUrl:
      'https://devstreaming-cdn.apple.com/videos/streaming/examples/bipbop_4x3/bipbop_4x3_variant.m3u8',
  },
];

export const findTitle = (id: string): Title | undefined =>
  CATALOGUE.find((t) => t.id === id);

/** How many titles in this catalogue a blind viewer can actually follow. */
export const describedCount = (titles: Title[] = CATALOGUE): number =>
  titles.filter((t) => t.description).length;
