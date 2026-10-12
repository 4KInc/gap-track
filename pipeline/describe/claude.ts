/**
 * Descriptions written by Claude, through the Anthropic API directly.
 *
 * Bedrock would be the AWS route and is a drop-in swap behind `Describer` —
 * same models, different client. The direct API is used here because the
 * project's AWS integration is Polly and S3, where Polly is doing the more
 * interesting work: the measured duration of its rendered audio is the
 * number the entire safety guarantee compares against.
 *
 * Note what this does NOT do: it never decides whether a description is
 * allowed to be spoken. It proposes text. Admission compares measured audio
 * against a measured gap, and that separation is the whole design.
 */

import Anthropic from '@anthropic-ai/sdk';

import { BRIEF, type DescribeOptions, type DescribeRequest, type DescribeResult, type Describer } from './types';

const DEFAULT_MODEL = 'claude-opus-5';

/** Declining is a first-class answer, so the schema has to express it. */
const SCHEMA = {
  type: 'object' as const,
  properties: {
    describe: {
      type: 'boolean',
      description: 'False when nothing visually important changed.',
    },
    text: {
      type: 'string',
      description: 'The description. Empty string when describe is false.',
    },
  },
  required: ['describe', 'text'],
  additionalProperties: false,
};

const countWords = (s: string): number => (s.trim() ? s.trim().split(/\s+/).length : 0);

export class ClaudeDescriber implements Describer {
  readonly name = 'claude';
  private readonly client: Anthropic;
  private readonly model: string;
  private readonly maxAttempts: number;

  constructor(opts: DescribeOptions & { client?: Anthropic } = {}) {
    // Zero-arg construction resolves ANTHROPIC_API_KEY, ANTHROPIC_AUTH_TOKEN,
    // or an `ant auth login` profile. Do not pass a key around.
    this.client = opts.client ?? new Anthropic();
    this.model = opts.model ?? DEFAULT_MODEL;
    this.maxAttempts = opts.maxAttempts ?? 2;
  }

  async describe(req: DescribeRequest): Promise<DescribeResult> {
    // A gap too short to hold a word is not a question worth asking.
    if (req.wordBudget < 1) {
      return { text: '', engine: this.name, model: this.model, declined: true };
    }

    let lastText = '';
    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      const result = await this.ask(req, attempt > 1 ? lastText : null);
      if (result.declined) return result;

      // The budget is a hard ceiling because it came from the length of a
      // measured silence. Over-length text is retried once with the miss
      // named, then declined rather than truncated: cutting a sentence short
      // produces a fragment that is worse than saying nothing.
      if (countWords(result.text) <= req.wordBudget) return result;
      lastText = result.text;
    }

    return { text: '', engine: this.name, model: this.model, declined: true };
  }

  private async ask(req: DescribeRequest, tooLong: string | null): Promise<DescribeResult> {
    const context: string[] = [`You have at most ${req.wordBudget} words.`];
    if (req.dialogueBefore) {
      context.push(`Dialogue leading into this silence: "${req.dialogueBefore}"`);
    } else {
      context.push('No dialogue has been spoken yet.');
    }
    if (req.recentDescriptions.length) {
      context.push(
        `You have already said: ${req.recentDescriptions.map((d) => `"${d}"`).join(', ')}. Do not repeat these.`,
      );
    }
    if (tooLong) {
      context.push(
        `Your previous attempt was "${tooLong}" — ${countWords(tooLong)} words, over the `
        + `${req.wordBudget}-word ceiling. Choose one detail instead of several.`,
      );
    }

    const response = await this.client.messages.create({
      model: this.model,
      max_tokens: 1024,
      system: BRIEF.replace('WORD_BUDGET', String(req.wordBudget)),
      output_config: {
        format: { type: 'json_schema', schema: SCHEMA },
      },
      messages: [
        {
          role: 'user',
          content: [
            ...req.frames.map((f) => ({
              type: 'image' as const,
              source: {
                type: 'base64' as const,
                media_type: f.mediaType,
                data: f.data.toString('base64'),
              },
            })),
            { type: 'text' as const, text: context.join('\n') },
          ],
        },
      ],
    });

    // A safety decline is not a description. Treat it as a decline rather
    // than letting an empty content array read as success.
    if (response.stop_reason === 'refusal') {
      return { text: '', engine: this.name, model: this.model, declined: true };
    }

    const block = response.content.find((b) => b.type === 'text');
    if (!block || block.type !== 'text') {
      return { text: '', engine: this.name, model: this.model, declined: true };
    }

    let parsed: { describe?: boolean; text?: string };
    try {
      parsed = JSON.parse(block.text);
    } catch {
      return { text: '', engine: this.name, model: this.model, declined: true };
    }

    const text = (parsed.text ?? '').trim();
    const declined = parsed.describe === false || text === '';
    return { text: declined ? '' : text, engine: this.name, model: this.model, declined };
  }
}

/** True when the API can be reached, so tests can gate on it synchronously. */
export const claudeConfigured = (): boolean =>
  Boolean(process.env.ANTHROPIC_API_KEY || process.env.ANTHROPIC_AUTH_TOKEN);
