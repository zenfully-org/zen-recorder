import type { StartCause, StartTrigger } from '@/lib/types';

/**
 * Why a recording started, as its notes say it, from what made the lifecycle want it. A restart
 * after an encoder error is one after the video failed when the recording it replaces had video:
 * the page records the rest of that meeting audio only.
 */
export function startCauseOf(trigger: StartTrigger, stoppedHadVideo: boolean): StartCause {
  switch (trigger) {
    case 'firstRemote':
      return 'auto-first-remote';
    case 'onJoin':
      return 'auto-on-join';
    case 'command':
      return 'manual';
    case 'encoder-error':
      return stoppedHadVideo ? 'restart-after-video-failure' : 'restart-after-encoder-error';
    case 'backlog-full':
      return 'restart-after-backlog-full';
    case 'video-back':
      return 'restart-after-video-back';
  }
}
