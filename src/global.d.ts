/* eslint-disable no-unused-vars */
declare type Nullabel<T> = T | null

declare module 'freeice' {
  const fn: () => RTCIceServer[]
  export default fn
}

interface RTCPeerConnection {
  // https://developer.mozilla.org/zh-CN/docs/Web/API/RTCPeerConnection/onaddstream
  onaddstream: ((this: RTCPeerConnection, ev: MediaStreamEvent) => void) | null;
}

interface MediaDevices {
  getDisplayMedia(constraints?: MediaStreamConstraints): Promise<MediaStream>
}
