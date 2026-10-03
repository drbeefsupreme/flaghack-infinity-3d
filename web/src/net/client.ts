/**
 * Browser side of a FLAGHACK host connection: the WebSocket, hello/welcome (the token reclaims
 * the same player and seat), lobby/chat/notice state for the UI (NetSession, polled through
 * `version`), match traffic handed to the App (NetClientHooks), ping/RTT, and reconnection with
 * backoff when the transmission drops mid-burn.
 * Owner: Controls (NetClient role).
 */
import type { Command } from '../sim/commands';
import type { AvatarInput, FactionId, MatchOptions } from '../sim/types';
import type { FullSnapshot } from './codec';
import { MAX_CHAT_LENGTH, MAX_NAME_LENGTH, PROTOCOL_VERSION, WS_PATH } from './protocol';
import type { ChatLine, ClientMessage, DenyReason, HostInfo, LobbySettings, LobbyState, ServerMessage, StateFrame } from './protocol';
import type { NetSession, NetStatus } from './session';

/** What the App does with match traffic. Only called for the client that owns the hooks. */
export interface NetClientHooks {
  /** Every lobby update (welcome included). */
  lobby(lobby: LobbyState): void;
  /** A match began, or this client (re)joined one: build a fresh mirror and restart input seq at 1. */
  matchStart(options: MatchOptions, seat: FactionId | null, snapshot: FullSnapshot): void;
  state(frame: StateFrame): void;
  /** The session ended for good: `error` is null for a voluntary leave. */
  closed(error: string | null): void;
}

/** Where the reclaim token survives a page reload. */
export interface TokenStore {
  load(): string | null;
  save(token: string): void;
}

export interface NetClientOptions {
  url: string;
  name: string;
  password: string;
  /** Shown until the first lobby state names the host. */
  serverName: string;
  hooks: NetClientHooks;
  tokens: TokenStore;
  /** Socket factory (tests hand in Node's global WebSocket). */
  connect?: (url: string) => WebSocket;
}

const OPEN = 1;
const PING_INTERVAL_MS = 2000;
/** Reconnect backoff doubles from the first delay up to the cap; the attempt gives up after the window. */
const RETRY_FIRST_MS = 500;
const RETRY_MAX_MS = 5000;
const RETRY_WINDOW_MS = 60_000;
const CHAT_KEEP = 100;
const NOTICES_KEEP = 20;
/** RTT smoothing weight of a new sample. */
const RTT_BLEND = 0.2;

/** Host close codes (server/host.ts): a newer window took the token, a denial, shutdown, abuse. */
const CLOSE_REPLACED = 4000;
const CLOSE_DENIED = 4001;
const CLOSE_GOING_AWAY = 1001;
const CLOSE_POLICY = 1008;

const DENY_TEXT: Record<DenyReason, string> = {
  password: 'The password was wrong. The Gate of Flagistan stays shut.',
  protocol: 'This page speaks an older dialect of the Survey. Reload it to join.',
  full: 'This burn is full.',
  name: 'That handle cannot be borne here. Choose another.',
  throttled: 'Too many wrong passwords. Wait a little before trying again.',
  banned: 'The host has turned you away.',
};
/** Denials worth retrying while reconnecting (the token still holds the seat). */
const TRANSIENT_DENY: Record<DenyReason, boolean> = {
  password: false,
  protocol: false,
  full: true,
  name: false,
  throttled: true,
  banned: false,
};

const SERVER_KINDS: Record<ServerMessage['t'], true> = {
  welcome: true,
  denied: true,
  lobby: true,
  chat: true,
  matchStart: true,
  state: true,
  pong: true,
  notice: true,
};

/**
 * Route a host frame by its tag. The host is the player's own trusted process speaking this
 * same protocol module, so the tag check is the boundary: the payload is taken as the named type.
 */
function parseServerMessage(raw: string): ServerMessage | null {
  let v: unknown;
  try {
    v = JSON.parse(raw);
  } catch {
    return null;
  }
  if (typeof v !== 'object' || v === null || !('t' in v) || typeof v.t !== 'string') return null;
  return Object.hasOwn(SERVER_KINDS, v.t) ? (v as ServerMessage) : null;
}

/** INFO_PATH answer, or null when the reply is not a FLAGHACK host's. */
export function parseHostInfo(v: unknown): HostInfo | null {
  if (typeof v !== 'object' || v === null) return null;
  if (!('serverName' in v) || typeof v.serverName !== 'string') return null;
  if (!('protocol' in v) || typeof v.protocol !== 'number') return null;
  if (!('phase' in v) || (v.phase !== 'lobby' && v.phase !== 'playing' && v.phase !== 'ended')) return null;
  if (!('players' in v) || typeof v.players !== 'number') return null;
  if (!('seated' in v) || typeof v.seated !== 'number') return null;
  return { serverName: v.serverName, protocol: v.protocol, phase: v.phase, players: v.players, seated: v.seated };
}

/** The host's WebSocket on the origin that served this page (wss behind an https tunnel). */
export function hostSocketUrl(loc: { protocol: string; host: string }): string {
  return `${loc.protocol === 'https:' ? 'wss' : 'ws'}://${loc.host}${WS_PATH}`;
}

export class NetClient implements NetSession {
  status: NetStatus = 'connecting';
  error: string | null = null;
  version = 0;
  serverName: string;
  lobby: LobbyState | null = null;
  playerId: string | null = null;
  readonly chat: ChatLine[] = [];
  ping = 0;
  reconnecting = false;
  readonly notices: string[] = [];

  private readonly url: string;
  private readonly name: string;
  private readonly password: string;
  private readonly hooks: NetClientHooks;
  private readonly tokens: TokenStore;
  private readonly connect: (url: string) => WebSocket;
  private ws: WebSocket | null = null;
  private token: string | null;
  private inMatch = false;
  private matchSeat: FactionId | null = null;
  private welcomed = false;
  private finished = false;
  /** A transient denial arrived while reconnecting: keep retrying when the host closes the socket. */
  private retryAfterDeny = false;
  private droppedAt = 0;
  private retryDelay = RETRY_FIRST_MS;
  /** Bumped per scheduled reconnect; a stale timer finds a newer number and does nothing. */
  private attempt = 0;
  private pingId = 0;

  constructor(opts: NetClientOptions) {
    this.url = opts.url;
    this.name = opts.name.trim().slice(0, MAX_NAME_LENGTH);
    this.password = opts.password;
    this.serverName = opts.serverName;
    this.hooks = opts.hooks;
    this.tokens = opts.tokens;
    this.connect = opts.connect ?? ((url) => new WebSocket(url));
    this.token = opts.tokens.load();
    this.open();
    this.pingLoop();
  }

  get seat(): FactionId | null {
    if (this.inMatch) return this.matchSeat;
    const me = this.lobby?.players.find((p) => p.id === this.playerId);
    return me ? me.seat : null;
  }

  get isLeader(): boolean {
    return this.playerId !== null && this.lobby !== null && this.lobby.leaderId === this.playerId;
  }

  /** The socket is up and the host knows us (inputs and lobby actions can go out). */
  get connected(): boolean {
    return this.welcomed && !this.reconnecting && this.ws !== null && this.ws.readyState === OPEN;
  }

  setSeat(seat: FactionId | null): void {
    this.send({ t: 'seat', seat });
  }

  setReady(ready: boolean): void {
    this.send({ t: 'ready', ready });
  }

  setSettings(settings: Partial<LobbySettings>): void {
    this.send({ t: 'settings', settings });
  }

  start(): void {
    this.send({ t: 'start' });
  }

  backToLobby(): void {
    this.send({ t: 'backToLobby' });
  }

  sendChat(text: string): void {
    const line = text.trim().slice(0, MAX_CHAT_LENGTH);
    if (line.length > 0) this.send({ t: 'chat', text: line });
  }

  /** One local sim tick of a seated player (see ClientMessage 'input'). Serialized at once. */
  sendInput(seq: number, input: AvatarInput, cmds: Command[]): void {
    if (this.inMatch && this.connected) this.send({ t: 'input', seq, input, cmds });
  }

  leave(): void {
    this.finish(null);
  }

  private changed(): void {
    this.version++;
  }

  private send(msg: ClientMessage): void {
    const ws = this.ws;
    if (ws && ws.readyState === OPEN) ws.send(JSON.stringify(msg));
  }

  private open(): void {
    let ws: WebSocket;
    try {
      ws = this.connect(this.url);
    } catch {
      this.socketClosed(0);
      return;
    }
    this.ws = ws;
    ws.onopen = () => {
      if (this.ws !== ws) return;
      this.send({ t: 'hello', protocol: PROTOCOL_VERSION, name: this.name, password: this.password, token: this.token });
      if (!this.reconnecting) {
        this.status = 'joining';
        this.changed();
      }
    };
    ws.onmessage = (e: MessageEvent) => {
      if (this.ws !== ws || typeof e.data !== 'string') return;
      const msg = parseServerMessage(e.data);
      if (msg) this.receive(msg);
    };
    ws.onclose = (e: CloseEvent) => {
      if (this.ws !== ws) return;
      this.ws = null;
      this.socketClosed(e.code);
    };
  }

  private receive(msg: ServerMessage): void {
    switch (msg.t) {
      case 'welcome':
        this.playerId = msg.playerId;
        this.token = msg.token;
        this.tokens.save(msg.token);
        this.lobby = msg.lobby;
        this.serverName = msg.lobby.serverName;
        this.welcomed = true;
        this.reconnecting = false;
        this.retryAfterDeny = false;
        this.retryDelay = RETRY_FIRST_MS;
        // Back from a drop mid-burn: matchStart follows at once, so the lobby must not flash.
        if (!this.inMatch || msg.lobby.phase === 'lobby') {
          this.inMatch = false;
          this.status = 'lobby';
        }
        this.changed();
        this.hooks.lobby(msg.lobby);
        return;
      case 'denied':
        if (this.reconnecting && TRANSIENT_DENY[msg.reason]) {
          this.retryAfterDeny = true;
          return;
        }
        this.finish(msg.message || DENY_TEXT[msg.reason]);
        return;
      case 'lobby':
        this.lobby = msg.lobby;
        this.serverName = msg.lobby.serverName;
        if (msg.lobby.phase === 'lobby' && this.inMatch) {
          this.inMatch = false;
          this.status = 'lobby';
        }
        this.changed();
        this.hooks.lobby(msg.lobby);
        return;
      case 'chat':
        this.chat.push(msg.line);
        if (this.chat.length > CHAT_KEEP) this.chat.splice(0, this.chat.length - CHAT_KEEP);
        this.changed();
        return;
      case 'matchStart':
        this.inMatch = true;
        this.matchSeat = msg.seat;
        this.status = 'match';
        this.changed();
        this.hooks.matchStart(msg.options, msg.seat, msg.snapshot);
        return;
      case 'state':
        if (this.inMatch) this.hooks.state(msg.frame);
        return;
      case 'pong': {
        const rtt = performance.now() - msg.clientTime;
        if (rtt < 0 || !Number.isFinite(rtt)) return;
        this.ping = this.ping === 0 ? rtt : this.ping + (rtt - this.ping) * RTT_BLEND;
        this.changed();
        return;
      }
      case 'notice':
        this.notices.push(msg.text);
        if (this.notices.length > NOTICES_KEEP) this.notices.splice(0, this.notices.length - NOTICES_KEEP);
        this.changed();
        return;
    }
  }

  private socketClosed(code: number): void {
    if (this.finished) return;
    if (code === CLOSE_REPLACED) return this.finish('This handle was claimed from another window.');
    if (code === CLOSE_GOING_AWAY) return this.finish(this.notices[this.notices.length - 1] ?? 'The host has ended the burn.');
    if (code === CLOSE_POLICY) return this.finish('The host closed the connection.');
    if (code === CLOSE_DENIED && !this.retryAfterDeny) return this.finish('The host refused the connection.');
    // Never got in: a wrong address or a host that is down. Nothing to reclaim, so no retry.
    if (!this.welcomed) return this.finish('Could not reach the host.');
    const now = performance.now();
    if (!this.reconnecting) {
      this.reconnecting = true;
      this.droppedAt = now;
      this.retryDelay = RETRY_FIRST_MS;
      this.changed();
    }
    if (now - this.droppedAt >= RETRY_WINDOW_MS) return this.finish('Lost the transmission from the host.');
    this.retryAfterDeny = false;
    const attempt = ++this.attempt;
    setTimeout(() => {
      if (!this.finished && attempt === this.attempt) this.open();
    }, this.retryDelay);
    this.retryDelay = Math.min(RETRY_MAX_MS, this.retryDelay * 2);
  }

  /** One self-rescheduling chain for the session's life: a ping every interval while connected. */
  private pingLoop(): void {
    setTimeout(() => {
      if (this.finished) return;
      if (this.connected) this.send({ t: 'ping', id: ++this.pingId, clientTime: performance.now() });
      this.pingLoop();
    }, PING_INTERVAL_MS);
  }

  private finish(error: string | null): void {
    if (this.finished) return;
    this.finished = true;
    this.attempt++;
    const ws = this.ws;
    this.ws = null;
    if (ws && ws.readyState <= OPEN) ws.close(1000);
    this.status = 'closed';
    this.error = error;
    this.reconnecting = false;
    this.inMatch = false;
    this.changed();
    this.hooks.closed(error);
  }
}
