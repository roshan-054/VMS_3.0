/**
 * Station-wide "a video is being recorded" flag. Background jobs (Sheets polling, uploads)
 * check it and stay quiet while recording so the page's main thread is free for the camera.
 */
let recording = false;

export function setStationRecording(active: boolean): void {
  recording = active;
}

export function isStationRecording(): boolean {
  return recording;
}
