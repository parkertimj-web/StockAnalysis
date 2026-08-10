// Draggable horizontal grab-bar for resizing a chart panel vertically.
// Calls onLiveResize(height) continuously during the drag (use it to
// applyOptions on the chart instance without rebuilding it) and
// onCommit(height) once on release (use it to persist the new height).
export default function ResizeHandle({ height, min = 100, max = 900, onLiveResize, onCommit }) {
  function onPointerDown(e) {
    e.preventDefault();
    const startY = e.clientY;
    const startH = height;
    let latest = startH;

    function move(ev) {
      latest = Math.round(Math.min(max, Math.max(min, startH + (ev.clientY - startY))));
      onLiveResize?.(latest);
    }
    function up() {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      if (latest !== startH) onCommit?.(latest);
    }
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  }

  return (
    <div
      onPointerDown={onPointerDown}
      className="h-2.5 flex items-center justify-center cursor-ns-resize group select-none touch-none"
      title="Drag to resize chart height"
    >
      <div className="w-10 h-1 rounded-full bg-gray-700 group-hover:bg-blue-500 transition-colors" />
    </div>
  );
}
