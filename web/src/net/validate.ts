/**
 * Host-side validation of untrusted client messages: JSON parse, exact shape and type checks for
 * every ClientMessage and every Command variant (numbers finite and in range, ids integers,
 * strings bounded, arrays bounded, no extra-deep nesting). Anything malformed returns null and
 * never reaches the simulation. Faction fields are overwritten by the host with the sender's
 * seat after validation.
 * Owner: HostServer agent.
 */
import type { ClientMessage } from './protocol';

export function parseClientMessage(raw: string): ClientMessage | null {
  return null;
}
