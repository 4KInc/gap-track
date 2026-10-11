/**
 * Exact duration of a WAV file, read from its own header.
 *
 * The admission rule compares a cue's audio duration against a measured gap,
 * so this number is load-bearing. It is deliberately computed from the file
 * rather than taken from a synthesis API's response, estimated from a word
 * count, or parsed out of a tool's human-readable output. Those are all
 * second-hand, and `afinfo` even calls its own figure "estimated".
 *
 * A WAV header gives the answer exactly: the data chunk's length in bytes,
 * divided by how many bytes a second of this format occupies.
 */

export interface WavInfo {
  durationMs: number;
  sampleRate: number;
  channels: number;
  bitsPerSample: number;
  dataBytes: number;
}

const ascii = (b: Buffer, at: number) => b.toString('ascii', at, at + 4);

/**
 * Parse a RIFF/WAVE header.
 *
 * Walks the chunk list rather than assuming `fmt ` and `data` sit at fixed
 * offsets, because real encoders insert `LIST`, `fact` and padding chunks
 * ahead of the audio. Assuming offset 44 works until it suddenly does not.
 */
export function wavInfo(buf: Buffer): WavInfo {
  if (buf.length < 12) throw new Error('not a WAV: too short');
  if (ascii(buf, 0) !== 'RIFF') throw new Error(`not a WAV: expected RIFF, got "${ascii(buf, 0)}"`);
  if (ascii(buf, 8) !== 'WAVE') throw new Error(`not a WAV: expected WAVE, got "${ascii(buf, 8)}"`);

  let sampleRate = 0;
  let channels = 0;
  let bitsPerSample = 0;
  let byteRate = 0;
  let dataBytes = -1;

  let off = 12;
  while (off + 8 <= buf.length) {
    const id = ascii(buf, off);
    const size = buf.readUInt32LE(off + 4);
    const body = off + 8;

    if (id === 'fmt ') {
      if (body + 16 > buf.length) throw new Error('truncated fmt chunk');
      channels = buf.readUInt16LE(body + 2);
      sampleRate = buf.readUInt32LE(body + 4);
      byteRate = buf.readUInt32LE(body + 8);
      bitsPerSample = buf.readUInt16LE(body + 14);
    } else if (id === 'data') {
      // A streamed file can carry a zero or bogus size, so fall back to what
      // is actually present rather than trusting the declared length.
      const available = buf.length - body;
      dataBytes = size > 0 && size <= available ? size : available;
    }

    // Chunks are word-aligned: an odd size is followed by a pad byte.
    off = body + size + (size % 2);
  }

  if (!sampleRate || !channels || !bitsPerSample) throw new Error('WAV has no fmt chunk');
  if (dataBytes < 0) throw new Error('WAV has no data chunk');

  // Prefer the declared byte rate; derive it when the header omits it.
  const bps = byteRate || sampleRate * channels * (bitsPerSample / 8);
  if (!bps) throw new Error('WAV header gives no usable byte rate');

  return {
    durationMs: Math.round((dataBytes / bps) * 1000),
    sampleRate,
    channels,
    bitsPerSample,
    dataBytes,
  };
}

/**
 * The PCM payload, located by walking the chunk list.
 *
 * Needed by the assembler, which splices cue audio into one track. Slicing
 * from a fixed offset would copy an encoder's padding chunks in as samples,
 * which is audible as a click and shifts everything after it.
 */
export function wavData(buf: Buffer): { info: WavInfo; data: Buffer } {
  const info = wavInfo(buf);
  let off = 12;
  while (off + 8 <= buf.length) {
    const id = ascii(buf, off);
    const size = buf.readUInt32LE(off + 4);
    const body = off + 8;
    if (id === 'data') {
      return { info, data: buf.subarray(body, body + info.dataBytes) };
    }
    off = body + size + (size % 2);
  }
  throw new Error('WAV has no data chunk');
}

/** Build a minimal WAV, used by the tests and handy for silence padding. */
export function makeWav(opts: {
  durationMs: number;
  sampleRate?: number;
  channels?: number;
  bitsPerSample?: number;
}): Buffer {
  const sampleRate = opts.sampleRate ?? 24_000;
  const channels = opts.channels ?? 1;
  const bitsPerSample = opts.bitsPerSample ?? 16;
  const byteRate = sampleRate * channels * (bitsPerSample / 8);
  const dataBytes = Math.round((opts.durationMs / 1000) * byteRate);

  const buf = Buffer.alloc(44 + dataBytes);
  buf.write('RIFF', 0, 'ascii');
  buf.writeUInt32LE(36 + dataBytes, 4);
  buf.write('WAVE', 8, 'ascii');
  buf.write('fmt ', 12, 'ascii');
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20); // PCM
  buf.writeUInt16LE(channels, 22);
  buf.writeUInt32LE(sampleRate, 24);
  buf.writeUInt32LE(byteRate, 28);
  buf.writeUInt16LE(channels * (bitsPerSample / 8), 32);
  buf.writeUInt16LE(bitsPerSample, 34);
  buf.write('data', 36, 'ascii');
  buf.writeUInt32LE(dataBytes, 40);
  return buf;
}
