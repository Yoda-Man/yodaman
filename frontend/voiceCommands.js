export function getSpeechRecognitionConstructor(windowRef = window) {
  return windowRef.SpeechRecognition || windowRef.webkitSpeechRecognition || null
}

export function createSpeechRecognition({
  continuous = false,
  interimResults = true,
  lang,
  onStart,
  onEnd,
  onError,
  onResult
} = {}, windowRef = window) {
  const SpeechRecognition = getSpeechRecognitionConstructor(windowRef)
  if (!SpeechRecognition) return null

  const recognition = new SpeechRecognition()
  recognition.continuous = continuous
  recognition.interimResults = interimResults
  recognition.lang = lang || windowRef.navigator?.language || 'en-US'
  recognition.onstart = onStart || null
  recognition.onend = onEnd || null
  recognition.onerror = onError || null
  recognition.onresult = onResult || null
  return recognition
}

export function normalizeVoiceTranscript(value) {
  return String(value || '')
    .replace(/\bnew line\b/gi, '\n')
    .replace(/\bquestion mark\b/gi, '?')
    .replace(/\bexclamation mark\b/gi, '!')
    .replace(/\bcomma\b/gi, ',')
    .replace(/\bcolon\b/gi, ':')
    .replace(/\bsemicolon\b/gi, ';')
    .replace(/\bperiod\b/gi, '.')
    .replace(/[ \t]+\n/g, '\n')
    .replace(/\n[ \t]+/g, '\n')
    .replace(/[ \t]{2,}/g, ' ')
    .trim()
}
