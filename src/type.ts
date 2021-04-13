/** Mode in which the PeerConnection will be configured. */
export type WebRtcPeerMode = 'recvonly' | 'sendonly' | 'sendrecv'
export type WebRtcPeerOptions = {
  /** Video tag for the local stream */
  localVideo: HTMLVideoElement,
  /** Video tag for the remote stream */
  remoteVideo: HTMLVideoElement,
  /**
   * Stream to be used as primary source
   * (typically video and audio, or only video if combined with audioStream) for
   * localVideo and to be added as stream to the RTCPeerConnection
   */
  videoStream: MediaStream,
  /**
   * Stream to be used as second source (typically for audio) for localVideo and
   * to be added as stream to the RTCPeerConnection
   */
  audioStream: MediaStream,
  mediaConstraints?: MediaStreamConstraints,
  peerConnection?: RTCPeerConnection,
  configuration?: RTCConfiguration,
  sendSource: string,
  dataChannelConfig: {
    id?: string,
    options?: RTCDataChannelInit
    onopen?: (e: Event) => any,
    onclose?: (e: Event) => any,
    onmessage?: (e: MessageEvent<any>) => any,
    onbufferedamountlow?: (e: Event) => any,
    onerror?: (e: RTCErrorEvent) => any,

  },
  dataChannels?: RTCDataChannelInit,
  onicecandidate?: (arg: RTCIceCandidate) => void,
  oncandidategatheringdone?: (arg: RTCIceCandidate) => void,
  onaddstream?: (ev: MediaStreamEvent) => void,
  onnegotiationneeded?: (ev: Event) => any,
  simulcast: boolean,
  id: string
}

export type ParticipantOptions = {
  uid: number
  rid: number
  video: HTMLVideoElement
  mediaConstraints: MediaStreamConstraints
}
