/**
 * Voice status indicator.
 * Shows wake word listening status and active voice states.
 * Fixed position at bottom-left, only visible when voice is enabled.
 */

import { motion, AnimatePresence } from 'framer-motion';
import { useVoiceContext } from '../../contexts/VoiceContext';
import { VoiceState } from '../../lib/voice/constants';
import VoiceMicIcon from './VoiceMicIcon';

export default function VoiceButton() {
  const { voiceState, isEnabled, isListeningForWakeWord, startListening, stopListening } = useVoiceContext();

  if (!isEnabled) return null;

  const isActive = voiceState !== VoiceState.IDLE && voiceState !== VoiceState.ERROR;
  const isListening = voiceState === VoiceState.LISTENING;
  const isProcessing = voiceState === VoiceState.PROCESSING;
  const isResponding = voiceState === VoiceState.RESPONDING;

  return (
    <AnimatePresence>
      {isListeningForWakeWord || isActive ? (
        <motion.div
          className="fixed bottom-8 left-6 z-40"
          initial={{ scale: 0, opacity: 0 }}
          animate={{ scale: 1, opacity: 1 }}
          exit={{ scale: 0, opacity: 0 }}
          transition={{ duration: 0.2 }}
        >
          {/* Manual trigger button (optional fallback) */}
          <motion.button
            className="w-14 h-14 rounded-full bg-skydark-accent text-white shadow-lg hover:shadow-xl focus:outline-none focus:ring-2 focus:ring-skydark-accent focus:ring-offset-2 flex items-center justify-center"
            onClick={() => {
              if (isActive) {
                stopListening();
              } else {
                void startListening();
              }
            }}
            whileTap={{ scale: 0.95 }}
            title={isListeningForWakeWord ? 'Say "Hey Jarvis" or tap to speak' : 'Tap to stop'}
          >
            {isListening && (
              <motion.div
                className="absolute inset-0 rounded-full border-2 border-white"
                animate={{ scale: [1, 1.2, 1], opacity: [1, 0.6, 1] }}
                transition={{ duration: 1.5, repeat: Infinity }}
              />
            )}

            {isProcessing && (
              <motion.div
                className="absolute inset-0 rounded-full border-2 border-white border-t-transparent"
                animate={{ rotate: 360 }}
                transition={{ duration: 1, repeat: Infinity, ease: 'linear' }}
              />
            )}

            {isResponding && (
              <motion.div
                className="absolute inset-0 rounded-full border-2 border-white"
                animate={{ opacity: [1, 0.5, 1] }}
                transition={{ duration: 1, repeat: Infinity }}
              />
            )}

            <VoiceMicIcon className="w-6 h-6 relative z-10" />
          </motion.button>

          {/* Listening for wake word indicator (subtle pulsing dot) */}
          {isListeningForWakeWord && !isActive && (
            <motion.div
              className="absolute -top-1 -right-1 w-3 h-3 bg-green-500 rounded-full"
              animate={{ scale: [1, 1.3, 1], opacity: [0.7, 1, 0.7] }}
              transition={{ duration: 2, repeat: Infinity }}
              title="Listening for 'Hey Jarvis'"
            />
          )}
        </motion.div>
      ) : null}
    </AnimatePresence>
  );
}
