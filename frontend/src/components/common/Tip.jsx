import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * Small ⓘ icon that shows a tooltip on hover.
 * Usage: <Tip text="explanation here" />
 * Props:
 *   text  — tooltip content
 *   below — legacy hint, no longer used (placement is measured automatically)
 *
 * The bubble is rendered into document.body via a portal with fixed
 * positioning — table cards use overflow-x-auto, which clips any
 * absolutely-positioned tooltip that extends outside them, so the bubble
 * must escape the scroll container entirely.
 *
 * Placement: above the icon, offset to the right, so the mouse cursor
 * (which extends down-right from its hotspot) never covers the text.
 * Flips left near the right viewport edge; drops below the icon only
 * when there is no room above.
 */
export default function Tip({ text }) {
  const [show, setShow] = useState(false);
  const [pos, setPos] = useState(null); // { top, left } in viewport coords
  const iconRef = useRef(null);
  const bubbleRef = useRef(null);

  useLayoutEffect(() => {
    if (!show) { setPos(null); return; }
    const icon = iconRef.current?.getBoundingClientRect();
    const bubble = bubbleRef.current?.getBoundingClientRect();
    if (!icon || !bubble) return;

    let top = icon.top - bubble.height - 6;          // prefer above
    let left = icon.right + 6;                       // offset right of the icon
    if (left + bubble.width > window.innerWidth - 4) {
      left = icon.left - bubble.width - 6;           // flip to the left side
    }
    if (top < 4) top = icon.bottom + 12;             // no room above → below
    if (left < 4) left = 4;
    setPos({ top, left });
  }, [show, text]);

  return (
    <span
      className="relative inline-flex items-center ml-0.5 cursor-help"
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    >
      <span
        ref={iconRef}
        className="inline-flex items-center justify-center w-3 h-3 rounded-full border border-gray-600 text-gray-500 hover:border-gray-400 hover:text-gray-300 text-[8px] leading-none select-none font-bold transition-colors"
      >
        i
      </span>
      {show && createPortal(
        <span
          ref={bubbleRef}
          style={{ position: 'fixed', top: pos?.top ?? -9999, left: pos?.left ?? -9999 }}
          className="block w-52 px-2.5 py-1.5 rounded-md bg-gray-700 border border-gray-600 text-gray-100 text-[11px] leading-snug shadow-xl z-50 pointer-events-none whitespace-normal font-normal text-left"
        >
          {text}
        </span>,
        document.body
      )}
    </span>
  );
}
