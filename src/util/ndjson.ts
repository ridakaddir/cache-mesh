const DEFAULT_MAX_LINE_CHARS = 4 * 1024 * 1024;

export class NdjsonParseError extends Error {
  constructor(message: string, cause?: unknown) {
    super(message, cause !== undefined ? { cause } : undefined);
    this.name = 'NdjsonParseError';
  }
}

/**
 * Iterate NDJSON records from a stream of Buffer/string chunks.
 * Throws NdjsonParseError on malformed JSON or if a single line exceeds maxLineChars.
 */
export async function* parseNdjson<T>(
  chunks: AsyncIterable<Uint8Array | string>,
  opts: { maxLineChars?: number } = {},
): AsyncGenerator<T> {
  const maxLineChars = opts.maxLineChars ?? DEFAULT_MAX_LINE_CHARS;
  let buf = '';
  for await (const chunk of chunks) {
    buf += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
    if (buf.length > maxLineChars && buf.indexOf('\n') === -1) {
      throw new NdjsonParseError(`ndjson line exceeds ${maxLineChars} chars`);
    }
    let idx = buf.indexOf('\n');
    while (idx !== -1) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (line.length > 0) yield parseLine<T>(line);
      idx = buf.indexOf('\n');
    }
  }
  const tail = buf.trim();
  if (tail.length > 0) yield parseLine<T>(tail);
}

function parseLine<T>(line: string): T {
  try {
    return JSON.parse(line) as T;
  } catch (err) {
    const preview = line.length > 80 ? `${line.slice(0, 80)}…` : line;
    throw new NdjsonParseError(`invalid JSON in ndjson line: ${preview}`, err);
  }
}
