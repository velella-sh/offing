const encoder = new TextEncoder();

/** Read a browser fetch body without buffering an unbounded number of bytes. */
export async function readBounded(response: Response, limit: number, label: string): Promise<Uint8Array<ArrayBuffer>> {
  const reader = response.body?.getReader();
  if (!reader) return new Uint8Array();
  const tooLarge = () => new Error(`${label} exceeds ${limit} bytes.`);
  const chunks: Uint8Array[] = [];
  let length = 0;
  try {
    if (Number(response.headers.get("content-length")) > limit) throw tooLarge();
    for (;;) {
      const chunk = await reader.read();
      if (chunk.done) break;
      length += chunk.value.byteLength;
      if (length > limit) throw tooLarge();
      chunks.push(chunk.value);
    }
  } catch (error) {
    await reader.cancel().catch(() => undefined);
    throw error;
  } finally {
    reader.releaseLock();
  }

  const result = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    result.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return result;
}

/** Hash the Git object framing and bytes to match a blob listed by the Git Trees API. */
export async function gitBlobSha(bytes: Uint8Array): Promise<string> {
  const prefix = encoder.encode(`blob ${bytes.byteLength}\u0000`);
  const object = new Uint8Array(prefix.byteLength + bytes.byteLength);
  object.set(prefix);
  object.set(bytes, prefix.byteLength);
  const digest = await crypto.subtle.digest("SHA-1", object);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}
