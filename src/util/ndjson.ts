/**
 * Iterate NDJSON records from a stream of Buffer/string chunks.
 */
export async function* parseNdjson<T>(
  chunks: AsyncIterable<Uint8Array | string>,
): AsyncGenerator<T> {
  let buf = '';
  for await (const chunk of chunks) {
    buf += typeof chunk === 'string' ? chunk : Buffer.from(chunk).toString('utf8');
    let idx = buf.indexOf('\n');
    while (idx !== -1) {
      const line = buf.slice(0, idx).trim();
      buf = buf.slice(idx + 1);
      if (line.length > 0) yield JSON.parse(line) as T;
      idx = buf.indexOf('\n');
    }
  }
  const tail = buf.trim();
  if (tail.length > 0) yield JSON.parse(tail) as T;
}
