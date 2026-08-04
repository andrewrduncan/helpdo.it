import { Buffer } from 'buffer';
import {
  RSocketClient,
  IdentitySerializer,
  BufferEncoders,
  encodeCompositeMetadata,
  encodeRoute,
  MESSAGE_RSOCKET_COMPOSITE_METADATA,
  MESSAGE_RSOCKET_ROUTING,
} from 'rsocket-core';
import * as RSocketWebSocketClientModule from 'rsocket-websocket-client';
import { getConfig } from './config';
import { getInstance } from './settings';

// CJS/ESM interop: depending on the bundler the constructor may be the module,
// `.default`, or `.default.default`. Unwrap until we hit the actual function.
function resolveCtor(mod: any): any {
  let c = mod;
  while (c && typeof c !== 'function' && c.default) c = c.default;
  return c;
}
const RSocketWebSocketClient: any = resolveCtor(RSocketWebSocketClientModule);

/**
 * RSocket-over-WebSocket client to the helpdo.it API (dedicated port 8081).
 * Hosted in the background service worker. Lazily connects and reuses the
 * socket; drops the cache on error so the next call reconnects.
 *
 * Recipe (verified): Identity serializers + BufferEncoders, data as a JSON
 * Buffer, route via composite routing metadata, JSON data MIME.
 */
let socketPromise: Promise<any> | undefined;

async function connect(): Promise<any> {
  if (socketPromise) return socketPromise;
  const { instanceUrl } = await getInstance();
  if (!instanceUrl) {
    throw new Error('NOT_CONFIGURED'); // no instance set at all
  }
  const config = await getConfig();
  if (!config?.wsUrl) {
    throw new Error('UNREACHABLE'); // instance set, but its discovery doc didn't load
  }
  const client = new RSocketClient({
    serializers: { data: IdentitySerializer, metadata: IdentitySerializer },
    setup: {
      keepAlive: 60000,
      lifetime: 180000,
      dataMimeType: 'application/json',
      metadataMimeType: MESSAGE_RSOCKET_COMPOSITE_METADATA.string,
    },
    transport: new RSocketWebSocketClient({ url: config.wsUrl }, BufferEncoders),
  });
  socketPromise = new Promise((resolve, reject) => {
    client.connect().subscribe({
      onComplete: (socket: any) => resolve(socket),
      onError: (err: any) => {
        socketPromise = undefined;
        reject(err);
      },
      onSubscribe: () => {},
    });
  });
  return socketPromise;
}

/** request/response on a given RSocket route; resolves the decoded JSON reply. */
function requestResponse(route: string, payload: unknown): Promise<any> {
  return connect().then(
    (socket) =>
      new Promise((resolve, reject) => {
        const metadata = encodeCompositeMetadata([
          [MESSAGE_RSOCKET_ROUTING, encodeRoute(route)],
        ]);
        const data = Buffer.from(JSON.stringify(payload ?? {}));
        socket.requestResponse({ data, metadata }).subscribe({
          onComplete: (p: any) => {
            const text = p?.data?.toString?.() ?? '';
            try {
              resolve(JSON.parse(text));
            } catch {
              resolve({ message: text });
            }
          },
          onError: (err: any) => {
            socketPromise = undefined; // force reconnect next time
            reject(err);
          },
        });
      }),
  );
}

/** Connectivity check — echoes back over the "ping" route. */
export function ping(payload: unknown): Promise<any> {
  return requestResponse('ping', payload);
}

/** Look up a question by id (to prefill Train mode from a deep-link). */
export function getQuestion(id: string): Promise<any> {
  return requestResponse('question', { id });
}

/**
 * Fetch a knowledge entry's full answer by id — used when the user clicks one of the
 * suggested options (bubbles). Resolves { knowledgeEntryId, title, answer, hasWalkthrough, walkthroughId }.
 */
export function getAnswer(knowledgeEntryId: string): Promise<any> {
  return requestResponse('answer', { knowledgeEntryId });
}

/** Fetch a recorded walkthrough's steps for an entry → { walkthroughId, steps[] } (for playback). */
export function getWalkthroughSteps(knowledgeEntryId: string): Promise<any> {
  return requestResponse('walkthrough-steps', { knowledgeEntryId });
}

/** Load an existing knowledge entry for editing → { question, answer, tags[], hasWalkthrough, steps }. */
export function knowledgeEdit(knowledgeEntryId: string): Promise<any> {
  return requestResponse('knowledge-edit', { knowledgeEntryId });
}

/** Save edits to an existing entry (answer/tags/steps) → { knowledgeEntryId, saved }. */
export function knowledgeUpdate(payload: {
  knowledgeEntryId: string;
  question?: string;
  answer?: string;
  tags?: string[];
  steps?: string;
}): Promise<any> {
  return requestResponse('knowledge-update', payload);
}

/**
 * Ask a question over the "ask" route → the retrieve/answer-or-queue flow.
 * Resolves the AskResult: { questionId, answered, answer, knowledgeEntryId }.
 */
export function ask(payload: {
  text: string;
  pageUrl?: string;
  pageContext?: string;
  askedBy?: string | null;
}): Promise<any> {
  return requestResponse('ask', payload);
}

/**
 * Record a trained answer over the "train" route (trainer/admin only).
 * Resolves the TrainResult: { knowledgeEntryId, saved }.
 */
export function train(payload: {
  question: string;
  answer: string;
  pageUrl?: string;
  authoredBy?: string | null;
  tags?: string[];
}): Promise<any> {
  return requestResponse('train', payload);
}

/** Walkthrough recording: start → resolves { walkthroughId }. */
export function trainStart(payload: {
  questionId?: string;
  captureScreens: boolean;
  createdBy?: string | null;
}): Promise<any> {
  return requestResponse('train-start', payload);
}

/** Walkthrough recording: append one typed step → { stepCount }. (Screenshots
 *  upload over HTTP — they're too large for an RSocket-over-WS frame.) */
export function trainStep(payload: { walkthroughId: string; step: unknown }): Promise<any> {
  return requestResponse('train-step', payload);
}

/**
 * Walkthrough recording: Stop → summarize into a review DRAFT (no authoring yet).
 * Resolves { walkthroughId, status, answer, steps (JSON string), stepCount }.
 */
export function trainStop(payload: { walkthroughId: string; question?: string }): Promise<any> {
  return requestResponse('train-stop', payload);
}

/**
 * Walkthrough recording: Save the reviewed draft as knowledge — the (edited) answer,
 * tags, and (edited) steps JSON. Resolves { walkthroughId, status, knowledgeEntryId, stepCount }.
 */
export function trainSave(payload: {
  walkthroughId: string;
  question?: string;
  tags?: string[];
  answer?: string;
  steps?: string;
}): Promise<any> {
  return requestResponse('train-save', payload);
}

/** Regenerate the draft answer from the trainer's edited step captions → { answer }. */
export function trainResummarize(payload: { question?: string; steps?: string }): Promise<any> {
  return requestResponse('train-resummarize', payload);
}

/** Type-ahead tag suggestions for the Train tags box. */
export function suggestTags(query: string): Promise<any> {
  return requestResponse('tags', { query });
}
