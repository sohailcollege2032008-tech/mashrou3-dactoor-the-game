/**
 * Detects if a string contains any Arabic characters.
 * @param {string} text 
 * @returns {boolean}
 */
export const hasArabic = (text) => {
  if (typeof text !== 'string') return false;
  // Regex for Arabic character range
  return /[\u0600-\u06FF]/.test(text);
};

/**
 * Gets the text direction based on content and an optional force flag.
 * @param {string} text 
 * @param {boolean} forceRtl 
 * @returns {'rtl' | 'ltr' | 'auto'}
 */
export const getDir = (text, forceRtl = false) => {
  if (forceRtl) return 'rtl';
  return hasArabic(text) ? 'rtl' : 'ltr';
};
