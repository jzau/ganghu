import type { ReactNode } from "react";
import { X } from "lucide-react";
import { Button } from "./Button";

export function Modal({
  title,
  children,
  onClose,
  className = "",
  titleClassName = "",
  hideCloseButton = false,
  closeOnBackdrop = false
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  className?: string;
  titleClassName?: string;
  hideCloseButton?: boolean;
  closeOnBackdrop?: boolean;
}) {
  return (
    <div className="nm-modal-backdrop" onClick={closeOnBackdrop ? onClose : undefined}>
      <div className={`nm-modal ${className}`} onClick={(event) => event.stopPropagation()}>
        <div className="nm-modal-head">
          <h2 className={`text-base font-extrabold ${titleClassName}`}>{title}</h2>
          {!hideCloseButton && (
            <Button variant="ghost" className="h-8 w-8 rounded-[10px] px-0" onClick={onClose} aria-label="Close">
              <X size={18} />
            </Button>
          )}
        </div>
        <div>{children}</div>
      </div>
    </div>
  );
}
