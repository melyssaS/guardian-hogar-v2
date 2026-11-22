import { useEffect, useState } from 'react';

export const TOAST_MS = 3200;

interface ToastProps {
  /** Mensaje a mostrar; `seq` cambia en cada aviso para reiniciar el temporizador. */
  message: { text: string; seq: number } | null;
}

/** Aviso flotante del prototipo: aparece abajo a la derecha y se oculta a los 3,2 s. */
export function Toast({ message }: ToastProps) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!message) return;
    setVisible(true);
    const timer = setTimeout(() => setVisible(false), TOAST_MS);
    return () => clearTimeout(timer);
  }, [message]);

  return (
    <div className={`toast${visible ? ' show' : ''}`} role="status" aria-live="polite">
      {message?.text}
    </div>
  );
}
