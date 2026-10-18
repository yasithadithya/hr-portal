/**
 * Upload type sniffing (PLAN.md Phase 10). The Content-Type header is the client's claim; the
 * file's first bytes are the truth. A mismatch is refused, so an HTML/JS file renamed to .png
 * can never land in storage. (Virus scanning is a separate, later control.)
 */
type Sniffer = (b: Buffer) => boolean;

const startsWith = (b: Buffer, bytes: number[], offset = 0) =>
  b.length >= offset + bytes.length && bytes.every((x, i) => b[offset + i] === x);

const SNIFFERS: Record<string, Sniffer> = {
  'application/pdf': (b) => startsWith(b, [0x25, 0x50, 0x44, 0x46, 0x2d]), // %PDF-
  'image/png': (b) => startsWith(b, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  'image/jpeg': (b) => startsWith(b, [0xff, 0xd8, 0xff]),
  'image/webp': (b) =>
    startsWith(b, [0x52, 0x49, 0x46, 0x46]) && startsWith(b, [0x57, 0x45, 0x42, 0x50], 8),
  // DOCX is a ZIP container.
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': (b) =>
    startsWith(b, [0x50, 0x4b, 0x03, 0x04]),
  // SVG is text: must parse as an <svg> document and contain no script or event handlers.
  'image/svg+xml': (b) => {
    const text = b.subarray(0, 512 * 1024).toString('utf8');
    if (!/<svg[\s>]/i.test(text)) return false;
    return !/<script|javascript:|\son[a-z]+\s*=|<foreignObject/i.test(text);
  },
};

export class UploadTypeError extends Error {}

/** Throws unless the bytes match the declared type. */
export function assertFileType(declared: string, body: Buffer): void {
  const sniff = SNIFFERS[declared];
  if (!sniff) throw new UploadTypeError(`File type ${declared} is not allowed`);
  if (!sniff(body))
    throw new UploadTypeError(
      'The file’s contents don’t match its type. Upload the original file.',
    );
}

/** For route handlers: a mismatch becomes a 400 with a readable message. */
export function requireFileType(
  declared: string,
  body: Buffer,
  badRequest: (m: string) => Error,
): void {
  try {
    assertFileType(declared, body);
  } catch (err) {
    if (err instanceof UploadTypeError) throw badRequest(err.message);
    throw err;
  }
}
