// Proximity voice chat. Everyone in the room is joined up peer to peer (WebRTC,
// signalled through the game's own socket), and what you hear of someone depends
// on where they are: full volume within a few metres, gone beyond thirty, muffled
// through a wall, and panned to the side they are on. Push to talk by default.
//
// Only the nearest dozen players are connected at any one time, so a 64-player
// royale is not 63 streams; the set is looked at again every couple of seconds.

import { settings } from './settings.js';
import { input } from './input.js';
import * as sfx from './audio.js';

export const TALK_FLAG = 256;         // a movement flag: this player is transmitting
export const VOICE_RANGE = 30;        // metres: beyond this, nothing
export const VOICE_FULL = 4;          // metres: within this, full volume
export const VOICE_PEERS = 12;        // the most players connected at once (teammates on top)
export const VOICE_PEERS_ALL = 24;    // in Free for All everyone is connected: the whole room talks
export const KILLER_GAIN = 3.0;       // how loud your killer hears you while you wait to respawn
export const DEAD_TALK = 8;           // seconds after dying that your killer can hear you
const ICE = [{ urls: ['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302'] }];

export class Voice {
  constructor(game) {
    this.game = game;
    this.peers = new Map();     // player id -> peer
    this.stream = null;         // my microphone
    this.mic = 'none';          // none | asking | on | denied | nomic
    this.talking = false;
    this.on = false;            // in a room with voice turned on
    this.evalT = 0;
    this.rayT = 0;
    this.lastNote = '';
    this.victims = new Map();   // player id -> until when I hear them, having just killed them
    this.deadTalkUntil = 0;     // while I'm dead, my killer hears me until this
  }

  // in a team mode (and not the warm-up), the whole team is one channel
  teamMode() {
    const g = this.game;
    return g.isTeamMode() && !g.warmup();
  }

  // I killed them: for a few seconds I hear whatever they have to say about it
  killed(victimId) {
    this.victims.set(victimId, { until: this.game.clock + DEAD_TALK, sawDead: false });
  }

  // they killed me: they can hear me for a few seconds
  died(killerId) {
    this.deadTalkUntil = killerId && killerId !== this.game.myId ? this.game.clock + DEAD_TALK : 0;
  }

  mode() {
    return settings.voiceMode || 'push';
  }

  // joining a room: get the microphone (once) and start joining up
  async start() {
    if (this.mode() === 'off' || !window.RTCPeerConnection) return;
    this.on = true;
    if (!this.stream && this.mic !== 'denied' && this.mic !== 'nomic') await this.openMic();
    this.sync();
  }

  async openMic() {
    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) { this.mic = 'nomic'; return; }
    this.mic = 'asking';
    try {
      this.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
      this.mic = 'on';
      for (const tr of this.stream.getAudioTracks()) tr.enabled = false;
      // peers made while we waited get the track now
      for (const P of this.peers.values()) this.attachMic(P);
    } catch (e) {
      this.mic = 'denied';
      this.stream = null;
      if (location.hostname === 'localhost') fetch('/__log?m=' + encodeURIComponent('[voice] microphone refused: ' + (e && e.name) + ' ' + (e && e.message)));
    }
  }

  // another stream in place of the microphone (the tests use a made-up voice)
  replaceMic(stream) {
    this.stream = stream;
    this.mic = 'on';
    const track = stream.getAudioTracks()[0];
    for (const tr of stream.getAudioTracks()) tr.enabled = this.talking;
    for (const P of this.peers.values()) this.attachMic(P);
  }

  // leaving the room: everything down; the microphone stays granted for next time
  stop() {
    this.on = false;
    this.talking = false;
    for (const id of [...this.peers.keys()]) this.drop(id);
    if (this.stream) for (const tr of this.stream.getAudioTracks()) tr.enabled = false;
  }

  // the settings changed: voice turned off or on
  applySettings() {
    if (this.mode() === 'off') { if (this.on) this.stop(); return; }
    if (!this.on && this.game.inRoom && !this.game.offline) this.start();
  }

  // -- who to be connected to -------------------------------------------------

  sync() {
    if (!this.on) return;
    const g = this.game;
    const me = g.me;
    const here = g.camera ? g.camera.position : me.pos;
    const team = this.teamMode();
    const others = [];
    const want = new Set();
    for (const a of g.avatars.map.values()) {
      if (a.id === g.myId) continue;
      const r = g.avatars.roster.get(a.id);
      if (r && r.bot) continue;      // bots have nothing to say, and no way to answer
      // teammates always, whoever I just killed, and whoever just killed me
      if ((team && a.team === me.team) || this.victims.has(a.id) || (this.deadTalkUntil > g.clock && a.id === me.killerId)) want.add(a.id);
      else others.push({ id: a.id, d: Math.hypot(a.pos.x - here.x, a.pos.y - here.y, a.pos.z - here.z) });
    }
    others.sort((p, q) => p.d - q.d);
    for (const o of others.slice(0, Math.max(0, this.peerLimit() - want.size))) want.add(o.id);
    // the lower id opens the connection; the other side answers when the offer comes
    for (const id of want) if (!this.peers.has(id) && g.myId < id) this.connect(id);
    for (const [id, P] of this.peers) {
      const o = others.find((x) => x.id === id);
      // gone from the room, or well out of earshot and not among the nearest any more
      if (!g.avatars.get(id) || (!want.has(id) && o && o.d > VOICE_RANGE * 1.5)) this.drop(id);
    }
  }

  connect(id, answering = false) {
    const g = this.game;
    const pc = new RTCPeerConnection({ iceServers: ICE });
    // perfect negotiation: the higher id is the polite one and gives way when both offer at once
    const P = { id, pc, polite: g.myId > id, makingOffer: false, ignoreOffer: false, sink: null, audio: null, blocked: false, gain: 0, connected: false, pending: [] };
    this.peers.set(id, P);
    pc.onicecandidate = (e) => { if (e.candidate) this.signal(id, { ice: e.candidate.toJSON() }); };
    pc.onnegotiationneeded = async () => {
      try {
        P.makingOffer = true;
        await pc.setLocalDescription();
        this.signal(id, { sdp: pc.localDescription });
      } catch (e) { /* the peer went away mid-offer */ } finally { P.makingOffer = false; }
    };
    pc.ontrack = (e) => {
      const stream = e.streams[0] || new MediaStream([e.track]);
      // Chrome only feeds WebRTC audio into an AudioContext once an element is playing it
      if (!P.audio) {
        P.audio = new Audio();
        P.audio.muted = true;
        P.audio.autoplay = true;
      }
      P.audio.srcObject = stream;
      P.audio.play().catch(() => {});
      if (P.sink) P.sink.close();
      P.sink = sfx.voiceSink(stream);
    };
    pc.onconnectionstatechange = () => {
      P.connected = pc.connectionState === 'connected';
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') this.drop(id);
    };
    // one audio channel each way from the start, so the microphone can be dropped in
    // later with replaceTrack and nothing has to be negotiated again. An answerer's
    // channel comes with the offer (see onMessage).
    if (answering) return;
    P.tr = pc.addTransceiver('audio', { direction: 'sendrecv' });
    this.attachMic(P);
  }

  // my microphone onto this connection's outgoing half (no renegotiation needed)
  attachMic(P) {
    if (!this.stream || !P.tr) return;
    const track = this.stream.getAudioTracks()[0];
    if (!track || P.tr.sender.track === track) return;
    P.tr.sender.replaceTrack(track).catch(() => {});
  }

  drop(id) {
    const P = this.peers.get(id);
    if (!P) return;
    this.peers.delete(id);
    try { P.pc.close(); } catch (e) { /* already */ }
    if (P.sink) P.sink.close();
    if (P.audio) { P.audio.srcObject = null; P.audio = null; }
  }

  signal(id, d) {
    if (!this.game.offline) this.game.send({ t: 'rtc', to: id, d });
  }

  // a signal from another player, relayed by the server
  async onMessage(m) {
    if (!this.on || this.mode() === 'off') return;
    const id = m.from;
    const d = m.d || {};
    let P = this.peers.get(id);
    if (!P) {
      if (!d.sdp || d.sdp.type !== 'offer') return;
      if (this.peers.size >= this.peerLimit() + 4) return;     // more than enough voices already
      this.connect(id, true);
      P = this.peers.get(id);
    }
    const pc = P.pc;
    try {
      if (d.sdp) {
        const offerCollision = d.sdp.type === 'offer' && (P.makingOffer || pc.signalingState !== 'stable');
        P.ignoreOffer = !P.polite && offerCollision;
        if (P.ignoreOffer) return;
        await pc.setRemoteDescription(d.sdp);
        // candidates that came before the description they belong to
        for (const c of P.pending.splice(0)) await pc.addIceCandidate(c).catch(() => {});
        if (d.sdp.type === 'offer') {
          // the channel the offer brought: make it two-way before answering
          const tr = pc.getTransceivers().find((t) => t.receiver && t.receiver.track && t.receiver.track.kind === 'audio');
          if (tr && !P.tr) {
            P.tr = tr;
            tr.direction = 'sendrecv';
            this.attachMic(P);
          }
          await pc.setLocalDescription();
          this.signal(id, { sdp: pc.localDescription });
        }
      } else if (d.ice) {
        if (!pc.remoteDescription) P.pending.push(d.ice);
        else await pc.addIceCandidate(d.ice).catch(() => {});
      }
    } catch (e) {
      /* a stale message from a connection being torn down */
    }
  }

  // -- every frame: the key, and what each voice sounds like from here ----------

  // Free for All is one open channel: everyone hears everyone, wherever they are
  everyone() {
    const r = this.game.room;
    return !!r && r.mode === 'ffa';
  }

  peerLimit() {
    return this.everyone() ? VOICE_PEERS_ALL : VOICE_PEERS;
  }

  update(dt) {
    const g = this.game;
    if (!this.on) { this.talking = false; return; }
    const me = g.me;
    const mode = this.mode();
    // alive, or just killed (your killer hears you for a few seconds)
    const deadTalk = !me.alive && this.deadTalkUntil > g.clock;
    if (me.alive) this.deadTalkUntil = 0;
    const can = this.mic === 'on' && (me.alive || deadTalk) && g.inRoom && !g.paused && !input.typing;
    const want = can && (mode === 'open' || (mode === 'push' && input.down('talk')));
    if (want !== this.talking) {
      this.talking = want;
      if (this.stream) for (const tr of this.stream.getAudioTracks()) tr.enabled = want;
    }
    this.evalT -= dt;
    if (this.evalT <= 0) { this.evalT = 2.0; this.sync(); }
    this.rayT -= dt;
    const doRay = this.rayT <= 0;
    if (doRay) this.rayT = 0.25;
    const cam = g.camera;
    const phys = g.world && g.world.physics;
    const team = this.teamMode();
    const everyone = this.everyone();
    // whoever I just killed: until they are back on their feet, or a few seconds at most
    for (const [id, v] of this.victims) {
      const a = g.avatars.get(id);
      if (a && !a.alive) v.sawDead = true;
      if (v.until < g.clock || (a && a.alive && v.sawDead)) this.victims.delete(id);
    }
    for (const P of this.peers.values()) {
      if (!P.sink) continue;
      const a = g.avatars.get(P.id);
      let gain = 0, pan = 0;
      if (a && this.victims.has(P.id)) {
        // the one I just killed: loud and clear, wherever they are
        gain = KILLER_GAIN;
        P.blocked = false;
      } else if (a && a.alive && (everyone || (team && a.team === me.team))) {
        // my team, or the whole room in Free for All: full volume, from everywhere
        gain = 1;
        P.blocked = false;
      } else if (a && a.alive) {
        const dx = a.pos.x - cam.position.x, dy = a.pos.y + 1.5 - cam.position.y, dz = a.pos.z - cam.position.z;
        const d = Math.sqrt(dx * dx + dy * dy + dz * dz);
        if (d < VOICE_RANGE) {
          gain = d <= VOICE_FULL ? 1 : Math.pow(1 - (d - VOICE_FULL) / (VOICE_RANGE - VOICE_FULL), 1.6);
          const rx = Math.cos(cam.rotation.y), rz = -Math.sin(cam.rotation.y);
          pan = d > 0.5 ? Math.max(-1, Math.min(1, (dx * rx + dz * rz) / d * 0.8)) : 0;
          if (doRay && phys) {
            const dir = { x: dx / d, y: dy / d, z: dz / d };
            P.blocked = !!phys.raycast(cam.position, this.vec(dir), d);
          }
          if (P.blocked) gain *= 0.45;
        } else P.blocked = false;
      }
      P.gain += (gain * settings.volChat - P.gain) * Math.min(1, dt * 12);
      P.sink.set(P.gain, pan, P.blocked ? 700 : 20000);
    }
  }

  vec(d) {
    this._v = this._v || (this.game.camera.position.clone());
    this._v.set(d.x, d.y, d.z);
    return this._v;
  }

  // a line for the HUD: what the microphone is doing
  status() {
    if (!this.on) return '';
    if (this.mic === 'asking') return 'Microphone: allow it to talk';
    if (this.mic === 'denied') return 'Microphone blocked: you can hear, not talk';
    if (this.mic === 'nomic') return 'No microphone: you can hear, not talk';
    if (this.talking && !this.game.me.alive) return 'Your killer can hear you';
    if (this.talking) return this.teamMode() ? 'Talking to your team' : 'Talking';
    return this.mode() === 'open' ? 'Open mic' : '';
  }
}
