/**
 * Small online helpers shared by the lobby, the standings, the connection pill, the end screen
 * and the seat chooser: who holds a seat, who leads, how good a ping is, who may take a camp
 * mid-burn. Pure reads of the NetSession and World state.
 */
import type { AppApi } from '../game/app';
import type { LobbyPlayer, LobbyState } from '../net/protocol';
import type { FactionId } from '../sim/types';
import type { World } from '../sim/world';
import { matchScreen } from './core';

export type PingTone = 'good' | 'fair' | 'poor' | 'unknown';

/** Round-trip bands: under 90 ms feels local, under 180 ms is playable, above that drags. */
export function pingTone(ms: number): PingTone {
  if (ms <= 0) return 'unknown';
  return ms < 90 ? 'good' : ms < 180 ? 'fair' : 'poor';
}

/** "42 ms", or a dash until the host has measured anything. */
export function fmtPing(ms: number): string {
  return ms > 0 ? `${Math.round(ms)} ms` : '—';
}

/** The human holding a seat (connected or lost), or null when the rivals' AI plays it. */
export function seatPlayer(lobby: LobbyState | null, f: FactionId): LobbyPlayer | null {
  const id = lobby?.seats[f]?.playerId ?? null;
  if (id === null || !lobby) return null;
  return lobby.players.find((p) => p.id === id) ?? null;
}

/** The leader's handle (settings, Start, Back to lobby), or null between leaders. */
export function leaderName(lobby: LobbyState | null): string | null {
  if (!lobby?.leaderId) return null;
  return lobby.players.find((p) => p.id === lobby.leaderId)?.name ?? null;
}

/** Online and not commanding a living camp: a seatless watcher, or a Signifier whose camp fell. */
export function watchingOnline(app: AppApi, world: World): boolean {
  const s = app.session;
  if (!app.net || !matchScreen(s.screen)) return false;
  return s.spectator || !(world.factions[s.playerFaction]?.alive ?? false);
}

/**
 * A camp a watcher may take over mid-burn: alive, and steered by the rivals' AI (no Signifier
 * holds the seat, or theirs is away). The host refuses an away seat for its first few seconds.
 */
export function takeableSeat(world: World, lobby: LobbyState | null, f: FactionId): boolean {
  if (lobby?.phase !== 'playing' || !(world.factions[f]?.alive ?? false)) return false;
  const holder = seatPlayer(lobby, f);
  return !holder || !holder.connected;
}
