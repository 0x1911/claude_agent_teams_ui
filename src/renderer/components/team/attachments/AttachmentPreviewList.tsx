import { useState } from 'react';

import { AlertCircle, X } from 'lucide-react';

import { AttachmentPreviewItem } from './AttachmentPreviewItem';
import { ImageLightbox } from './ImageLightbox';

import type { AttachmentPayload } from '@shared/types';

interface AttachmentPreviewListProps {
  attachments: AttachmentPayload[];
  onRemove: (id: string) => void;
  error?: string | null;
  onDismissError?: () => void;
  /** When true, previews are overlaid with a disabled indicator (recipient doesn't support attachments). */
  disabled?: boolean;
  /** Hint text shown when disabled and attachments are present. */
  disabledHint?: string;
}

export const AttachmentPreviewList = ({
  attachments,
  onRemove,
  error,
  onDismissError,
  disabled,
  disabledHint,
}: AttachmentPreviewListProps): React.JSX.Element | null => {
  const [lightboxIndex, setLightboxIndex] = useState<number | null>(null);

  if (attachments.length === 0 && !error) return null;

  const lightboxSlides = attachments.map((att) => ({
    src: `data:${att.mimeType};base64,${att.data}`,
    alt: att.filename,
  }));

  return (
    <div className="space-y-1.5 px-1">
      {attachments.length > 0 ? (
        <div className="flex gap-2 overflow-x-auto py-1">
          {attachments.map((att, i) => (
            <AttachmentPreviewItem
              key={att.id}
              attachment={att}
              onRemove={onRemove}
              onPreview={() => setLightboxIndex(i)}
              disabled={disabled}
            />
          ))}
        </div>
      ) : null}
      {disabled && disabledHint && attachments.length > 0 ? (
        <div
          className="flex items-center gap-1.5 rounded-md px-2.5 py-1.5"
          style={{ backgroundColor: 'var(--warning-bg)', color: 'var(--warning-text)' }}
        >
          <AlertCircle size={13} className="shrink-0" />
          <p className="text-[11px]">{disabledHint}</p>
        </div>
      ) : null}
      {error ? (
        <div className="flex items-center gap-1.5 rounded-md bg-red-500/10 px-2.5 py-1.5">
          <AlertCircle size={13} className="shrink-0 text-red-400" />
          <p className="flex-1 text-[11px] text-red-400">{error}</p>
          {onDismissError ? (
            <button
              type="button"
              className="shrink-0 rounded p-0.5 text-red-400 transition-colors hover:bg-red-500/20 hover:text-red-300"
              onClick={onDismissError}
            >
              <X size={12} />
            </button>
          ) : null}
        </div>
      ) : null}
      {lightboxIndex !== null && lightboxSlides[lightboxIndex] ? (
        <ImageLightbox
          open
          onClose={() => setLightboxIndex(null)}
          slides={lightboxSlides}
          index={lightboxIndex}
        />
      ) : null}
    </div>
  );
};
