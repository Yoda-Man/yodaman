/**
 * Holocron voice commands: what was said -> what the viewer should do.
 *
 * Pure, so every phrasing is tested without a microphone. Speech capture
 * reuses frontend/voiceCommands.js, the same wrapper Chat uses.
 *
 *   "where is AuthService" / "fly to …" / "find …" / "show me …" / "go to …"
 *       -> { action: 'fly', query }
 *   "reset" / "home" / "reset camera"      -> { action: 'reset' }
 *   "clear" / "deselect"                   -> { action: 'clear' }
 *   "hide tests" / "show docs" / …          -> { action: 'filter', key, value }
 *   "heatmap on" / "heat map off"           -> { action: 'heatmap', value }
 *   "play history" / "pause" / "now"        -> { action: 'play' | 'pause' | 'live' }
 */
import { normalizeVoiceTranscript } from '../../frontend/voiceCommands'

const FILTER_WORDS = {
  test: 'hideTests', tests: 'hideTests',
  doc: 'hideDocs', docs: 'hideDocs', documentation: 'hideDocs',
  'third party': 'hideThirdParty', 'third-party': 'hideThirdParty', vendor: 'hideThirdParty', dependencies: 'hideThirdParty'
}

const FLY = /^(?:hey yoda[,:]?\s+)?(?:where(?:'s| is| are)|fly(?: me)? to|go to|take me to|find|show me|locate|open|search for)\s+(?:the\s+)?(.+?)[\s.?!]*$/i

export function parseVoiceCommand(transcript) {
  const text = normalizeVoiceTranscript(transcript).replace(/^hey yoda[,:]?\s*/i, '').trim()
  const lower = text.toLowerCase().replace(/[.?!]+$/, '')
  if (!lower) return null

  if (/^(reset|reset (the )?(camera|view)|home|go home|overview)$/.test(lower)) return { action: 'reset' }
  if (/^(clear|deselect|clear selection|close)$/.test(lower)) return { action: 'clear' }
  if (/^(play|play history|replay|replay history|show history)$/.test(lower)) return { action: 'play' }
  if (/^(pause|stop)$/.test(lower)) return { action: 'pause' }
  if (/^(now|live|back to now|present)$/.test(lower)) return { action: 'live' }

  const heat = /^(?:turn\s+)?(?:the\s+)?heat\s?map\s+(on|off)$|^(show|hide)\s+(?:the\s+)?heat\s?map$/.exec(lower)
  if (heat) return { action: 'heatmap', value: heat[1] ? heat[1] === 'on' : heat[2] === 'show' }

  const filter = /^(hide|show)\s+(?:the\s+)?(.+)$/.exec(lower)
  if (filter && FILTER_WORDS[filter[2]]) {
    return { action: 'filter', key: FILTER_WORDS[filter[2]], value: filter[1] === 'hide' }
  }

  const fly = FLY.exec(text)
  if (fly) {
    // Speech engines split identifiers: "auth service" should find AuthService.
    const query = fly[1].replace(/\s+dot\s+/gi, '.').trim()
    return query ? { action: 'fly', query } : null
  }
  return null
}

/**
 * Candidate spellings for a spoken name: as said, without spaces
 * ("auth service" -> "authservice"), and with underscores.
 */
export function spokenVariants(query) {
  const base = String(query || '').trim()
  return [...new Set([base, base.replace(/\s+/g, ''), base.replace(/\s+/g, '_')])].filter(Boolean)
}
