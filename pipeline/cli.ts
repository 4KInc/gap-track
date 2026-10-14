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

import { execFile } from 'node:child_process';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

import { ClaudeDescriber, claudeConfigured } from './describe/claude';
import { SayVoice } from './synthesis/say';
import { PollyVoice } from './synthesis/polly';
import type { Synthesizer } from './synthesis/types';
import { buildTrack } from './build';
import { mixDescribed } from './mix';
import { ensureBucket, publishHls } from './publish';
import { packageVideoHls } from './package';
import { extractPreview } from './preview';
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
  synth?: string;
  mix: boolean;
  publish?: string;
  transcode: boolean;
}

function parseArgs(argv: string[]): Args {
  const args: Args = { out: 'build/tracks', dry: false, mix: false, transcode: false };
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
    else if (a === '--synth') args.synth = next();
    else if (a === '--dry') args.dry = true;
    else if (a === '--mix') args.mix = true;
    else if (a === '--publish') args.publish = next();
    else if (a === '--transcode') args.transcode = true;
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
  --synth <polly|say> synthesiser                  (default polly)
  --voice <name>      voice name for that engine   (Joanna / Samantha)
  --dry               skip the API, placeholder text
  --mix               also render <title>-described.mp4
  --publish <bucket>  upload the track to S3 and print its https URL
  --transcode         re-encode the programme to 360p H.264 main profile.
                      The virtual device's software decoder refuses 720p
                      High; real hardware does not need this.

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

/**
 * Pick a synthesiser.
 *
 * Polly by default: it runs anywhere, and `say` is macOS-only, so defaulting
 * to the local one would make the pipeline silently unbuildable on Linux and
 * in CI. `say` stays available for working without credentials or a network.
 *
 * Both measure the rendered file, so the guarantee does not depend on which
 * one is chosen — only the voice does.
 */
function makeSynth(args: Args): Synthesizer {
  const which = (args.synth ?? 'polly').toLowerCase();
  if (which === 'say') return new SayVoice({ voice: args.voice });
  if (which === 'polly') {
    return new PollyVoice(args.voice ? { voice: args.voice as never } : {});
  }
  process.stderr.write(`unknown --synth ${which}; expected polly or say\n`);
  process.exit(2);
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
    synth: makeSynth(args),
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
    const v = await packageVideoHls(args.video as string, join(dir, 'video-hls'), {
      transcode: args.transcode,
    });
    process.stdout.write(`  programme: ${v.segmentCount} segments\n`);

    const up = await publishHls(join(dir, 'video-hls'), {
      bucket: args.publish, prefix: `${args.title}/video`,
    });
    const ud = await publishHls(join(dir, 'hls'), {
      bucket: args.publish, prefix: `${args.title}/description`,
    });

    // Stills for devices that cannot decode. Not fetched on hardware.
    const strip = await extractPreview(args.video as string, join(dir, 'preview'));
    await run('aws', [
      's3', 'sync', strip.dir, `s3://${args.publish}/${args.title}/preview/`,
      '--content-type', 'image/jpeg', '--exclude', '*.json',
    ]);
    await run('aws', [
      's3', 'cp', strip.indexPath, `s3://${args.publish}/${args.title}/preview/frames.json`,
      '--content-type', 'application/json',
    ]);
    process.stdout.write(`  preview: ${strip.count} frames at ${strip.fps}fps\n`);
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
