// rsocket-core expects Node's `Buffer` to exist as a global (it's a browser/SW
// context here, where it doesn't). Provide it before rsocket-core loads — this
// module must be imported FIRST in any entrypoint that uses the channel.
import { Buffer } from 'buffer';

const g = globalThis as unknown as { Buffer?: unknown };
if (!g.Buffer) {
  g.Buffer = Buffer;
}
