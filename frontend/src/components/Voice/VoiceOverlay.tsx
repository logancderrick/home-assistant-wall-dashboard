/**
 * Voice state overlay display.
 * Shows waveform animation, transcript, or error message.
 */

import { motion, AnimatePresence } from 'framer-motion';
import { useVoiceContext } from '../../contexts/VoiceContext';
import { VoiceState } from '../../lib/voice/constants';
import VoiceMicIcon from './VoiceMicIcon';

export default function VoiceOverlay() {
  const { voiceState, transcript, error, dismiss } = useVoiceContext();

  const isVisible =
    voiceState !== VoiceState.IDLE ||
    (voiceState === VoiceState.ERROR && error !== null);

  return (
    <AnimatePresence>
      {isVisible && (
        <motion.div
          className="fixed inset-0 flex items-center justify-center z-30 pointer-events-none"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          <motion.div
            className="bg-skydark-surface rounded-3xl shadow-2xl px-8 py-12 max-w-sm text-center pointer-events-auto"
            initial={{ scale: 0.95, y: 20 }}
            animate={{ scale: 1, y: 0 }}
            exit={{ scale: 0.95, y: 20 }}
            transition={{ duration: 0.3 }}
          >
            {voiceState === VoiceState.CONNECTING && (
              <>
                <div className="mb-6">
                  <motion.div
                    animate={{ opacity: [0.5, 1, 0.5] }}
                    transition={{ duration: 1.5, repeat: Infinity }}
                  >
                    <VoiceMicIcon className="w-12 h-12 text-skydark-accent mx-auto" />
                  </motion.div>
                </div>
                <p className="text-skydark-text-secondary text-sm">Connecting...</p>
              </>
            )}

            {voiceState === VoiceState.LISTENING && (
              <>
                <div className="mb-6 flex justify-center gap-1">
                  {[0, 1, 2, 3, 4].map((i) => (
                    <motion.div
                      key={i}
                      className="w-1 bg-skydark-accent rounded-full"
                      style={{ height: 24 }}
                      animate={{ scaleY: [0.3, 1, 0.3] }}
                      transition={{
                        duration: 0.6,
                        repeat: Infinity,
                        delay: i * 0.1,
                      }}
                    />
                  ))}
                </div>
                <p className="text-skydark-text-secondary text-sm">Listening...</p>
              </>
            )}

            {voiceState === VoiceState.PROCESSING && (
              <>
                <div className="mb-6">
                  <motion.div
                    animate={{ rotate: 360 }}
                    transition={{ duration: 2, repeat: Infinity, ease: 'linear' }}
                  >
                    <VoiceMicIcon className="w-12 h-12 text-skydark-accent mx-auto" />
                  </motion.div>
                </div>
                <p className="text-skydark-text-secondary text-sm">Processing...</p>
              </>
            )}

            {voiceState === VoiceState.RESPONDING && (
              <>
                <div className="mb-4">
                  <VoiceMicIcon className="w-12 h-12 text-skydark-accent mx-auto" />
                </div>
                <div className="mb-4 min-h-[48px] flex items-center justify-center">
                  <p className="text-skydark-text font-medium">{transcript}</p>
                </div>
                <p className="text-skydark-text-secondary text-xs">Playing response...</p>
              </>
            )}

            {voiceState === VoiceState.ERROR && error && (
              <>
                <div className="mb-4">
                  <div className="w-12 h-12 rounded-full bg-red-100 dark:bg-red-900 flex items-center justify-center mx-auto">
                    <span className="text-xl">⚠️</span>
                  </div>
                </div>
                <p className="text-skydark-text font-medium mb-2">Error</p>
                <p className="text-skydark-text-secondary text-sm mb-6">{error}</p>
                <button
                  onClick={dismiss}
                  className="text-skydark-accent hover:text-skydark-accent/80 text-sm font-medium"
                >
                  Dismiss
                </button>
              </>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
