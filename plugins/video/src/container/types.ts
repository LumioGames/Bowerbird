/** What the video plugin reads from a container (builtin-plugins.md「视频 · 提取的技术信息」). */
export interface VideoInfo {
  container: 'mp4' | 'mov' | 'webm' | 'mkv'
  /** Seconds; null when the file does not say and it cannot be measured. */
  duration: number | null
  width: number
  height: number
  frameRate: number | null
  /** Display name, e.g. `H.264`, `ProRes 4444`, `VP9`. */
  codec: string | null
  /** Raw code from the file (`avc1`, `ap4h`, `V_VP9`). */
  codecTag: string | null
  hasVideo: boolean
  hasAudio: boolean
}
