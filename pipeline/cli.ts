#!/usr/bin/env node
/**
 * Build a description track for a film.
 *
 *   npx tsx pipeline/cli.ts \
 *     --video assets/sintel.mp4 \
 *     --captions assets/sintel.vtt \
 *     --title sintel \
 *     --out build/tracks
 *
 * Needs ANTHROPIC_API_KEY in the environment. `--dry` skips the API and
 * writes placeholder text, which is how you check gap detection and timing
 * on a new film before paying for a few hundred vision calls.
 */

import { join } from 'node:path';

import { ClaudeDescriber, claudeConfigured } from './describe/claude';
import { SayVoice } from './synthesis/say';
import { buildTrack } from './build';
import { mixDescribed } from './mix';
import { ensureBucket, publishHls } from './publish';
import { packageVideoHls } from './package';
import type { DescribeRequest, DescribeResult, Describer } from './describe/types';

interface Args {
  video?: string;
  captions?: string;
  title?: string;
  out: string;
  dry: boolean;
  minGap?: number;
  margin?: number;
  voice?: string;
  mix: boolean;
  publish?: string;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { out: 'build/tracks', dry: false, mix: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    if (a === '--video') args.video = next();
    else if (a === '--captions') args.captions = next();
    else if (a === '--title') args.title = next();
    else if (a === '--out') args.out = next();
    else if (a === '--min-gap') args.minGap = Number(next());
    else if (a === '--margin') args.margin = Number(next());
    else if (a === '--voice') args.voice = next();
    else if (a === '--dry') args.dry = true;
    else if (a === '--mix') args.mix = true;
    else if (a === '--publish') args.publish = next();
    else if (a === '--help' || a === '-h') {
      usage();
      process.exit(0);
    } else {
      throw new Error(`unknown argument: ${a}`);
    }
  }
  return args;
}

function usage(): void {
  process.stdout.write(`
Build a description track for a film.

  --video <path>      programme to describe        (required)
  --captions <path>   WebVTT or SRT                (required)
  --title <id>        output folder name           (required)
  --out <dir>         where tracks go              (default build/tracks)

  --min-gap <ms>      shortest silence worth using (default 1200)
  --margin <ms>       safety margin                (default 250, measured)
  --voice <name>      macOS say voice              (default Samantha)
  --dry               skip the API, placeholder text
  --mix               also render <title>-described.mp4
  --publish <bucket>  upload the track to S3 and print its https URL

The Vega simulator has no audio hardware, so --mix produces the file that
can actually be heard: the programme with its audio ducked under the
descriptions, at the offsets the scheduler admitted.

Needs ANTHROPIC_API_KEY unless --dry.
`);
}

/**
 * Stand-in writer for --dry.
 *
 * Deliberately writes to the exact word budget: the point of a dry run is to
 * see which gaps survive admission and where cues land, and a shorter
 * placeholder would make the track look more spacious than it is.
 */
class PlaceholderDescriber implements Describer {
  readonly name = 'placeholder';
  async describe(req: DescribeRequest): Promise<DescribeResult> {
    const words = Array.from({ length: req.wordBudget }, (_, i) => (i === 0 ? 'Placeholder' : 'word'));
    return { text: `${words.join(' ')}.`, engine: this.name, model: 'none', declined: false };
  }
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));

  const missing = (['video', 'captions', 'title'] as const).filter((k) => !args[k]);
  if (missing.length) {
    process.stderr.write(`missing required argument(s): ${missing.map((m) => `--${m}`).join(', ')}\n`);
    usage();
    process.exit(2);
  }

  if (!args.dry && !claudeConfigured()) {
    process.stderr.write(
      'ANTHROPIC_API_KEY is not set.\n'
      + 'Either export it, or pass --dry to check gaps and timing without the API.\n',
    );
    process.exit(2);
  }

  const started = Date.now();
  const result = await buildTrack({
    titleId: args.title as string,
    videoPath: args.video as string,
    captionsPath: args.captions as string,
    outDir: args.out,
    describer: args.dry ? new PlaceholderDescriber() : new ClaudeDescriber(),
    synth: new SayVoice({ voice: args.voice }),
    config: args.margin ? { safetyMarginMs: args.margin } : undefined,
    minGapMs: args.minGap,
    log: (line) => process.stdout.write(`${line}\n`),
  });

  let published: { video: string; description: string } | null = null;
  if (args.publish) {
    const dir = join(args.out, args.title as string);
    process.stdout.write(`publishing to s3://${args.publish}…\n`);
    await ensureBucket(args.publish);

    // Both streams, or the cue offsets refer to a video the device cannot
    // fetch. Packaging the programme is copy-only, so it costs seconds.
    const v = await packageVideoHls(args.video as string, join(dir, 'video-hls'));
    process.stdout.write(`  programme: ${v.segmentCount} segments\n`);

    const up = await publishHls(join(dir, 'video-hls'), {
      bucket: args.publish, prefix: `${args.title}/video`,
    });
    const ud = await publishHls(join(dir, 'hls'), {
      bucket: args.publish, prefix: `${args.title}/description`,
    });
    published = { video: up.playlistUrl, description: ud.playlistUrl };
    process.stdout.write(`  ${up.uploaded.length + ud.uploaded.length} objects\n`);
  }

  let mixed: string | null = null;
  if (args.mix) {
    const out = join(args.out, args.title as string, `${args.title}-described.mp4`);
    process.stdout.write('mixing described film…\n');
    mixed = (await mixDescribed(
      args.video as string,
      result.track.audioPath,
      result.track.cues,
      out,
    )).outputPath;
  }

  const seconds = ((Date.now() - started) / 1000).toFixed(0);
  process.stdout.write(
    `\ndone in ${seconds}s\n`
    + `  ${result.describedCount} descriptions across ${result.gapCount} gaps\n`
    + `  ${result.declinedCount} declined, ${result.track.rejected.length} refused by admission\n`
    + `  ${result.packaged.playlistPath}\n`
    + (mixed ? `  ${mixed}\n` : '')
    + (published
      ? `\n  programme   ${published.video}\n  description ${published.description}\n`
      : ''),
  );
}

main().catch((err) => {
  process.stderr.write(`\nfailed: ${err?.message ?? String(err)}\n`);
  process.exit(1);
});
