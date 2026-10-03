/**
 * Online presence during a match: the connection pill under the clock (host, ping, reconnecting),
 * the "reconnecting" card while the host is unreachable (Controls keeps the last mirror on screen
 * meanwhile), and host notices as banners plus feed lines. The spectator pill lives in hud.ts.
 */
import type { NetSession } from '../net/session';
import type { World } from '../sim/world';
import { matchScreen } from './core';
import type { UiHost, UiLayout, UiPart } from './core';
import { el, html, setAttr, setText, show } from './dom';
import { iconSvg } from './icons';
import { fmtPing, pingTone } from './online';

export class NetHud implements UiPart {
  private host: UiHost;
  private pill: HTMLElement;
  private pillHost: HTMLElement;
  private pillPing: HTMLElement;
  private reconnect: HTMLElement;
  private reconnectSub: HTMLElement;
  private net: NetSession | null = null;
  private noticesSeen = 0;

  constructor(host: UiHost, layout: UiLayout) {
    this.host = host;
    this.pill = el('div', 'netpill is-off', layout.topCenter);
    this.pill.title = 'Round trip to the host';
    el('span', 'np-dot', this.pill);
    this.pillHost = el('span', 'np-host', this.pill, '');
    this.pillPing = el('span', 'np-ping num', this.pill, '');

    this.reconnect = el('div', 'reconnect-card is-off', layout.center);
    html('div', 'rcn-ic', iconSvg('ping'), this.reconnect);
    el('div', 'rcn-head', this.reconnect, 'The mesh has gone quiet');
    this.reconnectSub = el('div', 'rcn-sub', this.reconnect, '');
  }

  update(world: World | null, _now: number): void {
    const s = this.host.app.session;
    const net = this.host.app.net;
    const inMatch = !!net && !!world && matchScreen(s.screen);
    show(this.pill, inMatch);
    show(this.reconnect, inMatch && !!net?.reconnecting);
    if (net !== this.net) {
      // A new session: whatever it announced before the match was shown in the lobby.
      this.net = net;
      this.noticesSeen = net?.notices.length ?? 0;
    }
    if (!inMatch || !net) return;

    setText(this.pillHost, net.serverName);
    setText(this.pillPing, net.reconnecting ? 'reconnecting…' : fmtPing(net.ping));
    setAttr(this.pill, 'data-tone', net.reconnecting ? 'lost' : pingTone(net.ping));
    if (net.reconnecting) {
      const camp = net.seat === null ? '' : ' The AI holds your camp until you are back.';
      setText(this.reconnectSub, `Reconnecting to ${net.serverName}…${camp}`);
    }

    if (net.notices.length < this.noticesSeen) this.noticesSeen = 0;
    while (this.noticesSeen < net.notices.length) {
      const text = net.notices[this.noticesSeen++];
      this.host.banner({ title: 'FROM THE HOST', sub: text, tone: 'danger', dur: 5 });
      this.host.post(`Host: ${text}`, 'warn');
    }
  }

  dispose(): void {
    this.pill.remove();
    this.reconnect.remove();
  }
}
