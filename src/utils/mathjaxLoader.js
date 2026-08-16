let mathjaxPromise = null;

/**
 * Dynamically loads and initializes MathJax 3 on-demand.
 * Does not block initial page render or download bytes on pages without MathML.
 */
export function loadMathJax() {
  if (typeof window === 'undefined') return Promise.resolve();

  if (window.MathJax && window.MathJax.typesetPromise) {
    return Promise.resolve(window.MathJax);
  }

  if (mathjaxPromise) {
    return mathjaxPromise;
  }

  mathjaxPromise = new Promise((resolve, reject) => {
    // Configure MathJax before script loads
    window.MathJax = {
      loader: { load: ['input/mml', 'output/chtml'] },
      displayAlign: 'inherit',
      chtml: {
        displayAlign: 'inherit',
        matchFontHeight: true
      },
      startup: {
        ready: () => {
          window.MathJax.startup.defaultReady();
          resolve(window.MathJax);
        }
      }
    };

    const script = document.createElement('script');
    script.src = 'https://cdn.jsdelivr.net/npm/mathjax@3/es5/mml-chtml.js';
    script.async = true;
    script.onload = () => {
      if (window.MathJax && window.MathJax.typesetPromise) {
        resolve(window.MathJax);
      }
    };
    script.onerror = (err) => {
      console.error('[MathJax] Failed to load dynamic MathJax bundle:', err);
      mathjaxPromise = null;
      reject(err);
    };

    document.head.appendChild(script);
  });

  return mathjaxPromise;
}
