/**
 * Text-to-speech playback via HTML Audio element.
 * Plays a single TTS audio URL and resolves when playback completes.
 */

export interface TtsPlayerHandle {
  play: (url: string) => Promise<void>;
  stop: () => void;
  readonly isPlaying: boolean;
}

/**
 * Creates a TTS player using a persistent <audio> element.
 */
export function createTtsPlayer(): TtsPlayerHandle {
  let audio: HTMLAudioElement | null = null;
  let isPlaying = false;
  let currentPromise: { resolve: () => void; reject: (err: Error) => void } | null = null;

  const getAudio = (): HTMLAudioElement => {
    if (!audio) {
      audio = new Audio();
      audio.addEventListener('ended', () => {
        isPlaying = false;
        if (currentPromise) {
          currentPromise.resolve();
          currentPromise = null;
        }
      });
      audio.addEventListener('error', (evt) => {
        isPlaying = false;
        if (currentPromise) {
          const mediaError = (evt.target as HTMLAudioElement).error;
          currentPromise.reject(
            new Error(`TTS playback error: ${mediaError?.message ?? 'unknown'}`)
          );
          currentPromise = null;
        }
      });
    }
    return audio;
  };

  const play = (url: string): Promise<void> => {
    return new Promise((resolve, reject) => {
      try {
        const audioEl = getAudio();
        isPlaying = true;
        currentPromise = { resolve, reject };
        audioEl.src = url;
        audioEl
          .play()
          .catch((err) => {
            isPlaying = false;
            currentPromise = null;
            reject(err);
          });
      } catch (err) {
        isPlaying = false;
        currentPromise = null;
        reject(err instanceof Error ? err : new Error(String(err)));
      }
    });
  };

  const stop = (): void => {
    if (audio) {
      audio.pause();
      audio.src = '';
    }
    isPlaying = false;
    if (currentPromise) {
      currentPromise.resolve();
      currentPromise = null;
    }
  };

  return {
    play,
    stop,
    get isPlaying() {
      return isPlaying;
    },
  };
}
