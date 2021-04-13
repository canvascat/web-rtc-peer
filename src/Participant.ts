import merge from 'lodash/merge';
import { WebRtcPeer, WebRtcPeerRecvonly, WebRtcPeerSendonly } from './WebRtcPeer';
import type { WebRtcPeerOptions, ParticipantOptions } from './type';
import { logger } from './util';

export class Participant {
  uid: number;
  rid: number;
  video: HTMLVideoElement; // 本端用来显示
  rtcPeer?: WebRtcPeer;
  onIceCandidate: (candidate: RTCIceCandidate) => void

  constructor(options: ParticipantOptions, onIceCandidate: (candidate: RTCIceCandidate) => void) {
    this.uid = options.uid;
    this.rid = options.rid;
    this.video = options.video
    this.onIceCandidate = onIceCandidate
  }

  async getBrowserVideoStats (): Promise<any> {}

  getVideoElement() {
    return this.video
  }

  dispose() {
    logger.log('Disposing participant ' + this.uid);
    this.rtcPeer?.dispose();
  };
}

export class ParticipantRecvonly extends Participant {
  rtcPeer: WebRtcPeerRecvonly

  constructor(options: ParticipantOptions, onIceCandidate: (candidate: RTCIceCandidate) => void) {
    super(options, onIceCandidate)
    const ops = Object.create(null) as WebRtcPeerOptions;
    ops.remoteVideo = options.video;
    ops.mediaConstraints = options.mediaConstraints
    ops.onicecandidate = this.onIceCandidate?.bind(this)
    this.rtcPeer = new WebRtcPeerRecvonly(ops)
    this.getBrowserVideoStats = this.getBrowserIncomingVideoStats
  }

  /** @returns sdpOffer */
  async start () {
    await this.rtcPeer.start();
    return this.rtcPeer.generateOffer();
  }

  // 获取浏览器输入Video统计
  async getBrowserIncomingVideoStats() {
    const retVal = Object.create(null);
    const peerConnection = this.rtcPeer.peerConnection as RTCPeerConnection;
    const remoteVideoStream = (peerConnection as any).getRemoteStreams()[0] as MediaStream;
    const remoteVideoTrack = remoteVideoStream?.getVideoTracks()[0];
    if (!remoteVideoTrack) return retVal;

    const stats = await peerConnection.getStats(remoteVideoTrack);

    const reportsRtp: RTCInboundRTPStreamStats[] = [];
    const reportsCandidatePair: RTCIceCandidatePairStats[] = []
    const reportTrack: RTCMediaStreamTrackStats[] = []

    stats.forEach((value: RTCStats) => {
      if (value.type === 'inbound-rtp') reportsRtp.push(value);
      else if (value.type === 'candidate-pair') reportsCandidatePair.push(value);
      else if (value.type === 'track') reportTrack.push(value);
    })
    retVal.userId = this.uid;
    if (reportsRtp.length > 0) {
      const reportRtp = reportsRtp[0];
      retVal.timestamp = reportRtp.timestamp;
      retVal.ssrc = reportRtp.ssrc;
      retVal.packetsReceived = reportRtp.packetsReceived;
      retVal.packetsLost = reportRtp.packetsLost;
      retVal.jitter = reportRtp.jitter;
      retVal.bytesReceived = reportRtp.bytesReceived;
      retVal.nackCount = reportRtp.nackCount;
      retVal.firCount = reportRtp.firCount || 0;
      retVal.pliCount = reportRtp.pliCount || 0;
      retVal.sliCount = reportRtp.sliCount || 0;

      const matchCandidatePair = reportsCandidatePair.find(pair => pair.transportId === reportRtp.transportId);
      if (matchCandidatePair) {
        retVal.currentRoundTripTime = matchCandidatePair.currentRoundTripTime;
        retVal.availableBitrate = matchCandidatePair.availableIncomingBitrate;
      }
    }

    if (reportTrack.length > 0) {
      const reportTrack0 = reportTrack[0];
      retVal.frameWidth = reportTrack0.frameWidth;
      retVal.frameHeight = reportTrack0.frameHeight;
      retVal.framesReceived = reportTrack0.framesReceived;
      retVal.framesDecoded = reportTrack0.framesDecoded;
      // retVal.jitterBufferDelay = reportTrack0.jitterBufferDelay;
      // retVal.jitterBufferEmittedCount = reportTrack0.jitterBufferEmittedCount;
    }
    return retVal
  }
}

export class ParticipantSendonly extends Participant {
  rtcPeer: WebRtcPeerSendonly
  private cache: { ops: WebRtcPeerOptions, cb?: (evt: Event) => any }

  constructor(options: ParticipantOptions, onIceCandidate: (candidate: RTCIceCandidate) => void) {
    super(options, onIceCandidate)
    const ops = Object.create(null) as WebRtcPeerOptions;
    ops.localVideo = options.video;
    ops.mediaConstraints = options.mediaConstraints
    ops.onicecandidate = this.onIceCandidate?.bind(this)
    this.cache = { ops };
    this.rtcPeer = new WebRtcPeerSendonly(ops)
    this.getBrowserVideoStats = this.getBrowserOutgoingVideoStats
  }

  async start(ondisconnected?: (evt: Event) => any) {
    await this.rtcPeer.start()
    const offerSdp = await this.rtcPeer.generateOffer()
    const pc = this.rtcPeer.peerConnection;
    this.cache.cb = ondisconnected;
    // ICE连接状态更新事件回调（音视频连接状态）
    pc.addEventListener('iceconnectionstatechange', evt => {
      if (pc.iceConnectionState === 'failed' ||
        pc.iceConnectionState === 'disconnected' ||
        pc.iceConnectionState === 'closed') this.cache.cb?.(evt);
    })
    return offerSdp
  }

  // 切换设备后，更改本地video流
  updateDevice(mediaConstraints: MediaStreamConstraints, ondisconnected?: (evt: Event) => any) {
    this.dispose();
    this.rtcPeer = new WebRtcPeerSendonly(merge(this.cache.ops, { mediaConstraints }))
    return this.start(ondisconnected)
  }

  // 获取浏览器输出Video的统计
  async getBrowserOutgoingVideoStats() {
    const retVal = Object.create(null);
    const peerConnection = this.rtcPeer.peerConnection as RTCPeerConnection;
    const localVideoStream = (peerConnection as any).getLocalStreams()[0] as MediaStream;
    if (!localVideoStream) return retVal;
    const localVideoTrack = localVideoStream.getVideoTracks()[0];
    if (!localVideoTrack) return retVal;
    const stats = await peerConnection.getStats(localVideoTrack);
    const reportsRtp: RTCOutboundRTPStreamStats[] = []
    const reportsCandidatePair: RTCIceCandidatePairStats[] = []
    const reportsMediaSource: RTCMediaStreamTrackStats[] = []
    stats.forEach((value: RTCStats) => {
      if (value.type === 'outbound-rtp') reportsRtp.push(value);
      else if (value.type === 'candidate-pair') reportsCandidatePair.push(value);
      else if (value.type === 'media-source') reportsMediaSource.push(value);
    })
    if (reportsRtp.length > 0) {
      const reportRtp = reportsRtp[0];
      retVal.timestamp = reportRtp.timestamp;
      retVal.ssrc = reportRtp.ssrc;
      retVal.packetsSent = reportRtp.packetsSent;
      retVal.bytesSent = reportRtp.bytesSent;
      retVal.nackCount = reportRtp.nackCount;
      retVal.firCount = reportRtp.firCount || 0;
      retVal.pliCount = reportRtp.pliCount || 0;
      retVal.sliCount = reportRtp.sliCount || 0;
      retVal.totalEncodeTime = (reportRtp as any).totalEncodeTime || 0;
      retVal.totalPacketSendDelay = (reportRtp as any).totalPacketSendDelay || 0;
      const matchCandidatePair = reportsCandidatePair.find(pair => pair.transportId === reportRtp.transportId);

      if (matchCandidatePair) {
        retVal.currentRoundTripTime = matchCandidatePair.currentRoundTripTime;
        retVal.availableBitrate = matchCandidatePair.availableOutgoingBitrate;
      }
    }
    if (reportsMediaSource.length > 0) {
      const { framesPerSecond, frameWidth, frameHeight } = reportsMediaSource[0];
      retVal.mediaSource = `${frameWidth}x${frameHeight}:${framesPerSecond}`
    }
    return retVal;
  }
}
