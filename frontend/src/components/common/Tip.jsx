import { useLayoutEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';

/**
 * Small ⓘ icon that shows a tooltip on hover.
 * Usage: <Tip text="explanation here" />
 *
 * The bubble is rendered into document.body via a portal with fixed
 * positioning — table cards use overflow-x-auto, which clips any
 * absolutely-positioned tooltip that extends outside them, so the bubble
 * must escape the scroll container entirely.
 *
 * Placement: always above the icon, offset to the right (or left near the
 * right viewport edge), so the mouse cursor never covers the text. A long
 * tip that doesn't fit above at the normal width is widened to shorten it;
 * if it still can't fit, it's pinned to the top of the viewport, where it
 * sits beside the icon rather than over or below it.
 */
const GAP = 6;
const EDGE = 4;

export default function Tip({ text }) {
  const [show, setShow] = useState(false);
  const [wide, setWide] = useState(false);
  const [pos, setPos] = useState(null); // { top, left } in viewport coords
  const iconRef = useRef(null);
  const bubbleRef = useRef(null);

  useLayoutEffect(() => {
    if (!show) { setPos(null); setWide(false); return; }
    const icon = iconRef.current?.getBoundingClientRect();
    const bubble = bubbleRef.current?.getBoundingClientRect();
    if (!icon || !bubble) return;

    const topAbove = icon.top - bubble.height - GAP;
    if (topAbove < EDGE && !wide) { setWide(true); return; } // re-measure wider (shorter)

    let left = icon.right + GAP;
    if (left + bubble.width > window.innerWidth - EDGE) left = icon.left - bubble.width - GAP;
    setPos({ top: Math.max(EDGE, topAbove), left: Math.max(EDGE, left) });
  }, [show, text, wide]);

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
          className={`block ${wide ? 'w-96' : 'w-52'} max-w-[calc(100vw-8px)] px-2.5 py-1.5 rounded-md bg-gray-700 border border-gray-600 text-gray-100 text-[11px] leading-snug shadow-xl z-50 pointer-events-none whitespace-normal font-normal text-left`}
        >
          {text}
        </span>,
        document.body
      )}
    </span>
  );
}
