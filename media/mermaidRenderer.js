// Runs in a hidden webview: draws Mermaid sources and sends them back as PNG (base64).
(function () {
  const vscode = acquireVsCodeApi();
  const SCALE = 2;

  // Without HTML labels the SVG has no <foreignObject>, which would taint the canvas.
  mermaid.initialize({
    startOnLoad: false,
    securityLevel: 'strict',
    theme: 'default',
    htmlLabels: false,
    flowchart: { htmlLabels: false },
    fontFamily: 'Arial, Helvetica, sans-serif'
  });

  function svgSize(svg) {
    const viewBox = (svg.getAttribute('viewBox') || '').split(/[\s,]+/).map(Number);
    const width = viewBox[2] || parseFloat(svg.getAttribute('width')) || 800;
    const height = viewBox[3] || parseFloat(svg.getAttribute('height')) || 600;
    return { width: Math.ceil(width), height: Math.ceil(height) };
  }

  function loadImage(url) {
    return new Promise((resolve, reject) => {
      const image = new Image();
      image.onload = () => resolve(image);
      image.onerror = () => reject(new Error('the drawn diagram could not be read as an image'));
      image.src = url;
    });
  }

  async function toPng(id, source) {
    const { svg } = await mermaid.render('diagram' + id, source);
    const element = new DOMParser().parseFromString(svg, 'image/svg+xml').documentElement;
    const { width, height } = svgSize(element);
    element.setAttribute('width', String(width));
    element.setAttribute('height', String(height));
    element.removeAttribute('style');
    const xml = new XMLSerializer().serializeToString(element);
    const image = await loadImage('data:image/svg+xml;base64,' + btoa(unescape(encodeURIComponent(xml))));
    const canvas = document.createElement('canvas');
    canvas.width = width * SCALE;
    canvas.height = height * SCALE;
    const context = canvas.getContext('2d');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/png').split(',')[1];
  }

  window.addEventListener('message', async (event) => {
    const { id, source } = event.data || {};
    if (id === undefined) return;
    try {
      vscode.postMessage({ id, png: await toPng(id, source) });
    } catch (e) {
      vscode.postMessage({ id, error: String((e && e.message) || e).split('\n')[0] });
    }
  });
  vscode.postMessage({ ready: true });
})();
