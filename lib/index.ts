import type WebSocket from "ws";
import {
  AsyncBufferConfig,
  AsyncStream,
  getCallbackWriteStream,
} from "@mojsoski/async-stream";
import { getEventReadStream } from "@mojsoski/async-event-stream";

export type BufferLike =
  | string
  | Buffer
  | DataView
  | number
  | ArrayBufferView
  | Uint8Array
  | ArrayBuffer
  | SharedArrayBuffer
  | Blob
  | readonly any[]
  | readonly number[]
  | { valueOf(): ArrayBuffer }
  | { valueOf(): SharedArrayBuffer }
  | { valueOf(): Uint8Array }
  | { valueOf(): readonly number[] }
  | { valueOf(): string }
  | { [Symbol.toPrimitive](hint: string): string };

export interface WebsocketStreamEncoding<TOutput, TInput = TOutput> {
  decode(data: WebSocket.RawData): TOutput;
  encode(input: TInput): BufferLike;
}

export type JsonValue =
  | { [k: string]: JsonValue | undefined }
  | JsonValue[]
  | string
  | number
  | null;

export const UTF8Encoding: WebsocketStreamEncoding<string, string> = {
  decode(data: WebSocket.RawData): string {
    return data.toString("utf-8");
  },
  encode(input: string): BufferLike {
    return input;
  },
};

export const NoEncoding: WebsocketStreamEncoding<
  WebSocket.RawData,
  BufferLike
> = {
  decode(data: WebSocket.RawData): WebSocket.RawData {
    return data;
  },
  encode(input: BufferLike): BufferLike {
    return input;
  },
};

function combineAbortSignals(...signals: (AbortSignal | undefined)[]) {
  const controller = new AbortController();

  function forwardAbort(signal: AbortSignal) {
    if (signal.aborted) {
      controller.abort(signal.reason);
    } else {
      signal.addEventListener(
        "abort",
        () => {
          controller.abort(signal.reason);
        },
        { once: true }
      );
    }
  }

  for (const signal of signals) {
    if (signal) {
      forwardAbort(signal);
    }
  }

  return controller.signal;
}

export const JsonEncoding: WebsocketStreamEncoding<JsonValue, JsonValue> = {
  decode(data: WebSocket.RawData): JsonValue {
    return JSON.parse(data.toString());
  },
  encode(input: JsonValue): BufferLike {
    return JSON.stringify(input);
  },
};

export async function getWebsocketStream<TOutput, TInput>(
  websocket: WebSocket,
  encoding: WebsocketStreamEncoding<TOutput, TInput>,
  buffer?: AsyncBufferConfig | boolean
): Promise<AsyncStream<TOutput, TInput>> {
  const abortController = new AbortController();

  const readTransform = getEventReadStream(websocket, "message")
    .transform()
    .with(abortController.signal)
    .map(([data]) => encoding.decode(data));

  const readStream = buffer
    ? readTransform
        .buffer(
          buffer !== true
            ? {
                ...buffer,
                signal: combineAbortSignals(
                  abortController.signal,
                  buffer.signal
                ),
              }
            : { signal: abortController.signal }
        )
        .stream()
    : readTransform.stream();

  const writeStream = getCallbackWriteStream<TInput>((item, resolve) =>
    websocket.send(encoding.encode(item), resolve)
  );

  const stream: AsyncStream<TOutput, TInput> = {
    ...readStream,
    ...writeStream,
  };

  return new Promise<AsyncStream<TOutput, TInput>>((resolve, reject) => {
    if (websocket.readyState === websocket.OPEN) {
      resolve(stream);
      return;
    }

    const resolveHandler = () => {
      websocket.removeEventListener("open", resolveHandler);
      websocket.removeEventListener("close", rejectHandler);
      websocket.removeEventListener("error", rejectHandler);

      resolve(stream);
    };

    const rejectHandler = (ev: WebSocket.CloseEvent | WebSocket.ErrorEvent) => {
      abortController.abort(ev);

      websocket.removeEventListener("open", resolveHandler);
      websocket.removeEventListener("close", rejectHandler);
      websocket.removeEventListener("error", rejectHandler);
      reject(new TypeError(`Invalid websocket state: ${websocket.readyState}`));
    };

    websocket.addEventListener("open", resolveHandler);
    websocket.addEventListener("error", rejectHandler);
    websocket.addEventListener("close", rejectHandler);
  });
}
