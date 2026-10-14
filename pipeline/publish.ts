/**
 * Publishing a description track to S3.
 *
 * The device cannot play a local file — `file://` is refused outright
 * (FRICTION.md entry 5) — so the track has to be reachable over https. For
 * a Fire TV channel that is not a workaround, it is how the thing would
 * actually ship: the publisher builds a track once and serves it beside the
 * programme.
 *
 * Content types matter more than usual here. A `.m3u8` served as
 * `application/octet-stream` is fetched happily and then fails to parse, and
 * the error surfaces far from the cause — as a player that loads nothing,
 * with no indication that the bytes arrived fine and were simply labelled
 * wrong.
 */

import { execFile } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

const run = promisify(execFile);

/** HLS types. The defaults the CLI guesses for these are wrong. */
const CONTENT_TYPE: Record<string, string> = {
  '.m3u8': 'application/vnd.apple.mpegurl',
  '.m4s': 'video/iso.segment',
  '.mp4': 'video/mp4',
  '.json': 'application/json',
};

const typeFor = (name: string): string => {
  const dot = name.lastIndexOf('.');
  return CONTENT_TYPE[name.slice(dot)] ?? 'application/octet-stream';
};

export interface PublishOptions {
  bucket: string;
  /** Key prefix; the title id by default. */
  prefix: string;
  region?: string;
  /** Seconds. Segments are immutable once written, so this can be long. */
  maxAge?: number;
}

export interface PublishResult {
  playlistUrl: string;
  uploaded: string[];
  bytes: number;
}

/**
 * Upload an HLS directory and return the playlist's public URL.
 *
 * Uses the AWS CLI rather than the SDK: this runs once per title at build
 * time, and adding `@aws-sdk/client-s3` to a React Native project's
 * dependency tree to do it would be a poor trade.
 */
export async function publishHls(
  hlsDir: string,
  opts: PublishOptions,
): Promise<PublishResult> {
  const region = opts.region ?? (await currentRegion());
  const files = (await readdir(hlsDir)).filter(
    (f) => f.endsWith('.m3u8') || f.endsWith('.m4s') || f.endsWith('.mp4'),
  );
  if (!files.some((f) => f.endsWith('.m3u8'))) {
    throw new Error(`no playlist in ${hlsDir} — was the track packaged?`);
  }

  const uploaded: string[] = [];
  let bytes = 0;

  for (const name of files) {
    const key = `${opts.prefix}/${name}`;
    // One call per file so each gets its correct content type. `sync` would
    // be fewer calls and would label the playlist wrong.
    const { stdout } = await run('aws', [
      's3', 'cp', join(hlsDir, name), `s3://${opts.bucket}/${key}`,
      '--content-type', typeFor(name),
      '--cache-control', `public, max-age=${opts.maxAge ?? 86_400}`,
      '--region', region,
    ]);
    uploaded.push(key);
    const m = /(\d+) Bytes/.exec(stdout);
    if (m) bytes += Number(m[1]);
  }

  return {
    playlistUrl: `https://${opts.bucket}.s3.${region}.amazonaws.com/${opts.prefix}/index.m3u8`,
    uploaded,
    bytes,
  };
}

/**
 * Create the bucket if it is missing, and allow public reads.
 *
 * Public read is deliberate and narrow: these are CC-BY film descriptions
 * meant to be fetched by televisions that cannot hold a credential. Nothing
 * private is ever published here. S3 blocks public access by default, so
 * that block is lifted explicitly rather than by accident.
 */
export async function ensureBucket(bucket: string, region?: string): Promise<void> {
  const r = region ?? (await currentRegion());

  try {
    await run('aws', ['s3api', 'head-bucket', '--bucket', bucket, '--region', r]);
    return; // already exists and we can see it
  } catch {
    // Fall through and create it.
  }

  const create = ['s3api', 'create-bucket', '--bucket', bucket, '--region', r];
  // us-east-1 is the one region that rejects a LocationConstraint.
  if (r !== 'us-east-1') {
    create.push('--create-bucket-configuration', `LocationConstraint=${r}`);
  }
  await run('aws', create);

  await run('aws', [
    's3api', 'put-public-access-block',
    '--bucket', bucket,
    '--public-access-block-configuration',
    'BlockPublicAcls=false,IgnorePublicAcls=false,BlockPublicPolicy=false,RestrictPublicBuckets=false',
    '--region', r,
  ]);

  const policy = JSON.stringify({
    Version: '2012-10-17',
    Statement: [
      {
        Sid: 'PublicReadDescriptionTracks',
        Effect: 'Allow',
        Principal: '*',
        Action: 's3:GetObject',
        Resource: `arn:aws:s3:::${bucket}/*`,
      },
    ],
  });
  await run('aws', [
    's3api', 'put-bucket-policy',
    '--bucket', bucket, '--policy', policy, '--region', r,
  ]);

  // A television fetching a playlist is a cross-origin request from the
  // player's point of view, and Shaka will not read a response it cannot
  // see the headers of.
  const cors = JSON.stringify({
    CORSRules: [
      {
        AllowedHeaders: ['*'],
        AllowedMethods: ['GET', 'HEAD'],
        AllowedOrigins: ['*'],
        ExposeHeaders: ['Content-Length', 'Content-Range'],
        MaxAgeSeconds: 3_000,
      },
    ],
  });
  await run('aws', [
    's3api', 'put-bucket-cors',
    '--bucket', bucket, '--cors-configuration', cors, '--region', r,
  ]);
}

async function currentRegion(): Promise<string> {
  try {
    const { stdout } = await run('aws', ['configure', 'get', 'region']);
    return stdout.trim() || 'us-east-1';
  } catch {
    return 'us-east-1';
  }
}

export { typeFor as contentTypeFor };
