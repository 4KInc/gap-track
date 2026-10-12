/**
 * Writing the descriptions.
 *
 * Behind an interface for the same reason synthesis is: the engine must not
 * care who wrote the line, and the tests must run without a network.
 *
 * The brief is unusual and worth stating plainly, because it is not the task
 * a summarisation prompt expects. At a three-word budget the problem is
 * SELECTION, not compression. An entrance, a reaction, and an object on a
 * table are mutually exclusive choices, and which one matters depends on
 * what the scene has already established — which is why the dialogue leading
 * into the gap is part of the request and not an optimisation.
 */

export interface DescribeRequest {
  /** JPEG or PNG frames sampled from the seconds before the gap. */
  frames: Array<{ data: Buffer; mediaType: 'image/jpeg' | 'image/png' }>;
  /**
   * Words this gap can afford, from `wordBudget()`. A brief, not a limit to
   * be truncated to afterwards.
   */
  wordBudget: number;
  /** Dialogue leading into the gap. Empty when the film has not spoken yet. */
  dialogueBefore: string;
  /** Descriptions already spoken, so the writer does not repeat itself. */
  recentDescriptions: string[];
}

export interface DescribeResult {
  text: string;
  /** Which implementation wrote this, for the provenance record. */
  engine: string;
  model: string;
  /** Null when the writer declined — see below. */
  declined: boolean;
}

export interface Describer {
  readonly name: string;
  describe(req: DescribeRequest): Promise<DescribeResult>;
}

/**
 * The brief, shared by every implementation so the Bedrock and direct-API
 * paths cannot drift apart.
 *
 * Two instructions here are load-bearing and easy to lose in editing:
 *
 * Declining. A describer that always produces something will fill quiet
 * moments with "a person stands in a room", which is worse than silence: it
 * costs the viewer attention and tells them nothing. Saying nothing is a
 * valid answer and the schema has to allow it, or the model will invent.
 *
 * No interpretation. Audio description convention is to report what is
 * visible, not what it means. "She frowns" is description; "she is angry" is
 * the describer deciding for the viewer, which is precisely the authorship
 * blind audiences object to.
 */
export const BRIEF = `You write audio description for blind and low-vision viewers.

A gap of silence has opened in a film. Say what a sighted viewer can see that
a blind viewer would otherwise miss.

Rules:
- At most WORD_BUDGET words. This is a hard ceiling set by the length of the
  silence. Going over means the line cannot be spoken at all.
- Report what is visible. Never interpret, explain, or editorialise. "She
  frowns", not "she is angry". "He looks away", not "he feels guilty".
- Present tense, plain language, no camera vocabulary.
- Do not name characters unless the dialogue has already named them.
- Do not describe anything the dialogue has already said. The viewer heard it.
- If nothing visually important changed, decline. Silence is a valid and
  often correct answer. Do not fill the gap for its own sake.

With a small budget you are choosing, not compressing. Pick the single detail
that matters most to following the story.`;

export interface DescribeOptions {
  model?: string;
  /** Hard retry ceiling for overlong output before giving up. */
  maxAttempts?: number;
}
