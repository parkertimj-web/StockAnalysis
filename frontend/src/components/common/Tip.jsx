import { useState } from 'react';

/**
 * Small ⓘ icon that shows a tooltip on hover.
 * Usage: <Tip text="explanation here" />
 * Props:
 *   text  — tooltip content
 *   below — place tooltip below instead of above (good for table headers at top of page)
 */
export default function Tip({ text, below = false }) {
  const [show, setShow] = useState(false);
  return (
    <span
      className="relative inline-flex items-center ml-0.5 cursor-help"
      onMouseEnter={() => setShow(true)}
      onMouseLeave={() => setShow(false)}
    >
      <span className="inline-flex items-center justify-center w-3 h-3 rounded-full border border-gray-600 text-gray-500 hover:border-gray-400 hover:text-gray-300 text-[8px] leading-none select-none font-bold transition-colors">
        i
      </span>
      {show && (
        <span
          className={`absolute ${below ? 'top-full mt-1.5' : 'bottom-full mb-1.5'} left-1/2 -translate-x-1/2 w-52 px-2.5 py-1.5 rounded-md bg-gray-700 border border-gray-600 text-gray-100 text-[11px] leading-snug shadow-xl z-50 pointer-events-none whitespace-normal font-normal text-left`}
        >
          {text}
        </span>
      )}
    </span>
  );
}
