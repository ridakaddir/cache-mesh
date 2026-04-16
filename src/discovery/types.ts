export type Peer = {
  /** Stable peer identity — the pod IP for DNS discovery. */
  id: string;
  /** Host the HTTP client should dial. */
  host: string;
  /** Port of the sync server on the peer. */
  port: number;
};

export type DiscoveryEvents = {
  'peer:add': (peer: Peer) => void;
  'peer:remove': (peer: Peer) => void;
  error: (err: unknown) => void;
};

export interface Discovery {
  start(): Promise<void>;
  stop(): Promise<void>;
  peers(): Peer[];
  on<K extends keyof DiscoveryEvents>(event: K, listener: DiscoveryEvents[K]): void;
  off<K extends keyof DiscoveryEvents>(event: K, listener: DiscoveryEvents[K]): void;
}
