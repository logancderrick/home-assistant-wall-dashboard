/**
 * Floating voice control button.
 * Fixed position at bottom-left, only visible when voice is enabled.
 */

import { motion } from 'framer-motion';
import { useVoiceContext } from '../../contexts/VoiceContext';
import { VoiceState } from '../../lib/voice/constants';
import VoiceMicIcon from './VoiceMicIcon';

export default function VoiceButton() {
  const { voiceState, isEnabled, startListening, stopListening } = useVoiceContext();

  if (!isEnabled) return null;

  const isActive = voiceState !== VoiceState.IDLE && voiceState !== VoiceState.ERROR;
  const isListening = voiceState === VoiceState.LISTENING;
  const isProcessing = voiceState === VoiceState.PROCESSING;

  return (
    <motion.button
      className="fixed bottom-8 left-6 z-40 rounded-full bg-skydark-accent text-white shadow-lg hover:shadow-xl focus:outline-none focus:ring-2 focus:ring-skydark-accent focus:ring-offset-2"
      style={{ width: 56, height: 56 }}
      onClick={() => {
        if (isActive) {
          stopListening();
        } else {
          void startListening();
        }
      }}
      whileTap={{ scale: 0.95 }}
      initial={{ scale: 0, opacity: 0 }}
      animate={{ scale: 1, opacity: 1 }}
      exit={{ scale: 0, opacity: 0 }}
      transition={{ duration: 0.2 }}
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

      <VoiceMicIcon className="w-6 h-6 mx-auto" />
    </motion.button>
  );
}
