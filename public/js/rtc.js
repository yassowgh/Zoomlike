// WebRTC peer-to-peer mesh. One RTCPeerConnection per remote participant.
// Uses the "perfect negotiation" pattern so simultaneous offers don't clash.
// Signaling messages are relayed through the Durable Object (see signaling.js).

export class Mesh {
  constructor({ iceServers, send, onStream, onLeave }) {
    this.iceServers = iceServers;
    this.send = send; // (toPeerId, data) => void
    this.onStream = onStream; // (peerId, name, stream) => void
    this.onLeave = onLeave; // (peerId) => void
    this.selfId = null;
    this.localStream = null;
    this.peers = new Map(); // peerId -> { pc, name, makingOffer, polite }
  }

  setSelf(id) { this.selfId = id; }
  setLocalStream(stream) { this.localStream = stream; }

  addPeer(peerId, name) {
    if (this.peers.has(peerId)) return this.peers.get(peerId);
    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    const entry = { pc, name, makingOffer: false, polite: this.selfId < peerId };
    this.peers.set(peerId, entry);

    // Publish our local tracks. If we have none (view-only participant), add
    // receive-only transceivers so negotiation still happens and we get media.
    const tracks = this.localStream ? this.localStream.getTracks() : [];
    if (tracks.length) {
      for (const track of tracks) pc.addTrack(track, this.localStream);
    } else {
      pc.addTransceiver("audio", { direction: "recvonly" });
      pc.addTransceiver("video", { direction: "recvonly" });
    }
    // If a screen share is already active, publish it to the new peer too.
    if (this.screenStream) {
      const st = this.screenStream.getVideoTracks()[0];
      if (st) pc.addTrack(st, this.screenStream);
    }

    pc.ontrack = (ev) => this.onStream(peerId, name, ev.streams[0]);

    pc.onicecandidate = (ev) => {
      if (ev.candidate) this.send(peerId, { candidate: ev.candidate });
    };

    pc.onnegotiationneeded = async () => {
      try {
        entry.makingOffer = true;
        await pc.setLocalDescription();
        this.send(peerId, { description: pc.localDescription });
      } catch (err) {
        console.warn("negotiation error", err);
      } finally {
        entry.makingOffer = false;
      }
    };

    pc.onconnectionstatechange = () => {
      const st = pc.connectionState;
      if (st === "closed") return this.removePeer(peerId);
      // A failed connection used to be dropped and never retried, leaving the
      // person in the roster with dead media until one side reloaded. Try to
      // rebuild it a few times before giving up on them.
      if (st === "failed") this.recover(peerId);
      if (st === "connected") entry.retries = 0;
    };

    return entry;
  }

  async handleSignal(fromId, name, data) {
    let entry = this.peers.get(fromId);
    if (!entry) entry = this.addPeer(fromId, name);
    const { pc } = entry;

    try {
      if (data.description) {
        const desc = data.description;
        const offerCollision =
          desc.type === "offer" && (entry.makingOffer || pc.signalingState !== "stable");
        const ignore = !entry.polite && offerCollision;
        if (ignore) return;

        if (offerCollision) {
          await pc.setLocalDescription({ type: "rollback" }).catch(() => {});
        }
        await pc.setRemoteDescription(desc);
        if (desc.type === "offer") {
          await pc.setLocalDescription();
          this.send(fromId, { description: pc.localDescription });
        }
      } else if (data.candidate) {
        try {
          await pc.addIceCandidate(data.candidate);
        } catch {
          /* candidate arriving before remote desc; safe to drop */
        }
      }
    } catch (err) {
      console.warn("signal handling error", err);
    }
  }

  // Swap the outgoing video track everywhere (camera <-> screen share) with
  // no renegotiation needed.
  replaceVideoTrack(track) {
    this._replace("video", track);
  }

  // Same for the microphone, so switching to a headset mid-call does not
  // interrupt anyone.
  replaceAudioTrack(track) {
    this._replace("audio", track);
  }

  _replace(kind, track) {
    for (const { pc } of this.peers.values()) {
      // Skip the screen-share sender when looking for the camera.
      const sender = pc.getSenders().find((s) => s.track && s.track.kind === kind &&
        !(kind === "video" && this.screenStream && s.track === this.screenStream.getVideoTracks()[0]));
      if (sender) sender.replaceTrack(track).catch((err) => console.warn("replaceTrack failed", err));
    }
  }

  // Publish a screen-share stream as an ADDITIONAL track (camera keeps going).
  setScreenStream(stream) {
    this.screenStream = stream;
    const track = stream && stream.getVideoTracks()[0];
    if (!track) return;
    for (const { pc } of this.peers.values()) {
      if (![...pc.getSenders()].some((s) => s.track === track)) pc.addTrack(track, stream);
    }
  }
  stopScreenStream() {
    if (!this.screenStream) return;
    const track = this.screenStream.getVideoTracks()[0];
    for (const { pc } of this.peers.values()) {
      const sender = pc.getSenders().find((s) => s.track === track);
      if (sender) { try { pc.removeTrack(sender); } catch {} }
    }
    this.screenStream = null;
  }

  // Rebuild a peer connection that has failed. Re-adding our local tracks
  // fires onnegotiationneeded, which sends a fresh offer, so the connection
  // re-establishes itself without waiting for the other side to do anything.
  recover(peerId) {
    const entry = this.peers.get(peerId);
    if (!entry) return;
    const retries = (entry.retries || 0) + 1;
    if (retries > 3) return this.removePeer(peerId);
    const { name } = entry;
    try { entry.pc.close(); } catch {}
    this.peers.delete(peerId);
    // Deliberately not calling onLeave: the tile stays put on its last frame
    // rather than vanishing and reappearing while we reconnect.
    const fresh = this.addPeer(peerId, name);
    fresh.retries = retries;
  }

  removePeer(peerId) {
    const entry = this.peers.get(peerId);
    if (!entry) return;
    try { entry.pc.close(); } catch {}
    this.peers.delete(peerId);
    this.onLeave(peerId);
  }

  closeAll() {
    for (const id of [...this.peers.keys()]) this.removePeer(id);
  }
}
