// backend/services/chatHandler.js
/**
 * Simple chat handler service to manage the current query mode (code or documentation).
 */
let currentMode = 'code'; // default mode

function setMode(mode) {
  if (['code', 'doc'].includes(mode)) {
    currentMode = mode;
  } else {
    throw new Error('Invalid mode');
  }
}

function getMode() {
  return currentMode;
}

module.exports = { setMode, getMode };
