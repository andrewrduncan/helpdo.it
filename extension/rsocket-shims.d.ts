// rsocket-js 0.x ships no TypeScript types — minimal ambient declarations so
// we can use the bits the channel needs without `any`-importing everywhere.
declare module 'rsocket-core' {
  export const RSocketClient: any;
  export const IdentitySerializer: any;
  export const JsonSerializer: any;
  export const BufferEncoders: any;
  export const MESSAGE_RSOCKET_COMPOSITE_METADATA: any;
  export const MESSAGE_RSOCKET_ROUTING: any;
  export function encodeCompositeMetadata(entries: any[]): any;
  export function encodeRoute(route: string): any;
}

declare module 'rsocket-websocket-client' {
  const RSocketWebSocketClient: any;
  export default RSocketWebSocketClient;
}
