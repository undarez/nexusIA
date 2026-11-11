import { WebviewWindow } from '@tauri-apps/api/webviewWindow';

const isTauri = () => typeof window !== 'undefined' && '__TAURI_INTERNALS__' in window;
let companionOpening: Promise<void> | null = null;

export async function openNexusBrowser(target: string) {
  if (!isTauri()) {
    const opened = window.open(target, '_blank');
    if (!opened) throw new Error('Le navigateur a bloqué la nouvelle fenêtre. Autorise les fenêtres contextuelles pour localhost, puis réessaie.');
    opened.opener = null;
    return;
  }
  const previous = await WebviewWindow.getByLabel('nexus-browser');
  if (previous) await previous.close();
  const webview = new WebviewWindow('nexus-browser', {
    url: target,
    title: 'Navigateur NEXUS',
    width: 1180,
    height: 780,
    minWidth: 760,
    minHeight: 520,
    center: true,
    resizable: true,
    decorations: true,
    focus: true,
  });
  return new Promise<void>((resolve, reject) => {
    webview.once('tauri://created', () => resolve());
    webview.once('tauri://error', (event) => reject(new Error(String(event.payload))));
  });
}

export function openNexusCompanion() {
  if (!isTauri()) return Promise.reject(new Error('Le compagnon bureau est disponible dans l’application Windows.'));
  if (companionOpening) return companionOpening;
  companionOpening = (async () => {
    const current = await WebviewWindow.getByLabel('nexus-companion');
    if (current) {
      await current.show();
      await current.setFocus();
      return;
    }
    const target = `${window.location.origin}/?nexusCompanion=1`;
    const companion = new WebviewWindow('nexus-companion', {
      url: target,
      title: 'NEXUS-01 · Compagnon',
      width: 380,
      height: 690,
      minWidth: 340,
      minHeight: 560,
      x: Math.max(0, window.screen.width - 395),
      y: 80,
      center: false,
      resizable: true,
      decorations: false,
      transparent: true,
      alwaysOnTop: true,
      skipTaskbar: true,
      shadow: false,
      focus: true,
    });
    await new Promise<void>((resolve, reject) => {
      companion.once('tauri://created', () => resolve());
      companion.once('tauri://error', (event) => reject(new Error(String(event.payload))));
    });
  })().finally(() => { companionOpening = null; });
  return companionOpening;
}
