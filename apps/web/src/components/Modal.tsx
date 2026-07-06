import type { ReactNode } from "react";
import { X } from "lucide-react";
import { Button } from "./Button";

export function Modal({ title, children, onClose, className = "" }: { title: string; children: ReactNode; onClose: () => void; className?: string }) {
  return (
    <div className="nm-modal-backdrop">
      <div className={`nm-modal ${className}`}>
        <div className="nm-modal-head">
          <h2 className="text-base font-extrabold">{title}</h2>
          <Button variant="ghost" className="h-8 w-8 rounded-[10px] px-0" onClick={onClose} aria-label="Close">
            <X size={18} />
          </Button>
        </div>
        <div>{children}</div>
      </div>
    </div>
  );
}
