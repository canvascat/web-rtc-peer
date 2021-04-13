export const logger = console

export const noop = (error: any) => error && logger.error(error)

export const sleep = (t = 0) => new Promise(resolve => setTimeout(resolve, t))

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

export function removeFIDFromOffer(sdp: string) {
  const n = sdp.indexOf('a=ssrc-group:FID')
  return n > 0 ? sdp.slice(0, n) : sdp
}

export function getSimulcastInfo(videoStream: MediaStream) {
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
