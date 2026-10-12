/**
 * The describer's contract, tested against a stubbed client so the suite
 * stays hermetic and free.
 *
 * What matters here is not prose quality — that is judged by listening — but
 * the two behaviours the rest of the system depends on: the word budget is a
 * hard ceiling derived from a measured silence, and declining is a real
 * answer rather than a failure to be papered over.
 */

import { ClaudeDescriber, claudeConfigured } from '../../pipeline/describe/claude';
import { BRIEF, type DescribeRequest } from '../../pipeline/describe/types';

type FakeReply = { describe: boolean; text: string } | { refusal: true };

/** Minimal stand-in for the SDK client: records requests, replays replies. */
const stubClient = (replies: FakeReply[]) => {
  const sent: Array<Record<string, unknown>> = [];
  let i = 0;
  return {
    sent,
    messages: {
      create: async (params: Record<string, unknown>) => {
        sent.push(params);
        const r = replies[Math.min(i++, replies.length - 1)];
        if ('refusal' in r) {
          return { stop_reason: 'refusal', content: [] };
        }
        return {
          stop_reason: 'end_turn',
          content: [{ type: 'text', text: JSON.stringify(r) }],
        };
      },
    },
  };
};

const req = (over: Partial<DescribeRequest> = {}): DescribeRequest => ({
  frames: [{ data: Buffer.from([0xff, 0xd8, 0xff]), mediaType: 'image/jpeg' }],
  wordBudget: 7,
  dialogueBefore: 'Where did she go?',
  recentDescriptions: [],
  ...over,
});

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const make = (replies: FakeReply[]) => {
  const client = stubClient(replies);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { client, d: new ClaudeDescriber({ client: client as any }) };
};

describe('ClaudeDescriber: the word budget is a ceiling', () => {
  it('accepts text within budget', async () => {
    const { d } = make([{ describe: true, text: 'She folds the letter.' }]);
    const r = await d.describe(req({ wordBudget: 7 }));
    expect(r.text).toBe('She folds the letter.');
    expect(r.declined).toBe(false);
  });

  it('retries once when the writer overruns, naming the miss', async () => {
    const { client, d } = make([
      { describe: true, text: 'She folds the letter and sets it down on the table slowly' },
      { describe: true, text: 'She folds the letter.' },
    ]);
    const r = await d.describe(req({ wordBudget: 5 }));

    expect(r.text).toBe('She folds the letter.');
    expect(client.sent).toHaveLength(2);
    // The retry has to say what went wrong, or it is just a reroll.
    const second = client.sent[1] as { messages: Array<{ content: Array<{ text?: string }> }> };
    const sentText = second.messages[0].content.map((c) => c.text ?? '').join(' ');
    expect(sentText).toContain('over the 5-word ceiling');
  });

  it('declines rather than truncating when it cannot get under budget', async () => {
    // Truncating would leave a fragment, which is worse than silence.
    const { d } = make([
      { describe: true, text: 'one two three four five six seven eight nine ten' },
    ]);
    const r = await d.describe(req({ wordBudget: 3 }));
    expect(r.declined).toBe(true);
    expect(r.text).toBe('');
  });

  it('does not ask at all when the gap affords no words', async () => {
    const { client, d } = make([{ describe: true, text: 'anything' }]);
    const r = await d.describe(req({ wordBudget: 0 }));
    expect(r.declined).toBe(true);
    expect(client.sent).toHaveLength(0);
  });
});

describe('ClaudeDescriber: declining is a real answer', () => {
  it('honours an explicit decline', async () => {
    const { d } = make([{ describe: false, text: '' }]);
    const r = await d.describe(req());
    expect(r.declined).toBe(true);
    expect(r.text).toBe('');
  });

  it('treats empty text as a decline even when describe is true', async () => {
    const { d } = make([{ describe: true, text: '   ' }]);
    expect((await d.describe(req())).declined).toBe(true);
  });

  it('treats a safety refusal as a decline, not a success', async () => {
    // An empty content array would otherwise read as an empty description.
    const { d } = make([{ refusal: true }]);
    const r = await d.describe(req());
    expect(r.declined).toBe(true);
  });

  it('declines on unparseable output rather than passing it through', async () => {
    const client = {
      sent: [] as unknown[],
      messages: {
        create: async () => ({
          stop_reason: 'end_turn',
          content: [{ type: 'text', text: 'not json at all' }],
        }),
      },
    };
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const d = new ClaudeDescriber({ client: client as any });
    expect((await d.describe(req())).declined).toBe(true);
  });
});

describe('ClaudeDescriber: what the writer is told', () => {
  it('sends the frames as images', async () => {
    const { client, d } = make([{ describe: true, text: 'ok' }]);
    await d.describe(req());
    const sent = client.sent[0] as { messages: Array<{ content: Array<{ type: string }> }> };
    expect(sent.messages[0].content[0].type).toBe('image');
  });

  it('includes the dialogue leading in, because the choice depends on it', async () => {
    const { client, d } = make([{ describe: true, text: 'ok' }]);
    await d.describe(req({ dialogueBefore: 'Where did she go?' }));
    const sent = client.sent[0] as { messages: Array<{ content: Array<{ text?: string }> }> };
    expect(sent.messages[0].content.map((c) => c.text ?? '').join(' ')).toContain('Where did she go?');
  });

  it('says so when nothing has been spoken yet', async () => {
    const { client, d } = make([{ describe: true, text: 'ok' }]);
    await d.describe(req({ dialogueBefore: '' }));
    const sent = client.sent[0] as { messages: Array<{ content: Array<{ text?: string }> }> };
    expect(sent.messages[0].content.map((c) => c.text ?? '').join(' ')).toContain('No dialogue');
  });

  it('passes recent descriptions so it does not repeat itself', async () => {
    const { client, d } = make([{ describe: true, text: 'ok' }]);
    await d.describe(req({ recentDescriptions: ['She folds the letter.'] }));
    const sent = client.sent[0] as { messages: Array<{ content: Array<{ text?: string }> }> };
    expect(sent.messages[0].content.map((c) => c.text ?? '').join(' ')).toContain('Do not repeat');
  });

  it('puts the actual budget into the brief', async () => {
    const { client, d } = make([{ describe: true, text: 'ok' }]);
    await d.describe(req({ wordBudget: 4 }));
    const sent = client.sent[0] as { system: string };
    expect(sent.system).toContain('At most 4 words');
    expect(sent.system).not.toContain('WORD_BUDGET');
  });
});

describe('the brief', () => {
  it('forbids interpretation, which is the convention blind viewers ask for', () => {
    expect(BRIEF).toContain('Never interpret');
  });

  it('permits declining, so the writer is not forced to invent', () => {
    expect(BRIEF).toContain('decline');
  });
});

describe('claudeConfigured', () => {
  it('reports whether credentials are present', () => {
    // Decided from the environment synchronously, so a gated integration
    // test cannot silently skip the way the synthesis tests once did.
    expect(typeof claudeConfigured()).toBe('boolean');
  });
});
