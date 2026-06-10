import { createSpeechRecognition, normalizeVoiceTranscript } from './voiceCommands.js'

export const SILENCE_TIMEOUT_MS = 10000
export const AUTO_SUBMIT_PAUSE_MS = 2000
const SETTINGS_KEY = 'yodaman:voiceAgentSettings'
const HOTWORD = 'Hey Yoda'

export const DEFAULT_VOICE_AGENT_SETTINGS = {
  voiceInputEnabled: true,
  hotwordDetectionEnabled: false,
  voiceOutputEnabled: false
}

export function readVoiceAgentSettings(storage = localStorage) {
  try {
    return {
      ...DEFAULT_VOICE_AGENT_SETTINGS,
      ...JSON.parse(storage.getItem(SETTINGS_KEY) || '{}')
    }
  } catch {
    return { ...DEFAULT_VOICE_AGENT_SETTINGS }
  }
}

export function writeVoiceAgentSettings(settings, storage = localStorage) {
  const next = { ...DEFAULT_VOICE_AGENT_SETTINGS, ...settings }
  storage.setItem(SETTINGS_KEY, JSON.stringify(next))
  return next
}

export function stripHotword(transcript) {
  return String(transcript || '').replace(/\bhey\s+yoda\b[:,]?\s*/i, '').trim()
}

export function interpretVoiceAgentCommand(transcript, context = {}) {
  const normalized = normalizeVoiceTranscript(stripHotword(transcript))
  const lower = normalized.toLowerCase()

  if (lower.includes('ask agent about this')) {
    return {
      label: 'Ask agent about this',
      query: context.inVr
        ? 'Inspect the current VR selection and explain what I should know about it.'
        : 'Inspect the current context and explain what I should know about it.',
      context
    }
  }

  if (lower.includes('find similar files')) {
    return {
      label: 'Find similar files',
      query: 'Find files similar to the current selection or active file, then summarize why they are related.',
      context
    }
  }

  return null
}

export function speakAgentResponse(text, settings = readVoiceAgentSettings(), windowRef = window) {
  if (!settings.voiceOutputEnabled || !text || !windowRef.speechSynthesis) return false
  windowRef.speechSynthesis.cancel()
  const utterance = new SpeechSynthesisUtterance(String(text))
  utterance.rate = 1
  utterance.pitch = 1
  windowRef.speechSynthesis.speak(utterance)
  return true
}

export class VoiceAgentBridge {
  constructor({
    windowRef = window,
    settings = readVoiceAgentSettings(),
    onListeningChange = () => {},
    onTranscript = () => {},
    onInterim = () => {},
    onAutoSubmit = () => {},
    onCommand = () => {},
    onError = () => {}
  } = {}) {
    this.windowRef = windowRef
    this.settings = settings
    this.onListeningChange = onListeningChange
    this.onTranscript = onTranscript
    this.onInterim = onInterim
    this.onAutoSubmit = onAutoSubmit
    this.onCommand = onCommand
    this.onError = onError
    this.recognition = null
    this.silenceTimer = null
    this.pauseTimer = null
    this.finalTranscript = ''
    this.activeContext = {}
  }

  updateSettings(settings) {
    this.settings = { ...DEFAULT_VOICE_AGENT_SETTINGS, ...settings }
  }

  startContinuousListening({ context = {}, hotwordRequired = false } = {}) {
    if (!this.settings.voiceInputEnabled) {
      this.onError('Voice input is disabled.')
      return false
    }

    this.stop()
    this.activeContext = context
    this.finalTranscript = ''
    this.recognition = createSpeechRecognition({
      continuous: true,
      interimResults: true,
      onStart: () => {
        this.onListeningChange(true)
        this.resetSilenceTimer()
      },
      onEnd: () => this.onListeningChange(false),
      onError: event => {
        this.onListeningChange(false)
        this.onError(event?.error ? `Voice input failed: ${event.error}` : 'Voice input failed.')
      },
      onResult: event => this.handleResult(event, hotwordRequired)
    }, this.windowRef)

    if (!this.recognition) {
      this.onError('Voice input is not available in this browser.')
      return false
    }

    this.recognition.start()
    return true
  }

  handleResult(event, hotwordRequired) {
    let interim = ''
    let finalChunk = ''

    for (let index = event.resultIndex || 0; index < event.results.length; index += 1) {
      const text = event.results[index][0]?.transcript || ''
      if (event.results[index].isFinal) {
        finalChunk += ` ${text}`
      } else {
        interim += ` ${text}`
      }
    }

    const visibleInterim = normalizeVoiceTranscript(interim)
    if (visibleInterim) this.onInterim(visibleInterim)

    if (!finalChunk.trim()) {
      this.resetSilenceTimer()
      return
    }

    let nextFinal = normalizeVoiceTranscript(`${this.finalTranscript} ${finalChunk}`)
    const hasHotword = /\bhey\s+yoda\b/i.test(nextFinal)
    if (hotwordRequired && !hasHotword) {
      this.resetSilenceTimer()
      return
    }
    nextFinal = normalizeVoiceTranscript(stripHotword(nextFinal))

    const command = interpretVoiceAgentCommand(nextFinal, this.activeContext)
    if (command) {
      this.onCommand(command)
      this.stop()
      return
    }

    this.finalTranscript = nextFinal
    this.onTranscript({
      text: this.finalTranscript,
      interim: visibleInterim,
      hotwordDetected: hasHotword,
      source: HOTWORD
    })
    this.onInterim('')
    this.resetSilenceTimer()
    this.resetAutoSubmitTimer()
  }

  resetSilenceTimer() {
    this.windowRef.clearTimeout(this.silenceTimer)
    this.silenceTimer = this.windowRef.setTimeout(() => this.stop(), SILENCE_TIMEOUT_MS)
  }

  resetAutoSubmitTimer() {
    this.windowRef.clearTimeout(this.pauseTimer)
    this.pauseTimer = this.windowRef.setTimeout(() => {
      if (this.finalTranscript.trim()) {
        this.onAutoSubmit({ text: this.finalTranscript, source: 'voice-pause' })
        this.stop()
      }
    }, AUTO_SUBMIT_PAUSE_MS)
  }

  stop() {
    this.windowRef.clearTimeout(this.silenceTimer)
    this.windowRef.clearTimeout(this.pauseTimer)
    if (this.recognition) {
      const current = this.recognition
      this.recognition = null
      current.onend = null
      current.stop()
    }
    this.onListeningChange(false)
  }
}
