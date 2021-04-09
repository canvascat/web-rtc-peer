import freeice from 'freeice'
import { v4 as uuidv4 } from 'uuid'
import { EventEmitter } from 'events'
import { merge } from 'lodash'

const logger = console

const MEDIA_CONSTRAINTS: MediaStreamConstraints = {
  audio: true,
  video: {
    width: 640,
    frameRate: 15
  }
}

const noop = (error: any) => error && logger.error(error)
const sleep = (t = 0) => new Promise(resolve => setTimeout(resolve, t))

export function bufferizeCandidates(pc: RTCPeerConnection) {
  const candidatesQueue: {
    candidate: RTCIceCandidate,
    resolve: (value: void) => void,
    reject: (reason: any) => void
  }[] = []
  pc.addEventListener('signalingstatechange', () => {
    if (pc.signalingState !== 'stable') return
    candidatesQueue.map(({ candidate, resolve, reject }) =>
      pc.addIceCandidate(candidate).then(resolve, reject))
    candidatesQueue.length = 0
  })

  return (candidate: RTCIceCandidate) => new Promise((resolve: (value: void) => void, reject) => {
    switch (pc.signalingState) {
      case 'closed':
        reject(new Error('PeerConnection object is closed'))
        break
      case 'stable':
        if (pc.remoteDescription) {
          pc.addIceCandidate(candidate).then(resolve, reject)
        } else {
          reject(new Error('No Remote Description'))
        }
        break
      default:
        candidatesQueue.push({ candidate, resolve, reject })
        break
    }
  })
}

function removeFIDFromOffer(sdp: string) {
  const n = sdp.indexOf('a=ssrc-group:FID')
  return n > 0 ? sdp.slice(0, n) : sdp
}

function getSimulcastInfo(videoStream: MediaStream) {
  const videoTracks = videoStream.getVideoTracks()
  if (!videoTracks.length) {
    logger.warn('No video tracks available in the video stream')
    return ''
  }
  return `a=x-google-flag:conference
a=ssrc-group:SIM 1 2 3
a=ssrc:1 cname:localVideo
a=ssrc:1 msid:${videoStream.id} ${videoTracks[0].id},
a=ssrc:1 mslabel:${videoStream.id},
a=ssrc:1 label:${videoTracks[0].id}
a=ssrc:2 cname:localVideo'
a=ssrc:2 msid:${videoStream.id} ${videoTracks[0].id},
a=ssrc:2 mslabel:${videoStream.id}
a=ssrc:2 label:${videoTracks[0].id}
a=ssrc:3 cname:localVideo
a=ssrc:3 msid:${videoStream.id} ${videoTracks[0].id},
a=ssrc:3 mslabel:${videoStream.id}
a=ssrc:3 label:${videoTracks[0].id}`
}

/** Mode in which the PeerConnection will be configured. */
type WebRtcPeerMode = 'recvonly' | 'sendonly' | 'sendrecv'
type WebRtcPeerOptions = {
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

/**
 * Wrapper object of an RTCPeerConnection. This object is aimed to simplify the
 * development of WebRTC-based applications.
 */
export class WebRtcPeer extends EventEmitter {
  mode: WebRtcPeerMode
  peerConnection: RTCPeerConnection
  id: string
  remoteVideo: HTMLVideoElement
  localVideo: HTMLVideoElement
  videoStream: MediaStream
  audioStream?: MediaStream
  dataChannel?: RTCDataChannel
  mediaConstraints?: MediaStreamConstraints
  private simulcast: boolean
  private sendSource: string

  private addIceCandidateFn?: (candidate: RTCIceCandidate) => Promise<void>

  /**
   * Creates an instance of WebRtcPeer.
   * @param {WebRtcPeerMode} mode - Mode in which the PeerConnection will be configured.
   * @param {WebRtcPeerOptions} options
   */
  constructor(mode: WebRtcPeerMode, options: WebRtcPeerOptions) {
    super()
    this.mode = mode
    this.localVideo = options.localVideo
    this.remoteVideo = options.remoteVideo
    this.videoStream = options.videoStream
    this.audioStream = options.audioStream
    this.mediaConstraints = options.mediaConstraints
    this.sendSource = options.sendSource || 'webcam'

    this.id = options.id || uuidv4()
    Object.defineProperty(this, 'id', { writable: false })

    const onicecandidate = options.onicecandidate
    if (onicecandidate) this.on('icecandidate', onicecandidate)

    const oncandidategatheringdone = options.oncandidategatheringdone
    if (oncandidategatheringdone) {
      this.on('candidategatheringdone', oncandidategatheringdone)
    }

    this.simulcast = options.simulcast

    const candidatesQueueOut: Nullabel<RTCIceCandidate>[] = []
    let candidategatheringdone = false

    // Init PeerConnection
    let pc = options.peerConnection
    if (!pc) {
      const configuration: RTCConfiguration = merge({ iceServers: freeice() }, options.configuration)
      pc = new RTCPeerConnection(configuration)
      const useDataChannels = options.dataChannels || false
      if (useDataChannels && !this.dataChannel) {
        const dataChannelConfig = options.dataChannelConfig
        const dcId = dataChannelConfig.id || `WebRtcPeer-${this.id}`
        const dcOptions = dataChannelConfig.options
        const dataChannel = pc.createDataChannel(dcId, dcOptions)
        if (dataChannelConfig) {
          if (dataChannelConfig.onopen) {
            dataChannel.onopen = dataChannelConfig.onopen
          }
          if (dataChannelConfig.onclose) {
            dataChannel.onclose = dataChannelConfig.onclose
          }
          if (dataChannelConfig.onmessage) {
            dataChannel.onmessage = dataChannelConfig.onmessage
          }
          if (dataChannelConfig.onbufferedamountlow) {
            dataChannel.onbufferedamountlow = dataChannelConfig.onbufferedamountlow
          }
          dataChannel.onerror = dataChannelConfig.onerror || noop
        }
        this.dataChannel = dataChannel
      }
    }

    // If event.candidate == null, it means that candidate gathering has finished
    // and RTCPeerConnection.iceGatheringState == "complete".
    // Such candidate does not need to be sent to the remote peer.
    // https://developer.mozilla.org/en-US/docs/Web/API/RTCPeerConnection/icecandidate_event#Indicating_that_ICE_gathering_is_complete
    pc.addEventListener('icecandidate', (event) => {
      const candidate = event.candidate
      if (this.listenerCount('icecandidate') || this.listenerCount('candidategatheringdone')) {
        let cand
        if (candidate) {
          cand = candidate
          this.emit('icecandidate', cand)
          candidategatheringdone = false
        } else if (!candidategatheringdone) {
          this.emit('candidategatheringdone', cand)
        }
        candidategatheringdone = true
      } else if (!candidategatheringdone) {
        candidatesQueueOut.push(candidate)
        if (!candidate) {
          candidategatheringdone = true
        }
      }
    })
    if (options.onaddstream) {
      pc.onaddstream = options.onaddstream
    }
    if (options.onnegotiationneeded) {
      pc.onnegotiationneeded = options.onnegotiationneeded
    }
    this.peerConnection = pc

    this.on('newListener', (event, listener) => {
      if (event === 'icecandidate' || event === 'candidategatheringdone') {
        while (candidatesQueueOut.length) {
          const candidate = candidatesQueueOut.shift()

          if (!candidate === (event === 'candidategatheringdone')) {
            listener(candidate)
          }
        }
      }
    })

    this.on('_dispose', () => {
      const { localVideo, remoteVideo } = this
      if (localVideo) {
        localVideo.pause()
        localVideo.srcObject = null
        localVideo.load()
        localVideo.muted = false
      }
      if (remoteVideo) {
        remoteVideo.pause()
        remoteVideo.srcObject = null
        remoteVideo.load()
      }
      this.removeAllListeners();
      WebRtcPeer.cancelChooseDesktopMedia(this.id)
    })
  }

  /**
   * Callback function invoked when an ICE candidate is received. Developers are
   * expected to invoke this function in order to complete the SDP negotiation.
   * Called when the ICE candidate has been added.
   * @param iceCandidate - Literal object with the ICE candidate description
   */
  addIceCandidate(iceCandidate: RTCIceCandidateInit) {
    const candidate = new RTCIceCandidate(iceCandidate)
    logger.debug('Remote ICE candidate received', iceCandidate)
    if (!this.addIceCandidateFn) {
      this.addIceCandidateFn = bufferizeCandidates(this.peerConnection)
    }
    return this.addIceCandidateFn(candidate)
  }

  public async generateOffer() {
    if (this.mode === 'recvonly') {
      /* Add reception tracks on the RTCPeerConnection. Send tracks are
       * unconditionally added to "sendonly" and "sendrecv" modes, in the
       * constructor's "start()" method, but nothing is done for "recvonly".
       *
       * Here, we add new transceivers to receive audio and/or video, so the
       * SDP Offer that will be generated by the PC includes these medias
       * with the "a=recvonly" attribute.
       */
      const useAudio = !!this.mediaConstraints?.audio
      const useVideo = !!this.mediaConstraints?.video
      useAudio && this.peerConnection.addTransceiver('audio', { direction: 'recvonly' })
      useVideo && this.peerConnection.addTransceiver('video', { direction: 'recvonly' })
    } else if (this.mode === 'sendonly') {
      /* The constructor's "start()" method already added any available track,
       * which by default creates Transceiver with "sendrecv" direction.
       *
       * Here, we set all transceivers to only send audio and/or video, so the
       * SDP Offer that will be generated by the PC includes these medias
       * with the "a=sendonly" attribute.
       */
      this.peerConnection.getTransceivers().forEach(transceiver => {
        transceiver.direction = 'sendonly'
      })
    }
    const sdp = await this.peerConnection.createOffer()
    const offer = this.mangleSdpToAddSimulcast(sdp)
    await this.peerConnection.setLocalDescription(offer)
    const localDescription = this.peerConnection.localDescription
    if (!localDescription) throw new Error('no local description')
    logger.debug('Local description set\n', localDescription.sdp)
    return localDescription.sdp
    // callback(null, localDescription.sdp, this.processAnswer.bind(self));
  }

  // peerConnection Shims over the now deprecated getLocalStreams() and getRemoteStreams()
  public getLocalStreams() {
    const stream = new MediaStream()
    this.peerConnection.getSenders().forEach(({ track }) => track && stream.addTrack(track))
    return [stream]
  }

  public getRemoteStreams() {
    const stream = new MediaStream()
    this.peerConnection.getReceivers().forEach(({ track }) => track && stream.addTrack(track))
    return [stream]
  }

  public getLocalStream(index = 0) {
    this.getLocalStreams()[index]
  }

  public getRemoteStream(index = 0) {
    return this.getRemoteStreams()[index]
  }

  public getLocalSessionDescriptor() {
    return this.peerConnection.localDescription
  }

  public getRemoteSessionDescriptor() {
    return this.peerConnection.remoteDescription
  }

  public showLocalVideo() {
    this.localVideo.srcObject = this.videoStream
    this.localVideo.muted = true
  };

  public send(data: string) {
    if (this.dataChannel?.readyState !== 'open') {
      logger.warn('Trying to send data over a non-existing or closed data channel')
      return
    }
    this.dataChannel.send(data)
  }

  /**
   * Callback function invoked when a SDP answer is received. Developers are
   * expected to invoke this function in order to complete the SDP negotiation.
   *
   * @param sdp - Description of sdpAnswer
   */
  public async processAnswer(sdp: string) {
    const answer = new RTCSessionDescription({ type: 'answer', sdp })

    logger.debug('SDP answer received, setting remote description')

    if (this.peerConnection.signalingState === 'closed') {
      throw new Error('PeerConnection is closed')
    }

    await this.peerConnection.setRemoteDescription(answer)
    this.setRemoteVideo()
  }

  /**
   * Callback function invoked when a SDP offer is received. Developers are
   * expected to invoke this function in order to complete the SDP negotiation.
   *
   * @param sdp - Description of sdpOffer
   */
  public async processOffer(sdp: string) {
    const offer = new RTCSessionDescription({ type: 'offer', sdp })

    logger.debug('SDP offer received, setting remote description')

    if (this.peerConnection.signalingState === 'closed') {
      throw new Error('PeerConnection is closed')
    }

    await this.peerConnection.setRemoteDescription(offer)
    this.setRemoteVideo()
    let answer = await this.peerConnection.createAnswer()
    answer = this.mangleSdpToAddSimulcast(answer)
    logger.debug('Created SDP answer')
    const localDescription = this.peerConnection.localDescription
    if (!localDescription) throw new Error('no local description')
    logger.debug('Local description set\n', localDescription.sdp)
    return localDescription.sdp
  }

  public currentFrame() {
    const remoteVideo = this.remoteVideo
    if (!remoteVideo) return
    if (remoteVideo.readyState < remoteVideo.HAVE_CURRENT_DATA) { throw new Error('No video stream data available') }

    const canvas = document.createElement('canvas')
    canvas.width = remoteVideo.videoWidth
    canvas.height = remoteVideo.videoHeight
    canvas.getContext('2d')?.drawImage(remoteVideo, 0, 0)

    return canvas
  }

  /**
   * @description This method frees the resources used by WebRtcPeer.
   */
  public dispose() {
    logger.debug('Disposing WebRtcPeer')
    const pc = this.peerConnection
    const dc = this.dataChannel
    try {
      if (dc) {
        if (dc.readyState === 'closed') return
        dc.close()
      }

      if (pc) {
        if (pc.signalingState === 'closed') return

        this.getLocalStreams()
          .forEach(stream => stream.getTracks()
            .forEach(track => track?.stop()))

        // FIXME This is not yet implemented in firefox
        // if(videoStream) pc.removeStream(videoStream);
        // if(audioStream) pc.removeStream(audioStream);

        pc.close()
      }
    } catch (err) {
      logger.warn('Exception disposing webrtc peer ' + err)
    }
    this.emit('_dispose')
  }

  private mangleSdpToAddSimulcast(answer: RTCSessionDescriptionInit) {
    if (this.simulcast) {
      logger.debug('Adding multicast info')
      answer = new RTCSessionDescription({
        type: answer.type,
        sdp: removeFIDFromOffer(answer.sdp!) + getSimulcastInfo(this.videoStream)
      })
    }
    return answer
  }

  private setRemoteVideo() {
    if (!this.remoteVideo) return
    this.remoteVideo.pause()

    const stream = this.getRemoteStreams()[0]
    this.remoteVideo.srcObject = stream
    logger.debug('Remote stream:', stream)
    this.remoteVideo.load()
  }

  /**
   * This function creates the RTCPeerConnection object taking into account the
   * properties received in the constructor. It starts the SDP negotiation
   * process: generates the SDP offer and invokes the onsdpoffer callback. This
   * callback is expected to send the SDP offer, in order to obtain an SDP
   * answer from another peer.
   */
  public async start() {
    if (this.mode !== 'recvonly' && !this.videoStream && !this.audioStream) {
      if (this.sendSource === 'webcam') {
        this.videoStream = await navigator.mediaDevices.getUserMedia(this.mediaConstraints || MEDIA_CONSTRAINTS)
      } else {
        this.videoStream = await WebRtcPeer.getScreenConstraints(this.sendSource)
      }
    } else {
      await sleep()
    }
    if (this.peerConnection.signalingState === 'closed') {
      throw new Error('The peer connection object is in "closed" state. This is most likely due to an invocation of the dispose method before accepting in the dialogue')
    }

    if (this.videoStream) {
      this.localVideo && this.showLocalVideo()
      this.videoStream.getTracks()
        .forEach(track => this.peerConnection.addTrack(track, this.videoStream))
    }

    this.audioStream?.getTracks()
      .forEach(track => this.peerConnection.addTrack(track, this.audioStream!))
  }

  get enabled() {
    return this.audioEnabled && this.videoEnabled
  }

  set enable(value: boolean) {
    this.audioEnabled = this.videoEnabled = value
  }

  get audioEnabled() {
    return this.getEnabled('getAudioTracks')
  }

  set audioEnabled(value: boolean) {
    this.setEnabled('getAudioTracks', value)
  }

  get videoEnabled() {
    return this.getEnabled('getVideoTracks')
  }

  set videoEnabled(value: boolean) {
    this.setEnabled('getVideoTracks', value)
  }

  private setEnabled(method: 'getAudioTracks' | 'getVideoTracks', value: boolean) {
    this.getLocalStreams().forEach(stream => stream[method]().forEach(track => track.enabled = value))
  }

  private getEnabled(method: 'getAudioTracks' | 'getVideoTracks') {
    if (!this.peerConnection) return false
    const streams = this.getLocalStreams()
    return streams.some(stream => stream[method]().some(track => track.enabled))
  }

  // TODO: add type
  static async getScreenConstraints(sendSource: string): Promise<MediaStream> {
    const stream = await navigator.mediaDevices.getDisplayMedia()
    if (!stream) throw new Error('This library is not enabled for screen sharing')
    return stream
  }

  static cancelChooseDesktopMedia (id: string) {
    console.log(`Cancel Choose Desktop Media id -> ${id}`)
  }
}

export class WebRtcPeerRecvonly extends WebRtcPeer {
  constructor(options: WebRtcPeerOptions) {
    super('recvonly', options)
  }
}

export class WebRtcPeerSendonly extends WebRtcPeer {
  constructor(options: WebRtcPeerOptions) {
    super('sendonly', options)
  }
}

export class WebRtcPeerSendrecv extends WebRtcPeer {
  constructor(options: WebRtcPeerOptions) {
    super('sendrecv', options)
  }
}
