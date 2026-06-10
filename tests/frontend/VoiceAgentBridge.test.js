const fs = require('fs');
const path = require('path');

describe('voice agent bridge contract', () => {
    const bridgePath = path.resolve(__dirname, '../../frontend/voiceAgentBridge.js');
    const voiceCommandsPath = path.resolve(__dirname, '../../frontend/voiceCommands.js');
    const chatPath = path.resolve(__dirname, '../../src/components/AgentChatTab.jsx');

    function read(filePath) {
        return fs.readFileSync(filePath, 'utf8');
    }

    test('creates a local Web Speech bridge for conversational agent input', () => {
        const text = read(bridgePath);

        expect(text).toContain("from './voiceCommands.js'");
        expect(text).toContain('VoiceAgentBridge');
        expect(text).toContain('SILENCE_TIMEOUT_MS = 10000');
        expect(text).toContain('AUTO_SUBMIT_PAUSE_MS = 2000');
        expect(text).toContain('readVoiceAgentSettings');
        expect(text).toContain('writeVoiceAgentSettings');
        expect(text).toContain('speakAgentResponse');
        expect(text).toContain('interpretVoiceAgentCommand');
        expect(text).toContain('Ask agent about this');
        expect(text).toContain('Find similar files');
        expect(text).toContain('Hey Yoda');
    });

    test('centralizes SpeechRecognition setup and punctuation normalization', () => {
        const text = read(voiceCommandsPath);

        expect(text).toContain('getSpeechRecognitionConstructor');
        expect(text).toContain('createSpeechRecognition');
        expect(text).toContain('normalizeVoiceTranscript');
        expect(text).toContain('new line');
        expect(text).toContain('question mark');
        expect(text).toContain('period');
    });

    test('agent chat uses the bridge for listening state, interim transcription, and voice settings', () => {
        const text = read(chatPath);

        expect(text).toContain("from '../../frontend/voiceAgentBridge.js'");
        expect(text).toContain('Listening...');
        expect(text).toContain('interimTranscript');
        expect(text).toContain('voiceSettings');
        expect(text).toContain('Voice input');
        expect(text).toContain('Hotword');
        expect(text).toContain('Voice output');
        expect(text).toContain('voiceBridgeRef.current.startContinuousListening');
    });
});
